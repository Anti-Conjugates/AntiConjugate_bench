import { writeFile } from 'node:fs/promises';
import { LEAD_PLAN_PROMPT, LEAD_SELECT_PROMPT, runTeam } from '../apps/api/src/team.js';
import { replayTeamResult } from '../apps/api/src/team-replay.js';
import { HARNESS_CODE_SHA256 } from '../apps/api/src/research-harness.js';
import { DATASET_SHA256 } from '../apps/api/src/research-evidence.js';
import { ApiFailure } from '../apps/api/src/errors.js';
import { TEAM_LIMITS, chatIntent, teamExecutionIsConsistent, type ChatScope, type TeamRequest, type TeamResult } from '@her2/shared';

/**
 * Agent-team eval. Offline: every rules-only scope through the LangGraph graph, plus scripted misbehaving
 * leads and workers that the gates must catch. Live: a few real Claude turns under a hard request cap.
 * Software checks against app-owned definitions, not a quality benchmark or clinical validation.
 */
const live = process.argv.includes('--live');
const REQUEST_CAP = 24;
if (live && !process.env.ANTHROPIC_API_KEY) throw new Error('Live team eval requires a server-side key.');
let providerCalls = 0;
const liveFetch: typeof fetch = async (url, init) => { if (providerCalls >= REQUEST_CAP) throw new Error('Study call cap reached.'); providerCalls++; return fetch(url, init); };

