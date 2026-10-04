import { BenchmarkArtifactSchema, LABEL_PRODUCT_IDS, TEAM_GRAPH, WORKBOOK_PRODUCTS, productLabel as workbookLabel, type BenchmarkArtifact, type PremiseReport } from '@her2/shared';
import results from '../../../evals/results.json';
import chatOffline from '../../../evals/chat.json';
import chatLive from '../../../evals/chat-live.json';
import teamLive from '../../../evals/team-live.json';
import premiseStudy from '../../../evals/premise-study.json';
import liveStudy from '../../../evals/live-retrieval.json';
import verifier from '../../../evals/verifier-study.json';
import verifierBeforeFix from '../../../evals/verifier-before-fix.json';
import selection from '../../../evals/selection-study.json';
import modelChecks from '../../../evals/models.json';
import { molecules } from '../../../data/model_observations.json';
import { record_count as workbookRecordCount, filename as workbookFile } from '../../api/src/workbook.snapshot.json';

export type BenchmarkLoad =
  | { state: 'missing' }
  | { state: 'invalid'; issue: string }
  | { state: 'ready'; artifact: BenchmarkArtifact };

/** Validates against the shared schema. Anything that does not parse is reported as invalid, never shown as results. */
export function parseBenchmark(value: unknown): BenchmarkLoad {
  if (value === undefined || value === null) return { state: 'missing' };
  const parsed = BenchmarkArtifactSchema.safeParse(value);
  if (!parsed.success) return { state: 'invalid', issue: parsed.error.issues[0]?.message ?? 'does not match BenchmarkArtifactSchema' };
  return { state: 'ready', artifact: parsed.data };
}

const ratio = (count: number, total: number) => `${count}/${total}`;

