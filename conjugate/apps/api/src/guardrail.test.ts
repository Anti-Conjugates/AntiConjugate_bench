import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSelection, requiredChecks } from './guardrail.js';
import { PRODUCT_IDS } from './evidence.js';
import { deterministicDraft } from './rules.js';
import { requestFixture } from './test-support.js';

test('independent expected checks survive an empty selection and expose omissions separately', () => {
  for (const product_id of PRODUCT_IDS) {
    const input = requestFixture({ product_id });
    const audit = auditSelection(input, { product_id, selections: [] });
    assert.equal(audit.valid_selection, true);
    assert.equal(audit.flags.length, 0);
    assert.deepEqual(audit.omitted_checks, requiredChecks(input));
    assert.ok(audit.omitted_checks.length >= 5);
    assert.ok(audit.reasons.some(reason => reason.includes('omitted')));
  }
});

test('independent input uncertainty survives even a rejected model draft', () => {
  const input = requestFixture();
  const audit = auditSelection(input, null);
  for (const field of ['Age', 'Renal', 'Hepatic', 'Lung-history', 'Neuropathy-history', 'Platelet', 'LVEF', 'Neutrophil', 'No medicines', 'Indication', 'HER2', 'Treatment history', 'Medicine-by-medicine']) assert.ok(audit.unknowns.some(text => text.includes(field)));
  assert.ok(audit.reasons.some(text => text.includes('Independent input audit')));
  assert.equal(audit.valid_selection, false);
});

test('single omission is not silently repaired', () => {
  const input = requestFixture(); const draft = deterministicDraft(input);
  const removed = draft.selections.shift()!;
  const audit = auditSelection(input, draft);
  assert.equal(audit.valid_selection, true);
  assert.deepEqual(audit.omitted_checks.map(flag => flag.id), [removed.flag_id]);
  assert.ok(!audit.flags.some(flag => flag.id === removed.flag_id));
});

test('exact product, unknown flags/citations, cross-product flags/citations, pair entailment and duplicates fail closed', () => {
  const input = requestFixture();
  const mutations: Array<(draft: ReturnType<typeof deterministicDraft>) => void> = [
    draft => { draft.product_id = 'DRG0CYMEB-fake'; },
    draft => { draft.product_id = 'DRG0ERKBH'; },
    draft => { draft.selections[0]!.flag_id = 'invented'; },
    draft => { draft.selections[0]!.flag_id = 'E-ILD'; },
    draft => { draft.selections[0]!.source_ids = ['invented']; },
    draft => { draft.selections[0]!.source_ids = ['UK-ENHERTU-SMPC-4.4-ILD']; },
    draft => { draft.selections[0]!.source_ids = ['ADCDB-DRG0CYMEB']; },
    draft => { draft.selections[0]!.source_ids = ['UK-KADCYLA-SMPC-4.4-CARDIAC']; },
    draft => { draft.selections[0]!.source_ids.push(draft.selections[0]!.source_ids[0]!); },
    draft => { draft.selections.push(draft.selections[0]!); },
    draft => { draft.selections[0]!.source_ids = []; }
  ];
  for (const mutate of mutations) {
    const draft = deterministicDraft(input); mutate(draft);
    const audit = auditSelection(input, draft);
    assert.equal(audit.valid_selection, false);
    assert.equal(audit.flags.length, 0);
    assert.deepEqual(audit.omitted_checks, requiredChecks(input));
    assert.ok(audit.reasons.some(reason => reason.includes('rejected')));
  }
});

test('free model prose, oversize selection, malformed inputs and irrelevant conditional flags are rejected', () => {
  const input = requestFixture();
  for (const value of [null, {}, 'free prose', { ...deterministicDraft(input), answer: 'untrusted assertion' }, { product_id: input.product_id, selections: Array(25).fill({ flag_id: 'K-CARDIAC', source_ids: ['UK-KADCYLA-SMPC-4.4-CARDIAC'] }) }]) assert.equal(auditSelection(input, value).valid_selection, false);
  const draft = deterministicDraft(input);
  draft.selections.push({ flag_id: 'K-CYP3A4', source_ids: ['UK-KADCYLA-SMPC-4.5'] });
  assert.equal(auditSelection(input, draft).valid_selection, false);
  assert.throws(() => requiredChecks({ ...input, synthetic_confirmed: false } as unknown as typeof input));
});

test('normal and every coarse impairment category remain coverage inputs, not label categories', () => {
  for (const product_id of PRODUCT_IDS) {
    for (const category of ['unknown', 'normal', 'mild', 'moderate', 'severe'] as const) {
      const input = requestFixture({ product_id }); input.patient.renal = category; input.patient.hepatic = category;
      const ids = requiredChecks(input).map(flag => flag.id);
      const prefix = product_id === 'DRG0CYMEB' ? 'K' : 'E';
      assert.equal(ids.includes(`${prefix}-RENAL`), category !== 'normal');
      assert.equal(ids.includes(`${prefix}-HEPATIC`), category !== 'normal');
      assert.deepEqual(auditSelection(input, deterministicDraft(input)).omitted_checks, []);
    }
  }
});
