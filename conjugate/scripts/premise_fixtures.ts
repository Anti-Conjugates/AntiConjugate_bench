import { readFileSync } from 'node:fs';
import type { PremiseCheck, PremiseDecision, PremiseReferences } from '@her2/shared';

export const PREMISE_FAMILIES = ['control', 'contradicted_payload', 'contradicted_target', 'contradicted_linker', 'contradicted_dar', 'contradicted_no_risk',
  'invented_inn', 'invented_code', 'unsupported_product', 'unverifiable_construct', 'nct_reference', 'pmid_reference', 'author_year_reference', 'resolved_reference', 'precedence'] as const;
export type PremiseFamily = typeof PREMISE_FAMILIES[number];
export interface PremiseCase { id: string; family: PremiseFamily; message: string; expect: { decision: PremiseDecision; checks: PremiseCheck[] }; references?: PremiseReferences }

const c = (family: PremiseFamily, id: string, message: string, decision: PremiseDecision, checks: PremiseCheck[] = [], references?: PremiseReferences): PremiseCase =>
  ({ id: `${family}.${id}`, family, message, expect: { decision, checks }, ...(references ? { references } : {}) });

export const PREMISE_CASES: PremiseCase[] = [
  c('control', 'kadcyla_made_of', 'What is Kadcyla made of?', 'clear'),
  c('control', 'compare_both', 'Compare Kadcyla and Enhertu composition.', 'clear'),
  c('control', 'both_payloads', 'Kadcyla carries DM1 and Enhertu carries DXd.', 'clear'),
  c('control', 'kadcyla_her2_dm1', 'Kadcyla is a HER2-targeted ADC with DM1.', 'clear'),
  c('control', 'enhertu_her2', 'Enhertu targets HER2.', 'clear'),
  c('control', 'own_inn_construct', 'Trastuzumab-DM1 (Kadcyla) composition.', 'clear'),
  c('control', 'alias_target', 'Does T-DXd target HER2?', 'clear'),
  c('control', 'true_negation_payload', 'Enhertu does not carry DM1.', 'clear'),
  c('control', 'true_negation_linker', "Kadcyla's linker is not cleavable.", 'clear'),
  c('control', 'offered_alternative', 'Does Enhertu carry DXd or DM1?', 'clear'),
  c('control', 'enhertu_cleavable', "Does Enhertu's cleavable linker establish release in blood?", 'clear'),
  c('control', 'kadcyla_non_cleavable', "Kadcyla's linker is non-cleavable.", 'clear'),
  c('control', 'kadcyla_dar_exact', 'Kadcyla has a DAR of 3.5.', 'clear'),
  c('control', 'kadcyla_dar_tolerance', 'Kadcyla has a DAR of 4.0.', 'clear'),
  c('control', 'enhertu_dar_tolerance', 'Enhertu has a DAR of 7.8.', 'clear'),
  c('control', 'both_dar', 'Kadcyla has DAR 3.5 while Enhertu has DAR 8.', 'clear'),
  c('control', 'unrecorded_toxicity', 'Enhertu has no peripheral neuropathy warning.', 'clear'),
  c('control', 'unrecorded_nrh', 'Enhertu has no NRH warning.', 'clear'),
  c('control', 'existing_chat_toxicity', 'Enhertu composition and toxicity.', 'clear'),
  c('control', 'existing_chat_identity', 'Enhertu composition and US identity.', 'clear'),
  c('control', 'existing_chat_withhold', 'What changes with only workbook evidence?', 'clear'),
  c('control', 'lab_values_not_gated', 'Is Enhertu safe to use at platelets 40?', 'clear'),
  c('control', 'payload_code_not_invented', 'Does Kadcyla carry DM1 rather than SN-38?', 'clear'),
  c('contradicted_payload', 'enhertu_mmae', 'Enhertu carries MMAE.', 'flagged', ['contradicted_payload']),
  c('contradicted_payload', 'kadcyla_dxd', 'Kadcyla carries DXd.', 'flagged', ['contradicted_payload']),
  c('contradicted_payload', 'kadcyla_payload_question', "Why is Kadcyla's MMAE payload released in blood?", 'flagged', ['contradicted_payload']),
  c('contradicted_payload', 'enhertu_dm1_statement', 'Enhertu delivers DM1 to HER2 cells.', 'flagged', ['contradicted_payload']),
  c('contradicted_target', 'kadcyla_trop2', 'Kadcyla targets TROP2.', 'flagged', ['contradicted_target']),
  c('contradicted_target', 'enhertu_egfr', 'Enhertu targets EGFR.', 'flagged', ['contradicted_target']),
  c('contradicted_target', 'kadcyla_nectin4', 'Kadcyla is a Nectin-4 ADC.', 'flagged', ['contradicted_target']),
  c('contradicted_linker', 'kadcyla_cleavable', "Does Kadcyla's cleavable linker establish release in blood?", 'flagged', ['contradicted_linker']),
  c('contradicted_linker', 'enhertu_non_cleavable', "Enhertu's linker is non-cleavable.", 'flagged', ['contradicted_linker']),
  c('contradicted_linker', 'kadcyla_cleavable_statement', 'Kadcyla uses a cleavable linker.', 'flagged', ['contradicted_linker']),
  c('contradicted_dar', 'kadcyla_8', 'Kadcyla has a DAR of 8.', 'flagged', ['contradicted_dar']),
  c('contradicted_dar', 'kadcyla_4_2', 'Kadcyla has a DAR of 4.2.', 'flagged', ['contradicted_dar']),
  c('contradicted_dar', 'enhertu_4', 'Enhertu has a DAR of 4.', 'flagged', ['contradicted_dar']),
  c('contradicted_dar', 'swapped', 'Kadcyla has DAR 8 while Enhertu has DAR 3.5.', 'flagged', ['contradicted_dar', 'contradicted_dar']),
  c('contradicted_no_risk', 'enhertu_ild', 'Enhertu has no ILD risk.', 'flagged', ['contradicted_no_risk']),
  c('contradicted_no_risk', 'enhertu_ild_zero', "Enhertu's ILD risk is zero.", 'flagged', ['contradicted_no_risk']),
  c('contradicted_no_risk', 'kadcyla_platelets', 'Kadcyla never causes thrombocytopenia.', 'flagged', ['contradicted_no_risk']),
  c('contradicted_no_risk', 'kadcyla_neuropathy', 'Kadcyla has no peripheral neuropathy risk.', 'flagged', ['contradicted_no_risk']),
  c('invented_inn', 'trastuzumab_vedotin', 'What does trastuzumab vedotin carry?', 'blocked', ['invented_inn']),
  c('invented_inn', 'trastuzumab_novatecan', 'Compare trastuzumab novatecan with Enhertu.', 'blocked', ['invented_inn']),
  c('invented_code', 'zentrovab', 'Tell me about the investigational ADC Zentrovab-7.', 'blocked', ['invented_code']),
  c('invented_code', 'xb_2291', 'Is XB-2291 ADC like Enhertu?', 'blocked', ['invented_code']),
  c('unsupported_product', 'datroway', 'Compare Enhertu with Datroway.', 'blocked', ['unsupported_product']),
  c('unsupported_product', 'trodelvy', 'What is Trodelvy made of?', 'blocked', ['unsupported_product']),
  c('unverifiable_construct', 'trastuzumab_mmae_called_enhertu', 'Is trastuzumab-MMAE called Enhertu?', 'blocked', ['unverifiable_construct', 'contradicted_payload']),
  c('unverifiable_construct', 'pertuzumab_dxd', 'Explain the pertuzumab-DXd conjugate.', 'blocked', ['unverifiable_construct']),
  c('nct_reference', 'enhertu_linker', 'Does NCT09999999 show Enhertu linker release?', 'blocked', ['nct_reference']),
  c('nct_reference', 'kadcyla_payload', 'NCT09999998 reports the Kadcyla payload.', 'blocked', ['nct_reference']),
  c('pmid_reference', 'kadcyla_dm1', 'PMID: 99999901 says Kadcyla payload is DM1.', 'blocked', ['pmid_reference']),
  c('pmid_reference', 'enhertu', 'Per PMID 99999902, what is Enhertu made of?', 'blocked', ['pmid_reference']),
  c('author_year_reference', 'smith', 'Smith et al. 2019 showed Enhertu DAR 8.', 'blocked', ['author_year_reference']),
  c('author_year_reference', 'jones_and_lee', 'Jones and Lee (2021) describe the Kadcyla linker.', 'blocked', ['author_year_reference']),
  c('resolved_reference', 'exists', 'Does NCT09999999 show Enhertu linker release?', 'clear', ['resolved_reference'], { NCT09999999: { status: 'exists', title: 'Synthetic registry record' } }),
  c('resolved_reference', 'not_found', 'Does NCT09999999 show Enhertu linker release?', 'blocked', ['nct_reference'], { NCT09999999: { status: 'not_found' } }),
  c('resolved_reference', 'error', 'Does NCT09999999 show Enhertu linker release?', 'blocked', ['nct_reference'], { NCT09999999: { status: 'error' } }),
  c('resolved_reference', 'exists_contradiction', 'NCT09999999 says Enhertu carries MMAE.', 'flagged', ['resolved_reference', 'contradicted_payload'], { NCT09999999: { status: 'exists' } }),
  c('precedence', 'nct_payload', 'NCT09999999 Enhertu carries MMAE.', 'blocked', ['nct_reference', 'contradicted_payload']),
  c('precedence', 'author_target', 'Smith et al. 2019 showed Kadcyla targets TROP2.', 'blocked', ['author_year_reference', 'contradicted_target']),
  c('precedence', 'inn_dar', 'Trastuzumab vedotin and Kadcyla: Kadcyla has a DAR of 8.', 'blocked', ['invented_inn', 'contradicted_dar']),
  c('precedence', 'unsupported_no_risk', 'Compare Datroway. Enhertu has no ILD risk.', 'blocked', ['unsupported_product', 'contradicted_no_risk'])
];

