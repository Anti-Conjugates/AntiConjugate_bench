import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ModelResultSchema, ModelSnapshotSchema } from '@her2/shared';
import { buildModelCatalog, replayModels, runModels, verifyModelSources } from './models.js';
import { createApp } from './app.js';

const request = { product_id: 'DRG0ERKBH', molecule_id: 'control-01', observation_policy: 'all', synthetic_confirmed: true };
test('component scorecard preserves the gate and separates target structure from antibody affinity', () => {
  const r = runModels(request);
  assert.equal(r.model_calls, 0); assert.equal(r.execution, 'frozen_observations');
  assert.equal(r.overall_adc_score, null); assert.equal(r.guardrail.status, 'blocked');
  assert.equal(r.answer_correctness_probability, null); assert.equal(r.omission_probability, null);
  assert.equal(r.structure?.role, 'target_monomer_only'); assert.equal(r.structure?.uniprot_id, 'P04626');
  assert.ok(r.missing.some(s => s.includes('affinity'))); assert.equal(r.checks.filter(c => c.passed).length, 3);
});
test('proxy reward shortcut is caught independently of the reward', () => {
  const good = runModels(request); const bad = runModels({ ...request, molecule_id: 'control-04' });
  assert.equal(good.molecule.proxy_reward, 1); assert.equal(bad.molecule.proxy_reward, 1);
  assert.equal(bad.molecule.valid, true); assert.equal(bad.molecule.has_two_mapped_attachments, false);
  assert.equal(bad.checks.filter(c => c.passed).length, 2);
});
test('invalid, disconnected and duplicated-map controls cannot pass all checks', () => {
  for (const id of ['control-03', 'control-05', 'control-06', 'control-07']) {
    assert.ok(runModels({ ...request, molecule_id: id }).checks.some(c => !c.passed));
  }
  assert.equal(runModels({ ...request, molecule_id: 'control-05' }).molecule.descriptors, null);
});
test('identical-antibody/different-payload control does not invent an ADC ranking', () => {
  const a = runModels(request); const b = runModels({ ...request, product_id: 'DRG0CYMEB' });
  assert.deepEqual(a.sequence, b.sequence); assert.equal(a.sequence?.cosine, 1); assert.equal(a.sequence?.identity, 1);
  assert.equal(a.overall_adc_score, null); assert.equal(b.overall_adc_score, null);
});
test('observation withholding removes values, and restoration is a fresh explicit request', () => {
  for (const policy of ['without_structure', 'without_sequence', 'chemistry_only']) {
    const r = runModels({ ...request, observation_policy: policy });
    assert.equal(r.sequence !== null, policy === 'without_structure');
    assert.equal(r.structure !== null, policy === 'without_sequence');
    assert.equal(r.molecule.proxy_reward, 1); assert.equal(replayModels(r).verified, true);
  }
  assert.ok(runModels(request).structure);
});
test('replay checks whole artifacts, schema fields, source hashes and controlled prose', () => {
  const original = runModels(request); assert.equal(replayModels(original).verified, true);
  const reversed = Object.fromEntries(Object.entries(original).reverse()); assert.equal(replayModels(reversed).verified, true);
  const changes: ((r: typeof original) => void)[] = [
    r => { r.snapshot_sha256 = '0'.repeat(64); }, r => { r.code_sha256 = '0'.repeat(64); },
    r => { r.molecule.proxy_reward = .3; }, r => { r.molecule.smiles = 'CC'; },
    r => { r.missing[0] = 'Binding measured.'; }, r => { r.sequence!.cosine = .5; },
    r => { r.structure!.plddt[0] = 100; }, r => { r.checks[0]!.detail = 'No verification.'; },
    r => { r.request.observation_policy = 'without_structure'; },
    r => { r.request.molecule_id = 'control-04'; }
  ];
  for (const change of changes) { const r = structuredClone(original); change(r); assert.throws(() => replayModels(r)); }
});
test('strict contracts reject invented overall scores, unsafe clinical fields and withheld values', () => {
  const original = runModels(request);
  for (const patch of [{ overall_adc_score: .9 }, { eligibility: 'eligible' }, { omission_probability: .1 }, { engine: 'claude' }]) {
    assert.equal(ModelResultSchema.safeParse({ ...original, ...patch }).success, false);
  }
  assert.equal(ModelResultSchema.safeParse({ ...original, request: { ...original.request, observation_policy: 'chemistry_only' } }).success, false);
  const s = structuredClone(buildModelCatalog().snapshot); s.structure.mean_plddt = 100;
  assert.equal(ModelSnapshotSchema.safeParse(s).success, false);
});
test('raw unconditioned checkpoint probes are not repaired into SMILES or counted as paper replication', () => {
  const s = buildModelCatalog().snapshot;
  assert.equal(s.linker_model.paper_checkpoint_equivalence, 'not_verified'); assert.equal(s.linker_model.license, 'not_declared');
  assert.equal(s.linker_model.invocation_kind, 'unconditioned_format_probe');
  const probes = s.molecules.filter(m => m.adapter_trial); assert.equal(probes.length, 12);
  for (const p of probes) assert.equal(runModels({ ...request, molecule_id: p.id }).molecule.smiles, p.smiles);
});
test('source validation rejects internally consistent but source-inconsistent structure values and identity', () => {
  const s = buildModelCatalog().snapshot;
  const metadata = readFileSync(new URL('../../../data/model_sources/her2_alphafold_metadata.json', import.meta.url), 'utf8');
  const confidence = readFileSync(new URL('../../../data/model_sources/her2_alphafold_confidence.json', import.meta.url), 'utf8');
  verifyModelSources(s, metadata, confidence);
  const altered = structuredClone(s); altered.structure.plddt.fill(100); altered.structure.mean_plddt = 100; altered.structure.below_50_fraction = 0;
  assert.equal(ModelSnapshotSchema.safeParse(altered).success, true);
  assert.throws(() => verifyModelSources(altered, metadata, confidence));
  assert.throws(() => verifyModelSources(s, metadata, confidence.replace('confidenceScore', 'other')));
  assert.throws(() => verifyModelSources({ ...s, structure: { ...s.structure, sequence_sha256: '0'.repeat(64) } }, metadata, confidence));
});
test('HTTP boundaries require synthetic confirmation and reject arbitrary inputs/providers/URLs', async t => {
  const app = await createApp(); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/api/models/catalog' })).statusCode, 200);
  for (const payload of [{ ...request, synthetic_confirmed: false }, { ...request, product_id: 'other' }, { ...request, molecule_id: 'sample-99' }, { ...request, url: 'https://example.com' }, { ...request, sequence: 'EVQL' }, { ...request, engine: 'claude' }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/models/runs', payload })).statusCode, 400);
  }
  const response = await app.inject({ method: 'POST', url: '/api/models/runs', payload: request });
  assert.equal(response.statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/models/replay', payload: response.json() })).statusCode, 200);
  const corrupt = response.json(); corrupt.molecule.proxy_reward = .5;
  const rejected = await app.inject({ method: 'POST', url: '/api/models/replay', payload: corrupt });
  assert.equal(rejected.statusCode, 400); assert.equal(rejected.json().error.code, 'MODEL_REPLAY_REJECTED');
});
