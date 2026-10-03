import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter, once } from 'node:events';
import { type PassThrough } from 'node:stream';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { ApiErrorSchema, ResearchCatalogSchema, ResearchEventSchema, ResearchResultSchema, RunResultSchema, type ResearchRequest, type ResearchEvent } from '@her2/shared';
import { createApp } from './app.js';
import { registerResearchRoutes } from './research-routes.js';
import { modelResponse, NON_CREDENTIAL, requestFixture } from './test-support.js';
import { DATASET_SHA256 } from './research-evidence.js';
import { type RunOptions } from './run.js';

const input: ResearchRequest = { product_id: 'DRG0ERKBH', question_id: 'linker_release', engine: 'evidence', evidence_policy: 'all', integrity_drill: 'none', synthetic_confirmed: true };
const post = (payload: unknown, stream = false) => ({ method: 'POST' as const, url: `/api/research/runs${stream ? '/stream' : ''}`, payload: JSON.stringify(payload), headers: { 'content-type': 'application/json' } });
function events(body: string) { return body.trim().split('\n').map(line => ResearchEventSchema.parse(JSON.parse(line))); }

test('research catalog/JSON/NDJSON satisfy frozen shared schemas and existing clinical API remains compatible', async t => {
  const app = await createApp(); t.after(() => app.close());
  const catalogResponse = await app.inject({ method: 'GET', url: '/api/research/catalog' });
  assert.equal(catalogResponse.statusCode, 200);
  const catalog = ResearchCatalogSchema.parse(catalogResponse.json());
  assert.equal(catalog.model, 'claude-opus-5-5'); assert.equal(catalog.claude_configured, false);
  assert.equal(catalog.dataset.sha256, DATASET_SHA256); assert.equal(catalog.dataset.records.length, catalog.dataset.record_count);
  assert.equal(catalog.dataset.records.length, 31); assert.equal(catalog.dataset.derived_records.length, 4);
  assert.ok(!JSON.stringify(catalog).includes('mg/kg')); assert.ok(!JSON.stringify(catalog).includes('Prescribing flags (DRAFT'));
  assert.deepEqual(catalog.questions.map(question => question.id), ['composition', 'linker_release', 'payload_risk_transfer', 'workbook_safety', 'label_identity']);
  const response = await app.inject(post(input));
  assert.equal(response.statusCode, 200); const result = ResearchResultSchema.parse(response.json());
  assert.equal(result.claims[0]!.verdict, 'contradicted'); assert.equal(result.guardrail.status, 'blocked');
  const stream = await app.inject(post(input, true));
  assert.equal(stream.statusCode, 200); assert.match(stream.headers['content-type']!, /application\/x-ndjson/);
  assert.equal(stream.headers['cache-control'], 'no-store'); assert.equal(stream.headers['x-content-type-options'], 'nosniff');
  assert.equal(stream.headers['referrer-policy'], 'no-referrer');
  const parsed = events(stream.body); const final = parsed.at(-1)!;
  assert.equal(final.type, 'result');
  if (final.type !== 'result') assert.fail('expected terminal result');
  assert.deepEqual(parsed.slice(0, -1).map(event => event.type === 'trace' ? event.step : null), final.result.trace);
  assert.equal(final.result.claims[0]!.verdict, 'contradicted');
  const old = await app.inject({ method: 'POST', url: '/api/runs', payload: requestFixture() });
  assert.equal(old.statusCode, 200); const clinical = RunResultSchema.parse(old.json());
  assert.equal(clinical.verdict, 'dont_know'); assert.equal(clinical.guardrail.status, 'blocked');
  assert.deepEqual(clinical.trace.map(step => step.stage), ['retrieval', 'draft', 'guardrail']);
  assert.ok(!old.body.includes('WORKBOOK-')); assert.ok(!old.body.includes('DERIVED-'));
});

test('both research routes retain strict body, synthetic, product, rate and content-type boundaries', async t => {
  const app = await createApp(); t.after(() => app.close());
  for (const stream of [false, true]) for (const payload of [
    {}, null, { ...input, patient: {} }, { ...input, synthetic_confirmed: false },
    { ...input, product_id: 'DRG0ZOYQV' }, { ...input, question_id: 'unknown' },
    { ...input, engine: 'other' }, { ...input, evidence_policy: 'hidden_sources' },
    { ...input, integrity_drill: 'malicious_text' }
  ]) {
    const response = await app.inject(post(payload, stream));
    assert.equal(response.statusCode, 400); assert.equal(ApiErrorSchema.parse(response.json()).error.code, 'INVALID_REQUEST');
  }
  for (const stream of [false, true]) {
    const url = post(input, stream).url;
    const oversized = await app.inject({ method: 'POST', url, payload: JSON.stringify({ ignored: 'x'.repeat(17_000) }), headers: { 'content-type': 'application/json' } });
    assert.equal(oversized.statusCode, 413); assert.equal(ApiErrorSchema.parse(oversized.json()).error.code, 'BODY_TOO_LARGE');
    const malformed = await app.inject({ method: 'POST', url, payload: '{PRIVATE-RAW-PROSE', headers: { 'content-type': 'application/json' } });
    assert.equal(malformed.statusCode, 400); assert.ok(!malformed.body.includes('PRIVATE-RAW-PROSE'));
    const media = await app.inject({ method: 'POST', url, payload: '<xml/>', headers: { 'content-type': 'application/xml' } });
    assert.equal(media.statusCode, 415);
  }
  const limited = await createApp({ rateLimitMax: 1 }); t.after(() => limited.close());
  assert.equal((await limited.inject(post(input, true))).statusCode, 200);
  const exhausted = await limited.inject(post(input));
  assert.equal(exhausted.statusCode, 429); assert.equal(ApiErrorSchema.parse(exhausted.json()).error.code, 'RATE_LIMITED');
});