/** "UK-KADCYLA-SMPC" -> "Kadcyla label", using the shared label-product list; unknown ids are shown as-is. */
export function labelSourceName(sourceId: string): string {
  const product = LABEL_PRODUCT_IDS.find(id => sourceId === `UK-${workbookLabel(id).toUpperCase()}-SMPC`);
  return product ? `${workbookLabel(product)} label` : sourceId;
}
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Missing recorded ${what}`);
  return value;
}

export const SOURCE_NAMES: Record<string, string> = {
  clinicaltrials_gov: 'ClinicalTrials.gov', pubmed: 'PubMed', openfda: 'openFDA', dailymed: 'DailyMed', adcdb: 'ADCdb',
};

export const PRESENTATION_SECTIONS = [
  { id: 'p-why', short: 'Why' },
  { id: 'p-problem', short: 'Problem' },
  { id: 'p-environment', short: 'Environment' },
  { id: 'p-harness', short: 'Harness' },
  { id: 'p-premise', short: 'False premise' },
  { id: 'p-bait', short: 'Hallucination bait' },
  { id: 'p-benchmark', short: 'Benchmark' },
  { id: 'p-failures', short: 'Failures' },
  { id: 'p-limits', short: 'Limits' },
] as const;
export type SectionId = typeof PRESENTATION_SECTIONS[number]['id'];

/** Every number the presentation shows is computed here from committed artifacts. */
export function loadPresentationData(benchmark: BenchmarkLoad) {
  const premiseRow = (id: string) => must(premiseStudy.rows.find(row => row.case_id === id), `premise case ${id}`);
  const verdictRow = (product: string, question: string, policy: string) =>
    must(results.verdicts.rows.find(row => row.product_id === product && row.question_id === question && row.evidence_policy === policy), `verdict ${product}/${question}/${policy}`);
  const liveRows = liveStudy.rows;
  const sources = liveStudy.manifest.catalog.sources.map(source => {
    const example = must(liveRows.find(row => row.source === source.id), `live receipt for ${source.id}`);
    return { id: source.id, name: SOURCE_NAMES[source.id] ?? source.id, host: source.host, purpose: source.purpose, example_url: example.url, example_status: example.status, example_http: example.http_status, example_sha256: example.raw_sha256, subject: example.subject };
  });
  const fakeNct = must(liveRows.find(row => row.source === 'clinicaltrials_gov' && row.status === 'not_found'), 'ClinicalTrials.gov not_found receipt');
  const realNct = must(liveRows.find(row => row.source === 'clinicaltrials_gov' && row.status === 'ok'), 'ClinicalTrials.gov ok receipt');
  const kadcylaChat = must(chatOffline.rows.find(row => row.id === 'Kadcyla_linker_release_all'), 'chat row Kadcyla_linker_release_all');
  const enhertuLive = must(chatLive.rows.find(row => row.id === 'linker_counter_evidence'), 'chat-live row linker_counter_evidence');
  const teamLinker = must(teamLive.rows.find(row => row.id === 'live_linker_counter_evidence'), 'team-live row live_linker_counter_evidence');
  const shift = must(results.verdicts.shifts.find(row => row.product_id === 'DRG0ERKBH' && row.question_id === 'linker_release'), 'Enhertu linker shift');
  const refused = (rows: readonly { status: string; error_code?: string }[]) => rows.filter(row => row.error_code === 'CLAUDE_REFUSED').length;
  const survivors = verifier.mutants.filter(mutant => !mutant.detected);
  const noHandle = must(molecules.find(molecule => molecule.id === 'control-04'), 'model control-04');
  const twoHandle = molecules.filter(molecule => molecule.has_two_mapped_attachments && molecule.proxy_reward === noHandle.proxy_reward);
  const mapped = must(selection.arms.find(arm => arm.arm === 'mapped'), 'selection arm mapped');
  const unmapped = must(selection.arms.find(arm => arm.arm === 'unmapped'), 'selection arm unmapped');
  return {
    benchmark,
    environment: {
      workbookRecords: workbookRecordCount, workbookFile,
      scopedProducts: WORKBOOK_PRODUCTS.length,
      labelProducts: LABEL_PRODUCT_IDS.map(workbookLabel),
      usLabelProducts: WORKBOOK_PRODUCTS.filter(product => product.us_label).length,
      labelSources: [...new Set(results.verdicts.rows.flatMap(row => row.receipts_read).filter(id => id.startsWith('UK-')))].sort(),
      sources, maxReferences: liveStudy.manifest.catalog.max_references, timeoutMs: liveStudy.manifest.catalog.timeout_ms,
    },
    harness: {
      nodes: TEAM_GRAPH.nodes as readonly string[],
      teamGraph: teamLive.graph,
      leadCap: teamLive.limits.max_lead_calls, workerCap: teamLive.limits.max_worker_calls, retries: teamLive.limits.retries,
      chatLiveRows: chatLive.rows.length, chatLiveComplete: chatLive.rows.filter(row => row.status === 'complete').length,
      teamLiveRows: teamLive.rows.length, teamLiveRefused: refused(teamLive.rows),
    },
    premise: {
      question: premiseStudy.exhibit.question,
      report: premiseStudy.exhibit.report as unknown as PremiseReport,
      modelCalls: premiseStudy.provider_requests,
      gate: { controls: ratio(premiseStudy.controls_cleared, premiseStudy.control_count), faults: ratio(premiseStudy.faults_as_expected, premiseStudy.fault_count) },
      kadcylaVerdict: verdictRow('DRG0CYMEB', 'linker_release', 'all'),
      kadcylaChat: { modelCalls: kadcylaChat.model_calls, sourceReads: kadcylaChat.source_reads, verdict: must(kadcylaChat.claims[0], 'Kadcyla chat claim').verdict, cited: must(kadcylaChat.claims[0], 'Kadcyla chat claim').cited_source_ids },
      enhertuLive: { modelCalls: enhertuLive.model_calls, verdict: must(enhertuLive.claims[0], 'Enhertu live claim').verdict, cited: must(enhertuLive.claims[0], 'Enhertu live claim').cited_source_ids, status: enhertuLive.status },
      teamLinker: { status: teamLinker.status, code: teamLinker.error_code ?? null, requests: teamLinker.actual_provider_requests },
    },
    bait: {
      invented: premiseRow('invented_code.zentrovab'),
      fakeNct: premiseRow('nct_reference.enhertu_linker'),
      modelCalls: premiseStudy.provider_requests,
      receipt: { url: fakeNct.url, subject: fakeNct.subject, status: fakeNct.status, http: fakeNct.http_status, sha256: fakeNct.raw_sha256, fetchedAt: fakeNct.fetched_at, bytes: fakeNct.bytes },
      realReceipt: { subject: realNct.subject, status: realNct.status, http: realNct.http_status },
    },
    failures: {
      refusals: { chat: `${refused(chatLive.rows as { status: string; error_code?: string }[])}/${chatLive.rows.length}`, team: ratio(refused(teamLive.rows), teamLive.rows.length), retries: teamLive.retries },
      keyOrder: { before: ratio(verifierBeforeFix.controls_accepted, verifierBeforeFix.control_count), after: ratio(verifier.controls_accepted, verifier.control_count) },
      shortcut: { eligibleOnly: ratio(selection.baseline.eligible_only_accepted, selection.baseline.total), kindOnly: ratio(selection.baseline.kind_only_accepted, selection.baseline.total), mapped: ratio(mapped.accepted, mapped.attempts), unmapped: ratio(unmapped.accepted, unmapped.attempts) },
      mutants: { caught: ratio(verifier.mutants_detected, verifier.mutant_count), survivors: survivors.map(mutant => mutant.name), escaped: survivors.reduce((sum, mutant) => sum + mutant.escaped_faults, 0) },
      proxy: { name: noHandle.name, reward: noHandle.proxy_reward, handles: noHandle.attachment_points, sameScoreTwoHandle: twoHandle.length, replayRows: modelChecks.rows.length, modelCalls: modelChecks.model_calls },
      withholding: { withLabel: shift.with_label, workbookOnly: shift.workbook_only, changed: ratio(results.verdicts.changed_count, results.verdicts.total) },
      live: { ...liveStudy.statuses, total: liveRows.length, generatedAt: liveStudy.manifest.generated_at },
    },
    limits: {
      premiseCases: premiseStudy.rows.length,
      chat: chatLive.limitations, team: teamLive.limitations, live: liveStudy.limits, models: modelChecks.limits, premise: premiseStudy.limits,
    },
  };
}
export type PresentationData = ReturnType<typeof loadPresentationData>;
