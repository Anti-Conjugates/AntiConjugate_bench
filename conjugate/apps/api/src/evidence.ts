import { CatalogSchema, FlagSchema, ProductSchema, SourceSchema, type Catalog, type Product, type ReviewFlag, type Source } from '@her2/shared';

export const PRODUCT_IDS = ['DRG0CYMEB', 'DRG0ERKBH'] as const;
export type ProductId = typeof PRODUCT_IDS[number];
export const CLAUDE_MODEL = 'claude-opus-5-5';
export const DRAFT_NOTICE = 'Unapproved research draft pending pharmacist review. Synthetic inputs only. Not clinical advice, prescribing guidance, treatment selection, or an eligibility assessment.';

const labelInfo = {
  DRG0CYMEB: { prefix: 'UK-KADCYLA-SMPC', brand: 'Kadcyla', url: 'https://www.medicines.org.uk/emc/product/5252/smpc', revision: '2026-09-23' },
  DRG0ERKBH: { prefix: 'UK-ENHERTU-SMPC', brand: 'Enhertu', url: 'https://www.medicines.org.uk/emc/product/12135/smpc', revision: '2026-07-27' }
} as const;

function source(product: ProductId, suffix: string, section: string, summary: string): Source {
  const label = labelInfo[product];
  return SourceSchema.parse({
    id: `${label.prefix}${suffix ? `-${suffix}` : ''}`,
    title: `${label.brand} UK SmPC — ${section}`,
    url: `${label.url}${section.startsWith('4.8') ? '#UNDESIRABLE_EFFECTS' : section.startsWith('4.5') ? '#INTERACTIONS' : section.startsWith('4.4') ? '#CLINICAL_PRECAUTIONS' : section.startsWith('4.2') ? '#POSOLOGY' : '#PHARMACOLOGICAL_PROPS'}`,
    jurisdiction: 'UK', revision_date: label.revision, section,
    excerpt: `Paraphrase (not a quotation), draft pending pharmacist approval: ${summary}`,
    review_status: 'draft_pending_pharmacist'
  });
}

