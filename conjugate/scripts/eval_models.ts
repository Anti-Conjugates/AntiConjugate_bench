import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildModelCatalog, replayModels, runModels } from '../apps/api/src/models.js';
import { ModelPolicySchema } from '@her2/shared';

const catalog = buildModelCatalog();
const rows = catalog.products.flatMap(product => catalog.snapshot.molecules.flatMap(molecule => ModelPolicySchema.options.map(policy => {
  const request = { product_id: product.id, molecule_id: molecule.id, observation_policy: policy, synthetic_confirmed: true };
  const first = runModels(request); const second = runModels(request);
  assert.deepEqual(first, second); assert.equal(replayModels(first).verified, true);
  assert.equal(first.overall_adc_score, null); assert.equal(first.guardrail.status, 'blocked');
  assert.equal(first.answer_correctness_probability, null); assert.equal(first.omission_probability, null);
  return { product_id: product.id, molecule_id: molecule.id, policy, deterministic: true, replay_passed: true, representation_passes: first.checks.filter(c => c.passed).length };
})));
const result = { version: 'conjugate-model-controls-1', generated_at: new Date().toISOString(), snapshot_sha256: catalog.snapshot_sha256,
  code_sha256: runModels({ product_id: 'DRG0CYMEB', molecule_id: 'control-01', observation_policy: 'all', synthetic_confirmed: true }).code_sha256,
  model_calls: 0, provider_requests: 0, rows,
  limits: ['This replays imported observations; model inference is not repeated.', 'The probes are unconditioned adapter trials, not a linker-generation benchmark.', 'Synthetic graph checks and proxy rewards do not establish ADC performance.'] };
writeFileSync(new URL('../evals/models.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(`${rows.length} fixed component views agreed with deterministic replay. No model calls.`);
