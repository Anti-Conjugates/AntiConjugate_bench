import { z } from 'zod';
import { WorkbookProductIdSchema, isLabelProduct, productLabel } from './products.js';
import { EvidencePolicySchema, ResearchQuestionSchema, ResearchResultSchema, researchExecutionIsConsistent } from './research.js';
import { TurnGuardSchema } from './guard.js';

export const ChatScopeSchema = z.object({ product_id: WorkbookProductIdSchema, question_id: ResearchQuestionSchema, evidence_policy: EvidencePolicySchema }).strict();
export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000), engine: z.enum(['evidence', 'claude']),
  context: z.array(ChatScopeSchema).max(4).default([]), synthetic_confirmed: z.literal(true)
}).strict();
export const CHAT_LIMITS = { deadline_ms: 60000, max_model_calls: 4, max_audits: 4, max_evidence_reads: 16, retries: 0, max_request_bytes: 65536, max_response_bytes: 131072 } as const;
export const PREMISE_STOP = 'The premise gate stopped this question before any model or evidence call.';
export const ChatStepSchema = z.object({
  id: z.string(), actor: z.enum(['controller', 'claude', 'local_tool', 'deterministic_verifier']),
  stage: z.enum(['scope', 'model', 'audit', 'answer']), detail: z.string(),
  scope: ChatScopeSchema.nullable(), duration_ms: z.number().nonnegative()
}).strict().superRefine((step, context) => {
  const valid = step.stage === 'scope' ? step.actor === 'controller' && step.scope === null && (/^[1-4] research checks scoped\. Only recognized research terms reach Claude; raw text stays out of provider requests\.$/.test(step.detail) || step.detail === 'The scope guard stopped this question before any model or evidence call.' || step.detail === PREMISE_STOP)
    : step.stage === 'model' ? step.actor === 'claude' && step.scope === null && /^Claude call [1-4] completed with (?:tool requests|an identifier selection)\.$/.test(step.detail)
      : step.stage === 'audit' ? step.actor === 'deterministic_verifier' && step.scope !== null && /^audit-[1-4]: [1-4] local source reads; citation checks completed\.$/.test(step.detail)
        : step.actor === 'controller' && step.scope === null && step.detail === 'The controller rendered verified findings. Raw model prose was not displayed.';
  if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Chat progress must use controller templates.' });
});
export const ChatAuditSchema = z.object({ id: z.string().regex(/^audit-[1-4]$/), scope: ChatScopeSchema, result: ResearchResultSchema }).strict();
export const ChatResultSchema = z.object({
  id: z.string(), created_at: z.string().datetime(), engine: z.enum(['evidence', 'claude']), model: z.literal('claude-opus-5-5').nullable(),
  status: z.enum(['complete', 'incomplete', 'clarification', 'outside_scope', 'premise_blocked']), reply: z.string().max(3000),
  scopes: z.array(ChatScopeSchema).max(4), audits: z.array(ChatAuditSchema).max(4), selected_audit_ids: z.array(z.string()).max(4),
  missing_scopes: z.array(ChatScopeSchema).max(4), followups: z.array(z.string().max(180)).max(3), trace: z.array(ChatStepSchema).max(12),
  harness: z.object({ version: z.literal('conjugate-chat-1'), model_calls: z.number().int().min(0).max(4), audit_calls: z.number().int().min(0).max(4), evidence_reads: z.number().int().min(0).max(16),
    code_sha256: z.string().regex(/^[a-f0-9]{64}$/), intent_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    skills: z.array(z.object({ name: z.string(), version: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(3),
    limits: z.object({ deadline_ms: z.literal(60000), max_model_calls: z.literal(4), max_audits: z.literal(4), max_evidence_reads: z.literal(16), retries: z.literal(0), max_request_bytes: z.literal(65536), max_response_bytes: z.literal(131072) }).strict()
  }).strict(),
  guard: TurnGuardSchema.optional(),
  clinical_status: z.literal('draft_pending_pharmacist'), eligibility: z.literal('not_assessed'), needs_human: z.literal(true),
  guardrail: z.object({ status: z.literal('blocked') }).strict(), answer_correctness_probability: z.null(), omission_probability: z.null()
}).strict();
export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('guard'), guard: TurnGuardSchema }).strict(),
  z.object({ type: z.literal('trace'), step: ChatStepSchema }).strict(),
  z.object({ type: z.literal('result'), result: ChatResultSchema }).strict(),
  z.object({ type: z.literal('error'), error: z.object({ code: z.string(), message: z.string() }).strict() }).strict()
]);
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatScope = z.infer<typeof ChatScopeSchema>;
export type ChatAudit = z.infer<typeof ChatAuditSchema>;
export type ChatResult = z.infer<typeof ChatResultSchema>;
export type ChatStep = z.infer<typeof ChatStepSchema>;
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export function renderChatReply(status: ChatResult['status'], audits: ChatAudit[], selected: string[], missing: number) {
  if (status === 'outside_scope') return 'This chat checks research evidence about the 31 ADCs in the workbook. For questions about care, ask a clinician. Try a question about composition or linker release.';
  if (status === 'premise_blocked') return 'This question rests on a premise the gate could not verify, so nothing was sent to Claude and no evidence was read. The premise findings are shown below. Rephrase it about Kadcyla or Enhertu.';
  if (status === 'clarification') return 'What should I check? Name an ADC from the workbook (for example Kadcyla, Enhertu, Trodelvy or Padcev) and ask about composition, linker release, payload-to-risk claims, workbook safety claims or US label identity.';
  const chosen = audits.filter(audit => selected.includes(audit.id));
  const labels = { supported: 'Supported', contradicted: 'Contradicted', insufficient: 'Not enough evidence' };
  const lines = chosen.map(audit => `${productLabel(audit.scope.product_id)} — ${audit.result.claims.map(claim => `${labels[claim.verdict]} for the claim “${claim.statement}” ${claim.explanation}`).join(' ')}`);
  if (missing) lines.push(`${missing} requested check${missing === 1 ? ' was' : 's were'} left unanswered. Those omissions are shown below.`);
  return lines.join('\n\n') || 'No evidence checks were selected. The question is still unanswered.';
}
export const chatScopeKey = (scope: ChatScope) => `${scope.product_id}/${scope.question_id}/${scope.evidence_policy}`;

