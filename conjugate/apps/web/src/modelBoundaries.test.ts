import { afterEach, expect, it, vi } from 'vitest';
import { ModelCatalogSchema } from '@her2/shared';
import { buildModelCatalog, runModels } from '../../api/src/models';
import { fetchModelCatalog, submitModelRun, validateModelResult } from './modelBoundaries';

const request = { product_id: 'DRG0ERKBH', molecule_id: 'control-01', observation_policy: 'all', synthetic_confirmed: true } as const;
const catalog = buildModelCatalog();
afterEach(() => vi.unstubAllGlobals());
it('accepts only matched component outputs and refuses invented clinical scores', () => {
  const r = runModels(request); expect(validateModelResult(r, request, catalog).overall_adc_score).toBeNull();
  for (const patch of [{ overall_adc_score: .9 }, { eligibility: 'eligible' }, { needs_human: false }, { omission_probability: .4 }, { model_calls: 1 }, { clinical_status: 'released' }]) {
    expect(() => validateModelResult({ ...r, ...patch }, request, catalog)).toThrow();
  }
});
it('rejects product, molecule, source-fingerprint and raw-observation swaps', () => {
  const r = runModels(request);
  const bad = [{ ...r, request: { ...request, product_id: 'DRG0CYMEB' } },
    { ...r, snapshot_sha256: '0'.repeat(64) },
    { ...r, molecule: { ...r.molecule, proxy_reward: .1 } },
    { ...r, structure: { ...r.structure!, mean_plddt: 100 } }];
  for (const value of bad) expect(() => validateModelResult(value, request, catalog)).toThrow();
});
it('rejects withheld data smuggled back into a result', () => {
  const r = runModels({ ...request, observation_policy: 'chemistry_only' });
  expect(validateModelResult(r, r.request, catalog).sequence).toBeNull();
  expect(() => validateModelResult({ ...r, structure: catalog.snapshot.structure }, r.request, catalog)).toThrow();
  expect(() => validateModelResult({ ...r, checks: [r.checks[0], r.checks[0], r.checks[0]] }, r.request, catalog)).toThrow();
});
it('rejects altered ESM values/provenance, controller hashes and unsupported prose before display', () => {
  const r = runModels(request);
  const bad = [
    { ...r, sequence: { ...r.sequence!, cosine: .12 } },
    { ...r, sequence: { ...r.sequence!, source_sha256: '0'.repeat(64) } },
    { ...r, sequence_artifact_sha256: '0'.repeat(64) }, { ...r, code_sha256: '0'.repeat(64) },
    { ...r, missing: ['Binding was measured.', ...r.missing.slice(1)] },
    { ...r, checks: r.checks.map(c => ({ ...c, detail: 'Efficacy proved.' })) }
  ];
  for (const value of bad) expect(() => validateModelResult(value, request, catalog)).toThrow();
});
it('rejects arbitrary external links and duplicate product identities', () => {
  expect(ModelCatalogSchema.safeParse({ ...catalog, products: [catalog.products[0], catalog.products[0]] }).success).toBe(false);
  expect(ModelCatalogSchema.safeParse({ ...catalog, unavailable: [{ name: 'other', reason: 'x', url: 'javascript:alert(1)' }] }).success).toBe(false);
});
it('does not send unconfirmed or uncatalogued requests', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(submitModelRun({ ...request, synthetic_confirmed: false } as unknown as typeof request, catalog, new AbortController().signal)).rejects.toThrow();
  await expect(submitModelRun({ ...request, molecule_id: 'control-99' }, catalog, new AbortController().signal)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it('uses strict transport parsing and exposes upstream errors without fallback', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'MODEL_REPLAY_REJECTED', message: 'Saved observations mismatch.' } }), { status: 400 }));
  vi.stubGlobal('fetch', fetch);
  await expect(submitModelRun(request, catalog, new AbortController().signal)).rejects.toThrow('Saved observations mismatch.');
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(new Response('<html>error</html>', { status: 500 }));
  await expect(fetchModelCatalog(new AbortController().signal)).rejects.toThrow('unreadable');
});