const sources: Source[] = [
  source('DRG0CYMEB', '', '2; 5.1', 'Trastuzumab is linked to the maytansine-derived microtubule inhibitor DM1 through stable, non-cleavable thioether MCC; mean DAR is 3.5. A mean is not a fixed count on each molecule. No individual release rate or affinity window is established.'),
  source('DRG0CYMEB', '4.4-LIVER', '4.4 Hepatotoxicity; 4.8', 'Transaminase elevations, serious liver injury including fatal outcomes, and nodular regenerative hyperplasia are reported. Liver-function monitoring is specified before treatment and each administration. NRH may cause non-cirrhotic portal hypertension despite normal transaminases.'),
  source('DRG0CYMEB', '4.4-PLATELETS', '4.4 Thrombocytopenia and Haemorrhage; 4.8', 'Thrombocytopenia and haemorrhage, including fatal events, are reported. Platelet monitoring is specified. Bleeding occurred with and without additional known risk factors; anticoagulant and antiplatelet use warrants additional review.'),
  source('DRG0CYMEB', '4.4-CARDIAC', '4.4 Left ventricular dysfunction; 4.8', 'Left ventricular dysfunction and potential symptomatic heart failure are warnings. Baseline and regular cardiac-function testing are specified. Trial exclusions limit extrapolation to significant cardiac histories.'),
  source('DRG0CYMEB', '4.4-PULMONARY', '4.4 Pulmonary toxicity; 4.8', 'ILD and pneumonitis have occurred, including acute respiratory distress syndrome and fatal outcomes. These are not exclusive to DXd products; radiation pneumonitis has distinct label wording.'),
  source('DRG0CYMEB', '4.4-NEUROPATHY', '4.4 Neurotoxicity; 4.8', 'Peripheral neuropathy is reported and ongoing clinical monitoring is specified. Different study populations used different baseline neuropathy exclusions; this summary is not a grading or management algorithm.'),
  source('DRG0CYMEB', '4.2-RENAL', '4.2 Renal impairment; 5.2', 'No formal renal-impairment PK study was performed. Mild and moderate impairment were assessed in population PK; severe impairment had only one contributing patient and conclusions are insufficient. Label creatinine-clearance categories must not be replaced by unexamined eGFR categories.'),
  source('DRG0CYMEB', '4.2-HEPATIC', '4.2 Hepatic impairment; 4.4; 5.2', 'A small study examined normal function and Child–Pugh A and B; Child–Pugh C was not studied. Laboratory exclusions and Child–Pugh categories are different evidence limits. PK observations do not remove the hepatotoxicity warning.'),
  source('DRG0CYMEB', '4.2-ELDERLY', '4.2 Elderly patients; 5.2', 'Safety and efficacy evidence at age 75 and above is insufficient. Age-related population PK findings do not establish equivalent tolerability in frailty or polypharmacy.'),
  source('DRG0CYMEB', '4.5', '4.5; 5.2', 'There were no formal interaction studies. DM1 is mainly metabolised by CYP3A4 and less by CYP3A5 in vitro. The label has a strong-CYP3A4-inhibitor precaution, with examples clarithromycin, itraconazole and ritonavir; this is not a measured effect size or a complete interaction database.'),
  source('DRG0ERKBH', '', '2; 5.1', 'Humanised anti-HER2 IgG1 with the amino-acid sequence of trastuzumab is linked to the exatecan-derived topoisomerase-I inhibitor DXd through a cleavable tetrapeptide-based linker; approximate DAR is 8. The label describes plasma stability and intracellular lysosomal cleavage, not an individual release rate.'),
  source('DRG0ERKBH', '4.4-ILD', '4.4 Interstitial lung disease/pneumonitis; 4.8', 'ILD and pneumonitis including fatalities are reported, with respiratory monitoring and prompt investigation specified. Prior ILD and moderate or severe renal impairment are potential increased-risk contexts. Management algorithms are not reproduced here.'),
  source('DRG0ERKBH', '4.4-CBC', '4.4 Neutropenia; 4.8', 'Neutropenia, including fatal febrile neutropenia, has a dedicated warning. Complete blood counts are specified before treatment, each administration and as indicated.'),
  source('DRG0ERKBH', '4.4-CARDIAC', '4.4 Left ventricular dysfunction; 4.8', 'LVEF decrease is reported; baseline and regular LVEF assessment as clinically indicated is specified. Evidence does not establish safety for pre-existing low LVEF; do not copy another product’s monitoring schedule.'),
  source('DRG0ERKBH', '4.8-LIVER-PLATELETS', '4.8; 4.4 Neutropenia', 'Transaminase increases and thrombocytopenia are reported. No Kadcyla-equivalent NRH or anticoagulant/antiplatelet haemorrhage warning was identified in the reviewed section 4.4; this bounded finding is not evidence that those co-medications are safe.'),
  source('DRG0ERKBH', '4.2-RENAL', '4.2 Renal impairment; 4.4; 5.2', 'There is no dedicated renal-impairment study. Severe impairment was excluded and severe/end-stage conclusions are undetermined. Moderate impairment was associated with more low-grade ILD/pneumonitis and discontinuation, despite unchanged released-DXd PK in mild/moderate impairment; causality is not established.'),
  source('DRG0ERKBH', '4.2-HEPATIC', '4.2 Hepatic impairment; 4.4; 5.2', 'There is no dedicated hepatic-impairment study. Bilirubin-defined population PK information is limited or absent in more impaired groups, irrespective of AST. These are not Kadcyla Child–Pugh categories. Human DXd excretion was not studied.'),
  source('DRG0ERKBH', '4.2-ELDERLY', '4.2 Elderly; 5.2', 'Evidence at age 75 and above is limited. Lack of a clinically meaningful age-PK effect does not establish safety for frailty or complex polypharmacy.'),
  source('DRG0ERKBH', '4.5', '4.5; 5.2', 'Studied co-administration with ritonavir or itraconazole produced no clinically meaningful exposure increase. This differs from Kadcyla’s precaution and does not establish absence of all interactions or safety of every co-medication, inducer, organ-function combination or toxicity overlap.'),
  source('DRG0ERKBH', '4.8-NEUROPATHY', '4.4; 4.8', 'No named peripheral-neuropathy warning or neuropathy adverse-reaction term was identified in the reviewed sections. This bounded label-text observation is not proof that neuropathy cannot occur and does not resolve existing symptoms or another medicine’s toxicity.')
];

