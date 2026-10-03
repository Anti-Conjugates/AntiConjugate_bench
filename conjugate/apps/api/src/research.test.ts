import assert from 'node:assert/strict';
import test from 'node:test';
import { ResearchResultSchema, type ResearchDraft, type ResearchRequest, type ResearchTrace } from '@her2/shared';
import { ApiFailure } from './errors.js';
import { CLAUDE_MODEL, PRODUCT_IDS } from './evidence.js';
import { auditResearchDraft, runResearch } from './research.js';
import { allowedTools, DATASET_SHA256, derivedSourceId, expectedClaim, labelSourceId, readResearchTool, workbookSourceId } from './research-evidence.js';
import { draftOutputSchema, plannerOutputSchema } from './research-claude.js';
import { modelResponse, NON_CREDENTIAL } from './test-support.js';
import { type FetchLike } from './claude.js';

// Software contract fixtures only: no patient cases, scientific model calls or clinical scoring.
export function researchInput(overrides: Partial<ResearchRequest> = {}): ResearchRequest {
  return { product_id: 'DRG0ERKBH', question_id: 'linker_release', engine: 'evidence', evidence_policy: 'all', integrity_drill: 'none', synthetic_confirmed: true, ...overrides };
}
function hasCode(code: string) { return (error: unknown) => error instanceof ApiFailure && error.code === code; }
function trustedDraft(request: ResearchRequest, tools = allowedTools(request)): ResearchDraft {
  const expected = expectedClaim(request, tools.flatMap(tool => readResearchTool(tool, request)));
  return { product_id: request.product_id, claims: [{ claim_id: expected.id, source_ids: expected.source_ids }] };
}
function twoCallMock(request: ResearchRequest, draft: unknown, tools = allowedTools(request)): FetchLike {
  let calls = 0;
  return async () => ++calls === 1 ? modelResponse({ product_id: request.product_id, tool_ids: tools }) : modelResponse(draft);
}

test('both products and all hypotheses are bounded shared-contract drafts; explicit evidence mode calls no LLM', async () => {
  for (const product_id of PRODUCT_IDS) for (const question_id of ['composition', 'linker_release', 'payload_risk_transfer', 'workbook_safety'] as const) {
    let calls = 0;
    const result = ResearchResultSchema.parse(await runResearch(researchInput({ product_id, question_id }), { claude: { fetch: async () => { calls++; throw new Error('no model call permitted'); } } }));
    assert.equal(calls, 0); assert.equal(result.model, null); assert.equal(result.draft_integrity, 'accepted');
    assert.equal(result.clinical_status, 'draft_pending_pharmacist'); assert.equal(result.needs_human, true);
    assert.equal(result.eligibility, 'not_assessed'); assert.equal(result.guardrail.status, 'blocked');
    assert.equal(result.answer_correctness_probability, null); assert.equal(result.omission_probability, null);
    assert.equal(result.dataset_sha256, DATASET_SHA256); assert.equal(result.claims.length, 1);
    assert.ok(result.receipts.every(receipt => receipt.product_id === product_id));
    const tools = result.trace.filter(step => step.tool !== null).map(step => step.tool);
    assert.deepEqual(tools, ['read_workbook', 'read_label', 'read_derived']);
    assert.deepEqual(result.trace.map(step => step.stage), ['scope', 'plan', 'retrieve', 'retrieve', 'retrieve', 'draft', 'challenge', 'verify', 'handoff']);
    if (question_id === 'composition') {
      assert.equal(result.claims[0]!.verdict, 'supported');
      assert.match(result.claims[0]!.statement, product_id === 'DRG0CYMEB' ? /payload DM1 and DAR 3\.5/ : /payload DXd and DAR 8/);
      assert.match(result.claims[0]!.limitation, /not a fixed count/);
    } else if (question_id === 'linker_release' && product_id === 'DRG0ERKBH') {
      assert.equal(result.claims[0]!.verdict, 'contradicted');
      assert.equal(result.claims[0]!.statement, 'A cleavable linker establishes rapid release in blood.');
      assert.match(result.claims[0]!.explanation, /plasma stability and intracellular lysosomal cleavage/);
      assert.match(result.claims[0]!.limitation, /No individual release rate/);
    } else assert.equal(result.claims[0]!.verdict, 'insufficient');
    if (product_id === 'DRG0CYMEB') assert.ok(!JSON.stringify(result).includes('UK-ENHERTU'));
    assert.equal(result.receipts.find(receipt => receipt.kind === 'derived')!.eligible_for_claim, false);
    const workbook = result.receipts.find(receipt => receipt.kind === 'workbook')!;
    assert.match(workbook.section, /Raw worksheet .*name not retained/); assert.match(workbook.section, /SHA-256/);
    assert.ok(!workbook.excerpt.includes('Toxicity')); assert.ok(!workbook.excerpt.includes('Absorption'));
    assert.match(workbook.excerpt, product_id === 'DRG0CYMEB' ? /G2/ : /G3/);
  }
});

