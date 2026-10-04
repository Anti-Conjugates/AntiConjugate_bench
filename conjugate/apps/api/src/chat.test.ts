import test from 'node:test';
import assert from 'node:assert/strict';
import { chatIntent, ChatRequestSchema, chatConversationContext, chatExecutionIsConsistent, type ChatRequest, type ChatScope } from '@her2/shared';
import { runChat } from './chat.js';
import { replayChatResult } from './chat-replay.js';
import { ApiFailure } from './errors.js';
import type { FetchLike } from './claude.js';

const request = (message = 'Does Enhertu’s cleavable linker establish release in blood?', context: ChatScope[] = [], engine: ChatRequest['engine'] = 'evidence'): ChatRequest => ({ message, context, engine, synthetic_confirmed: true });
const tool = (id = 'tool-1', input: object = { product_id: 'DRG0ERKBH', question_id: 'linker_release' }) => ({ type: 'tool_use', id, name: 'check_evidence', input, caller: { type: 'direct' } });
const envelope = (content: object[], stop_reason = 'tool_use') => new Response(JSON.stringify({ model: 'claude-opus-5-5', stop_reason, content }), { status: 200 });
const final = (audit_ids = ['audit-1']) => envelope([{ type: 'text', text: JSON.stringify({ audit_ids }) }], 'end_turn');
function nativeAgent(onRequest?: (data: Record<string, unknown>, call: number) => void): FetchLike {
  let call = 0;
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)); onRequest?.(body, ++call);
    const last = body.messages.at(-1);
    if (last.role === 'user' && typeof last.content === 'string') {
      const intent = JSON.parse(last.content).recognized_research_intent;
      return envelope(intent.scopes.map((scope: ChatScope, index: number) => tool(`tool-${index + 1}`, { product_id: scope.product_id, question_id: scope.question_id })));
    }
    return final(last.content.map((item: {content: string}) => JSON.parse(item.content).audit_id));
  };
}