export function chatFollowups(status: ChatResult['status'], policy?: ChatScope['evidence_policy']) {
  return status === 'complete' || status === 'incomplete' ? [policy === 'workbook_only' ? 'Restore all sources and check again.' : 'What changes with only workbook evidence?', 'Compare Kadcyla and Enhertu composition.', 'What does the frozen US label identity show?']
    : ['What is Enhertu made of?', 'Does Enhertu’s cleavable linker establish release in blood?', 'Compare Kadcyla and Enhertu composition.'];
}

export function chatAuditProseIsConsistent(result: ChatAudit['result']) {
  const tools = ['read_workbook', 'read_label', 'read_derived', 'read_openfda'] as const;
  const unknowns = ['No individual release rate, blood kinetics, affinity window, patient risk or eligibility is established.', 'Original workbook extraction date, raw sheet name and primary assay provenance are unknown; this is a local snapshot, not live ADCdb.', 'Label summaries are local UK draft paraphrases pending pharmacist review, not complete approved labels.'];
  for (const tool of tools) {
    const step = result.trace.find(step => step.stage === 'retrieve' && step.tool === tool && step.status === 'completed');
    if (!step) unknowns.push(`${tool} was not retrieved: source policy excludes it. Its content cannot influence the verdict.`);
    else {
      if (!step.source_ids.length) unknowns.push(`${tool} returned no product-specific local receipt; planned evidence is unavailable.`);
      const detail = `${tool} actually read ${step.source_ids.length} exact-product local receipt(s). No network retrieval. ${tool === 'read_derived' ? 'Author-derived notes are ineligible as primary evidence.' : tool === 'read_workbook' ? 'Raw composition cells only; never promoted to clinical flags.' : tool === 'read_openfda' ? 'Frozen US identity fields only; not a UK label or clinical sections.' : 'Local pending-review product-specific UK label summary.'}`;
      if (step.detail !== detail) return false;
    }
  }
  if (!result.claims.some(claim => claim.source_ids.length)) unknowns.push('No eligible primary source establishes this positive hypothesis; outcome remains insufficient.');
  return JSON.stringify(unknowns) === JSON.stringify(result.unknowns);
}