test('source ablation actually executes only workbook; no hidden label or derived content enters claims', async () => {
  for (const product_id of PRODUCT_IDS) for (const question_id of ['composition', 'linker_release', 'payload_risk_transfer', 'workbook_safety'] as const) {
    const request = researchInput({ product_id, question_id, evidence_policy: 'workbook_only' });
    const result = await runResearch(request);
    assert.equal(result.receipts.length, 1); assert.equal(result.receipts[0]!.kind, 'workbook');
    assert.deepEqual(result.trace.filter(step => step.tool !== null).map(step => step.tool), ['read_workbook']);
    assert.equal(result.trace.filter(step => step.status === 'skipped').length, 2);
    assert.ok(result.unknowns.some(text => text.includes('read_label was not retrieved')));
    assert.ok(result.unknowns.some(text => text.includes('read_derived was not retrieved')));
    assert.equal(result.claims[0]!.verdict, question_id === 'composition' ? 'supported' : 'insufficient');
    assert.ok(!JSON.stringify(result.claims).includes('plasma stability'));
    assert.ok(!JSON.stringify(result).includes(labelSourceId(product_id)));
    assert.throws(() => readResearchTool('read_label', request), /Source policy/);
    assert.throws(() => readResearchTool('read_derived', request), /Source policy/);
  }
});

test('all three developer-controlled post-draft drills are actually caught for both products and source policies', async () => {
  for (const product_id of PRODUCT_IDS) for (const evidence_policy of ['all', 'workbook_only'] as const) for (const integrity_drill of ['cross_product_citation', 'derived_as_primary', 'invented_source'] as const) {
    const result = await runResearch(researchInput({ product_id, evidence_policy, integrity_drill }));
    assert.equal(result.draft_integrity, 'rejected'); assert.deepEqual(result.claims, []);
    assert.deepEqual(result.omitted_claim_ids, ['linker_release']);
    assert.ok(result.challenges.some(check => check.outcome === 'caught'));
    assert.match(result.answer, /A fault was injected on purpose after drafting/);
    assert.match(result.trace.find(step => step.stage === 'draft')!.detail, /after normal drafting/);
    const badIds = result.draft.claims[0]!.source_ids;
    assert.ok(badIds.length > 0); assert.ok(badIds.every(id => /^[A-Za-z0-9_-]{1,120}$/.test(id)));
    assert.ok(!result.receipts.some(receipt => badIds.includes(receipt.id) && receipt.url !== null));
    assert.ok(!result.challenges.flatMap(check => check.source_ids).some(id => id === 'INVENTED-SOURCE-DEVELOPER-DRILL'));
    assert.equal(result.trace.find(step => step.stage === 'verify')!.status, 'blocked');
    if (integrity_drill === 'derived_as_primary' && evidence_policy === 'all') assert.equal(result.challenges.find(check => check.code === 'source_eligibility')!.outcome, 'caught');
  }
});

test('two bounded Claude calls use exact native transport, strict schemas, local policy and identifiers only', async () => {
  for (const product_id of PRODUCT_IDS) for (const evidence_policy of ['all', 'workbook_only'] as const) {
    const request = researchInput({ engine: 'claude', product_id, evidence_policy });
    const receipts = allowedTools(request).flatMap(tool => readResearchTool(tool, request));
    let calls = 0;
    const result = await runResearch(request, { claude: { apiKey: NON_CREDENTIAL, fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
      const headers = new Headers(init?.headers); assert.equal(headers.get('x-api-key'), NON_CREDENTIAL);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'claude-opus-5-5'); assert.equal(body.max_tokens, 4096);
      assert.deepEqual(body.thinking, { type: 'adaptive' }); assert.equal(body.output_config.effort, 'low');
      assert.equal(body.tools, undefined); assert.equal(body.tool_choice, undefined);
      assert.ok(!String(init?.body).includes(NON_CREDENTIAL));
      assert.deepEqual(body.output_config.format.schema, calls === 1 ? plannerOutputSchema(request) : draftOutputSchema(request, receipts));
      const data = JSON.parse(body.messages[0].content);
      if (calls === 1) {
        assert.deepEqual(data.allowed_tool_ids, allowedTools(request)); assert.equal(data.max_tool_calls, 3);
        assert.deepEqual(body.output_config.format.schema.properties.product_id.enum, [product_id]);
        // Reordering is canonicalized without adding/removing a selection.
        return modelResponse({ product_id, tool_ids: [...allowedTools(request)].reverse() });
      }
      assert.deepEqual(data.retrieved_local_receipts, receipts);
      if (evidence_policy === 'workbook_only') {
        assert.ok(!String(init?.body).includes('plasma stability'));
        assert.ok(!String(init?.body).includes('UK-ENHERTU'));
        assert.ok(!String(init?.body).includes('UK-KADCYLA'));
      }
      return modelResponse(trustedDraft(request), [{ type: 'thinking', thinking: 'PRIVATE-MODEL-PROSE-DO-NOT-RENDER' }]);
    } } });
    assert.equal(calls, 2); assert.equal(result.model, CLAUDE_MODEL); assert.equal(result.draft_integrity, 'accepted');
    assert.ok(!JSON.stringify(result).includes('PRIVATE-MODEL-PROSE'));
    assert.deepEqual(result.trace.filter(step => step.tool).map(step => step.tool), allowedTools(request));
  }
});

