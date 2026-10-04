import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  ResearchRequestSchema, ResearchResultSchema, ResearchTraceSchema, type ResearchRequest,
  type ResearchReceipt, type ResearchDraft, type ResearchResult, type ResearchTrace
} from '@her2/shared';
import { ApiFailure } from './errors.js';
import { CLAUDE_MODEL } from './evidence.js';
import { type RunOptions } from './run.js';
import {
  allowedTools, CANONICAL_TOOLS, DATASET_SHA256, derivedSourceId, expectedClaim,
  labelSourceId, workbookSourceId, readResearchTool, receiptIntegrity, RESEARCH_NOTICE, type ToolId
} from './research-evidence.js';
import { researchDraft, researchPlan } from './research-claude.js';
import { loadRuntimeSkills, skillTraceDetail, type RuntimeSkillReader } from './research-skills.js';
import { openFdaSourceId } from './research-openfda.js';
import { HARNESS_LIMITS, harnessManifest } from './research-harness.js';

export interface ResearchOptions extends RunOptions {
  signal?: AbortSignal;
  skillReader?: RuntimeSkillReader;
  onTrace?: (step: ResearchTrace) => void | Promise<void>;
}
function sameIds(left: string[], right: string[]) {
  return left.length === right.length && new Set(left).size === left.length && left.every(id => right.includes(id));
}
export function auditResearchDraft(request: ResearchRequest, draft: ResearchDraft, receipts: ResearchReceipt[]) {
  // Independent expected claim and citation mapping; no model-provided statements/verdicts.
  const expected = expectedClaim(request, receipts);
  const allowedIds = new Set([workbookSourceId(request.product_id), ...(request.evidence_policy === 'all' ? [labelSourceId(request.product_id), derivedSourceId(request.product_id), openFdaSourceId(request.product_id)] : [])]);
  const selectedIds = draft.claims.flatMap(claim => claim.source_ids);
  const cited = receipts.filter(receipt => selectedIds.includes(receipt.id));
  const productCorrect = draft.product_id === request.product_id && cited.every(receipt => receipt.product_id === request.product_id);
  const allowlisted = selectedIds.every(id => allowedIds.has(id));
  const pairing = draft.claims.every(claim => claim.claim_id === expected.id && sameIds(claim.source_ids, expected.source_ids));
  const eligible = cited.every(receipt => receipt.eligible_for_claim && receipt.kind !== 'derived');
  const available = selectedIds.every(id => receipts.some(receipt => receipt.id === id));
  const unique = new Set(draft.claims.map(claim => claim.claim_id)).size === draft.claims.length;
  const omitted = draft.claims.some(claim => claim.claim_id === expected.id) ? [] : [expected.id];
  const provenanceIntact = new Set(receipts.map(receipt => receipt.id)).size === receipts.length && receipts.every(receipt => receiptIntegrity(receipt, request));
  const checks: ResearchResult['challenges'] = [];
  const add = (code: string, ok: boolean, pass: string, fail: string) => checks.push({ code, outcome: ok ? 'passed' : 'caught', detail: ok ? pass : fail, source_ids: cited.filter(receipt => allowedIds.has(receipt.id)).map(receipt => receipt.id) });
  add('product_identity', productCorrect, 'Draft product matches the exact scoped product.', 'Draft product identity does not match the exact scoped product.');
  add('source_allowlist', allowlisted, 'All cited IDs belong to the scoped product and source policy.', 'A citation is invented, cross-product or forbidden by source policy.');
  add('exact_source_claim_pairing', pairing, 'Claim IDs and exact primary citation sets match independent trusted definitions.', 'Claim ID or exact primary source/claim pairing is invalid; no repair is performed.');
  add('source_eligibility', eligible, 'No ineligible retrieved source was elevated to primary evidence.', 'Author-derived or other ineligible evidence was elevated to primary evidence.');
  add('evidence_availability', available, 'All selected source IDs were actually retrieved.', 'The draft cites evidence that was not retrieved.');
  add('unique_claims', unique, 'No duplicate claim selections.', 'Duplicate claim selections were rejected.');
  add('omitted_claim_ids', omitted.length === 0, 'The independently expected claim ID is selected.', 'An independently expected claim ID is omitted; it is not silently added to the draft.');
  add('receipt_integrity', provenanceIntact, 'Receipts match exact local trusted retrievals.', 'Receipt contents or provenance do not match the local trusted source.');
  checks.push({ code: 'incomplete_provenance', outcome: 'unknown', detail: 'Snapshot original extraction date, raw sheet name and primary assay provenance remain unverified; local label paraphrases are incomplete and pending review.', source_ids: receipts.filter(receipt => allowedIds.has(receipt.id)).map(receipt => receipt.id) });
  checks.push({ code: 'uncalibrated_confidence', outcome: 'unknown', detail: 'No calibrated correctness, omission probability or individual release rate is available. Both probabilities remain null.', source_ids: [] });
  if (!expected.source_ids.length) checks.push({ code: 'primary_evidence_limit', outcome: 'unknown', detail: 'No eligible primary evidence establishes the positive hypothesis. The outcome is insufficient, never false clinical reassurance.', source_ids: [] });
  const accepted = !checks.some(check => check.outcome === 'caught');
  return { accepted, expected, challenges: checks, claims: accepted ? [{ ...expected }] : [], omitted_claim_ids: accepted ? omitted : [expected.id] };
}

