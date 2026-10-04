import { afterEach, expect, it, vi } from 'vitest';
import { InferenceCatalogSchema } from '@her2/shared';
import { INFERENCE_CASES, scoreMaskedAntibody } from '../../api/src/live-inference';
import { fetchInferenceCatalog, submitInference, validateInferenceResult } from './inferenceBoundaries';

const request = { sequence_id: 'trastuzumab_vh', synthetic_confirmed: true } as const;
const catalog = InferenceCatalogSchema.parse({ configured: true, provider: 'hf-inference', model_id: 'facebook/esm2_t33_650M_UR50D', task: 'fill-mask', transport: 'mcp_stdio', remaining_calls: 20, cases: INFERENCE_CASES });
async function result() {
  return scoreMaskedAntibody(request, { apiKey: 'unit-test-key', fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify([{ token: 19, token_str: 'Y', score: 0.25, sequence: body.inputs.replace('<mask>', 'Y') }]));
  } });
}
afterEach(() => vi.unstubAllGlobals());
it('accepts only live, catalog-bound inference with blocked clinical fields', async () => {
  const r = await result(); expect((await validateInferenceResult(r, request, catalog)).residue_nll).toBe(-Math.log(.25));
  for (const patch of [{ input_sha256: '0'.repeat(64) }, { overall_adc_score: .9 }, { clinical_status: 'released' }, { transport: 'native' }, { execution: 'frozen_observations' }, { provider_calls: 0 }, { served_revision_verified: true }, { answer_correctness_probability: .8 }, { residue_nll: 2 }, { sequence: { ...r.sequence, sequence_sha256: '0'.repeat(64) } }, { request: { ...request, sequence_id: 'reversed_vh_control' } }]) {
    await expect(validateInferenceResult({ ...r, ...patch }, request, catalog)).rejects.toThrow();
  }
});
it('binds displayed scores to the retained bounded response and its hash', async () => {
  const r = await result();
  for (const patch of [
    { residue_probability: .99, residue_nll: -Math.log(.99) },
    { output_sha256: '0'.repeat(64) },
    { provider_response_json: r.provider_response_json.replace('0.25', '0.99'), residue_probability: .99, residue_nll: -Math.log(.99) },
    { provider_response_json: '[]' }
  ]) await expect(validateInferenceResult({ ...r, ...patch }, request, catalog)).rejects.toThrow();
});
it('unconfirmed or disabled inference requests are never sent', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(submitInference({ ...request, synthetic_confirmed: false } as unknown as typeof request, catalog, new AbortController().signal)).rejects.toThrow();
  await expect(submitInference(request, { ...catalog, configured: false }, new AbortController().signal)).rejects.toThrow();
  await expect(submitInference(request, { ...catalog, remaining_calls: 0 }, new AbortController().signal)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it('provider failures remain failures with one call and no snapshot fallback', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INFERENCE_UNAVAILABLE', message: 'HF inference failed.' } }), { status: 502 }));
  vi.stubGlobal('fetch', fetch);
  await expect(submitInference(request, catalog, new AbortController().signal)).rejects.toThrow('HF inference failed.');
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(new Response('<html>error</html>', { status: 500 }));
  await expect(fetchInferenceCatalog(new AbortController().signal)).rejects.toThrow('unreadable');
  expect(InferenceCatalogSchema.safeParse({ ...catalog, cases: [catalog.cases[0], catalog.cases[0]] }).success).toBe(false);
});