test('planner can choose a proper subset: missing label evidence remains an unknown and insufficient, without hidden calls', async () => {
  const request = researchInput({ engine: 'claude' });
  const tools = ['read_workbook'] as const;
  const result = await runResearch(request, { claude: { apiKey: NON_CREDENTIAL, fetch: twoCallMock(request, trustedDraft(request, [...tools]), [...tools]) } });
  assert.equal(result.claims[0]!.verdict, 'insufficient');
  assert.deepEqual(result.trace.filter(step => step.tool).map(step => step.tool), tools);
  assert.equal(result.receipts.length, 1);
  assert.match(result.unknowns.find(text => text.includes('read_label was not retrieved'))!, /planner did not select/);
  assert.ok(!JSON.stringify(result.claims).includes('plasma stability'));
  const labelOnly = await runResearch(researchInput({ engine: 'claude', question_id: 'composition' }), { claude: { apiKey: NON_CREDENTIAL, fetch: twoCallMock(researchInput({ engine: 'claude', question_id: 'composition' }), trustedDraft(researchInput({ question_id: 'composition' }), ['read_label']), ['read_label']) } });
  assert.match(labelOnly.claims[0]!.statement, /local pending-review label summary/);
  assert.ok(!labelOnly.claims[0]!.statement.includes('workbook records'));
});

test('unknown, missing, duplicate, cross-product, extra and source-policy-invalid plans fail closed before retrieval or draft', async () => {
  const request = researchInput({ engine: 'claude' });
  const outputs = [
    {}, { product_id: request.product_id }, { product_id: request.product_id, tool_ids: [] },
    { product_id: request.product_id, tool_ids: ['read_workbook', 'read_workbook'] },
    { product_id: request.product_id, tool_ids: ['read_workbook', 'unknown_tool'] },
    { product_id: 'DRG0CYMEB', tool_ids: ['read_workbook'] },
    { product_id: 'UNKNOWN', tool_ids: ['read_workbook'] },
    { product_id: request.product_id, tool_ids: ['read_workbook'], prose: 'PRIVATE-RAW-PROSE' },
    { product_id: request.product_id, tool_ids: ['read_workbook', 'read_label', 'read_derived', 'read_workbook'] }
  ];
  for (const output of outputs) {
    let calls = 0; const trace: ResearchTrace[] = [];
    await assert.rejects(() => runResearch(request, { onTrace: step => { trace.push(step); }, claude: { apiKey: NON_CREDENTIAL, fetch: async () => { calls++; return modelResponse(output); } } }), hasCode('CLAUDE_INVALID_OUTPUT'));
    assert.equal(calls, 1); assert.deepEqual(trace.map(step => step.stage), ['scope']);
  }
  await assert.rejects(() => runResearch({ ...request, evidence_policy: 'workbook_only' }, { claude: { apiKey: NON_CREDENTIAL, fetch: async () => modelResponse({ product_id: request.product_id, tool_ids: ['read_label'] }) } }), hasCode('CLAUDE_INVALID_OUTPUT'));
});