function applyDrill(request: ResearchRequest, draft: ResearchDraft): ResearchDraft {
  const copy = structuredClone(draft);
  if (request.integrity_drill === 'none') return copy;
  // A deliberate post-drafting identifier mutation, not an observed model hallucination.
  const invalidId = request.integrity_drill === 'cross_product_citation'
    ? labelSourceId(request.product_id === 'DRG0ERKBH' ? 'DRG0CYMEB' : 'DRG0ERKBH')
    : request.integrity_drill === 'derived_as_primary' ? derivedSourceId(request.product_id) : 'INVENTED-SOURCE-DEVELOPER-DRILL';
  if (copy.claims[0]) copy.claims[0].source_ids = [invalidId];
  else copy.claims.push({ claim_id: request.question_id, source_ids: [invalidId] });
  return copy;
}

export async function runResearch(untrustedInput: unknown, options: ResearchOptions = {}): Promise<ResearchResult> {
  const parsed = ResearchRequestSchema.safeParse(untrustedInput);
  if (!parsed.success) throw new ApiFailure('INVALID_REQUEST', 400);
  const request = parsed.data;
  const startRun = performance.now();
  // One total deadline, shared by planner, local tools, draft and handoff (never reset per call).
  const budget = Math.min(HARNESS_LIMITS.deadline_ms, Math.max(1, options.claude?.timeoutMs ?? HARNESS_LIMITS.deadline_ms));
  const remaining = () => {
    if (options.signal?.aborted) throw new ApiFailure('RESEARCH_CANCELLED', 499);
    const left = budget - (performance.now() - startRun);
    if (left <= 0) throw new ApiFailure('CLAUDE_TIMEOUT', 504);
    return left;
  };
  const callOptions = () => ({ ...options.claude, timeoutMs: remaining() });
  const boundedLocal = async <T>(operation: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ApiFailure('CLAUDE_TIMEOUT', 504)), remaining());
      cancel = () => reject(new ApiFailure('RESEARCH_CANCELLED', 499));
      options.signal?.addEventListener('abort', cancel, { once: true });
    });
    try { return await Promise.race([operation(), limit]); }
    finally { if (timer) clearTimeout(timer); if (cancel) options.signal?.removeEventListener('abort', cancel); }
  };
  const trace: ResearchTrace[] = [];
  const step = async (stage: ResearchTrace['stage'], actor: ResearchTrace['actor'], status: ResearchTrace['status'], detail: string, started: number, tool: ToolId | null = null, source_ids: string[] = []) => {
    remaining();
    const entry = ResearchTraceSchema.parse({ id: `step-${trace.length + 1}`, stage, actor, status, detail, duration_ms: performance.now() - started, tool, source_ids });
    trace.push(entry);
    if (options.onTrace) await boundedLocal(async () => options.onTrace!(entry));
    remaining();
  };
  let started = performance.now();
  await step('scope', 'controller', 'completed', `Exact product ${request.product_id}; question ${request.question_id}; UK local label summaries and separate frozen US identity fields if permitted; local workbook snapshot ${DATASET_SHA256}. No patient inputs or clinical flags.`, started);
  started = performance.now();
  if (request.engine === 'claude' && !options.claude?.apiKey?.trim()) throw new ApiFailure('CLAUDE_NOT_CONFIGURED', 503);
  const skills = request.engine === 'claude' ? await boundedLocal(() => loadRuntimeSkills(request.question_id, options.skillReader)) : [];
  const plan = request.engine === 'evidence' ? allowedTools(request) : await researchPlan(request, skills, callOptions(), options.signal);
  await step('plan', request.engine === 'claude' ? 'claude' : 'controller', 'completed', request.engine === 'evidence'
    ? `Rules-only plan: ${plan.join(', ')}. No model or network retrieval; at most 4 unique local tools.`
    : `One completed Claude Opus 5.5 planner call selected ${plan.join(', ')}. At most 4 unique local tools, no retries. ${skillTraceDetail(skills)} Metadata/descriptions were included in the planner request.`, started);
  const receipts: ResearchReceipt[] = [];
  let toolCalls = 0;
  const unknowns = ['No individual release rate, blood kinetics, affinity window, patient risk or eligibility is established.', 'Original workbook extraction date, raw sheet name and primary assay provenance are unknown; this is a local snapshot, not live ADCdb.', 'Label summaries are local UK draft paraphrases pending pharmacist review, not complete approved labels.'];
  for (const tool of CANONICAL_TOOLS) {
    started = performance.now();
    remaining();
    if (!plan.includes(tool)) {
      const policyBlocked = !allowedTools(request).includes(tool);
      // Unknowns are visible but contain no hidden label/derived evidence.
      unknowns.push(`${tool} was not retrieved: ${policyBlocked ? 'source policy excludes it' : 'bounded planner did not select it'}. Its content cannot influence the verdict.`);
      await step('retrieve', 'controller', 'skipped', `${tool} skipped: ${policyBlocked ? 'workbook_only source constraint' : 'not selected by bounded planner'}; no evidence from it was used.`, started);
      continue;
    }
    if (++toolCalls > HARNESS_LIMITS.max_tool_calls) throw new ApiFailure('CLAUDE_INVALID_OUTPUT', 502);
    const found = readResearchTool(tool, request);
    receipts.push(...found);
    if (!found.length) unknowns.push(`${tool} returned no product-specific local receipt; planned evidence is unavailable.`);
    await step('retrieve', 'local_tool', 'completed', `${tool} actually read ${found.length} exact-product local receipt(s). No network retrieval. ${tool === 'read_derived' ? 'Author-derived notes are ineligible as primary evidence.' : tool === 'read_workbook' ? 'Raw composition cells only; never promoted to clinical flags.' : tool === 'read_openfda' ? 'Frozen US identity fields only; not a UK label or clinical sections.' : 'Local pending-review product-specific UK label summary.'}`, started, tool, found.map(receipt => receipt.id));
  }
  started = performance.now();
  const expected = expectedClaim(request, receipts);
  const normalDraft: ResearchDraft = request.engine === 'evidence'
    ? { product_id: request.product_id, claims: [{ claim_id: expected.id, source_ids: expected.source_ids }] }
    : await researchDraft(request, receipts, expected, skills, callOptions(), options.signal);
  const draft = applyDrill(request, normalDraft);
  await step('draft', request.engine === 'claude' ? 'claude' : 'controller', 'completed', `${request.engine === 'evidence' ? 'Deterministic identifier-only draft completed; no LLM was called.' : 'Second Claude Opus 5.5 identifier-only draft call completed; no raw model prose rendered.'} ${request.engine === 'claude' ? `${skillTraceDetail(skills)} Question-relevant instructions were included in the actual draft request. ` : ''}${request.integrity_drill === 'none' ? 'No integrity drill requested.' : 'Intentionally developer-controlled software integrity drill applied after normal drafting; not an observed model hallucination or a clinical benchmark.'}`, started);
  started = performance.now();
  const audit = auditResearchDraft(request, draft, receipts);
  if (!audit.expected.source_ids.length) unknowns.push('No eligible primary source establishes this positive hypothesis; outcome remains insufficient.');
  await step('challenge', 'deterministic_verifier', audit.accepted ? 'completed' : 'blocked', 'Independent product, source allowlist, exact source/claim pairing, eligibility, actual availability, omissions, receipt provenance and uncalibrated-confidence checks completed. Bad draft identifiers are not source links.', started, null, receipts.map(receipt => receipt.id));
  started = performance.now();
  await step('verify', 'deterministic_verifier', audit.accepted ? 'completed' : 'blocked', audit.accepted ? 'Identifier integrity accepted. Evidence outcome is separately supported, contradicted or insufficient; never a clinical release approval.' : 'Draft rejected. No accepted claims are rendered; all independently expected claim IDs are omitted. No silent fallback or citation repair.', started);
  const reasons = [RESEARCH_NOTICE, ...audit.challenges.filter(check => check.outcome === 'caught').map(check => check.detail), 'Software integrity checks are not clinical validation; pharmacist approval has not occurred.'];
  started = performance.now();
  await step('handoff', 'controller', 'blocked', 'Research draft handed off for human pharmacist review. Clinical release always blocked; probabilities null; eligibility not assessed.', started);
  return ResearchResultSchema.parse({
    id: randomUUID(), created_at: new Date().toISOString(), product_id: request.product_id, question_id: request.question_id,
    engine: request.engine, model: request.engine === 'claude' ? CLAUDE_MODEL : null, evidence_policy: request.evidence_policy,
    integrity_drill: request.integrity_drill, draft, draft_integrity: audit.accepted ? 'accepted' : 'rejected',
    answer: `${RESEARCH_NOTICE} ${audit.accepted ? 'The citations passed the checks. The verdict on the claim is separate from the clinical gate, which stays blocked.' : 'The verifier rejected the draft. No claim was accepted and the expected claim id is listed as omitted.'}${request.integrity_drill === 'none' ? '' : ' A fault was injected on purpose after drafting. This is a software test, not observed model behaviour.'}`,
    claims: audit.claims.map(claim => ({ id: claim.id, statement: claim.statement, verdict: claim.verdict, explanation: claim.explanation, source_ids: claim.source_ids, limitation: claim.limitation })),
    omitted_claim_ids: audit.omitted_claim_ids, receipts, challenges: audit.challenges, unknowns,
    next_actions: ['Pharmacist must review the exact product and primary source provenance before any clinical use.', 'Verify the original workbook extraction, missing/truncated cells and full label wording outside this local snapshot audit.', 'Do not infer patient safety, eligibility, doses or release rates from these structural records.'],
    trace, dataset_sha256: DATASET_SHA256, harness: harnessManifest(request, receipts, skills, toolCalls, budget), clinical_status: 'draft_pending_pharmacist', eligibility: 'not_assessed', needs_human: true,
    guardrail: { status: 'blocked', reasons }, answer_correctness_probability: null, omission_probability: null
  });
}
