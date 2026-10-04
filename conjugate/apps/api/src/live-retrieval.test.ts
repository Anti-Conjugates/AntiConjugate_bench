import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { LiveCheckRequestSchema, LiveCheckResultSchema } from '@her2/shared';
import { assertLiveUrl, createLiveRetriever, htmlTextLines, liveUrl, parseAdcdbDetail, LIVE_USER_AGENT, type LiveOptions } from './live-retrieval.js';
import { registerLiveRoutes } from './live-routes.js';
import { createApp } from './app.js';

// Software contract tests with a fake fetch. No network, no clinical data, no benchmark material.
const fixture = readFileSync(new URL('./fixtures/adcdb-detail-mini.html', import.meta.url), 'utf8');
const snapshot = JSON.parse(readFileSync(new URL('./openfda.snapshot.json', import.meta.url), 'utf8')) as { records: { product_id: string; id: string; query_url: string; set_id: string; version: string; effective_time: string; brand_name: string[]; generic_name: string[]; application_number: string[]; manufacturer_name: string[] }[] };
const kadcyla = snapshot.records.find(r => r.product_id === 'DRG0CYMEB')!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const openFdaBody = (overrides: Record<string, unknown> = {}) => ({ meta: {}, results: [{ id: kadcyla.id, set_id: kadcyla.set_id, version: kadcyla.version, effective_time: kadcyla.effective_time,
  openfda: { brand_name: kadcyla.brand_name, generic_name: kadcyla.generic_name, application_number: kadcyla.application_number, manufacturer_name: kadcyla.manufacturer_name }, ...overrides }] });
const dailyMedBody = { data: [{ setid: kadcyla.set_id, spl_version: Number(kadcyla.version), published_date: 'Apr 03, 2026', title: 'KADCYLA (synthetic test title)' }] };

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: NonNullable<LiveOptions['fetch']> = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { fetch, calls };
}
const happy: Handler = url => {
  const host = new URL(url).hostname;
  if (host === 'api.fda.gov') return json(openFdaBody());
  if (host === 'dailymed.nlm.nih.gov') return json(dailyMedBody);
  if (host === 'adcdb.idrblab.net') return new Response(fixture, { status: 200, headers: { 'content-type': 'text/html' } });
  if (url.includes('NCT09999999')) return json({ message: 'not found' }, 404);
  if (host === 'clinicaltrials.gov') return json({ protocolSection: { identificationModule: { nctId: 'NCT03529110', officialTitle: 'Synthetic test title' } } });
  if (url.includes('id=99999999')) return json({ result: { uids: ['99999999'], '99999999': { uid: '99999999', error: 'cannot get document summary' } } });
  return json({ result: { uids: ['29420467'], '29420467': { uid: '29420467', title: 'Synthetic title', source: 'Journal', pubdate: '2018' } } });
};
const waitForAbort: Handler = (_url, init) => new Promise((_resolve, reject) => {
  init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
});

