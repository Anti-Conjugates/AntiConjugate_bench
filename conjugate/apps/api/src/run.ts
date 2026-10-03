import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { RunRequestSchema, RunResultSchema, type RunResult, type TraceStep } from '@her2/shared';
import { claudeDraft, type ClaudeOptions } from './claude.js';
import { CLAUDE_MODEL, DRAFT_NOTICE, getProduct, isProductId, productSources } from './evidence.js';
import { ApiFailure } from './errors.js';
import { auditSelection } from './guardrail.js';
import { deterministicDraft } from './rules.js';

export interface RunOptions { claude?: ClaudeOptions; }

function freezeCard<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeCard(child);
    Object.freeze(value);
  }
  return value;
}

// No request/result cache, log, history or persistence. Boundary validation is
// also performed here so direct software callers cannot bypass synthetic=true.
export async function runReview(untrustedInput: unknown, options: RunOptions = {}): Promise<RunResult> {
  const parsed = RunRequestSchema.safeParse(untrustedInput);
  if (!parsed.success) throw new ApiFailure('INVALID_REQUEST', 400);
  const request = parsed.data;
  if (!isProductId(request.product_id)) throw new ApiFailure('UNKNOWN_PRODUCT', 400);
  const trace: TraceStep[] = [];
  let start = performance.now();
  const product = getProduct(request.product_id);
  if (!product) throw new ApiFailure('UNKNOWN_PRODUCT', 400);
  const sources = productSources(request.product_id);
  trace.push({ stage: 'retrieval', status: 'completed', detail: 'Retrieved the exact allowlisted product and its dated UK draft label paraphrases locally. ADCdb is a separate structural link, not clinical evidence.', duration_ms: performance.now() - start });
  start = performance.now();
  const draft = request.engine === 'evidence' ? deterministicDraft(request) : await claudeDraft(request, options.claude);
  const draftDuration = performance.now() - start;
  start = performance.now();
  const audit = auditSelection(request, draft);
  trace.push({ stage: 'draft', status: audit.valid_selection ? 'completed' : 'blocked', detail: audit.valid_selection
    ? request.engine === 'evidence' ? 'Explicit deterministic evidence mode selected trusted identifiers only; no model was called.' : 'Claude Opus 5.5 returned bounded identifier selections; only trusted template prose is rendered.'
    : 'Draft identifier selection rejected. No raw model prose is shown and no deterministic repair or fallback was performed.', duration_ms: draftDuration });
  trace.push({ stage: 'guardrail', status: 'blocked', detail: 'Independent coverage, exact product, citation allowlist and flag/source entailment audits completed. Omissions are separate. Clinical release is blocked pending pharmacist approval.', duration_ms: performance.now() - start });
  return freezeCard(RunResultSchema.parse({
    id: randomUUID(), created_at: new Date().toISOString(), engine: request.engine,
    model: request.engine === 'claude' ? CLAUDE_MODEL : null, product,
    clinical_status: 'draft_pending_pharmacist', eligibility: 'not_assessed', verdict: 'dont_know',
    answer: `${DRAFT_NOTICE} ${!audit.valid_selection
      ? 'The draft selection failed independent safety checks. No claimed clinical answer is accepted; the independently expected checks are shown as omitted.'
      : audit.omitted_checks.length > 0
        ? 'Some independently required software checks were omitted from the draft selection. Selected evidence and omissions are shown separately; no individual clinical conclusion is established.'
        : 'Product-specific evidence review checks are shown as trusted paraphrases. Software checklist coverage does not establish clinical safety, eligibility or complete review.'}`,
    flags: audit.flags, omitted_checks: audit.omitted_checks, sources, unknowns: audit.unknowns,
    evidence_confidence: { kind: 'heuristic', level: 'unknown', reason: 'No calibrated confidence is available. Source summaries and conservative software coverage remain unapproved and do not establish individual clinical correctness.' },
    omission_probability: null, answer_correctness_probability: null,
    guardrail: { kind: 'deterministic', status: 'blocked', reasons: [...audit.reasons, 'Missing inputs and unresolved label-specific organ, history and medication-review scopes remain visible in unknowns; complete form inputs would not establish eligibility.'] },
    needs_human: true, trace
  }));
}