const products: Product[] = [
  ProductSchema.parse({ id: 'DRG0CYMEB', brand: 'Kadcyla', name: 'trastuzumab emtansine', short_name: 'T-DM1', antibody: 'trastuzumab', target: 'HER2', payload: 'DM1', linker: 'Non-cleavable thioether MCC', dar: 3.5, adcdb_url: 'https://adcdb.idrblab.net/data/adc/details/DRG0CYMEB', source_ids: sources.filter(s => s.id.startsWith('UK-KADCYLA-SMPC')).map(s => s.id), description: 'Draft structural paraphrase: mean DAR 3.5, not a fixed per-molecule count. ADCdb is a structural reference, not clinical evidence or an affinity/risk model.' }),
  ProductSchema.parse({ id: 'DRG0ERKBH', brand: 'Enhertu', name: 'trastuzumab deruxtecan', short_name: 'T-DXd', antibody: 'Humanised anti-HER2 IgG1 (trastuzumab amino-acid sequence)', target: 'HER2', payload: 'DXd', linker: 'Cleavable tetrapeptide-based linker', dar: 8, adcdb_url: 'https://adcdb.idrblab.net/data/adc/details/DRG0ERKBH', source_ids: sources.filter(s => s.id.startsWith('UK-ENHERTU-SMPC')).map(s => s.id), description: 'Draft structural paraphrase: approximate DAR 8. Cleavable does not mean blood-unstable. ADCdb is a structural reference, not clinical evidence or an affinity/risk model.' })
];