test('no-key and mocked failures terminate streaming with sanitized errors, never raw prose or fallback results', async t => {
  for (const configured of [false, true]) {
    let calls = 0;
    const app = await createApp({ claude: { ...(configured ? { apiKey: NON_CREDENTIAL } : {}), fetch: async () => { calls++; throw new Error(`${NON_CREDENTIAL}:PRIVATE-RAW-PROSE`); } } });
    t.after(() => app.close());
    const stream = await app.inject(post({ ...input, engine: 'claude' }, true));
    assert.equal(stream.statusCode, 200); const parsed = events(stream.body);
    const last = parsed.at(-1)!; assert.equal(last.type, 'error');
    if (last.type !== 'error') assert.fail('expected terminal error');
    assert.equal(last.error.code, configured ? 'CLAUDE_UNAVAILABLE' : 'CLAUDE_NOT_CONFIGURED');
    assert.ok(!parsed.some(event => event.type === 'result'));
    assert.deepEqual(parsed.filter(event => event.type === 'trace').map(event => event.step.stage), ['scope']);
    assert.equal(calls, configured ? 1 : 0);
    assert.ok(!stream.body.includes(NON_CREDENTIAL)); assert.ok(!stream.body.includes('PRIVATE-RAW-PROSE'));
    const response = await app.inject(post({ ...input, engine: 'claude' }));
    assert.equal(response.statusCode, configured ? 502 : 503);
    ApiErrorSchema.parse(response.json()); assert.ok(!response.body.includes('PRIVATE-RAW-PROSE'));
    const catalog = await app.inject({ method: 'GET', url: '/api/research/catalog' });
    assert.equal(catalog.json().claude_configured, configured); assert.ok(!catalog.body.includes(NON_CREDENTIAL));
  }
});

// An in-memory route/transport harness observes writes as they happen, without
// opening a server, restarting shells, network calls or browser automation.
function streamHarness(options: RunOptions) {
  const handlers = new Map<string, (request: FastifyRequest, reply: FastifyReply) => unknown>();
  const fakeApp = { get: () => {}, post: (path: string, handler: (request: FastifyRequest, reply: FastifyReply) => unknown) => handlers.set(path, handler) } as unknown as FastifyInstance;
  registerResearchRoutes(fakeApp, options);
  const requestRaw = new EventEmitter(); const replyRaw = new EventEmitter();
  const observed: ResearchEvent[] = []; let stream!: PassThrough;
  const request = { body: { ...input, engine: 'claude' }, raw: requestRaw } as unknown as FastifyRequest;
  const reply = {
    raw: replyRaw, type: () => reply,
    send: (output: PassThrough) => { stream = output; output.on('data', bytes => { observed.push(...events(String(bytes))); }); return reply; }
  } as unknown as FastifyReply;
  handlers.get('/api/research/runs/stream')!(request, reply);
  return { stream, observed, requestRaw, replyRaw };
}

test('NDJSON publishes only executed steps before each pending mock call and closes after terminal result', async () => {
  let plannerReady!: () => void; const enteredPlanner = new Promise<void>(resolve => { plannerReady = resolve; });
  let draftReady!: () => void; const enteredDraft = new Promise<void>(resolve => { draftReady = resolve; });
  let resolvePlan!: (response: Response) => void; let resolveDraft!: (response: Response) => void; let calls = 0;
  const harness = streamHarness({ claude: { apiKey: NON_CREDENTIAL, fetch: async () => {
    if (++calls === 1) { plannerReady(); return new Promise<Response>(resolve => { resolvePlan = resolve; }); }
    draftReady(); return new Promise<Response>(resolve => { resolveDraft = resolve; });
  } } });
  await enteredPlanner;
  assert.deepEqual(harness.observed.map(event => event.type === 'trace' ? event.step.stage : event.type), ['scope']);
  resolvePlan(modelResponse({ product_id: input.product_id, tool_ids: ['read_workbook', 'read_label', 'read_derived'] }));
  await enteredDraft;
  assert.deepEqual(harness.observed.map(event => event.type === 'trace' ? event.step.stage : event.type), ['scope', 'plan', 'retrieve', 'retrieve', 'retrieve', 'retrieve']);
  const done = once(harness.stream, 'end');
  resolveDraft(modelResponse({ product_id: input.product_id, claims: [{ claim_id: 'linker_release', source_ids: ['UK-ENHERTU-SMPC'] }] }));
  await done;
  assert.equal(calls, 2); assert.equal(harness.observed.at(-1)!.type, 'result');
  assert.equal(harness.requestRaw.listenerCount('aborted'), 0); assert.equal(harness.replyRaw.listenerCount('close'), 0);
});

test('stream disconnect aborts pending Claude work, cleans listeners and terminates without leaking or hanging', async () => {
  let ready!: () => void; const entered = new Promise<void>(resolve => { ready = resolve; });
  let signal: AbortSignal | null | undefined; let calls = 0;
  const harness = streamHarness({ claude: { apiKey: NON_CREDENTIAL, fetch: async (_url, init) => {
    calls++; signal = init?.signal; ready(); return new Promise<Response>(() => {});
  } } });
  await entered;
  const done = once(harness.stream, 'end');
  harness.replyRaw.emit('close');
  await done;
  assert.equal(signal?.aborted, true); assert.equal(calls, 1);
  assert.deepEqual(harness.observed.map(event => event.type === 'trace' ? event.step.stage : event.type), ['scope']);
  assert.equal(harness.requestRaw.listenerCount('aborted'), 0); assert.equal(harness.replyRaw.listenerCount('close'), 0);
});
