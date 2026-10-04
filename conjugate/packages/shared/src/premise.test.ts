import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chatIntent } from './chat-intent.js';
import { WorkbookDatasetSchema } from './research.js';
import { maskPremiseReferences, PREMISE_ATTRIBUTION, PREMISE_EVIDENCE_IDS, premiseDarRange, premiseFacts, premiseFactsSha256, premiseGate, premiseReportIsConsistent,
  premiseSha256Hex, PremiseReportSchema, type PremiseCheck, type PremiseReferences } from './premise.js';

const dataset = WorkbookDatasetSchema.parse(JSON.parse(readFileSync(new URL('../../../apps/api/src/workbook.snapshot.json', import.meta.url), 'utf8')));
const facts = premiseFacts(dataset);
const gate = (message: string, references?: PremiseReferences) => premiseGate(message, facts, references ? { references } : {});
const checks = (message: string, references?: PremiseReferences) => gate(message, references).findings.map(finding => finding.check);
const expectGate = (message: string, decision: 'blocked' | 'flagged' | 'clear', expected: PremiseCheck[] = []) => {
  const report = gate(message);
  assert.equal(report.decision, decision, message); assert.deepEqual(report.findings.map(finding => finding.check).sort(), [...expected].sort(), message);
  assert.ok(premiseReportIsConsistent(report), message);
  return report;
};

