import { z } from 'zod';
import { ChatAuditSchema, ChatScopeSchema, chatAuditProseIsConsistent, chatFollowups, chatScopeKey, guardStatusIsConsistent, renderChatReply } from './chat.js';
import { TurnGuardSchema } from './guard.js';
import { researchExecutionIsConsistent } from './research.js';

/**
 * Agent-team chat: a LangGraph state graph in which a lead agent plans checks, one evidence
 * worker per check runs in its own context, code verifies every audit, and an omission gate
 * can send the lead back once. Models select identifiers only; verdicts come from the verifier.
 */
export const TEAM_LIMITS = { deadline_ms: 60000, max_lead_calls: 4, max_worker_calls: 8, max_audits: 4, max_revisions: 1, retries: 0, max_request_bytes: 65536, max_response_bytes: 131072 } as const;
export const TEAM_FRAMEWORK = '@langchain/langgraph@1.4.19' as const;
export const TeamNodeSchema = z.enum(['scope_gate', 'premise_gate', 'lead_plan', 'evidence_worker', 'verifier', 'lead_select', 'omission_gate', 'answer']);
export type TeamNode = z.infer<typeof TeamNodeSchema>;
export const TEAM_GRAPH = {
  nodes: TeamNodeSchema.options,
  edges: [
    { from: '__start__', to: 'scope_gate', conditional: false },
    { from: 'scope_gate', to: 'premise_gate', conditional: false },
    { from: 'premise_gate', to: 'lead_plan', conditional: true },
    { from: 'premise_gate', to: 'answer', conditional: true },
    { from: 'lead_plan', to: 'evidence_worker', conditional: true },
    { from: 'lead_plan', to: 'lead_select', conditional: true },
    { from: 'lead_plan', to: 'omission_gate', conditional: true },
    { from: 'evidence_worker', to: 'verifier', conditional: false },
    { from: 'verifier', to: 'lead_select', conditional: true },
    { from: 'verifier', to: 'omission_gate', conditional: true },
    { from: 'lead_select', to: 'omission_gate', conditional: false },
    { from: 'omission_gate', to: 'lead_plan', conditional: true },
    { from: 'omission_gate', to: 'answer', conditional: true },
    { from: 'answer', to: '__end__', conditional: false }
  ]
} as const;
const nodeActors: Record<TeamNode, readonly string[]> = {
  scope_gate: ['controller'], premise_gate: ['controller'], lead_plan: ['lead_agent', 'controller'], evidence_worker: ['worker_agent', 'controller'],
  verifier: ['deterministic_verifier'], lead_select: ['lead_agent', 'controller'], omission_gate: ['controller'], answer: ['controller']
};
const CodeSchema = z.string().regex(/^[A-Z_]{3,40}$/);
export const TeamStepSchema = z.object({
  id: z.string().regex(/^step-\d{1,2}$/), node: TeamNodeSchema, actor: z.enum(['controller', 'lead_agent', 'worker_agent', 'deterministic_verifier']),
  scope: ChatScopeSchema.nullable(), audit_id: z.string().regex(/^audit-[1-4]$/).nullable(), status: z.enum(['completed', 'failed']), code: CodeSchema.nullable(),
  model_calls: z.number().int().min(0).max(2), duration_ms: z.number().nonnegative()
}).strict().superRefine((step, context) => {
  const scoped = step.node === 'evidence_worker' || step.node === 'verifier';
  const ok = nodeActors[step.node].includes(step.actor) && (scoped ? step.scope !== null && step.audit_id !== null : step.scope === null && step.audit_id === null)
    && (step.status === 'completed') === (step.code === null) && (step.actor === 'lead_agent' ? step.model_calls === 1 : step.actor === 'worker_agent' ? step.model_calls >= 1 : step.model_calls === 0);
  if (!ok) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Team step does not match its node.' });
});
export const TeamWorkerSchema = z.object({ audit_id: z.string().regex(/^audit-[1-4]$/), scope: ChatScopeSchema, status: z.enum(['accepted', 'failed']), code: CodeSchema.nullable(), audited: z.boolean(), model_calls: z.number().int().min(0).max(2) }).strict();
export const TeamRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000), engine: z.enum(['evidence', 'claude']),
  context: z.array(ChatScopeSchema).max(4).default([]), synthetic_confirmed: z.literal(true)
}).strict();
export const TeamResultSchema = z.object({
  id: z.string(), created_at: z.string().datetime(), engine: z.enum(['evidence', 'claude']), model: z.literal('claude-opus-5-5').nullable(),
  status: z.enum(['complete', 'incomplete', 'clarification', 'outside_scope', 'premise_blocked']), reply: z.string().max(3000),
  scopes: z.array(ChatScopeSchema).max(4), audits: z.array(ChatAuditSchema).max(4), workers: z.array(TeamWorkerSchema).max(4),
  selected_audit_ids: z.array(z.string().regex(/^audit-[1-4]$/)).max(4), missing_scopes: z.array(ChatScopeSchema).max(4), revisions: z.number().int().min(0).max(1),
  followups: z.array(z.string().max(180)).max(3), trace: z.array(TeamStepSchema).max(24),
  harness: z.object({ version: z.literal('conjugate-team-1'), framework: z.literal(TEAM_FRAMEWORK), lead_calls: z.number().int().min(0).max(4), worker_calls: z.number().int().min(0).max(8),
    audit_calls: z.number().int().min(0).max(4), evidence_reads: z.number().int().min(0).max(16), code_sha256: z.string().regex(/^[a-f0-9]{64}$/), intent_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    limits: z.object({ deadline_ms: z.literal(60000), max_lead_calls: z.literal(4), max_worker_calls: z.literal(8), max_audits: z.literal(4), max_revisions: z.literal(1), retries: z.literal(0), max_request_bytes: z.literal(65536), max_response_bytes: z.literal(131072) }).strict()
  }).strict(),
  guard: TurnGuardSchema.optional(),
  clinical_status: z.literal('draft_pending_pharmacist'), eligibility: z.literal('not_assessed'), needs_human: z.literal(true),
  guardrail: z.object({ status: z.literal('blocked') }).strict(), answer_correctness_probability: z.null(), omission_probability: z.null()
}).strict();
export const TeamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('guard'), guard: TurnGuardSchema }).strict(),
  z.object({ type: z.literal('trace'), step: TeamStepSchema }).strict(),
  z.object({ type: z.literal('result'), result: TeamResultSchema }).strict(),
  z.object({ type: z.literal('error'), error: z.object({ code: z.string(), message: z.string() }).strict() }).strict()
]);
export type TeamRequest = z.infer<typeof TeamRequestSchema>;
export type TeamStep = z.infer<typeof TeamStepSchema>;
export type TeamWorker = z.infer<typeof TeamWorkerSchema>;
export type TeamResult = z.infer<typeof TeamResultSchema>;
export type TeamEvent = z.infer<typeof TeamEventSchema>;