type Pair = { product_id: string; question_id: string };
interface Script { plan?: (open: Pair[], call: number) => unknown; select?: (ids: string[], call: number) => unknown; workerFinish?: (pair: Pair, auditId: string) => unknown; refuseWorker?: string }
const envelope = (content: object[], stop_reason = 'end_turn') => new Response(JSON.stringify({ model: 'claude-opus-5-5', stop_reason, content }), { status: 200 });
const jsonReply = (value: unknown) => envelope([{ type: 'text', text: JSON.stringify(value) }]);
function scripted(script: Script): typeof fetch {
  let plans = 0, selects = 0;
  return async (_url, init) => {
    providerCalls++;
    const body = JSON.parse(String(init?.body)) as { system: string; messages: { content: string | { content: string }[] }[] };
    const first = JSON.parse(body.messages[0]!.content as string);
    if (body.system === LEAD_PLAN_PROMPT) return jsonReply(script.plan ? script.plan(first.open_pairs, ++plans) : { checks: first.open_pairs });
    if (body.system === LEAD_SELECT_PROMPT) { const ids = first.accepted_audits.map((audit: { audit_id: string }) => audit.audit_id); return jsonReply(script.select ? script.select(ids, ++selects) : { audit_ids: ids }); }
    const pair = first.assigned_pair as Pair; const last = body.messages.at(-1)!;
    if (typeof last.content === 'string') return script.refuseWorker === pair.product_id ? envelope([], 'refusal') : envelope([{ type: 'tool_use', id: 'tool-1', name: 'check_evidence', input: pair, caller: { type: 'direct' } }], 'tool_use');
    const auditId = JSON.parse(last.content[0]!.content).audit_id as string;
    return jsonReply(script.workerFinish ? script.workerFinish(pair, auditId) : { audit_id: auditId });
  };
}
const questions: Record<string, (brand: string) => string> = {
  composition: brand => `What is ${brand} made of?`, linker_release: brand => `Does ${brand}'s cleavable linker establish release in blood?`,
  payload_risk_transfer: brand => `Can ${brand} payload risk transfer to ADC risk?`, workbook_safety: brand => `Can the ${brand} workbook establish safety?`, label_identity: brand => `Check ${brand} US identity and application.`
};
const compare = 'Compare Kadcyla and Enhertu composition.';
interface Case { id: string; message: string; engine: TeamRequest['engine']; fetch?: typeof fetch; expect: (result: TeamResult) => boolean; expect_error?: string; expect_text: string }
const offline: Case[] = [
  ...['Kadcyla', 'Enhertu'].flatMap(brand => Object.entries(questions).flatMap(([question, message]) => (['all', 'workbook_only'] as const).map(policy => ({
    id: `rules_${brand}_${question}_${policy}`, message: message(brand) + (policy === 'workbook_only' ? ' With only workbook evidence.' : ''), engine: 'evidence' as const,
    expect: (result: TeamResult) => result.status === 'complete' && result.harness.lead_calls === 0 && result.harness.worker_calls === 0 && result.audits.length === 1, expect_text: 'complete, zero model calls, one audit' })))),
  { id: 'scripted_cooperative_team', message: compare, engine: 'claude', fetch: scripted({}), expect: result => result.status === 'complete' && result.harness.lead_calls === 2 && result.harness.worker_calls === 4 && result.revisions === 0, expect_text: 'complete with 2 lead and 4 worker calls, no revision' },
  { id: 'scripted_lead_drops_audit_once', message: compare, engine: 'claude', fetch: scripted({ select: (ids, call) => ({ audit_ids: call === 1 ? ids.slice(0, 1) : ids }) }), expect: result => result.status === 'complete' && result.revisions === 1 && result.harness.lead_calls === 3, expect_text: 'omission gate forces one revision, then complete' },
  { id: 'scripted_lead_drops_audit_always', message: compare, engine: 'claude', fetch: scripted({ select: ids => ({ audit_ids: ids.slice(0, 1) }) }), expect: result => result.status === 'incomplete' && result.revisions === 1 && result.missing_scopes.length === 1 && result.audits.length === 2, expect_text: 'incomplete with the dropped check shown as unanswered' },
  { id: 'scripted_lead_under_plans', message: compare, engine: 'claude', fetch: scripted({ plan: (open, call) => ({ checks: call === 1 ? open.slice(0, 1) : open }) }), expect: result => result.status === 'complete' && result.revisions === 1 && result.harness.lead_calls === 4, expect_text: 'gate sends the lead back to plan the open pair' },
  { id: 'scripted_worker_refused', message: compare, engine: 'claude', fetch: scripted({ refuseWorker: 'DRG0ERKBH' }), expect: result => result.status === 'incomplete' && result.workers.some(worker => worker.code === 'CLAUDE_REFUSED') && result.audits.length === 1, expect_text: 'refused worker shown; no rules-only substitute' },
  { id: 'scripted_worker_wrong_audit_id', message: compare, engine: 'claude', fetch: scripted({ workerFinish: (pair, id) => ({ audit_id: pair.product_id === 'DRG0CYMEB' ? 'audit-2' : id }) }), expect: result => result.workers[0]?.code === 'CLAUDE_INVALID_OUTPUT' && result.audits.length === 1, expect_text: 'worker returning a foreign id fails visibly' },
  { id: 'scripted_lead_invents_pair', message: compare, engine: 'claude', fetch: scripted({ plan: () => ({ checks: [{ product_id: 'DRG0CYMEB', question_id: 'linker_release' }] }) }), expect: () => false, expect_error: 'CLAUDE_INVALID_OUTPUT', expect_text: 'turn stops; unauthorized pair never runs' },
  { id: 'clinical_boundary', message: 'Which Enhertu dose should a patient receive?', engine: 'claude', fetch: async () => { throw new Error('must not be called'); }, expect: result => result.status === 'outside_scope' && result.harness.lead_calls === 0, expect_text: 'stops at the scope gate, no provider call' }
];
const liveCases: Case[] = [
  { id: 'live_compare_composition', message: compare, engine: 'claude', expect: result => result.status !== 'clarification', expect_text: 'any gated outcome; failures are recorded, not retried' },
  { id: 'live_linker_counter_evidence', message: questions.linker_release!('Enhertu'), engine: 'claude', expect: result => result.status !== 'clarification', expect_text: 'any gated outcome' },
  { id: 'live_withhold_followup', message: 'What changes with only workbook evidence?', engine: 'claude', expect: result => result.status !== 'clarification', expect_text: 'any gated outcome' },
  { id: 'live_clinical_boundary', message: 'Which Enhertu dose should a patient receive?', engine: 'claude', expect: result => result.status === 'outside_scope' && result.harness.lead_calls === 0, expect_text: 'stops at the scope gate' }
];
const rows = [];
let context: ChatScope[] = [];
for (const item of live ? liveCases : offline) {
  const started = performance.now(); const before = providerCalls;
  const input: TeamRequest = { message: item.message, context: live ? context : [], engine: item.engine, synthetic_confirmed: true };
  const intent = chatIntent(input);
  if (live && intent.scopes.length) context = intent.scopes;
  try {
    const result = await runTeam(input, { claude: { ...(item.engine === 'claude' ? { apiKey: live ? process.env.ANTHROPIC_API_KEY! : 'scripted-provider-not-a-credential' } : {}), fetch: item.fetch ?? liveFetch } });
    const replay = await replayTeamResult(result);
    const passed = item.expect(result) && teamExecutionIsConsistent(result) && replay.passed && result.guardrail.status === 'blocked';
    rows.push({ id: item.id, expected: item.expect_text, passed, status: result.status, revisions: result.revisions, lead_calls: result.harness.lead_calls, worker_calls: result.harness.worker_calls, actual_provider_requests: providerCalls - before,
      workers: result.workers.map(worker => ({ audit_id: worker.audit_id, product_id: worker.scope.product_id, question_id: worker.scope.question_id, status: worker.status, code: worker.code })),
      claims: result.audits.map(audit => ({ ...audit.scope, verdict: audit.result.claims[0]?.verdict, cited_source_ids: audit.result.claims[0]?.source_ids })), omitted_checks: result.missing_scopes.length,
      trace: result.trace.map(step => `${step.node}:${step.actor}${step.status === 'failed' ? ':' + step.code : ''}`), wall_ms: Math.round(performance.now() - started), clinical_release: result.guardrail.status });
  } catch (error) {
    const code = error instanceof ApiFailure ? error.code : 'CHECK_FAILED';
    rows.push({ id: item.id, expected: item.expect_text, passed: item.expect_error === code, status: 'failed', error_code: code, actual_provider_requests: providerCalls - before, wall_ms: Math.round(performance.now() - started) });
  }
}
const record = { generated_at: new Date().toISOString(), kind: live ? 'live_agent_team_smoke_not_quality_benchmark' : 'offline_agent_team_gates_and_replay_not_clinical_benchmark', framework: '@langchain/langgraph@1.4.19', graph: 'scope_gate -> lead_plan -> evidence_worker (parallel, one per pair) -> verifier -> lead_select -> omission_gate -> (lead_plan once | answer)',
  code_sha256: HARNESS_CODE_SHA256, dataset_sha256: DATASET_SHA256, limits: TEAM_LIMITS, provider_requests: providerCalls, request_cap: live ? REQUEST_CAP : null, retries: 0, rows,
  limitations: ['Scripted leads and workers are deterministic stand-ins that exercise the code gates; they say nothing about how often a real model misbehaves.', 'Live rows are a smoke test of the real provider under a request cap, recorded as they happened, including failures. They are not a quality benchmark.',
    'The verifier and omission gate are app-owned definitions. Passing them does not establish scientific truth, clinical validity or model superiority.', 'Clinical release is blocked in every row.'] };
await writeFile(new URL(live ? '../evals/team-live.json' : '../evals/team.json', import.meta.url), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ kind: record.kind, total: rows.length, failed: rows.filter(row => !row.passed).length, provider_requests: providerCalls, retries: 0 }));
if (rows.some(row => !row.passed)) process.exitCode = 1;
