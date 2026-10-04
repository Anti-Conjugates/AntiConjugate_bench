import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceResultSchema } from '@her2/shared';
import { scoreMaskedAntibody, inferencePayload } from './live-inference.js';
import { ApiFailure } from './errors.js';

const request = { sequence_id: 'trastuzumab_vh', synthetic_confirmed: true } as const;
const fixture = (inputs: string, score = 0.25) => [{ score, token: 19, token_str: 'Y', sequence: inputs.replace('<mask>', 'Y') }];
test('live inference calls only the fixed HF model and scores one fixed residue', async () => {
  let calls = 0;
  const result = await scoreMaskedAntibody(request, { apiKey: 'unit-test-key', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://router.huggingface.co/hf-inference/models/facebook/esm2_t33_650M_UR50D');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.parameters, { top_k: 1, targets: ['Y'] });
    return new Response(JSON.stringify(fixture(body.inputs)));
  } });
  assert.equal(calls, 1); assert.equal(result.provider_calls, 1);
  assert.equal(result.execution, 'live_inference'); assert.equal(result.served_revision_verified, false);
  assert.equal(result.residue_nll, -Math.log(0.25)); assert.equal(result.overall_adc_score, null);
  assert.equal(result.guardrail.status, 'blocked'); assert.equal(result.answer_correctness_probability, null);
  assert.ok(!JSON.stringify(result).includes('unit-test-key'));
  assert.equal(InferenceResultSchema.safeParse({ ...result, residue_nll: 4 }).success, false);
});
test('unconfirmed inputs, arbitrary models, URLs and sequences cause zero calls', async () => {
  let calls = 0;
  const options = { apiKey: 'unit-test-key', fetchImpl: async () => { calls++; return new Response('[]'); } };
  for (const input of [{ ...request, synthetic_confirmed: false }, { ...request, sequence_id: 'user-sequence' }, { ...request, url: 'https://example.org' }, { ...request, model_id: 'other' }, { ...request, sequence: 'AAA' }]) {
    await assert.rejects(scoreMaskedAntibody(input, options), (e: unknown) => e instanceof ApiFailure && e.code === 'INVALID_REQUEST');
  }
  await assert.rejects(scoreMaskedAntibody(request), (e: unknown) => e instanceof ApiFailure && e.code === 'INFERENCE_NOT_CONFIGURED');
  assert.equal(calls, 0);
});
test('the composition control preserves the scored residue and changes its context', () => {
  const reference = inferencePayload(request).inputs.replace('<mask>', 'Y');
  const control = inferencePayload({ ...request, sequence_id: 'reversed_vh_control' }).inputs.replace('<mask>', 'Y');
  assert.notEqual(reference, control); assert.equal(reference[32], 'Y'); assert.equal(control[32], 'Y');
  assert.equal([...reference].sort().join(''), [...control].sort().join(''));
});
test('provider failures and corrupt responses cannot release or replace a score', async () => {
  const valid = fixture(inferencePayload(request).inputs);
  for (const body of ['not-json', JSON.stringify([{ ...valid[0], score: 2 }]), JSON.stringify([{ ...valid[0], token_str: 'A' }]), JSON.stringify([{ ...valid[0], sequence: 'Y' }]), JSON.stringify([{ ...valid[0], extra: 'unit-test-key' }]), ' '.repeat(33_000)]) {
    await assert.rejects(scoreMaskedAntibody(request, { apiKey: 'unit-test-key', fetchImpl: async () => new Response(body) }), (e: unknown) => e instanceof ApiFailure && e.code === 'INFERENCE_INVALID_OUTPUT' && !e.message.includes('unit-test-key'));
  }
  for (const status of [403, 429, 503]) {
    let calls = 0;
    await assert.rejects(scoreMaskedAntibody(request, { apiKey: 'unit-test-key', fetchImpl: async () => { calls++; return new Response('secret from upstream', { status }); } }), (e: unknown) => e instanceof ApiFailure && e.code === 'INFERENCE_UNAVAILABLE' && !e.message.includes('secret'));
    assert.equal(calls, 1);
  }
});
test('cancellation stops before calling the provider', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(scoreMaskedAntibody(request, { apiKey: 'unit-test-key', signal: controller.signal, fetchImpl: async () => { calls++; return new Response('[]'); } }), (e: unknown) => e instanceof ApiFailure && e.code === 'RESEARCH_CANCELLED');
  assert.equal(calls, 0);
});
test('deadlines and cancellation bound fetch and body readers that ignore abort', async () => {
  for (const fetchImpl of [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const keepAlive = setInterval(() => {}, 50);
    try {
      await assert.rejects(scoreMaskedAntibody(request, { apiKey: 'unit-test-key', timeoutMs: 10, fetchImpl }), (e: unknown) => e instanceof ApiFailure && e.code === 'INFERENCE_TIMEOUT');
      const controller = new AbortController();
      const operation = scoreMaskedAntibody(request, { apiKey: 'unit-test-key', signal: controller.signal, fetchImpl });
      setTimeout(() => controller.abort(), 10);
      await assert.rejects(operation, (e: unknown) => e instanceof ApiFailure && e.code === 'RESEARCH_CANCELLED');
    } finally { clearInterval(keepAlive); }
  }
});
