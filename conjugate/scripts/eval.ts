/**
 * Software evals for the research audit pipeline. Not a clinical benchmark:
 * no clinician cases, answer keys or scoring of medical correctness. Every
 * expected value here is the app's own server-side mapping, so these numbers
 * measure whether the verifier enforces its contract, not whether the science
 * is right. Output: evals/results.json (read by the web Evals view).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { type ResearchDraft, type ResearchRequest, type ResearchResult } from '@her2/shared';
import { auditResearchDraft, runResearch } from '../apps/api/src/research.js';
import {
  allowedTools, DATASET_SHA256, derivedSourceId, expectedClaim, labelSourceId, readResearchTool, workbookSourceId
} from '../apps/api/src/research-evidence.js';
import { CLAUDE_MODEL } from '../apps/api/src/evidence.js';

const PRODUCTS = ['DRG0CYMEB', 'DRG0ERKBH'] as const;
const QUESTIONS = ['composition', 'linker_release', 'payload_risk_transfer', 'workbook_safety', 'label_identity'] as const;
const POLICIES = ['all', 'workbook_only'] as const;
const DRILLS = ['cross_product_citation', 'derived_as_primary', 'invented_source'] as const;

type Scope = { product_id: ResearchRequest['product_id']; question_id: ResearchRequest['question_id']; evidence_policy: ResearchRequest['evidence_policy'] };
const scopes: Scope[] = PRODUCTS.flatMap(product_id => QUESTIONS.flatMap(question_id => POLICIES.map(evidence_policy => ({ product_id, question_id, evidence_policy }))));

function request(scope: Scope, engine: ResearchRequest['engine'], integrity_drill: ResearchRequest['integrity_drill'] = 'none'): ResearchRequest {
  return { ...scope, engine, integrity_drill, synthetic_confirmed: true };
}
function invariantsHold(result: ResearchResult) {
  return result.clinical_status === 'draft_pending_pharmacist' && result.needs_human === true && result.eligibility === 'not_assessed'
    && result.guardrail.status === 'blocked' && result.answer_correctness_probability === null && result.omission_probability === null;
}
function traceMs(result: ResearchResult, stage: ResearchResult['trace'][number]['stage']) {
  return Math.round(result.trace.filter(step => step.stage === stage).reduce((sum, step) => sum + step.duration_ms, 0));
}

// Grid A: rules-only runs, no drill. Verdict per scope and the shift when the label is withheld.
type VerdictRow = Scope & { verdict: string; source_ids: string[]; receipts_read: string[]; invariants: boolean };
async function gridVerdicts() {
  const rows: VerdictRow[] = [];
  for (const scope of scopes) {
    const result = await runResearch(request(scope, 'evidence'));
    rows.push({ ...scope, verdict: result.claims[0]?.verdict ?? 'no_claim', source_ids: result.claims[0]?.source_ids ?? [],
      receipts_read: result.receipts.map(r => r.id), invariants: invariantsHold(result) });
  }
  const shifts = PRODUCTS.flatMap(product_id => QUESTIONS.map(question_id => {
    const all = rows.find(r => r.product_id === product_id && r.question_id === question_id && r.evidence_policy === 'all')!;
    const wb = rows.find(r => r.product_id === product_id && r.question_id === question_id && r.evidence_policy === 'workbook_only')!;
    return { product_id, question_id, with_label: all.verdict, workbook_only: wb.verdict, changed: all.verdict !== wb.verdict };
  }));
  return { rows, shifts, changed_count: shifts.filter(s => s.changed).length, total: shifts.length };
}

// Grid B: injected bad citations after drafting. The verifier must reject every one.
type DrillRow = Scope & { drill: string; rejected: boolean; caught_by: string[]; invariants: boolean };
async function gridDrills() {
  const rows: DrillRow[] = [];
  for (const scope of scopes) for (const drill of DRILLS) {
    const result = await runResearch(request(scope, 'evidence', drill));
    const caught = result.challenges.filter(c => c.outcome === 'caught').map(c => c.code);
    rows.push({ ...scope, drill, rejected: result.draft_integrity === 'rejected' && result.claims.length === 0 && result.omitted_claim_ids.length > 0,
      caught_by: caught, invariants: invariantsHold(result) });
  }
  return { rows, rejected_count: rows.filter(r => r.rejected).length, total: rows.length };
}

// Grid C: scripted drafter strategies that would score well under a naive metric.
// These are hand-written drafts, not model behaviour.
const STRATEGIES = {
  abstain_all: 'Return no claims at all (would max out an "abstention" metric).',
  cite_everything: 'Cite every retrieved source, including the author-derived note.',
  duplicate_claim: 'Repeat the same claim twice with the right sources.',
  other_product_label: "Cite the other product's label summary.",
  invented_source: 'Cite a source id that was never retrieved.',
  swap_product: 'Keep the sources but declare the other product id.',
  honest_expected: 'Cite exactly the independently expected sources (control).'
} as const;
type Strategy = keyof typeof STRATEGIES;
function strategyDraft(strategy: Strategy, req: ResearchRequest, receipts: ReturnType<typeof readResearchTool>): ResearchDraft {
  const expected = expectedClaim(req, receipts);
  const other = req.product_id === 'DRG0ERKBH' ? 'DRG0CYMEB' : 'DRG0ERKBH';
  const claim = (source_ids: string[]) => ({ claim_id: req.question_id, source_ids });
  switch (strategy) {
    case 'abstain_all': return { product_id: req.product_id, claims: [] };
    case 'cite_everything': return { product_id: req.product_id, claims: [claim(receipts.map(r => r.id))] };
    case 'duplicate_claim': return { product_id: req.product_id, claims: [claim(expected.source_ids), claim(expected.source_ids)] };
    case 'other_product_label': return { product_id: req.product_id, claims: [claim([labelSourceId(other)])] };
    case 'invented_source': return { product_id: req.product_id, claims: [claim(['ADCDB-PRIMARY-ASSAY-2024'])] };
    case 'swap_product': return { product_id: other, claims: [claim(expected.source_ids)] };
    case 'honest_expected': return { product_id: req.product_id, claims: [claim(expected.source_ids)] };
  }
}
type StrategyRow = Scope & { strategy: Strategy; accepted: boolean; caught_by: string[]; omitted: string[] };
function gridStrategies() {
  const rows: StrategyRow[] = [];
  for (const scope of scopes) for (const strategy of Object.keys(STRATEGIES) as Strategy[]) {
    const req = request(scope, 'evidence');
    const receipts = allowedTools(req).flatMap(tool => readResearchTool(tool, req));
    const audit = auditResearchDraft(req, strategyDraft(strategy, req, receipts), receipts);
    rows.push({ ...scope, strategy, accepted: audit.accepted, caught_by: audit.challenges.filter(c => c.outcome === 'caught').map(c => c.code),
      omitted: audit.omitted_claim_ids });
  }
  const byStrategy = (Object.keys(STRATEGIES) as Strategy[]).map(strategy => {
    const mine = rows.filter(r => r.strategy === strategy);
    return { strategy, description: STRATEGIES[strategy], accepted: mine.filter(r => r.accepted).length, total: mine.length,
      caught_by: [...new Set(mine.flatMap(r => r.caught_by))] };
  });
  return { rows, by_strategy: byStrategy };
}

// Grid D: Claude (plan + draft) on every scope. Measures whether the model's identifier-only
// output matches the independent expected selection, plus latency. Skipped without a key.
async function gridClaude(apiKey: string | undefined) {
  if (!apiKey) return { skipped: true as const, reason: 'ANTHROPIC_API_KEY not set' };
  type ClaudeOk = Scope & { ok: true; accepted: boolean; verdict: string; tools_planned: (string | null)[]; draft_source_ids: string[]; draft_claim_count: number; plan_ms: number; draft_ms: number; wall_ms: number; invariants: boolean };
  type ClaudeFail = Scope & { ok: false; error_code: string; wall_ms: number };
  const rows: (ClaudeOk | ClaudeFail)[] = [];
  for (const scope of scopes) {
    const started = performance.now();
    try {
      const result = await runResearch(request(scope, 'claude'), { claude: { apiKey } });
      const expected = result.claims[0];
      const draftClaim = result.draft.claims[0];
      rows.push({ ...scope, ok: true as const, accepted: result.draft_integrity === 'accepted', verdict: expected?.verdict ?? 'no_claim',
        tools_planned: result.trace.filter(s => s.stage === 'retrieve' && s.status === 'completed').map(s => s.tool),
        draft_source_ids: draftClaim?.source_ids ?? [], draft_claim_count: result.draft.claims.length,
        plan_ms: traceMs(result, 'plan'), draft_ms: traceMs(result, 'draft'), wall_ms: Math.round(performance.now() - started), invariants: invariantsHold(result) });
    } catch (error) {
      rows.push({ ...scope, ok: false as const, error_code: (error as { code?: string }).code ?? 'UNKNOWN', wall_ms: Math.round(performance.now() - started) });
    }
  }
  const ok = rows.filter((r): r is ClaudeOk => r.ok);
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  return { skipped: false as const, model: CLAUDE_MODEL, rows, completed: ok.length, failed: rows.length - ok.length,
    accepted: ok.filter(r => r.accepted).length, total: rows.length,
    median_plan_ms: med(ok.map(r => r.plan_ms)), median_draft_ms: med(ok.map(r => r.draft_ms)), median_wall_ms: med(ok.map(r => r.wall_ms)) };
}

async function main() {
  const verdicts = await gridVerdicts();
  const drills = await gridDrills();
  const strategies = gridStrategies();
  const claude = await gridClaude(process.env.ANTHROPIC_API_KEY?.trim() || undefined);
  const out = {
    kind: 'software_evals_not_clinical_benchmark',
    generated_at: new Date().toISOString(),
    dataset_sha256: DATASET_SHA256,
    products: PRODUCTS, questions: QUESTIONS, policies: POLICIES,
    source_ids_example: { workbook: workbookSourceId('DRG0ERKBH'), label: labelSourceId('DRG0ERKBH'), derived: derivedSourceId('DRG0ERKBH') },
    verdicts, drills, strategies, claude,
    notes: [
      'Expected claims and sources are the app\'s own server-side definitions; agreement measures contract enforcement, not scientific truth.',
      'Grid C drafts are scripted by the authors to probe the verifier. They are not observed model behaviour.',
      'Clinical release stays blocked in every run; no eval changes that gate.'
    ]
  };
  mkdirSync('evals', { recursive: true });
  writeFileSync('evals/results.json', JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ verdict_shifts: `${verdicts.changed_count}/${verdicts.total}`, drills_rejected: `${drills.rejected_count}/${drills.total}`,
    strategies: strategies.by_strategy.map(s => `${s.strategy}:${s.accepted}/${s.total}`), claude: claude.skipped ? claude.reason : `${claude.accepted}/${claude.total} accepted, ${claude.failed} failed, median wall ${claude.median_wall_ms}ms` }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