test('URLs come only from fixed templates on allowlisted https hosts', () => {
  assert.equal(liveUrl('clinicaltrials_gov', 'NCT03529110'), 'https://clinicaltrials.gov/api/v2/studies/NCT03529110?fields=protocolSection.identificationModule');
  assert.equal(liveUrl('pubmed', 'PMID:29420467'), 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=29420467&retmode=json');
  assert.equal(liveUrl('openfda', 'DRG0CYMEB'), kadcyla.query_url);
  assert.equal(liveUrl('adcdb', 'DRG0ERKBH'), 'https://adcdb.idrblab.net/data/adc/details/DRG0ERKBH');
  assert.equal(liveUrl('dailymed', 'DRG0ERKBH'), 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=Enhertu&pagesize=1');
  for (const bad of ['NCT123', 'NCT03529110/../x', 'https://evil.example/']) assert.throws(() => liveUrl('clinicaltrials_gov', bad));
  assert.throws(() => liveUrl('adcdb', 'DRG0XXXXX'));
  assert.throws(() => liveUrl('pubmed', 'PMID:0'));
  for (const bad of ['http://api.fda.gov/drug/label.json', 'https://api.fda.gov.evil.example/', 'https://user:pw@api.fda.gov/', 'https://api.fda.gov:444/', 'https://clinicaltrials.gov/']) assert.throws(() => assertLiveUrl('openfda', bad));
});
test('request schema is strict and bounded', () => {
  assert.ok(LiveCheckRequestSchema.safeParse({ product_id: 'DRG0CYMEB' }).success);
  assert.ok(LiveCheckRequestSchema.safeParse({ references: ['NCT03529110', 'PMID:29420467'] }).success);
  for (const bad of [{}, { references: [] }, { product_id: 'DRG0OTHER' }, { references: ['NCT1', 'x'] }, { references: Array(5).fill('NCT03529110') },
    { product_id: 'DRG0CYMEB', url: 'https://evil.example/' }, { references: ['https://clinicaltrials.gov/'] }]) {
    assert.equal(LiveCheckRequestSchema.safeParse(bad).success, false);
  }
});
test('product check agrees with snapshots, sends the user agent and never follows redirects', async () => {
  const fake = fakeFetch(happy);
  const result = await createLiveRetriever({ fetch: fake.fetch }).check({ product_id: 'DRG0CYMEB', references: ['NCT03529110', 'NCT09999999', 'PMID:29420467', 'PMID:99999999'] });
  LiveCheckResultSchema.parse(result);
  assert.deepEqual(result.receipts.map(r => [r.source, r.subject, r.status]), [['openfda', 'DRG0CYMEB', 'ok'], ['dailymed', 'DRG0CYMEB', 'ok'], ['adcdb', 'DRG0CYMEB', 'ok'],
    ['clinicaltrials_gov', 'NCT03529110', 'ok'], ['clinicaltrials_gov', 'NCT09999999', 'not_found'], ['pubmed', 'PMID:29420467', 'ok'], ['pubmed', 'PMID:99999999', 'not_found']]);
  assert.equal(fake.calls.length, 7);
  for (const call of fake.calls) {
    assert.equal(call.init.redirect, 'manual');
    assert.equal((call.init.headers as Record<string, string>)['user-agent'], LIVE_USER_AGENT);
  }
  assert.ok(result.receipts.every(r => r.provenance === 'live_retrieved_unverified' && r.raw_sha256?.length === 64 && r.limitations.length > 0));
  assert.equal(result.guardrail.status, 'blocked'); assert.equal(result.needs_human, true); assert.equal(result.clinical_status, 'draft_pending_pharmacist');
  assert.equal(result.answer_correctness_probability, null); assert.equal(result.omission_probability, null); assert.equal(result.overall_adc_score, null);
  assert.deepEqual(result.counts, { ok: 5, not_found: 2, drift: 0, error: 0 });
});
test('redirects and off-host final URLs are rejected as error receipts', async () => {
  for (const respond of [
    () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    () => { const r = json(openFdaBody()); Object.defineProperty(r, 'url', { value: 'https://evil.example/drug/label.json' }); return r; },
    () => { const r = json(openFdaBody()); Object.defineProperty(r, 'redirected', { value: true }); return r; }
  ]) {
    const result = await createLiveRetriever({ fetch: fakeFetch(respond).fetch }).check({ product_id: 'DRG0CYMEB' });
    const openfda = result.receipts.find(r => r.source === 'openfda')!;
    assert.equal(openfda.status, 'error'); assert.equal(openfda.error_code, 'REDIRECT_REJECTED');
    assert.deepEqual(openfda.parsed, {}); assert.deepEqual(openfda.comparison, []);
  }
});
test('oversize bodies are rejected by header and by streamed length', async () => {
  const declared = () => new Response('{}', { status: 200, headers: { 'content-length': '99999999' } });
  const streamed = () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(32_000)); } }), { status: 200 });
  for (const respond of [declared, streamed]) {
    const [receipt] = (await createLiveRetriever({ fetch: fakeFetch(respond).fetch }).check({ references: ['NCT03529110'] })).receipts;
    assert.equal(receipt!.status, 'error'); assert.equal(receipt!.error_code, 'OVERSIZE');
  }
});
test('per-request timeout, overall deadline and caller cancellation are explicit errors', async () => {
  const timeout = await createLiveRetriever({ fetch: fakeFetch(waitForAbort).fetch, timeoutMs: 20, deadlineMs: 5_000 }).check({ references: ['NCT03529110'] });
  assert.equal(timeout.receipts[0]!.error_code, 'TIMEOUT');
  const deadline = await createLiveRetriever({ fetch: fakeFetch(waitForAbort).fetch, timeoutMs: 5_000, deadlineMs: 20 }).check({ references: ['PMID:29420467'] });
  assert.equal(deadline.receipts[0]!.error_code, 'DEADLINE');
  const controller = new AbortController();
  const pending = createLiveRetriever({ fetch: fakeFetch(waitForAbort).fetch }).check({ references: ['NCT03529110'] }, controller.signal);
  setTimeout(() => controller.abort(), 10);
  assert.equal((await pending).receipts[0]!.error_code, 'CANCELLED');
  const network = await createLiveRetriever({ fetch: fakeFetch(() => { throw new TypeError('fetch failed'); }).fetch }).check({ product_id: 'DRG0ERKBH' });
  assert.ok(network.receipts.every(r => r.status === 'error' && r.error_code === 'NETWORK' && r.comparison.length === 0 && Object.keys(r.parsed).length === 0));
});
test('not_found statuses for each source', async () => {
  const fake = fakeFetch(url => {
    const host = new URL(url).hostname;
    if (host === 'dailymed.nlm.nih.gov') return json({ data: [] });
    return json({ error: { code: 'NOT_FOUND' } }, 404);
  });
  const result = await createLiveRetriever({ fetch: fake.fetch }).check({ product_id: 'DRG0CYMEB', references: ['NCT09999999'] });
  assert.deepEqual(result.receipts.map(r => r.status), ['not_found', 'not_found', 'not_found', 'not_found']);
  const server = await createLiveRetriever({ fetch: fakeFetch(() => json({}, 503)).fetch }).check({ references: ['NCT03529110'] });
  assert.equal(server.receipts[0]!.error_code, 'HTTP_STATUS');
});
test('drift is reported field by field and is never overwritten by the snapshot', async () => {
  const fake = fakeFetch(url => {
    const host = new URL(url).hostname;
    if (host === 'api.fda.gov') return json(openFdaBody({ version: '99' }));
    if (host === 'dailymed.nlm.nih.gov') return json({ data: [{ ...dailyMedBody.data[0], setid: '00000000-0000-0000-0000-000000000000' }] });
    return new Response(fixture.replace('<td>DM1</td>', '<td>MMAE</td>'), { status: 200 });
  });
  const result = await createLiveRetriever({ fetch: fake.fetch }).check({ product_id: 'DRG0CYMEB' });
  assert.deepEqual(result.receipts.map(r => r.status), ['drift', 'drift', 'drift']);
  const [openfda, dailymed, adcdb] = result.receipts;
  assert.deepEqual(openfda!.comparison.filter(row => !row.agrees), [{ field: 'version', snapshot: kadcyla.version, live: '99', agrees: false }]);
  assert.equal(openfda!.parsed.version, '99');
  assert.deepEqual(dailymed!.comparison.filter(row => !row.agrees).map(row => row.field), ['set_id']);
  assert.deepEqual(adcdb!.comparison.filter(row => !row.agrees), [{ field: 'payload', snapshot: 'DM1', live: 'MMAE', agrees: false }]);
});
test('ADCdb text-line parser reads the handwritten fixture and ignores script/style text', () => {
  const lines = htmlTextLines(fixture);
  assert.ok(!lines.some(line => line.includes('Not this') || line.includes('trap')));
  assert.deepEqual(parseAdcdbDetail(fixture), { adc_id: 'DRG0CYMEB', adc_name: 'Trastuzumab\u00a0emtansine', brand: 'Kadcyla', antibody: 'Trastuzumab',
    target: 'Receptor tyrosine-protein kinase erbB-2 (HER2)', payload: 'DM1', linker: 'Succinimidyl-4-(N-maleimidomethyl)cyclohexane-1-carboxylate (SMCC)', dar: '3.5' });
});
test('ADCdb page for another id or without composition fields is an error, not a pass', async () => {
  for (const page of [fixture.replace('(ID: DRG0CYMEB)', '(ID: DRG0ERKBH)'), '<html><h2>(ID: DRG0CYMEB)</h2></html>']) {
    const fake = fakeFetch(url => new URL(url).hostname === 'adcdb.idrblab.net' ? new Response(page, { status: 200 }) : happy(url, {}));
    const adcdb = (await createLiveRetriever({ fetch: fake.fetch }).check({ product_id: 'DRG0CYMEB' })).receipts.find(r => r.source === 'adcdb')!;
    assert.equal(adcdb.status, 'error'); assert.ok(adcdb.error_code === 'IDENTITY_MISMATCH' || adcdb.error_code === 'PARSE');
  }
});
test('cache serves repeats within the TTL and refetches after it; errors are not cached', async () => {
  let clock = Date.parse('2026-10-04T00:00:00Z');
  const fake = fakeFetch(happy);
  const retriever = createLiveRetriever({ fetch: fake.fetch, now: () => clock });
  await retriever.check({ references: ['NCT03529110'] });
  const again = await retriever.check({ references: ['NCT03529110'] });
  assert.equal(fake.calls.length, 1); assert.equal(again.receipts[0]!.cached, true);
  clock += 60 * 60 * 1000 + 1;
  assert.equal((await retriever.check({ references: ['NCT03529110'] })).receipts[0]!.cached, false);
  assert.equal(fake.calls.length, 2);
  const failing = fakeFetch(() => json({}, 500));
  const errors = createLiveRetriever({ fetch: failing.fetch });
  await errors.check({ references: ['NCT03529110'] }); await errors.check({ references: ['NCT03529110'] });
  assert.equal(failing.calls.length, 2);
});
test('at most one ADCdb request is in flight', async () => {
  let active = 0; let peak = 0;
  const fake = fakeFetch(async url => {
    if (new URL(url).hostname !== 'adcdb.idrblab.net') return happy(url, {});
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return new Response(fixture, { status: 200 });
  });
  const retriever = createLiveRetriever({ fetch: fake.fetch });
  await Promise.all([retriever.check({ product_id: 'DRG0CYMEB' }), retriever.check({ product_id: 'DRG0ERKBH' })]);
  assert.equal(peak, 1);
});
test('route: strict body, env switch and safety fields', async () => {
  const off = Fastify(); registerLiveRoutes(off, { env: { LIVE_RETRIEVAL: 'off' }, retriever: createLiveRetriever({ fetch: fakeFetch(happy).fetch }) });
  const disabled = await off.inject({ method: 'POST', url: '/api/live/check', payload: { product_id: 'DRG0CYMEB' } });
  assert.equal(disabled.statusCode, 503); assert.equal(disabled.json().error.code, 'LIVE_RETRIEVAL_OFF');
  assert.equal((await off.inject({ method: 'GET', url: '/api/live/sources' })).json().enabled, false);
  const fake = fakeFetch(happy);
  const app = await createApp();
  const on = Fastify(); registerLiveRoutes(on, { env: {}, retriever: createLiveRetriever({ fetch: fake.fetch }) });
  on.setErrorHandler((error, _request, reply) => reply.code((error as { status?: number }).status ?? 500).send({ error: { code: 'INVALID_REQUEST' } }));
  for (const payload of [{}, { product_id: 'DRG0CYMEB', url: 'https://evil.example/' }, { references: Array(5).fill('NCT03529110') }]) {
    assert.equal((await on.inject({ method: 'POST', url: '/api/live/check', payload })).statusCode, 400);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/live/check', payload: { references: ['not-an-id'] } })).statusCode, 400);
  assert.equal(fake.calls.length, 0);
  const ok = await on.inject({ method: 'POST', url: '/api/live/check', payload: { product_id: 'DRG0CYMEB' } });
  assert.equal(ok.statusCode, 200);
  const body = LiveCheckResultSchema.parse(ok.json());
  assert.equal(body.guardrail.status, 'blocked'); assert.equal(body.overall_adc_score, null);
  await Promise.all([off.close(), on.close(), app.close()]);
});