/** Cross-field checks shared by the server, the browser and replay. */
export function teamExecutionIsConsistent(result: TeamResult) {
  const keys = result.scopes.map(chatScopeKey);
  const accepted = result.workers.filter(worker => worker.status === 'accepted');
  const selected = new Set(result.selected_audit_ids);
  if (new Set(keys).size !== keys.length || selected.size !== result.selected_audit_ids.length) return false;
  if (result.workers.some((worker, index) => worker.audit_id !== `audit-${index + 1}` || !keys.includes(chatScopeKey(worker.scope)) || (worker.status === 'accepted') === (worker.code !== null))) return false;
  if (new Set(result.workers.map(worker => chatScopeKey(worker.scope))).size !== result.workers.length) return false;
  if (JSON.stringify(result.audits.map(audit => [audit.id, chatScopeKey(audit.scope)])) !== JSON.stringify(accepted.map(worker => [worker.audit_id, chatScopeKey(worker.scope)]))) return false;
  if (result.selected_audit_ids.some(id => !accepted.some(worker => worker.audit_id === id))) return false;
  const selectedKeys = result.audits.filter(audit => selected.has(audit.id)).map(audit => chatScopeKey(audit.scope));
  if (JSON.stringify(result.missing_scopes.map(chatScopeKey)) !== JSON.stringify(keys.filter(key => !selectedKeys.includes(key)))) return false;
  const ready = result.status === 'complete' || result.status === 'incomplete';
  if ((result.status === 'complete' && (!keys.length || result.missing_scopes.length)) || (result.status === 'incomplete' && (!keys.length || !result.missing_scopes.length))) return false;
  if (!guardStatusIsConsistent(result.status, result.guard)) return false;
  const premiseSteps = result.trace.filter(step => step.node === 'premise_gate');
  if (premiseSteps.length !== (result.guard ? 1 : 0) || premiseSteps.some(step => (step.status === 'failed') !== (result.status === 'premise_blocked') || (step.code !== null && step.code !== 'PREMISE_BLOCKED'))) return false;
  if (result.guard && result.trace[1]?.node !== 'premise_gate') return false;
  if (!ready && (keys.length || result.workers.length || result.harness.lead_calls || result.harness.worker_calls)) return false;
  if (result.reply !== renderChatReply(result.status, result.audits, result.selected_audit_ids, result.missing_scopes.length)) return false;
  if (JSON.stringify(result.followups) !== JSON.stringify(chatFollowups(result.status, result.scopes[0]?.evidence_policy))) return false;
  const trace = result.trace;
  if (trace.some((step, index) => step.id !== `step-${index + 1}`) || trace[0]?.node !== 'scope_gate' || trace.at(-1)?.node !== 'answer') return false;
  const leadSteps = trace.filter(step => step.actor === 'lead_agent');
  if (leadSteps.length !== result.harness.lead_calls || trace.filter(step => step.actor === 'worker_agent').reduce((sum, step) => sum + step.model_calls, 0) !== result.harness.worker_calls) return false;
  if (result.workers.reduce((sum, worker) => sum + worker.model_calls, 0) !== result.harness.worker_calls) return false;
  const workerSteps = trace.filter(step => step.node === 'evidence_worker');
  if (JSON.stringify(workerSteps.map(step => [step.audit_id, step.status === 'completed' ? null : step.code])) !== JSON.stringify(result.workers.map(worker => [worker.audit_id, worker.status === 'accepted' ? null : worker.code === 'VERIFIER_REJECTED' ? null : worker.code]))) return false;
  if (trace.filter(step => step.node === 'omission_gate').length !== (ready ? result.revisions + 1 : 0) || trace.filter(step => step.node === 'scope_gate' || step.node === 'answer').length !== 2) return false;
  if (result.engine === 'evidence' && (result.model !== null || result.harness.lead_calls || result.harness.worker_calls || result.revisions || trace.some(step => step.actor === 'lead_agent' || step.actor === 'worker_agent'))) return false;
  if (result.engine === 'claude' && (trace.some(step => step.actor === 'controller' && ['evidence_worker', 'lead_select'].includes(step.node)) || (ready && trace.find(step => step.node === 'lead_plan')?.actor !== 'lead_agent') || (ready && result.model !== 'claude-opus-5-5') || (ready && result.harness.lead_calls < 1))) return false;
  const audited = result.workers.filter(worker => worker.audited);
  if (result.workers.some(worker => (worker.status === 'accepted' || worker.code === 'VERIFIER_REJECTED') && !worker.audited)) return false;
  if (result.harness.audit_calls !== audited.length || result.harness.evidence_reads !== result.audits.reduce((sum, audit) => sum + audit.result.harness.tool_calls, 0)) return false;
  const verifierSteps = trace.filter(step => step.node === 'verifier');
  const plans = result.trace.filter(step => step.node === 'lead_plan');
  if (result.status === 'clarification' || result.status === 'outside_scope' || result.status === 'premise_blocked' ? plans.length !== 0 || result.revisions !== 0 : plans.length !== result.revisions + 1) return false;
  const verified = result.workers.filter(worker => worker.status === 'accepted' || worker.code === 'VERIFIER_REJECTED');
  if (JSON.stringify(verifierSteps.map(step => [step.audit_id, step.status])) !== JSON.stringify(verified.map(worker => [worker.audit_id, worker.status === 'accepted' ? 'completed' : 'failed']))) return false;
  return result.audits.every(audit => audit.result.product_id === audit.scope.product_id && audit.result.question_id === audit.scope.question_id && audit.result.evidence_policy === audit.scope.evidence_policy
    && audit.result.engine === 'evidence' && audit.result.model === null && audit.result.integrity_drill === 'none' && audit.result.draft_integrity === 'accepted' && audit.result.claims.length === 1
    && audit.result.claims[0]?.id === audit.scope.question_id && audit.result.harness.code_sha256 === result.harness.code_sha256 && chatAuditProseIsConsistent(audit.result) && researchExecutionIsConsistent(audit.result));
}
