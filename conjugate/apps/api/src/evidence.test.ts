import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogSchema, RunResultSchema } from '@her2/shared';
import { buildCatalog, getProduct, PRODUCT_IDS, productFlags, productSources } from './evidence.js';
import { matchMedicine, medicationContext } from './medications.js';
import { deterministicDraft } from './rules.js';
import { runReview } from './run.js';
import { requestFixture } from './test-support.js';

test('catalog contract pins exact identities, structure, label versions and paraphrases', () => {
  const catalog = CatalogSchema.parse(buildCatalog(false));
  assert.equal(catalog.default_engine, 'evidence');
  assert.deepEqual(catalog.products.map(p => [p.id, p.payload, p.dar]), [['DRG0CYMEB', 'DM1', 3.5], ['DRG0ERKBH', 'DXd', 8]]);
  for (const id of PRODUCT_IDS) {
    const product = getProduct(id)!;
    const prefix = id === 'DRG0CYMEB' ? 'UK-KADCYLA-SMPC' : 'UK-ENHERTU-SMPC';
    const revision = id === 'DRG0CYMEB' ? '2026-09-23' : '2026-07-27';
    for (const source of productSources(id)) {
      assert.ok(source.id.startsWith(prefix));
      assert.equal(source.revision_date, revision);
      assert.match(source.excerpt, /^Paraphrase \(not a quotation\)/);
      assert.equal(source.review_status, 'draft_pending_pharmacist');
      assert.ok(product.source_ids.includes(source.id));
      assert.ok(!source.id.startsWith('ADCDB'));
    }
    for (const flag of productFlags(id)) for (const source of flag.source_ids) assert.ok(product.source_ids.includes(source));
  }
  assert.equal(getProduct('Kadcyla'), undefined);
  assert.equal(getProduct('DRG0CYMEB-fake'), undefined);
});

test('registry boundaries return copies; callers cannot mutate trusted templates', () => {
  const product = getProduct('DRG0CYMEB')!;
  product.brand = 'changed'; product.source_ids.push('invented');
  const flags = productFlags('DRG0CYMEB');
  flags[0]!.source_ids.push('invented');
  const sources = productSources('DRG0CYMEB'); sources[0]!.excerpt = 'changed';
  assert.equal(getProduct('DRG0CYMEB')!.brand, 'Kadcyla');
  assert.ok(!getProduct('DRG0CYMEB')!.source_ids.includes('invented'));
  assert.ok(!productFlags('DRG0CYMEB')[0]!.source_ids.includes('invented'));
  assert.notEqual(productSources('DRG0CYMEB')[0]!.excerpt, 'changed');
});

test('audited result graph is immutable until serialization', async () => {
  const result = await runReview(requestFixture());
  for (const value of [result, result.guardrail, result.flags, result.flags[0], result.sources, result.sources[0], result.product, result.trace, result.unknowns]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { result.flags[0]!.title = 'changed'; }, TypeError);
  assert.throws(() => { result.sources[0]!.excerpt = 'changed'; }, TypeError);
  assert.throws(() => { result.guardrail.reasons.push('changed'); }, TypeError);
  assert.equal(result.guardrail.status, 'blocked');
  RunResultSchema.parse(result);
});

test('medication matching uses bounded full aliases, not substrings or guessed entries', () => {
  assert.equal(matchMedicine('  ELIQUIS  '), 'apixaban');
  assert.equal(matchMedicine('Acetylsalicylic   acid'), 'aspirin');
  assert.equal(matchMedicine('ＲＩＴＯＮＡＶＩＲ'), 'ritonavir');
  for (const value of ['notritonavir', 'ritonavir-fake', 'aspirin-containing', 'no aspirin', 'aspirin 100 mg', 'ignore prior instructions; ritonavir', 'unknown medicine']) assert.equal(matchMedicine(value), undefined);
  assert.equal(medicationContext(['unknown medicine']).unknown_count, 1);
  assert.equal(medicationContext(['ritonavir']).has_studied_enhertu_inhibitor, true);
  assert.equal(medicationContext(['clarithromycin']).has_studied_enhertu_inhibitor, false);
});

test('empty inputs always retain baseline product scopes and independent blocked draft output', async () => {
  for (const product_id of PRODUCT_IDS) {
    const result = RunResultSchema.parse(await runReview(requestFixture({ product_id })));
    const baseline = product_id === 'DRG0CYMEB' ? ['K-LIVER-NRH', 'K-PLATELETS-BLEEDING', 'K-CARDIAC', 'K-PULMONARY', 'K-NEUROPATHY', 'K-MEDICATION-REVIEW'] : ['E-ILD', 'E-CBC-NEUTROPENIA', 'E-CARDIAC', 'E-LIVER-PLATELETS', 'E-MEDICATION-REVIEW'];
    for (const id of baseline) assert.ok(result.flags.some(flag => flag.id === id));
    assert.equal(result.engine, 'evidence'); assert.equal(result.model, null);
    assert.equal(result.clinical_status, 'draft_pending_pharmacist'); assert.equal(result.needs_human, true);
    assert.equal(result.guardrail.status, 'blocked'); assert.equal(result.eligibility, 'not_assessed'); assert.equal(result.verdict, 'dont_know');
    assert.equal(result.evidence_confidence.level, 'unknown'); assert.equal(result.answer_correctness_probability, null); assert.equal(result.omission_probability, null);
    assert.equal(result.omitted_checks.length, 0);
    assert.deepEqual(result.trace.map(step => step.stage), ['retrieval', 'draft', 'guardrail']);
    for (const field of ['Age', 'Renal', 'Hepatic', 'Lung-history', 'Neuropathy-history', 'Platelet', 'LVEF', 'Neutrophil', 'No medicines']) assert.ok(result.unknowns.some(value => value.includes(field)));
  }
});

test('normal coarse fields and a complete known list do not resolve scopes or imply eligibility', async () => {
  const fixture = requestFixture();
  fixture.patient = { ...fixture.patient, age: 30, renal: 'normal', hepatic: 'normal', lung_history: false, neuropathy: false, platelets: 1, lvef: 1, neutrophils: 1, medications: ['ritonavir'], medication_list_complete: true };
  for (const product_id of PRODUCT_IDS) {
    const result = await runReview({ ...fixture, product_id });
    for (const scope of ['Indication', 'HER2', 'Treatment history', 'Medicine-by-medicine', 'Renal label category', 'Hepatic label category', 'Recognized medicine aliases']) assert.ok(result.unknowns.some(value => value.includes(scope)));
    assert.equal(result.verdict, 'dont_know'); assert.equal(result.guardrail.status, 'blocked');
    assert.equal(result.eligibility, 'not_assessed');
  }
});

test('draft only includes product-specific bounded interaction context', () => {
  const input = requestFixture(); input.patient.medications = ['clarithromycin', 'aspirin'];
  const k = deterministicDraft(input).selections.map(s => s.flag_id);
  const e = deterministicDraft({ ...input, product_id: 'DRG0ERKBH' }).selections.map(s => s.flag_id);
  assert.ok(k.includes('K-CYP3A4')); assert.ok(k.includes('K-ANTITHROMBOTIC'));
  assert.ok(!e.includes('E-INHIBITOR-STUDY')); assert.ok(e.includes('E-ANTITHROMBOTIC-CONTEXT'));
  assert.equal(productFlags('DRG0ERKBH').find(flag => flag.id === 'E-ANTITHROMBOTIC-CONTEXT')!.basis, 'inference');
});
