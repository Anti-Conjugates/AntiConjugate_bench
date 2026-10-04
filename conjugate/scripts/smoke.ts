import assert from 'node:assert/strict';
import { ApiErrorSchema, CatalogSchema, RunRequestSchema, RunResultSchema, ResearchCatalogSchema, ResearchRequestSchema, ResearchResultSchema, ResearchEventSchema, researchExecutionIsConsistent, ChatResultSchema, ChatEventSchema, chatExecutionIsConsistent, TeamResultSchema, TeamEventSchema, teamExecutionIsConsistent } from '@her2/shared';

const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:5173';
// The API allows 30 requests a minute per client. This script makes more than that, so it
// waits out the window the server reports instead of weakening the limit or failing on 429.
let resumeAt = 0;
async function paced(input: URL, init: RequestInit) {
  for (let attempt = 0; ; attempt += 1) {
    if (Date.now() < resumeAt) await new Promise(resolve => setTimeout(resolve, resumeAt - Date.now()));
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
    const reset = Number(response.headers.get('x-ratelimit-reset') ?? 60);
    if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0') resumeAt = Date.now() + (reset + 1) * 1000;
    if (response.status === 429 && attempt === 0) continue;
    return response;
  }
}
async function get(path: string) {
  return paced(new URL(path, base), {});
}
async function post(body: unknown) {
  return paced(new URL('/api/runs', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const page = await get('/');
assert.equal(page.status, 200);
assert.match(await page.text(), /Conjugate/);
const health = await get('/api/health');
assert.equal(health.status, 200);
const status: unknown = await health.json();
assert.ok(status && typeof status === 'object' && 'status' in status && status.status === 'ok');
const catalogResponse = await get('/api/catalog');
assert.equal(catalogResponse.status, 200);
const catalog = CatalogSchema.parse(await catalogResponse.json());
assert.equal(catalog.products.length, 2);
assert.equal(catalog.model, 'claude-opus-5-5');
assert.equal(catalog.default_engine, 'evidence');

const emptyShape = RunRequestSchema.parse({
  product_id: catalog.products[0]?.id, engine: 'evidence', synthetic_confirmed: true,
  patient: { age: null, renal: 'unknown', hepatic: 'unknown', lung_history: null,
    neuropathy: null, platelets: null, lvef: null, neutrophils: null,
    medications: [], medication_list_complete: false }
});

for (const product of catalog.products) {
  const response = await post({ ...emptyShape, product_id: product.id });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = RunResultSchema.parse(await response.json());
  assert.equal(result.product?.id, product.id);
  assert.equal(result.engine, 'evidence');
  assert.equal(result.model, null);
  assert.equal(result.needs_human, true);
  assert.equal(result.guardrail.status, 'blocked');
  assert.equal(result.verdict, 'dont_know');
  assert.equal(result.omission_probability, null);
  assert.equal(result.answer_correctness_probability, null);
  assert.ok(result.flags.length > 0 && result.unknowns.length > 0);
  assert.equal(result.omitted_checks.length, 0);
  assert.deepEqual(result.trace.map(step => step.stage), ['retrieval', 'draft', 'guardrail']);
  assert.ok(result.flags.every(flag => flag.source_ids.every(id => product.source_ids.includes(id))));
}
for (const [body, code] of [
  [{ ...emptyShape, product_id: catalog.products[0]?.id, synthetic_confirmed: false }, 'INVALID_REQUEST'],
  [{ ...emptyShape, product_id: 'UNKNOWN_SOFTWARE_SENTINEL' }, 'UNKNOWN_PRODUCT']
] as const) {
  const response = await post(body);
  assert.equal(response.status, 400);
  assert.equal(ApiErrorSchema.parse(await response.json()).error.code, code);
}
if (!catalog.claude_configured) {
  const response = await post({ ...emptyShape, product_id: catalog.products[0]?.id, engine: 'claude' });
  assert.equal(response.status, 503);
  assert.equal(ApiErrorSchema.parse(await response.json()).error.code, 'CLAUDE_NOT_CONFIGURED');
}
const researchCatalogResponse = await get('/api/research/catalog');
assert.equal(researchCatalogResponse.status, 200);
const researchCatalog = ResearchCatalogSchema.parse(await researchCatalogResponse.json());
assert.equal(researchCatalog.dataset.record_count, 31);
assert.equal(researchCatalog.dataset.derived_record_count, 4);
assert.equal(researchCatalog.dataset.records.reduce((count, record) => count + record.missing_fields.length, 0), 69);
assert.equal(researchCatalog.dataset.sha256, 'e95412ecfbc468f29f85dd9391de63f33fdfd3a14b8d557ea34ebc4d5b94b0cb');
const researchInput = ResearchRequestSchema.parse({
  product_id: 'DRG0ERKBH', question_id: 'linker_release', engine: 'evidence',
  evidence_policy: 'all', integrity_drill: 'none', synthetic_confirmed: true
});
async function researchPost(body: unknown, path = '/api/research/runs') {
  return paced(new URL(path, base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
for (const product_id of ['DRG0CYMEB', 'DRG0ERKBH'] as const) {
  for (const question of researchCatalog.questions) {
    const response = await researchPost({ ...researchInput, product_id, question_id: question.id });
    assert.equal(response.status, 200);
    const result = ResearchResultSchema.parse(await response.json());
    assert.equal(result.product_id, product_id);
    assert.equal(result.model, null);
    assert.equal(result.harness.model_calls, 0);
    assert.ok(researchExecutionIsConsistent(result));
    assert.equal(result.draft_integrity, 'accepted');
    assert.equal(result.clinical_status, 'draft_pending_pharmacist');
    assert.equal(result.needs_human, true);
    assert.equal(result.guardrail.status, 'blocked');
    assert.equal(result.answer_correctness_probability, null);
    assert.equal(result.omission_probability, null);
    assert.ok(result.receipts.every(receipt => receipt.product_id === product_id));
    assert.ok(result.claims.every(claim => claim.source_ids.every(id => result.receipts.some(receipt => receipt.id === id))));
    assert.equal(result.trace[0]?.stage, 'scope');
    assert.equal(result.trace.at(-1)?.stage, 'handoff');
    assert.ok(result.trace.some(step => step.stage === 'challenge'));
    if (question.id === 'composition') assert.ok(result.claims.some(claim => claim.verdict === 'supported'));
    if (question.id === 'linker_release' && product_id === 'DRG0ERKBH') assert.ok(result.claims.some(claim => claim.verdict === 'contradicted'));
    if (question.id === 'label_identity') {
      assert.deepEqual(result.claims[0]?.source_ids, [`US-OPENFDA-${product_id}-IDENTITY`]);
      assert.equal(result.claims[0]?.verdict, 'supported');
      const withheld = ResearchResultSchema.parse(await (await researchPost({ ...researchInput, product_id, question_id: question.id, evidence_policy: 'workbook_only' })).json());
      assert.ok(researchExecutionIsConsistent(withheld));
      assert.equal(withheld.claims[0]?.verdict, 'insufficient');
      assert.ok(withheld.receipts.every(receipt => receipt.kind === 'workbook'));
    }
  }
  const withheldResponse = await researchPost({ ...researchInput, product_id, evidence_policy: 'workbook_only' });
  const withheld = ResearchResultSchema.parse(await withheldResponse.json());
  assert.ok(withheld.receipts.every(receipt => receipt.kind === 'workbook'));
  assert.ok(withheld.claims.every(claim => claim.verdict === 'insufficient'));
  assert.ok(!withheld.trace.some(step => step.tool === 'read_label' && step.status === 'completed'));
}
for (const integrity_drill of ['cross_product_citation', 'derived_as_primary', 'invented_source'] as const) {
  const response = await researchPost({ ...researchInput, integrity_drill });
  const result = ResearchResultSchema.parse(await response.json());
  assert.equal(result.draft_integrity, 'rejected');
  assert.equal(result.claims.length, 0);
  assert.ok(result.omitted_claim_ids.length > 0);
  assert.ok(result.challenges.some(challenge => challenge.outcome === 'caught'));
}
const streamResponse = await researchPost(researchInput, '/api/research/runs/stream');
assert.equal(streamResponse.status, 200);
assert.match(streamResponse.headers.get('content-type') ?? '', /application\/x-ndjson/);
const events = (await streamResponse.text()).trim().split('\n').map(line => ResearchEventSchema.parse(JSON.parse(line)));
const finalEvent = events.at(-1);
assert.equal(finalEvent?.type, 'result');
if (finalEvent?.type === 'result') {
  const steps = events.filter(event => event.type === 'trace').map(event => event.step);
  assert.deepEqual(steps, finalEvent.result.trace);
  assert.equal(finalEvent.result.clinical_status, 'draft_pending_pharmacist');
}
const invalidResearchResponse = await researchPost({ ...researchInput, synthetic_confirmed: false });
assert.equal(invalidResearchResponse.status, 400);
if (!researchCatalog.claude_configured) {
  const response = await researchPost({ ...researchInput, engine: 'claude' });
  assert.equal(response.status, 503);
  assert.equal(ApiErrorSchema.parse(await response.json()).error.code, 'CLAUDE_NOT_CONFIGURED');
}
const chat = { message: 'Does Enhertu’s cleavable linker establish release in blood?', engine: 'evidence', synthetic_confirmed: true };
const chatResponse = await researchPost(chat, '/api/chat/turns'); assert.equal(chatResponse.status, 200);
const chatResult = ChatResultSchema.parse(await chatResponse.json()); assert.ok(chatExecutionIsConsistent(chatResult)); assert.equal(chatResult.harness.model_calls, 0); assert.equal(chatResult.audits[0]?.result.claims[0]?.verdict, 'contradicted');
const chatStream = await researchPost({ ...chat, message: 'What changes with only workbook evidence?', context: chatResult.scopes }, '/api/chat/turns/stream');
const chatEvents = (await chatStream.text()).trim().split('\n').map(line => ChatEventSchema.parse(JSON.parse(line))); const chatFinal = chatEvents.at(-1)!; assert.equal(chatFinal.type, 'result');
if (chatFinal.type === 'result') { assert.ok(chatExecutionIsConsistent(chatFinal.result)); assert.equal(chatFinal.result.audits[0]?.result.claims[0]?.verdict, 'insufficient'); assert.equal(chatFinal.result.harness.evidence_reads, 1); assert.deepEqual(chatEvents.slice(0, -1).map(event => event.type === 'trace' ? event.step : null), chatFinal.result.trace); }
const teamResponse = await researchPost({ message: 'Compare Kadcyla and Enhertu composition.', engine: 'evidence', synthetic_confirmed: true }, '/api/team/turns'); assert.equal(teamResponse.status, 200);
const teamResult = TeamResultSchema.parse(await teamResponse.json()); assert.ok(teamExecutionIsConsistent(teamResult)); assert.equal(teamResult.harness.lead_calls, 0); assert.equal(teamResult.audits.length, 2); assert.equal(teamResult.trace.filter(step => step.node === 'evidence_worker').length, 2);
const teamStream = await researchPost({ ...chat, engine: 'evidence' }, '/api/team/turns/stream');
const teamEvents = (await teamStream.text()).trim().split('\n').map(line => TeamEventSchema.parse(JSON.parse(line))); const teamFinal = teamEvents.at(-1)!; assert.equal(teamFinal.type, 'result');
if (teamFinal.type === 'result') { assert.ok(teamExecutionIsConsistent(teamFinal.result)); assert.equal(teamFinal.result.audits[0]?.result.claims[0]?.verdict, 'contradicted'); assert.deepEqual(teamEvents.slice(0, -1).map(event => event.type === 'trace' ? event.step.node : event.type), teamFinal.result.trace.map(step => step.node)); }
console.info('PASS: HTTP page/proxy, context API, research questions, source withholding, citation faults, chat and follow-up NDJSON, agent-team graph turns, provenance and safe errors. No model or browser called.');