test('true composition premises pass through the gate', () => {
  for (const message of ['What is Kadcyla made of?', 'Compare Kadcyla and Enhertu composition.', 'Kadcyla carries DM1 and Enhertu carries DXd.', 'Kadcyla is a HER2-targeted ADC with DM1.',
    'Trastuzumab-DM1 (Kadcyla) composition.', 'Does T-DXd target HER2?']) expectGate(message, 'clear');
});
test('true negations and offered alternatives are not contradictions', () => {
  for (const message of ['Enhertu does not carry DM1.', "Kadcyla's linker is not cleavable.", 'Does Enhertu carry DXd or DM1?']) expectGate(message, 'clear');
});
test('true linker cleavability passes for each product', () => {
  expectGate("Does Enhertu's cleavable linker establish release in blood?", 'clear');
  expectGate("Kadcyla's linker is non-cleavable.", 'clear');
});
test('a wrong payload is contradicted with the workbook composition cell', () => {
  const report = expectGate('Enhertu carries MMAE.', 'flagged', ['contradicted_payload']);
  const finding = report.findings[0]!;
  assert.equal(finding.kind, 'contradicted_premise'); assert.equal(finding.stated, 'MMAE'); assert.equal(finding.recorded, 'DXd'); assert.equal(finding.product_id, 'DRG0ERKBH');
  assert.ok(finding.evidence_ids.includes('WORKBOOK-DRG0ERKBH-COMPOSITION'));
});
test('a wrong target is contradicted', () => {
  expectGate('Kadcyla targets TROP2.', 'flagged', ['contradicted_target']);
  expectGate('Enhertu targets EGFR.', 'flagged', ['contradicted_target']);
});
test('a wrong linker cleavability is contradicted', () => {
  const report = expectGate("Does Kadcyla's cleavable linker establish release in blood?", 'flagged', ['contradicted_linker']);
  assert.match(report.findings[0]!.text, /non-cleavable/);
});
test('DAR is contradicted only outside the recorded range plus or minus 0.6', () => {
  expectGate('Kadcyla has a DAR of 8.', 'flagged', ['contradicted_dar']);
  expectGate('Kadcyla has a DAR of 4.2.', 'flagged', ['contradicted_dar']);
  expectGate('Kadcyla has a DAR of 4.0.', 'clear');
  expectGate('Enhertu has a DAR of 7.8.', 'clear');
  expectGate('Kadcyla has DAR 8 while Enhertu has DAR 3.5.', 'flagged', ['contradicted_dar', 'contradicted_dar']);
});
test('workbook DAR cells parse into ranges', () => {
  assert.deepEqual(premiseDarRange('3.5'), [3.5, 3.5]);
  assert.deepEqual(premiseDarRange('7.6~8'), [7.6, 8]);
  assert.deepEqual(premiseDarRange('5.3 to 6.4 (~6)'), [5.3, 6.4]);
  assert.equal(premiseDarRange('not reported'), null);
});
test('absolute no-toxicity claims are contradicted only by a held label paraphrase id', () => {
  const ild = expectGate('Enhertu has no ILD risk.', 'flagged', ['contradicted_no_risk']);
  assert.deepEqual(ild.findings[0]!.evidence_ids.filter(id => id.startsWith('UK-')), ['UK-ENHERTU-SMPC-4.4-ILD']);
  expectGate("Enhertu's ILD risk is zero.", 'flagged', ['contradicted_no_risk']);
  expectGate('Kadcyla never causes thrombocytopenia.', 'flagged', ['contradicted_no_risk']);
  expectGate('Enhertu has no peripheral neuropathy warning.', 'clear');
  expectGate('Enhertu has no NRH warning.', 'clear');
});
test('an invented INN is unverifiable', () => {
  const report = expectGate('What does trastuzumab vedotin carry?', 'blocked', ['invented_inn']);
  assert.equal(report.findings[0]!.kind, 'unverifiable_entity');
});
test('an invented ADC code name is unverifiable, but payload and product codes are not', () => {
  expectGate('Tell me about the investigational ADC Zentrovab-7.', 'blocked', ['invented_code']);
  expectGate('Is XB-2291 ADC like Enhertu?', 'blocked', ['invented_code']);
  assert.ok(!checks('Is Trodelvy an SN-38 ADC?').includes('invented_code'));
  assert.ok(!checks('Is T-DM1 an ADC?').includes('invented_code'));
});
test('every workbook ADC is in scope and contradicted only from its own workbook cells', () => {
  expectGate('Compare Enhertu with Datroway.', 'clear');
  const payload = expectGate('Trodelvy carries MMAE.', 'flagged', ['contradicted_payload']);
  assert.deepEqual(payload.findings[0]!.evidence_ids, ['WORKBOOK-DRG0EKTUN-COMPOSITION']);
  expectGate('Padcev targets HER2.', 'flagged', ['contradicted_target']);
  expectGate('Trodelvy has no toxicity risk.', 'clear');
});
test('a real snapshot ADC outside a narrower allowlist is unsupported, not invented', () => {
  const narrow = { ...facts, allowlisted: facts.allowlisted.filter(id => id === 'DRG0CYMEB' || id === 'DRG0ERKBH') };
  const report = premiseGate('Compare Enhertu with Datroway.', narrow);
  assert.equal(report.decision, 'blocked'); assert.equal(report.findings[0]!.kind, 'unsupported_product'); assert.match(report.findings[0]!.text, /Datroway/);
});
test('an antibody-payload pairing with no row is an unverifiable construct and outranks the contradiction', () => {
  const report = expectGate('Is trastuzumab-MMAE called Enhertu?', 'blocked', ['unverifiable_construct', 'contradicted_payload']);
  assert.equal(report.findings.find(finding => finding.check === 'unverifiable_construct')!.kind, 'unverifiable_construct');
});
test('NCT, PMID and author-year references are unverifiable without an external resolution', () => {
  expectGate('Does NCT09999999 show Enhertu linker release?', 'blocked', ['nct_reference']);
  expectGate('PMID: 99999901 says Kadcyla payload is DM1.', 'blocked', ['pmid_reference']);
  expectGate('Smith et al. 2019 showed Enhertu DAR 8.', 'blocked', ['author_year_reference']);
});
test('an externally resolved existing reference is informational only and stops blocking', () => {
  const report = gate('Does NCT09999999 show Enhertu linker release?', { NCT09999999: { status: 'exists', title: 'Synthetic registry title' } });
  assert.equal(report.decision, 'clear'); assert.deepEqual(report.findings.map(finding => finding.kind), ['resolved_reference']);
  assert.match(report.findings[0]!.text, /not evidence/); assert.deepEqual(report.findings[0]!.evidence_ids, []);
  assert.equal(gate('NCT09999999 says Enhertu carries MMAE.', { NCT09999999: { status: 'exists' } }).decision, 'flagged');
});
test('a reference resolved not_found stays unverifiable with stronger text; error stays unverifiable', () => {
  const missing = gate('Does NCT09999999 show Enhertu linker release?', { NCT09999999: { status: 'not_found' } });
  assert.equal(missing.decision, 'blocked'); assert.match(missing.findings[0]!.text, /registry returned no record/);
  const failed = gate('Does NCT09999999 show Enhertu linker release?', { NCT09999999: { status: 'error' } });
  assert.equal(failed.decision, 'blocked'); assert.equal(failed.findings[0]!.kind, 'unverifiable_reference'); assert.doesNotMatch(failed.findings[0]!.text, /returned no record/);
});
test('precedence: any unverifiable finding blocks even when contradictions are present', () => {
  expectGate('NCT09999999 Enhertu carries MMAE.', 'blocked', ['nct_reference', 'contradicted_payload']);
  expectGate('Smith et al. 2019 showed Kadcyla targets TROP2.', 'blocked', ['author_year_reference', 'contradicted_target']);
});
test('fails closed on internal error, invalid facts and oversized input', () => {
  for (const report of [premiseGate('Enhertu', { ...facts, rows: [] }), premiseGate('x'.repeat(4001), facts), premiseGate('Enhertu', facts, { references: { NCT1: { status: 'maybe' } } as unknown as PremiseReferences })]) {
    assert.equal(report.decision, 'blocked'); assert.equal(report.findings[0]!.kind, 'internal_error'); assert.ok(PremiseReportSchema.safeParse(report).success);
  }
});
test('reports are deterministic, hashed and cite only allowlisted ids', () => {
  const message = 'Kadcyla has a DAR of 8 and Enhertu has no ILD risk.';
  assert.deepEqual(gate(message), gate(message));
  assert.equal(gate(message).facts_sha256, premiseFactsSha256(facts));
  for (const input of ['', 'abc', 'Kadcyla — DM1 ✓', 'x'.repeat(200)]) assert.equal(premiseSha256Hex(input), createHash('sha256').update(input).digest('hex'));
  for (const finding of gate(message).findings) for (const id of finding.evidence_ids) assert.ok(PREMISE_EVIDENCE_IDS.includes(id));
  assert.equal(PremiseReportSchema.safeParse({ ...gate(message), findings: [{ ...gate(message).findings[0]!, evidence_ids: ['INVENTED-SOURCE'] }] }).success, false);
});
test('facts come from the workbook snapshot only', () => {
  const kadcyla = facts.rows.find(row => row.id === 'DRG0CYMEB')!; const enhertu = facts.rows.find(row => row.id === 'DRG0ERKBH')!;
  assert.equal(facts.rows.length, dataset.records.length); assert.equal(facts.dataset_sha256, dataset.sha256);
  assert.match(kadcyla.payload, /DM1/); assert.match(enhertu.payload, /DXd/); assert.match(kadcyla.target, /HER2/); assert.match(enhertu.target, /HER2/);
  assert.equal(facts.allowlisted.length, dataset.records.length);
});
test('patient lab values, doses and confidence wording are outside the gate and its text', () => {
  expectGate('Is Enhertu safe to use at platelets 40?', 'clear');
  const texts = ['Kadcyla has a DAR of 8.', 'Enhertu has no ILD risk.', 'What does trastuzumab vedotin carry?', 'Compare Enhertu with Datroway.', 'NCT09999999 Enhertu carries MMAE.']
    .flatMap(message => gate(message).findings.map(finding => finding.text)).join(' ');
  assert.doesNotMatch(texts, /\b(unsafe|contraindicated|dose|eligib|probability|confidence|%)/i);
});
test('case and alias variants agree', () => {
  assert.equal(gate('ENHERTU carries MMAE.').decision, 'flagged');
  assert.deepEqual(checks('T-DXd carries MMAE.'), checks('Enhertu carries MMAE.'));
  assert.deepEqual(checks('trastuzumab emtansine targets TROP2.'), checks('Kadcyla targets TROP2.'));
});
test('attribution records only the adapted idea', () => {
  assert.equal(PREMISE_ATTRIBUTION.commit, '5ac1c1a'); assert.match(PREMISE_ATTRIBUTION.repository, /adc-guardrail$/);
  assert.equal(PREMISE_ATTRIBUTION.scope, 'category names and approach adapted; no code, data, thresholds or benchmark results imported');
});
test('chat intent masks references before the digit guard and stops safety, lab and dose wording', () => {
  assert.equal(maskPremiseReferences('NCT09999999 and PMID: 1234567').includes('999'), false);
  const intent = (message: string) => chatIntent({ message, context: [], engine: 'evidence', synthetic_confirmed: true }).status;
  for (const message of ['Does NCT09999999 show Enhertu linker release?', 'PMID: 99999901 says Kadcyla payload is DM1.', 'Smith et al. 2019 showed Enhertu composition.']) assert.notEqual(intent(message), 'outside_scope', message);
  for (const message of ['Is Enhertu safe to use at platelets 40?', 'Enhertu linker with ANC low', 'Kadcyla composition when LVEF falls', 'Enhertu eGFR 25 linker', 'Kadcyla 3.6 mg/kg composition', 'Enhertu dose composition', 'Is Kadcyla unsafe?'])
    assert.equal(intent(message), 'outside_scope', message);
  assert.equal(intent('Enhertu reference 123456 composition'), 'outside_scope');
});