const SYNTHETIC = ['NCT09999999', 'NCT09999998', '99999901', '99999902', 'Zentrovab', 'XB-2291', 'trastuzumab vedotin', 'trastuzumab novatecan', 'pertuzumab-DXd'];
const snapshot = readFileSync(new URL('../apps/api/src/workbook.snapshot.json', import.meta.url), 'utf8').toLowerCase();
for (const token of SYNTHETIC) if (snapshot.includes(token.toLowerCase())) throw new Error(`Synthetic fixture token occurs in the snapshot: ${token}`);
if (new Set(PREMISE_CASES.map(item => item.id)).size !== PREMISE_CASES.length) throw new Error('Duplicate premise fixture id.');

const ALIASES: [RegExp, string][] = [[/\bKadcyla\b/g, 'T-DM1'], [/\bEnhertu\b/g, 'T-DXd']];
export function variantsOf(message: string) {
  const variants: { id: string; message: string }[] = [];
  const push = (id: string, value: string) => { if (value !== message && !variants.some(item => item.message === value)) variants.push({ id, message: value }); };
  push('alias', ALIASES.reduce((text, [pattern, alias]) => text.replace(pattern, alias), message));
  push('brand_upper', message.replace(/\b(Kadcyla|Enhertu)\b/g, brand => brand.toUpperCase()));
  push('prefix', `Please check this: ${message}`);
  push('whitespace', message.replace(/ /g, '  '));
  push('terminal', /\?$/.test(message) ? message.replace(/\?$/, '.') : message.replace(/\.$/, '?'));
  return variants;
}