test('chat request is strict and requires synthetic confirmation; context contains only finite hints', () => {
  for (const input of [{ ...request(), synthetic_confirmed: false }, { ...request(), message: 'x'.repeat(1001) }, { ...request(), context: [{ product_id: 'other', question_id: 'composition', evidence_policy: 'all' }] }, { ...request(), history: ['old answer'] }, { ...request(), source_ids: ['invented'] }]) assert.equal(ChatRequestSchema.safeParse(input).success, false);
});
test('controller scopes aliases, comparisons and explicit product switches', () => {
  assert.deepEqual(chatIntent(request('Compare trastuzumab emtansine and trastuzumab deruxtecan composition.')).scopes.map(scope => scope.product_id), ['DRG0CYMEB', 'DRG0ERKBH']);
  const context = chatIntent(request()).scopes;
  assert.equal(chatIntent(request('What is Kadcyla made of?', context)).scopes[0]?.product_id, 'DRG0CYMEB');
  assert.equal(chatIntent(request('Why?', context)).scopes[0]?.question_id, 'linker_release');
  assert.equal(chatIntent(request('No labels, check again.', context)).scopes[0]?.evidence_policy, 'workbook_only');
  assert.equal(chatIntent(request('What is the weather?', context)).status, 'clarification');
  assert.equal(chatIntent(request('Does NCT09999999 show Enhertu linker release?')).status, 'ready');
  assert.equal(chatIntent(request('PMID: 99999901 says Kadcyla payload is DM1.')).status, 'ready');
});
test('clinical questions stop locally; raw unknown words never enter provider input', async () => {
  for (const text of ['My mother takes Enhertu, which dose?', 'Is Kadcyla safer for a patient?', 'Recommend treatment using Enhertu.', 'Enhertu record for person@example.com', 'Enhertu dosing 125mg',
    'Is Enhertu safe to use at platelets 40?', 'Enhertu linker with ANC low', 'Kadcyla composition when LVEF falls', 'Enhertu eGFR 25 linker', 'Kadcyla 3.6 mg/kg composition']) {
    const result = await runChat(request(text, [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => { assert.fail('Must not call provider'); } } });
    assert.equal(result.status, 'outside_scope'); assert.equal(result.harness.model_calls, 0); assert.equal(result.audits.length, 0);
  }
  const messages: string[] = [];
  await runChat(request('UnrecognizedSentinel AdaSurname Enhertu payload DAR', [], 'claude'), { claude: { apiKey: 'test-key', fetch: nativeAgent(data => messages.push(JSON.stringify(data))) } });
  assert.ok(messages.every(body => !body.includes('UnrecognizedSentinel') && !body.includes('AdaSurname')));
});
test('rules-only comparison and meaningful abstention preserve all clinical invariants', async () => {
  const comparison = await runChat(request('Compare Kadcyla and Enhertu composition.'));
  assert.equal(comparison.status, 'complete'); assert.equal(comparison.audits.length, 2); assert.equal(comparison.harness.evidence_reads, 8); assert.equal(comparison.harness.model_calls, 0);
  assert.match(comparison.reply, /DM1.*3\.5/); assert.match(comparison.reply, /DXd.*8/);
  const limits = await runChat(request('Can the Enhertu workbook establish safety?'));
  assert.equal(limits.audits[0]?.result.claims[0]?.verdict, 'insufficient');
  for (const result of [comparison, limits]) { assert.equal(result.guardrail.status, 'blocked'); assert.equal(result.needs_human, true); assert.equal(result.answer_correctness_probability, null); assert.equal(result.eligibility, 'not_assessed'); assert.ok(chatExecutionIsConsistent(result)); }
});
test('withholding is a fresh audit, does not reuse prior prose or hidden labels, and can be restored', async () => {
  const baseline = await runChat(request());
  const withheld = await runChat(request('What changes with only workbook evidence?', baseline.scopes));
  assert.equal(baseline.audits[0]?.result.claims[0]?.verdict, 'contradicted'); assert.equal(withheld.audits[0]?.result.claims[0]?.verdict, 'insufficient');
  assert.equal(withheld.harness.evidence_reads, 1); assert.ok(withheld.audits[0]?.result.receipts.every(source => source.kind === 'workbook')); assert.doesNotMatch(withheld.reply, /lysosomal/);
  const restored = await runChat(request('Restore all sources and check again.', withheld.scopes));
  assert.equal(restored.audits[0]?.result.claims[0]?.verdict, 'contradicted');
});
test('native loop makes real tool calls, retains signed thinking in RAM and emits only safe completed steps', async () => {
  const bodies: Record<string, unknown>[] = [];
  let calls = 0;
  const fetch: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return ++calls === 1 ? envelope([{ type: 'thinking', thinking: 'RAW_MODEL_SENTINEL', signature: 'fake-signature' }, { type: 'text', text: 'RAW_MODEL_SENTINEL' }, tool()]) : final();
  };
  const result = await runChat(request(undefined, [], 'claude'), { claude: { apiKey: 'test-key', fetch } });
  assert.equal(calls, 2); assert.equal(result.harness.model_calls, 2); assert.equal(result.harness.audit_calls, 1); assert.equal(result.harness.evidence_reads, 4);
  assert.equal(result.harness.skills.length, 3); assert.ok(JSON.stringify(bodies[1]).includes('fake-signature')); assert.ok(!JSON.stringify(result).includes('RAW_MODEL_SENTINEL'));
  assert.ok(!bodies.some(body => 'tool_choice' in body)); assert.equal(result.audits[0]?.result.engine, 'evidence');
  assert.equal((await replayChatResult(result)).passed, true);
});
test('native batch checks both products and missing answer selections remain visible omissions', async () => {
  const full = await runChat(request('Compare Kadcyla and Enhertu composition.', [], 'claude'), { claude: { apiKey: 'test-key', fetch: nativeAgent() } });
  assert.equal(full.audits.length, 2); assert.equal(full.status, 'complete');
  let calls = 0;
  const partial = await runChat(request('Compare Kadcyla and Enhertu composition.', [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => ++calls === 1 ? envelope([tool('tool-1', { product_id: 'DRG0ERKBH', question_id: 'composition' })]) : final([]) } });
  assert.equal(partial.status, 'incomplete'); assert.equal(partial.missing_scopes.length, 2); assert.equal(partial.selected_audit_ids.length, 0); assert.equal(partial.audits.length, 1);
});
test('out-of-scope tools, forged arguments and mixed invalid batches execute no audits', async () => {
  const bad: object[][] = [
    [{ ...tool(), name: 'fetch_url' }], [{ ...tool(), caller: { type: 'code_execution', tool_id: 'other' } }], [tool('tool-1', { product_id: 'DRG0CYMEB', question_id: 'linker_release' })],
    [tool('tool-1', { product_id: 'DRG0ERKBH', question_id: 'linker_release', evidence_policy: 'all' })],
    [tool('tool-1', { product_id: 'DRG0ERKBH', question_id: 'linker_release', path: '/secret' })],
    [tool(), tool('tool-2', { product_id: 'DRG0CYMEB', question_id: 'composition' })], [tool(), tool('tool-1')]
  ];
  for (const content of bad) {
    const steps: string[] = [];
    await assert.rejects(runChat(request(undefined, [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => envelope(content) }, onStep: step => { steps.push(step.stage); } }), (error: unknown) => error instanceof ApiFailure && error.code === 'CLAUDE_INVALID_OUTPUT');
    assert.ok(!steps.includes('audit'));
  }
});
test('invented or duplicate final audit ids and raw prose fail closed; no-tool completion is not abstention', async () => {
  for (const ids of [['audit-4'], ['audit-1', 'audit-1']]) {
    let count = 0;
    await assert.rejects(runChat(request(undefined, [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => ++count === 1 ? envelope([tool()]) : final(ids) } }), /ids that do not fit/);
  }
  for (const response of [final([]), envelope([{ type: 'text', text: 'RAW_MODEL_SENTINEL' }], 'end_turn')]) await assert.rejects(runChat(request(undefined, [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => response.clone() } }), /ids that do not fit/);
});
test('duplicate audit attempts, provider refusals and provider errors never retry or fall back', async () => {
  let calls = 0;
  await assert.rejects(runChat(request(undefined, [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => { calls++; return envelope([tool(`tool-${calls}`)]); } } }), (error: unknown) => error instanceof ApiFailure && error.code === 'CLAUDE_INVALID_OUTPUT');
  assert.equal(calls, 2);
  for (const response of [envelope([], 'refusal'), new Response('RAW_UPSTREAM_SENTINEL', { status: 500 }), envelope([tool()], 'max_tokens')]) {
    calls = 0;
    await assert.rejects(runChat(request(undefined, [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => { calls++; return response.clone(); } } }));
    assert.equal(calls, 1);
  }
});
test('model budget is bounded across multiple genuine continuations', async () => {
  const scopes = chatIntent(request('How do Kadcyla and Enhertu work?')).scopes;
  let calls = 0;
  await assert.rejects(runChat(request('How do Kadcyla and Enhertu work?', [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => { const scope = scopes[calls++]!; return envelope([tool(`tool-${calls}`, { product_id: scope.product_id, question_id: scope.question_id })]); } } }), (error: unknown) => error instanceof ApiFailure && error.code === 'CHAT_BUDGET_EXCEEDED');
  assert.equal(calls, 4);
});
test('timeouts, cancel, byte limits and absent keys stop work without alternate engines', async () => {
  await assert.rejects(runChat(request(undefined, [], 'claude')), (error: unknown) => error instanceof ApiFailure && error.code === 'CLAUDE_NOT_CONFIGURED');
  await assert.rejects(runChat(request(undefined, [], 'claude'), { claude: { apiKey: 'test-key', timeoutMs: 5, fetch: async () => new Promise<Response>(() => undefined) } }), (error: unknown) => error instanceof ApiFailure && error.code === 'CLAUDE_TIMEOUT');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runChat(request(), { signal: controller.signal }), (error: unknown) => error instanceof ApiFailure && error.code === 'RESEARCH_CANCELLED');
  await assert.rejects(runChat(request(undefined, [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => new Response('x'.repeat(131073)) } }), /ids that do not fit/);
});
test('replay rejects tampered replies, sources, verdicts, scopes, counters and skill records', async () => {
  const result = await runChat(request());
  assert.equal((await replayChatResult(result)).passed, true);
  const mutations: ((copy: typeof result) => void)[] = [
    copy => { copy.followups[0] = 'FORGED_FOLLOWUP'; }, copy => { copy.audits[0]!.result.unknowns[0] = 'FORGED_UNKNOWN'; }, copy => { copy.trace[0]!.detail = 'FORGED_TRACE'; }, copy => { copy.audits[0]!.result.trace[0]!.detail = 'FORGED_AUDIT_TRACE'; },
    copy => { copy.reply = 'FORGED_REPLY'; }, copy => { copy.audits[0]!.result.claims[0]!.verdict = 'supported'; },
    copy => { copy.audits[0]!.result.receipts[0]!.excerpt += 'FORGED_SOURCE'; }, copy => { copy.harness.audit_calls = 0; },
    copy => { copy.audits[0]!.scope.question_id = 'composition'; }, copy => { copy.harness.skills.push({ name: 'invented', version: '1.0.0', sha256: '0'.repeat(64) }); }
  ];
  for (const mutate of mutations) { const copy = structuredClone(result); mutate(copy); await assert.rejects(replayChatResult(copy)); }
});
test('scope controls preserve negation, comparisons, requested topics and ambiguous-policy abstention', async () => {
  const context: ChatScope[] = [{ product_id: 'DRG0ERKBH', question_id: 'linker_release', evidence_policy: 'workbook_only' }];
  for (const message of ['Do not restore all sources.', "Don't restore the sources.", 'Never restore sources.']) {
    const result = await runChat(request(message, context)); assert.equal(result.scopes[0]?.evidence_policy, 'workbook_only'); assert.equal(result.harness.evidence_reads, 1);
  }
  for (const message of ['Withhold labels but restore all sources.', "Don't withhold labels.", 'Never ever restore all sources.', "Don't ever restore sources.", "I wouldn't restore all sources.", 'Please restore none of the sources.', 'Please keep labels withheld; restore nothing.', 'Restore the labels.']) assert.equal(chatIntent(request(message, context)).status, 'clarification');
  assert.equal(chatIntent(request('Restore all sources.', context)).scopes[0]?.evidence_policy, 'all');
  const comparison = chatIntent(request('Compare with Kadcyla.', context)); assert.deepEqual(comparison.scopes.map(scope => scope.product_id), ['DRG0CYMEB', 'DRG0ERKBH']); assert.ok(comparison.scopes.every(scope => scope.question_id === 'linker_release' && scope.evidence_policy === 'workbook_only'));
  assert.equal(chatIntent(request('Compare both products composition.', context)).status, 'clarification');
  assert.equal(chatIntent(request('Compare both products composition.', [...context, { ...context[0]!, product_id: 'DRG0CYMEB' }])).scopes.length, 2);
  assert.equal(chatIntent(request('Compare the two vedotin ADCs.')).status, 'clarification');
  assert.deepEqual(chatIntent(request('Enhertu composition and toxicity.')).scopes.map(scope => scope.question_id), ['composition', 'payload_risk_transfer']);
  assert.deepEqual(chatIntent(request('Enhertu composition and US identity.')).scopes.map(scope => scope.question_id), ['composition', 'label_identity']);
  assert.equal(chatIntent(request('Compare with Kadcyla.', [...context, { ...context[0]!, question_id: 'composition' }])).status, 'clarification');
  assert.equal(chatIntent(request('Explain again.', [...context, { ...context[0]!, evidence_policy: 'all' }])).status, 'clarification');
});
test('a later invalid batch executes no new audits when a prior scope is duplicated', async () => {
  let calls = 0; let audits = 0;
  await assert.rejects(runChat(request('Compare Kadcyla and Enhertu composition.', [], 'claude'), { claude: { apiKey: 'test-key', fetch: async () => ++calls === 1 ? envelope([tool('first', { product_id: 'DRG0CYMEB', question_id: 'composition' })]) : envelope([tool('new', { product_id: 'DRG0ERKBH', question_id: 'composition' }), tool('prior', { product_id: 'DRG0CYMEB', question_id: 'composition' })]) }, onStep: step => { if (step.stage === 'audit') audits++; } }), (error: unknown) => error instanceof ApiFailure && error.code === 'CLAUDE_INVALID_OUTPUT');
  assert.equal(calls, 2); assert.equal(audits, 1);
});
test('the whole turn bounds stalled skill reads and callbacks and rejects late completions', async () => {
  const never = async () => new Promise<Uint8Array>(() => undefined);
  let calls = 0;
  const claude = { apiKey: 'test-key', timeoutMs: 10, fetch: async () => { calls++; return final(); } };
  for (const options of [{ claude, skillReader: never }, { claude, onStep: async () => new Promise<void>(() => undefined) }]) await assert.rejects(runChat(request(undefined, [], 'claude'), options), (error: unknown) => error instanceof ApiFailure && error.code === 'CLAUDE_TIMEOUT');
  const controller = new AbortController();
  const pending = runChat(request(undefined, [], 'claude'), { claude: { ...claude, timeoutMs: 1000 }, skillReader: never, signal: controller.signal });
  controller.abort(); await assert.rejects(pending, (error: unknown) => error instanceof ApiFailure && error.code === 'RESEARCH_CANCELLED');
  assert.equal(calls, 0);
});
test('a failed question still supplies local scope hints for a fresh follow-up, never prior answer prose', () => {
  const first = request('Compare Kadcyla and Enhertu composition.');
  const failed = request(undefined, chatIntent(first).scopes, 'claude');
  const context = chatConversationContext([first, failed]);
  const withheld = chatIntent(request('What changes with only workbook evidence?', context));
  assert.deepEqual(withheld.scopes, [{ product_id: 'DRG0ERKBH', question_id: 'linker_release', evidence_policy: 'workbook_only' }]);
});