test('draft wrong identities/citation pairings, unknown IDs, duplicate/missing selections and unavailable evidence are rejected without repair', async () => {
  const request = researchInput({ engine: 'claude' });
  const outputs = [
    { product_id: 'DRG0CYMEB', claims: trustedDraft(request).claims },
    { product_id: request.product_id, claims: [{ claim_id: 'unknown_claim', source_ids: [labelSourceId(request.product_id)] }] },
    { product_id: request.product_id, claims: [{ claim_id: request.question_id, source_ids: ['UNKNOWN-SOURCE'] }] },
    { product_id: request.product_id, claims: [{ claim_id: request.question_id, source_ids: ['UK-KADCYLA-SMPC'] }] },
    { product_id: request.product_id, claims: [{ claim_id: request.question_id, source_ids: [workbookSourceId(request.product_id)] }] },
    { product_id: request.product_id, claims: [{ claim_id: request.question_id, source_ids: [derivedSourceId(request.product_id)] }] },
    { product_id: request.product_id, claims: [{ claim_id: request.question_id, source_ids: [labelSourceId(request.product_id), labelSourceId(request.product_id)] }] },
    { ...trustedDraft(request), claims: [...trustedDraft(request).claims, ...trustedDraft(request).claims] },
    { product_id: request.product_id, claims: [] }
  ];
  for (const output of outputs) {
    const result = await runResearch(request, { claude: { apiKey: NON_CREDENTIAL, fetch: twoCallMock(request, output) } });
    assert.equal(result.draft_integrity, 'rejected'); assert.deepEqual(result.claims, []);
    assert.deepEqual(result.omitted_claim_ids, ['linker_release']); assert.equal(result.engine, 'claude');
    assert.ok(result.challenges.some(check => check.outcome === 'caught'));
  }
  const absent = await runResearch(request, { claude: { apiKey: NON_CREDENTIAL, fetch: twoCallMock(request, trustedDraft(request), ['read_workbook']) } });
  assert.equal(absent.draft_integrity, 'rejected');
  assert.equal(absent.challenges.find(check => check.code === 'evidence_availability')!.outcome, 'caught');
});

test('independent verifier detects altered/incomplete receipt provenance without extra retrieval', () => {
  const request = researchInput({ question_id: 'composition' });
  const receipts = allowedTools(request).flatMap(tool => readResearchTool(tool, request));
  for (const field of ['excerpt', 'section', 'provenance'] as const) {
    const changed = structuredClone(receipts);
    if (field === 'provenance') changed[0]!.provenance = 'derived_not_adcdb';
    else changed[0]![field] = 'ALTERED-SOFTWARE-TEST';
    const audit = auditResearchDraft(request, trustedDraft(request), changed);
    assert.equal(audit.accepted, false); assert.deepEqual(audit.claims, []);
    assert.equal(audit.challenges.find(check => check.code === 'receipt_integrity')!.outcome, 'caught');
  }
  const changed = structuredClone(receipts); changed[0]!.excerpt = JSON.stringify([JSON.parse(changed[0]!.excerpt)[0]]);
  assert.equal(auditResearchDraft(request, trustedDraft(request), changed).accepted, false);
});

test('no-key Claude research is explicit, zero calls and zero fallback', async () => {
  let calls = 0;
  await assert.rejects(() => runResearch(researchInput({ engine: 'claude' }), { claude: { fetch: async () => { calls++; throw new Error('never call'); } } }), hasCode('CLAUDE_NOT_CONFIGURED'));
  assert.equal(calls, 0);
});

