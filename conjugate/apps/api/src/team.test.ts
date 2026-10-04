import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_GRAPH, teamExecutionIsConsistent, type ChatScope, type TeamRequest, type TeamResult } from '@her2/shared';
import { LEAD_PLAN_PROMPT, LEAD_SELECT_PROMPT, WORKER_PROMPT, buildTeamGraph, runTeam } from './team.js';
import { replayTeamResult } from './team-replay.js';
import { ApiFailure } from './errors.js';
import type { FetchLike } from './claude.js';

const request = (message = 'Compare Kadcyla and Enhertu composition.', engine: TeamRequest['engine'] = 'claude', context: ChatScope[] = []): TeamRequest => ({ message, context, engine, synthetic_confirmed: true });
const envelope = (content: object[], stop_reason = 'end_turn') => new Response(JSON.stringify({ model: 'claude-opus-5-5', stop_reason, content }), { status: 200 });
const jsonReply = (value: unknown) => envelope([{ type: 'text', text: JSON.stringify(value) }]);
interface Behaviour { plan?: (open: { product_id: string; question_id: string }[], call: number) => unknown; select?: (ids: string[], call: number) => unknown; worker?: (pair: { product_id: string; question_id: string }, phase: 'tool' | 'finish', auditId: string | null) => Response | undefined; refuse?: 'lead' | 'worker' }
/** A scripted provider: dispatches on the system prompt so each role can misbehave independently. */
function team(behaviour: Behaviour = {}, seen: Record<string, unknown>[] = []): FetchLike {
  let planCalls = 0, selectCalls = 0;
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown> & { system: string; messages: { role: string; content: string | { type: string; content?: string }[] }[] };
    seen.push(body);
    if (body.system === LEAD_PLAN_PROMPT) {
      const data = JSON.parse(body.messages[0]!.content as string);
      if (behaviour.refuse === 'lead') return envelope([], 'refusal');
      return jsonReply(behaviour.plan ? behaviour.plan(data.open_pairs, ++planCalls) : { checks: data.open_pairs });
    }
    if (body.system === LEAD_SELECT_PROMPT) {
      const data = JSON.parse(body.messages[0]!.content as string);
      const ids = data.accepted_audits.map((audit: { audit_id: string }) => audit.audit_id);
      return jsonReply(behaviour.select ? behaviour.select(ids, ++selectCalls) : { audit_ids: ids });
    }
    assert.equal(body.system, WORKER_PROMPT);
    const pair = JSON.parse(body.messages[0]!.content as string).assigned_pair;
    const last = body.messages.at(-1)!;
    if (typeof last.content === 'string') {
      if (behaviour.refuse === 'worker' && pair.product_id === 'DRG0ERKBH') return envelope([], 'refusal');
      return behaviour.worker?.(pair, 'tool', null) ?? envelope([{ type: 'tool_use', id: 'tool-1', name: 'check_evidence', input: pair, caller: { type: 'direct' } }], 'tool_use');
    }
    const auditId = JSON.parse((last.content as { content: string }[])[0]!.content).audit_id as string;
    return behaviour.worker?.(pair, 'finish', auditId) ?? jsonReply({ audit_id: auditId });
  };
}
const claude = (behaviour: Behaviour = {}, seen: Record<string, unknown>[] = []) => ({ claude: { apiKey: 'test-key', fetch: team(behaviour, seen) } });