function flag(product: ProductId, id: string, title: string, suffix: string, description: string, basis: ReviewFlag['basis'] = 'label', severity: ReviewFlag['severity'] = 'review'): ReviewFlag {
  return FlagSchema.parse({ id, title, description: `Draft ${basis === 'inference' ? 'software review inference grounded in a label paraphrase' : 'label paraphrase'} (not a quotation): ${description}`, severity, basis, source_ids: [`${labelInfo[product].prefix}-${suffix}`], context: 'Product-specific research checklist only; pharmacist review is required. No individual risk, eligibility, grade or prescribing action is inferred.' });
}
const flags: Record<ProductId, ReviewFlag[]> = {
  DRG0CYMEB: [
    flag('DRG0CYMEB', 'K-LIVER-NRH', 'Liver and NRH review', '4.4-LIVER', 'Review liver monitoring and NRH evidence. Normal transaminases alone do not exclude NRH.', 'label', 'priority'),
    flag('DRG0CYMEB', 'K-PLATELETS-BLEEDING', 'Platelet and bleeding review', '4.4-PLATELETS', 'Review platelet monitoring and bleeding history/context; bleeding is not restricted to known thrombocytopenia.', 'label', 'priority'),
    flag('DRG0CYMEB', 'K-CARDIAC', 'Cardiac-function review', '4.4-CARDIAC', 'Baseline and regular cardiac-function review remain required regardless of the supplied LVEF.'),
    flag('DRG0CYMEB', 'K-PULMONARY', 'Pulmonary / ILD review', '4.4-PULMONARY', 'Pulmonary toxicity including ILD and pneumonitis remains a baseline review scope.', 'label', 'priority'),
    flag('DRG0CYMEB', 'K-NEUROPATHY', 'Peripheral neuropathy review', '4.4-NEUROPATHY', 'Neuropathy monitoring and pre-existing symptom review remain a baseline scope.'),
    flag('DRG0CYMEB', 'K-MEDICATION-REVIEW', 'Incomplete medication interaction review', '4.5', 'No formal interaction studies; a small alias allowlist is not a comprehensive medication review.', 'inference'),
    flag('DRG0CYMEB', 'K-RENAL', 'Renal evidence limitations', '4.2-RENAL', 'Severe-impairment PK evidence is insufficient. A coarse renal field cannot establish a label creatinine-clearance category.'),
    flag('DRG0CYMEB', 'K-HEPATIC', 'Hepatic evidence limitations', '4.2-HEPATIC', 'Coarse hepatic categories do not establish Child–Pugh class or the label’s laboratory evidence categories.'),
    flag('DRG0CYMEB', 'K-ELDERLY', 'Older-adult evidence limitations', '4.2-ELDERLY', 'Evidence in older adults is limited; neither age nor PK findings establish tolerability or eligibility.'),
    flag('DRG0CYMEB', 'K-CYP3A4', 'CYP3A4 inhibitor context', '4.5', 'A matched limited example falls within the product’s strong-CYP3A4-inhibitor precaution. This is context for pharmacist review, not a prescribing instruction.', 'label', 'priority'),
    flag('DRG0CYMEB', 'K-ANTITHROMBOTIC', 'Anticoagulant / antiplatelet context', '4.4-PLATELETS', 'The product specifically cautions about anticoagulants and antiplatelets; matched examples require pharmacist assessment.', 'label', 'priority')
  ],
  DRG0ERKBH: [
    flag('DRG0ERKBH', 'E-ILD', 'ILD / pneumonitis review', '4.4-ILD', 'ILD and pneumonitis including fatalities require a dedicated baseline review; no symptom triage or management algorithm is provided.', 'label', 'priority'),
    flag('DRG0ERKBH', 'E-CBC-NEUTROPENIA', 'CBC and neutropenia review', '4.4-CBC', 'Review CBC monitoring and neutropenia evidence regardless of supplied counts.', 'label', 'priority'),
    flag('DRG0ERKBH', 'E-CARDIAC', 'Cardiac-function review', '4.4-CARDIAC', 'Baseline and regular cardiac-function assessment is a product-specific review scope, not a safety conclusion.'),
    flag('DRG0ERKBH', 'E-LIVER-PLATELETS', 'Liver and platelet abnormality review', '4.8-LIVER-PLATELETS', 'Liver abnormalities and thrombocytopenia are reported; the ILD warning does not erase these other review scopes.'),
    flag('DRG0ERKBH', 'E-MEDICATION-REVIEW', 'Incomplete medication interaction review', '4.5', 'Named inhibitor studies do not constitute a full medicine-by-medicine interaction or toxicity-overlap review.', 'inference'),
    flag('DRG0ERKBH', 'E-RENAL', 'Renal and pulmonary evidence limitations', '4.2-RENAL', 'Renal impairment evidence and its reported ILD association require review. A coarse field cannot establish the label’s renal category.', 'label', 'priority'),
    flag('DRG0ERKBH', 'E-HEPATIC', 'Hepatic evidence limitations', '4.2-HEPATIC', 'Coarse hepatic categories cannot establish the product’s bilirubin/AST evidence categories; Child–Pugh categories from Kadcyla do not transfer.'),
    flag('DRG0ERKBH', 'E-ELDERLY', 'Older-adult evidence limitations', '4.2-ELDERLY', 'Older-adult evidence is limited and population PK does not resolve frailty or polypharmacy safety.'),
    flag('DRG0ERKBH', 'E-INHIBITOR-STUDY', 'Bounded inhibitor-study context', '4.5', 'A matched ritonavir or itraconazole example has studied exposure evidence. That bounded finding does not make the medicine or combination fully reviewed.'),
    flag('DRG0ERKBH', 'E-ANTITHROMBOTIC-CONTEXT', 'Bleeding overlap — unverified review inference', '4.8-LIVER-PLATELETS', 'Thrombocytopenia plus anticoagulant/antiplatelet context is a proposed pharmacodynamic review issue, NOT a verified Enhertu-specific interaction or the Kadcyla haemorrhage warning.', 'inference'),
    flag('DRG0ERKBH', 'E-NEUROPATHY-CONTEXT', 'Existing neuropathy — unresolved context', '4.8-NEUROPATHY', 'The bounded negative label-text finding does not resolve existing symptoms or other-medicine toxicity; additional review is a software inference.', 'inference')
  ]
};

export function isProductId(id: string): id is ProductId { return PRODUCT_IDS.some(known => known === id); }
export function getProduct(id: string): Product | undefined {
  const found = products.find(p => p.id === id);
  return found ? ProductSchema.parse(found) : undefined;
}
export function productSources(id: ProductId): Source[] {
  const allowed = new Set(getProduct(id)?.source_ids);
  return sources.filter(s => allowed.has(s.id)).map(s => SourceSchema.parse(s));
}
export function productFlags(id: ProductId): ReviewFlag[] { return flags[id].map(f => FlagSchema.parse(f)); }
export function trustedFlag(id: ProductId, flagId: string): ReviewFlag | undefined { return productFlags(id).find(f => f.id === flagId); }
export function buildCatalog(claudeConfigured: boolean): Catalog {
  return CatalogSchema.parse({ products, sources, default_engine: 'evidence', claude_configured: claudeConfigured, model: CLAUDE_MODEL,
    scope: 'Review of two already-selected HER2 ADC products against synthetic inputs using dated UK label paraphrases. No product selection, eligibility, dosing, comprehensive interaction database, acute triage, affinity window, calibrated confidence or clinical validation. ADCdb links are structural references only.', disclaimer: DRAFT_NOTICE });
}