export function chatExecutionIsConsistent(result: ChatResult) {
  const keys = result.scopes.map(chatScopeKey);
  const selected = new Set(result.selected_audit_ids);
  const audits = result.audits;
  const selectedKeys = audits.filter(audit => selected.has(audit.id)).map(audit => chatScopeKey(audit.scope));
  const missing = keys.filter(key => !selectedKeys.includes(key));
  if (JSON.stringify(result.followups) !== JSON.stringify(chatFollowups(result.status, result.scopes[0]?.evidence_policy))) return false;
  let modelIndex = 0;
  let auditIndex = 0;
  if (result.trace.some(step => {
    const detail = step.stage === 'scope' ? ['complete', 'incomplete'].includes(result.status) ? `${keys.length} research checks scoped. Only recognized research terms reach Claude; raw text stays out of provider requests.` : result.status === 'premise_blocked' ? PREMISE_STOP : 'The scope guard stopped this question before any model or evidence call.'
      : step.stage === 'answer' ? 'The controller rendered verified findings. Raw model prose was not displayed.'
        : step.stage === 'model' ? `Claude call ${++modelIndex} completed with ${modelIndex === result.harness.model_calls ? 'an identifier selection' : 'tool requests'}.`
          : `${audits[auditIndex]?.id}: ${audits[auditIndex++]?.result.harness.tool_calls} local source reads; citation checks completed.`;
    return step.detail !== detail;
  })) return false;
  if (new Set(keys).size !== keys.length || new Set(audits.map(audit => audit.id)).size !== audits.length || new Set(audits.map(audit => chatScopeKey(audit.scope))).size !== audits.length || selected.size !== result.selected_audit_ids.length || result.selected_audit_ids.some(id => !audits.some(audit => audit.id === id))) return false;
  if (JSON.stringify(missing) !== JSON.stringify(result.missing_scopes.map(chatScopeKey))) return false;
  if ((result.status === 'complete' && (!keys.length || missing.length)) || (result.status === 'incomplete' && (!keys.length || !missing.length))) return false;
  if (!guardStatusIsConsistent(result.status, result.guard)) return false;
  if (['clarification', 'outside_scope', 'premise_blocked'].includes(result.status) && (keys.length || audits.length || selected.size || result.harness.model_calls)) return false;
  if (result.harness.audit_calls !== audits.length || result.harness.evidence_reads !== audits.reduce((total, audit) => total + audit.result.harness.tool_calls, 0)) return false;
  if (result.trace.filter(step => step.stage === 'model').length !== result.harness.model_calls || result.trace.filter(step => step.stage === 'audit').length !== audits.length) return false;
  if (result.trace.length !== 2 + result.harness.model_calls + audits.length || result.trace.some((step, index) => step.id !== `step-${index + 1}` || (step.stage === 'model' && (step.actor !== 'claude' || step.scope !== null)) || (step.stage === 'audit' && (step.actor !== 'deterministic_verifier' || step.scope === null))) || result.trace[0]?.stage !== 'scope' || result.trace[0]?.actor !== 'controller' || result.trace.at(-1)?.stage !== 'answer' || result.trace.at(-1)?.actor !== 'controller') return false;
  if (JSON.stringify(result.trace.filter(step => step.stage === 'audit').map(step => step.scope && chatScopeKey(step.scope))) !== JSON.stringify(audits.map(audit => chatScopeKey(audit.scope)))) return false;
  if (result.engine === 'claude' && ['complete', 'incomplete'].includes(result.status) && (result.harness.model_calls < 2 || !audits.length || result.harness.skills.length !== 3)) return false;
  if (result.engine === 'evidence' && result.harness.skills.length) return false;
  if ((result.engine === 'evidence' && (result.model !== null || result.harness.model_calls !== 0)) || (result.harness.model_calls > 0 && result.model !== 'claude-opus-5-5')) return false;
  return audits.every(audit => keys.includes(chatScopeKey(audit.scope)) && audit.result.product_id === audit.scope.product_id && audit.result.question_id === audit.scope.question_id && audit.result.evidence_policy === audit.scope.evidence_policy && audit.result.engine === 'evidence' && audit.result.model === null && audit.result.integrity_drill === 'none' && audit.result.draft_integrity === 'accepted' && audit.result.claims.length === 1 && audit.result.claims[0]?.id === audit.scope.question_id && audit.result.harness.tool_calls === (audit.scope.evidence_policy === 'all' ? (isLabelProduct(audit.scope.product_id) ? 4 : 2) : 1) && audit.result.harness.code_sha256 === result.harness.code_sha256 && chatAuditProseIsConsistent(audit.result) && researchExecutionIsConsistent(audit.result));
}

/** premise_blocked needs a blocked premise report; a blocked report only allows premise_blocked or outside_scope. */
export function guardStatusIsConsistent(status: string, guard: { premise: { decision: string } } | undefined) {
  if (!guard) return status !== 'premise_blocked';
  if (status === 'premise_blocked') return guard.premise.decision === 'blocked';
  return guard.premise.decision !== 'blocked' || status === 'outside_scope';
}