test('both planner and draft malformed/refused/truncated/oversized/network/provider failures are sanitized', async () => {
  const request = researchInput({ engine: 'claude' });
  const factories = [
    { code: 'CLAUDE_INVALID_OUTPUT', make: () => new Response('PRIVATE-RAW-PROSE') },
    ...[['max_tokens', 'CLAUDE_INVALID_OUTPUT'], ['refusal', 'CLAUDE_REFUSED']].map(([stop_reason, code]) => ({ code, make: () => new Response(JSON.stringify({ model: CLAUDE_MODEL, stop_reason, content: [{ type: 'text', text: '{}' }] })) })),
    { code: 'CLAUDE_INVALID_OUTPUT', make: () => modelResponse({ product_id: request.product_id, claims: [], answer: 'PRIVATE-RAW-PROSE' }) },
    { code: 'CLAUDE_INVALID_OUTPUT', make: () => new Response('x'.repeat(140_000)) },
    { code: 'CLAUDE_INVALID_OUTPUT', make: () => new Response('x', { headers: { 'content-length': '140000' } }) },
    { code: 'CLAUDE_UNAVAILABLE', make: () => new Response('PRIVATE-RAW-PROSE', { status: 401 }) },
    { code: 'CLAUDE_UNAVAILABLE', make: () => new Response('PRIVATE-RAW-PROSE', { status: 500 }) },
    { code: 'CLAUDE_UNAVAILABLE', make: () => { throw new Error(`${NON_CREDENTIAL}-PRIVATE-RAW-PROSE`); } }
  ];
  for (const atCall of [1, 2]) for (const failure of factories) {
    let calls = 0;
    await assert.rejects(() => runResearch(request, { claude: { apiKey: NON_CREDENTIAL, fetch: async () => ++calls === atCall ? failure.make() : modelResponse({ product_id: request.product_id, tool_ids: allowedTools(request) }) } }), error => {
      assert.ok(error instanceof ApiFailure); assert.equal(error.code, failure.code);
      assert.ok(!error.message.includes(NON_CREDENTIAL)); assert.ok(!error.message.includes('PRIVATE-RAW-PROSE'));
      return true;
    });
    assert.equal(calls, atCall);
  }
  for (const output of [
    { product_id: request.product_id, claims: [{ claim_id: 'bad clinical prose', source_ids: [] }] },
    { product_id: request.product_id, claims: [{ claim_id: request.question_id, source_ids: ['https://malicious.invalid'] }] },
    { product_id: request.product_id, claims: Array(9).fill({ claim_id: request.question_id, source_ids: [] }) }
  ]) await assert.rejects(() => runResearch(request, { claude: { apiKey: NON_CREDENTIAL, fetch: twoCallMock(request, output) } }), hasCode('CLAUDE_INVALID_OUTPUT'));
});

test('total deadline is not reset between planner and draft, and bounds a non-aborting injected fetch', async () => {
  const request = researchInput({ engine: 'claude' }); let calls = 0;
  const start = performance.now();
  await assert.rejects(() => runResearch(request, { claude: { apiKey: NON_CREDENTIAL, timeoutMs: 150, fetch: async () => {
    if (++calls === 1) { await new Promise(resolve => setTimeout(resolve, 100)); return modelResponse({ product_id: request.product_id, tool_ids: allowedTools(request) }); }
    return new Promise<Response>(() => {});
  } } }), hasCode('CLAUDE_TIMEOUT'));
  assert.equal(calls, 2); assert.ok(performance.now() - start < 220, 'one 150ms budget, not a second full budget');
  await assert.rejects(() => runResearch(researchInput(), { claude: { timeoutMs: 5 }, onTrace: async () => new Promise<void>(() => {}) }), hasCode('CLAUDE_TIMEOUT'));
});

test('trace events occur only after actual completed work; disconnect aborts even an injected planner ignoring cancellation', async () => {
  const controller = new AbortController(); const trace: ResearchTrace[] = [];
  let capturedSignal: AbortSignal | null | undefined;
  let entered!: () => void; const plannerEntered = new Promise<void>(resolve => { entered = resolve; });
  const pending = runResearch(researchInput({ engine: 'claude' }), {
    signal: controller.signal, onTrace: step => { trace.push(step); },
    claude: { apiKey: NON_CREDENTIAL, fetch: async (_url, init) => { capturedSignal = init?.signal; entered(); return new Promise<Response>(() => {}); } }
  });
  await plannerEntered;
  assert.deepEqual(trace.map(step => step.stage), ['scope']);
  controller.abort(); await assert.rejects(() => pending, hasCode('RESEARCH_CANCELLED'));
  assert.equal(capturedSignal?.aborted, true); assert.deepEqual(trace.map(step => step.stage), ['scope']);
  await assert.rejects(() => runResearch(researchInput(), { signal: controller.signal }), hasCode('RESEARCH_CANCELLED'));
});

test('disconnect cancels a pending upstream body reader as well as the fetch signal, at either model stage', async () => {
  for (const atCall of [1, 2]) {
    const controller = new AbortController(); const request = researchInput({ engine: 'claude' });
    let calls = 0; let bodyCancelled = false;
    let entered!: () => void; const reading = new Promise<void>(resolve => { entered = resolve; });
    const pending = runResearch(request, { signal: controller.signal, claude: { apiKey: NON_CREDENTIAL, fetch: async () => {
      if (++calls !== atCall) return modelResponse({ product_id: request.product_id, tool_ids: ['read_workbook'] });
      return new Response(new ReadableStream<Uint8Array>({
        pull: () => { entered(); return new Promise<void>(() => {}); },
        cancel: () => { bodyCancelled = true; }
      }));
    } } });
    await reading; controller.abort();
    await assert.rejects(() => pending, hasCode('RESEARCH_CANCELLED'));
    assert.equal(calls, atCall); assert.equal(bodyCancelled, true);
  }
});