test('compiled LangGraph matches the published graph shape', () => {
  const graph = buildTeamGraph(async () => ({}), { afterScope: () => 'answer', afterPlan: () => 'omission_gate', afterVerify: () => 'omission_gate', afterGate: () => 'answer' }, async () => { throw new Error('unused'); }).getGraph();
  const edges = graph.edges.map(edge => ({ from: edge.source, to: edge.target, conditional: Boolean(edge.conditional) })).sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`));
  assert.deepEqual(edges, [...TEAM_GRAPH.edges].sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`)));
  assert.deepEqual(Object.keys(graph.nodes).filter(node => !node.startsWith('__')).sort(), [...TEAM_GRAPH.nodes].sort());
});
test('rules-only team runs the same graph with code in every seat and no model calls', async () => {
  const steps: string[] = [];
  const result = await runTeam(request('Compare Kadcyla and Enhertu composition.', 'evidence'), { onStep: step => { steps.push(step.node); } });
  assert.equal(result.status, 'complete'); assert.equal(result.audits.length, 2); assert.equal(result.model, null);
  assert.equal(result.harness.lead_calls, 0); assert.equal(result.harness.worker_calls, 0); assert.equal(result.harness.evidence_reads, 8); assert.equal(result.revisions, 0);
  assert.deepEqual(steps, ['scope_gate', 'lead_plan', 'evidence_worker', 'evidence_worker', 'verifier', 'verifier', 'lead_select', 'omission_gate', 'answer']);
  assert.ok(result.trace.every(step => step.actor === 'controller' || step.actor === 'deterministic_verifier'));
  assert.ok(teamExecutionIsConsistent(result)); assert.equal((await replayTeamResult(result)).passed, true);
  assert.equal(result.guardrail.status, 'blocked'); assert.equal(result.needs_human, true); assert.equal(result.answer_correctness_probability, null); assert.equal(result.omission_probability, null);
});
test('clinical and unrecognized questions stop at the scope gate without any provider call', async () => {
  for (const [message, status] of [['Which Enhertu dose should a patient receive?', 'outside_scope'], ['What is the weather?', 'clarification']] as const) {
    const result = await runTeam(request(message), { claude: { apiKey: 'test-key', fetch: async () => { assert.fail('Must not call provider'); } } });
    assert.equal(result.status, status); assert.equal(result.harness.lead_calls, 0); assert.deepEqual(result.trace.map(step => step.node), ['scope_gate', 'answer']); assert.ok(teamExecutionIsConsistent(result));
  }
});
test('lead plans, isolated workers run in parallel with one pair each, verifier accepts, lead selects', async () => {
  const seen: Record<string, unknown>[] = [];
  const result = await runTeam(request(), claude({}, seen));
  assert.equal(result.status, 'complete'); assert.equal(result.harness.lead_calls, 2); assert.equal(result.harness.worker_calls, 4); assert.equal(result.harness.audit_calls, 2); assert.equal(result.model, 'claude-opus-5-5');
  assert.deepEqual(result.selected_audit_ids, ['audit-1', 'audit-2']); assert.deepEqual(result.workers.map(worker => worker.model_calls), [2, 2]);
  const workerBodies = seen.filter(body => body.system === WORKER_PROMPT).map(body => JSON.stringify(body));
  assert.equal(workerBodies.length, 4);
  assert.ok(workerBodies.every(body => (body.includes('DRG0CYMEB') ? 1 : 0) + (body.includes('DRG0ERKBH') ? 1 : 0) === 1), 'each worker sees exactly one product');
  assert.ok(seen.every(body => !JSON.stringify(body).includes('Compare Kadcyla')), 'raw user text never reaches the provider');
  assert.deepEqual(result.trace.map(step => [step.node, step.actor]), [['scope_gate', 'controller'], ['lead_plan', 'lead_agent'], ['evidence_worker', 'worker_agent'], ['evidence_worker', 'worker_agent'], ['verifier', 'deterministic_verifier'], ['verifier', 'deterministic_verifier'], ['lead_select', 'lead_agent'], ['omission_gate', 'controller'], ['answer', 'controller']]);
  assert.ok(teamExecutionIsConsistent(result)); assert.equal((await replayTeamResult(result)).passed, true);
});
test('omission gate sends an under-selecting lead back exactly once, then shows what is still missing', async () => {
  const recovered = await runTeam(request(), claude({ select: (ids, call) => ({ audit_ids: call === 1 ? ids.slice(0, 1) : ids }) }));
  assert.equal(recovered.status, 'complete'); assert.equal(recovered.revisions, 1); assert.equal(recovered.harness.lead_calls, 3);
  assert.deepEqual(recovered.trace.map(step => step.node).filter(node => node === 'omission_gate' || node === 'lead_select'), ['lead_select', 'omission_gate', 'lead_select', 'omission_gate']);
  assert.ok(teamExecutionIsConsistent(recovered));
  const stubborn = await runTeam(request(), claude({ select: ids => ({ audit_ids: ids.slice(0, 1) }) }));
  assert.equal(stubborn.status, 'incomplete'); assert.equal(stubborn.revisions, 1); assert.equal(stubborn.missing_scopes.length, 1); assert.equal(stubborn.audits.length, 2); assert.equal(stubborn.selected_audit_ids.length, 1);
  assert.match(stubborn.reply, /unanswered/i); assert.ok(teamExecutionIsConsistent(stubborn));
});
test('a lead that under-plans gets one revision to plan the open pair', async () => {
  const result = await runTeam(request(), claude({ plan: (open, call) => ({ checks: call === 1 ? open.slice(0, 1) : open }) }));
  assert.equal(result.status, 'complete'); assert.equal(result.revisions, 1); assert.equal(result.harness.lead_calls, 4); assert.equal(result.audits.length, 2);
  assert.deepEqual(result.workers.map(worker => worker.audit_id), ['audit-1', 'audit-2']); assert.ok(teamExecutionIsConsistent(result));
});
test('a refused or malformed worker fails visibly; the other worker stands; nothing switches to rules only', async () => {
  const refused = await runTeam(request(), claude({ refuse: 'worker' }));
  assert.equal(refused.status, 'incomplete'); assert.equal(refused.audits.length, 1); assert.equal(refused.harness.worker_calls, 3);
  assert.deepEqual(refused.workers.map(worker => [worker.status, worker.code]), [['accepted', null], ['failed', 'CLAUDE_REFUSED']]);
  assert.equal(refused.trace.find(step => step.node === 'evidence_worker' && step.audit_id === 'audit-2')?.code, 'CLAUDE_REFUSED'); assert.ok(teamExecutionIsConsistent(refused));
  const wrongId = await runTeam(request(), claude({ worker: (pair, phase) => phase === 'finish' && pair.product_id === 'DRG0CYMEB' ? jsonReply({ audit_id: 'audit-2' }) : undefined }));
  assert.deepEqual(wrongId.workers.map(worker => worker.code), ['CLAUDE_INVALID_OUTPUT', null]); assert.equal(wrongId.harness.audit_calls, 2); assert.equal(wrongId.audits.length, 1); assert.ok(teamExecutionIsConsistent(wrongId));
  const wrongPair = await runTeam(request(), claude({ worker: (pair, phase) => phase === 'tool' && pair.product_id === 'DRG0CYMEB' ? envelope([{ type: 'tool_use', id: 'tool-1', name: 'check_evidence', input: { product_id: 'DRG0ERKBH', question_id: 'composition' }, caller: { type: 'direct' } }], 'tool_use') : undefined }));
  assert.deepEqual(wrongPair.workers.map(worker => worker.code), ['CLAUDE_INVALID_OUTPUT', null]); assert.equal(wrongPair.harness.audit_calls, 1);
});
test('a lead that invents pairs, duplicates, picks foreign ids or is refused stops the turn', async () => {
  await assert.rejects(runTeam(request(), claude({ plan: () => ({ checks: [{ product_id: 'DRG0CYMEB', question_id: 'linker_release' }] }) })), (error: ApiFailure) => error.code === 'CLAUDE_INVALID_OUTPUT');
  await assert.rejects(runTeam(request(), claude({ plan: open => ({ checks: [open[0], open[0]] }) })), (error: ApiFailure) => error.code === 'CLAUDE_INVALID_OUTPUT');
  await assert.rejects(runTeam(request(), claude({ select: () => ({ audit_ids: ['audit-4'] }) })), (error: ApiFailure) => error.code === 'CLAUDE_INVALID_OUTPUT');
  await assert.rejects(runTeam(request(), claude({ refuse: 'lead' })), (error: ApiFailure) => error.code === 'CLAUDE_REFUSED');
  await assert.rejects(runTeam(request(), { claude: { apiKey: '' } }), (error: ApiFailure) => error.code === 'CLAUDE_NOT_CONFIGURED');
});
test('cancellation and the whole-turn deadline stop the graph', async () => {
  const controller = new AbortController();
  const slow: FetchLike = async (...args) => { controller.abort(); return team()(...args); };
  await assert.rejects(runTeam(request(), { signal: controller.signal, claude: { apiKey: 'test-key', fetch: slow } }), (error: ApiFailure) => error.code === 'RESEARCH_CANCELLED');
  const hang: FetchLike = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(runTeam(request(), { claude: { apiKey: 'test-key', fetch: hang, timeoutMs: 50 } }), (error: ApiFailure) => error.code === 'CLAUDE_TIMEOUT');
});
test('tampered team results fail the shared consistency check', async () => {
  const result = await runTeam(request(), claude());
  const tampered: TeamResult[] = [
    { ...result, selected_audit_ids: ['audit-1', 'audit-2', 'audit-3'] },
    { ...result, harness: { ...result.harness, worker_calls: 2 } },
    { ...result, workers: result.workers.map(worker => ({ ...worker, status: 'failed', code: 'CLAUDE_REFUSED' })) },
    { ...result, workers: result.workers.map(worker => ({ ...worker, audited: false })) },
    { ...result, missing_scopes: [] , status: 'complete', scopes: [...result.scopes, { product_id: 'DRG0CYMEB', question_id: 'linker_release', evidence_policy: 'all' }] },
    { ...result, engine: 'evidence' },
    { ...result, trace: result.trace.slice(0, -1) }
  ];
  for (const item of tampered) assert.equal(teamExecutionIsConsistent(item), false);
  await assert.rejects(replayTeamResult(tampered[1]));
});
test('follow-ups keep context and source withholding produces a fresh audit through the team', async () => {
  const baseline = await runTeam(request('Does Enhertu’s cleavable linker establish release in blood?'), claude());
  const withheld = await runTeam(request('What changes with only workbook evidence?', 'claude', baseline.scopes), claude());
  assert.equal(baseline.audits[0]?.result.claims[0]?.verdict, 'contradicted'); assert.equal(withheld.audits[0]?.result.claims[0]?.verdict, 'insufficient');
  assert.equal(withheld.harness.evidence_reads, 1); assert.equal(withheld.harness.worker_calls, 2); assert.ok(teamExecutionIsConsistent(withheld));
});
