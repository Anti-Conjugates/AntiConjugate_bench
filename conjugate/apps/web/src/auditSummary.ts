import type { ResearchReceipt, ResearchRequest, ResearchResult, ResearchTrace } from '@her2/shared';
import results from '../../../evals/results.json';
import { faultTests, verdictLabels } from './labels';

export type Outcome = keyof typeof verdictLabels | 'rejected';
export const outcomeLabels: Record<Outcome, string> = { ...verdictLabels, rejected: 'Rejected by verifier' };
export const outcomeMeaning: Record<Outcome, string> = {
  supported: 'The citations passed every check, and the sources read back the claim.',
  contradicted: 'The citations passed every check, and at least one source read says the opposite of the claim.',
  insufficient: 'The citations passed every check, but the sources read do not settle the claim either way.',
  rejected: 'A citation failed a check, so the whole draft was thrown out and no verdict was issued. Checks shows which rule caught it.',
};

/** A rejected draft is not "not enough evidence"; it never reached a verdict. */
type Judged = { draft_integrity: ResearchResult['draft_integrity']; claims: Pick<ResearchResult['claims'][number], 'verdict'>[] };
export function outcomeOf(result: Judged): Outcome {
  if (result.draft_integrity === 'rejected') return 'rejected';
  if (result.claims.some((claim) => claim.verdict === 'contradicted')) return 'contradicted';
  if (!result.claims.length || result.claims.some((claim) => claim.verdict === 'insufficient')) return 'insufficient';
  return 'supported';
}

export const stageOrder = ['scope', 'plan', 'retrieve', 'draft', 'challenge', 'verify', 'handoff'] as const;
export const actorLabels: Record<ResearchTrace['actor'], string> = { controller: 'controller', local_tool: 'local tool', claude: 'Claude', deterministic_verifier: 'verifier' };
export type StageStatus = ResearchTrace['status'] | 'pending' | 'running';
export const stageStatusLabels: Record<StageStatus, string> = { pending: 'waiting', running: 'running', completed: 'done', skipped: 'skipped', blocked: 'blocked' };
export interface StageState { stage: ResearchTrace['stage']; status: StageStatus; actors: ResearchTrace['actor'][]; tools: string[] }
type TraceStep = Pick<ResearchTrace, 'stage' | 'actor' | 'status' | 'tool'>;

/** Collapses the event list into one state per stage; the first stage with no events is "running" while the request is open. */
export function stageStates(trace: TraceStep[], busy: boolean): StageState[] {
  const states: StageState[] = stageOrder.map((stage) => {
    const steps = trace.filter((step) => step.stage === stage);
    const status: StageStatus = !steps.length ? 'pending'
      : steps.some((step) => step.status === 'blocked') ? 'blocked'
        : steps.every((step) => step.status === 'skipped') ? 'skipped' : 'completed';
    return { stage, status, actors: [...new Set(steps.map((step) => step.actor))], tools: steps.flatMap((step) => step.tool ? [step.tool] : []) };
  });
  if (busy) { const next = states.find((state) => state.status === 'pending'); if (next) next.status = 'running'; }
  return states;
}

export const policyLabels: Record<ResearchRequest['evidence_policy'], string> = { all: 'All sources', workbook_only: 'Workbook only' };
export interface CompareRow { label: string; a: string; b: string; differs: boolean }
type Comparable = Pick<ResearchResult, 'evidence_policy' | 'integrity_drill' | 'draft_integrity' | 'unknowns' | 'guardrail'> & {
  receipts: Pick<ResearchReceipt, 'id'>[];
  claims: Pick<ResearchResult['claims'][number], 'verdict' | 'source_ids'>[];
  challenges: Pick<ResearchResult['challenges'][number], 'code' | 'outcome'>[];
};
const list = (ids: string[]) => ids.length ? ids.join(', ') : 'none';

/** Two runs of the same product and question, one input apart. Strings only, so the table needs no interpretation. */
export function compareResults(a: Comparable, b: Comparable): CompareRow[] {
  const row = (label: string, read: (result: Comparable) => string): CompareRow => {
    const left = read(a), right = read(b);
    return { label, a: left, b: right, differs: left !== right };
  };
  return [
    row('Sources allowed', (result) => policyLabels[result.evidence_policy]),
    row('Fault injected', (result) => faultTests[result.integrity_drill]),
    row('Outcome', (result) => outcomeLabels[outcomeOf(result)]),
    row('Citations', (result) => result.draft_integrity),
    row('Sources read', (result) => list(result.receipts.map((receipt) => receipt.id))),
    row('Sources cited', (result) => list([...new Set(result.claims.flatMap((claim) => claim.source_ids))])),
    row('Checks that caught something', (result) => list(result.challenges.filter((challenge) => challenge.outcome === 'caught').map((challenge) => challenge.code))),
    row('Unknowns listed', (result) => String(result.unknowns.length)),
    row('Clinical release', (result) => result.guardrail.status),
  ];
}

interface EvalData {
  verdicts: { shifts: { product_id: string; question_id: string; with_label: keyof typeof verdictLabels; workbook_only: keyof typeof verdictLabels }[] };
  drills: { rows: { product_id: string; question_id: string; evidence_policy: string; drill: string; rejected: boolean }[] };
}
const evals = results as unknown as EvalData;
type Scope = Pick<ResearchRequest, 'product_id' | 'question_id' | 'evidence_policy' | 'integrity_drill'>;

/** What the last rules-only eval run recorded for this scope, read from evals/results.json. Null when that scope was not in the grid. */
export function lastEvalOutcome(scope: Scope): string | null {
  if (scope.integrity_drill !== 'none') {
    const row = evals.drills.rows.find((item) => item.product_id === scope.product_id && item.question_id === scope.question_id
      && item.evidence_policy === scope.evidence_policy && item.drill === scope.integrity_drill);
    return row ? (row.rejected ? outcomeLabels.rejected : 'Accepted, fault not caught') : null;
  }
  const row = evals.verdicts.shifts.find((item) => item.product_id === scope.product_id && item.question_id === scope.question_id);
  return row ? verdictLabels[scope.evidence_policy === 'all' ? row.with_label : row.workbook_only] : null;
}

export interface Preset { id: string; title: string; why: string; request: ResearchRequest; last_eval: string | null }
const preset = (id: string, title: string, why: string, scope: Scope): Preset => {
  const request: ResearchRequest = { ...scope, engine: 'evidence', synthetic_confirmed: true };
  return { id, title, why, request, last_eval: lastEvalOutcome(scope) };
};
/** Three rules-only runs that show the three things the verifier can say. Products are the two allowlisted ids. */
export const presets: Preset[] = [
  preset('agree', 'Enhertu: what is it made of?',
    'The workbook row records the payload and drug-to-antibody ratio. This check reports that row, not an independent comparison.',
    { product_id: 'DRG0ERKBH', question_id: 'composition', evidence_policy: 'all', integrity_drill: 'none' }),
  preset('contradict', 'Enhertu: does a cleavable linker mean release in blood?',
    'The label summary says the opposite. Run it again with the label withheld to see what the verdict rested on.',
    { product_id: 'DRG0ERKBH', question_id: 'linker_release', evidence_policy: 'all', integrity_drill: 'none' }),
  preset('fault', 'Kadcyla: composition, with an invented source id',
    'A source id that was never read is swapped in after drafting. The verifier has to notice and refuse the draft.',
    { product_id: 'DRG0CYMEB', question_id: 'composition', evidence_policy: 'all', integrity_drill: 'invented_source' }),
];
