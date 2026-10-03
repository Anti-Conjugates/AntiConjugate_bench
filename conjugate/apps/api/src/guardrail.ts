import { RunRequestSchema, type Patient, type ReviewFlag, type RunRequest } from '@her2/shared';
import { isProductId, productSources, trustedFlag, type ProductId } from './evidence.js';
import { medicationContext } from './medications.js';
import { SelectionSchema } from './selection.js';

// Independent conservative coverage rules: this module never calls the draft
// generator or accepts its expected-check list. Shared templates are evidence,
// not the coverage decision. These are software checks, not clinical approval.
export function requiredChecks(input: RunRequest): ReviewFlag[] {
  const request = RunRequestSchema.parse(input);
  if (!isProductId(request.product_id)) throw new Error('Unsupported product');
  const p = request.patient;
  const context = medicationContext(p.medications);
  const required = new Set<string>();
  if (request.product_id === 'DRG0CYMEB') {
    for (const id of ['K-LIVER-NRH', 'K-PLATELETS-BLEEDING', 'K-CARDIAC', 'K-PULMONARY', 'K-NEUROPATHY', 'K-MEDICATION-REVIEW']) required.add(id);
    if (p.renal === 'unknown' || p.renal === 'mild' || p.renal === 'moderate' || p.renal === 'severe') required.add('K-RENAL');
    if (p.hepatic === 'unknown' || p.hepatic === 'mild' || p.hepatic === 'moderate' || p.hepatic === 'severe') required.add('K-HEPATIC');
    if (p.age === null || p.age >= 75) required.add('K-ELDERLY');
    if (context.has_cyp3a4_example) required.add('K-CYP3A4');
    if (context.has_antithrombotic_example) required.add('K-ANTITHROMBOTIC');
  } else {
    for (const id of ['E-ILD', 'E-CBC-NEUTROPENIA', 'E-CARDIAC', 'E-LIVER-PLATELETS', 'E-MEDICATION-REVIEW']) required.add(id);
    if (p.renal !== 'normal') required.add('E-RENAL');
    if (p.hepatic !== 'normal') required.add('E-HEPATIC');
    if (p.age === null || p.age >= 75) required.add('E-ELDERLY');
    if (context.has_studied_enhertu_inhibitor) required.add('E-INHIBITOR-STUDY');
    if (context.has_antithrombotic_example) required.add('E-ANTITHROMBOTIC-CONTEXT');
    if (p.neuropathy === true) required.add('E-NEUROPATHY-CONTEXT');
  }
  const productId: ProductId = request.product_id;
  return [...required].map(id => {
    const template = trustedFlag(productId, id);
    if (!template) throw new Error('Missing guardrail template');
    // Context is from trusted fixed strings, never patient medicine prose.
    const fields = [
      'Independently required by conservative software coverage; not clinical validation.',
      id.endsWith('-RENAL') ? 'Coarse renal input does not establish the label impairment category.' : '',
      id.endsWith('-HEPATIC') ? 'Coarse hepatic input does not establish the label impairment category.' : '',
      id.endsWith('-ELDERLY') && p.age === null ? 'Age was not supplied; evidence context is unresolved.' : '',
      id.includes('MEDICATION') ? 'Review remains incomplete for all medicines, including recognized aliases.' : ''
    ].filter(Boolean);
    return { ...template, context: `${template.context} ${fields.join(' ')}` };
  });
}

function collectUnknowns(p: Patient): string[] {
  const meds = medicationContext(p.medications);
  const unknowns = [
    'Indication, cancer setting and jurisdiction suitability are not assessed.',
    'HER2 status/subgroup and testing details are unknown; HER2 targeting does not establish eligibility.',
    'Treatment history, prior therapies and relevant study population are unknown.',
    'Medicine-by-medicine interaction, toxicity-overlap, supplements and full medication reconciliation remain incomplete even for recognized aliases or a marked-complete list.',
    `Renal label category is unresolved regardless of the coarse supplied renal field (${p.renal}); label-specific creatinine clearance and clinical context are not established.`,
    `Hepatic label category is unresolved regardless of the coarse supplied hepatic field (${p.hepatic}); Child–Pugh or bilirubin/AST evidence categories are not established and must not be interchanged.`,
    'Laboratory units, dates, trends, symptoms, frailty and full organ/cardiac/pulmonary history are not established. Supplied values are not interpreted as prescribing thresholds.',
    'This limited source review and checklist do not establish complete clinical information or eligibility.'
  ];
  const missing: [boolean, string][] = [
    [p.age === null, 'Age is missing; older-adult evidence context remains unresolved.'],
    [p.renal === 'unknown', 'Renal input is unknown.'],
    [p.hepatic === 'unknown', 'Hepatic input is unknown.'],
    [p.lung_history === null, 'Lung-history input is missing.'],
    [p.neuropathy === null, 'Neuropathy-history input is missing.'],
    [p.platelets === null, 'Platelet input is missing.'],
    [p.lvef === null, 'LVEF input is missing.'],
    [p.neutrophils === null, 'Neutrophil input is missing.'],
    [!p.medication_list_complete, 'Medication list is marked incomplete.'],
    [p.medications.length === 0, 'No medicines supplied; absence of interacting medicines has not been established.'],
    [meds.unknown_count > 0, 'One or more medicine entries are outside the small whole-alias allowlist; their interaction review remains unknown.'],
    [meds.known_count > 0, 'Recognized medicine aliases provide limited context only, not a completed interaction review.']
  ];
  return [...unknowns, ...missing.filter(([condition]) => condition).map(([, text]) => text)];
}

export interface GuardrailAudit {
  valid_selection: boolean;
  unknowns: string[];
  flags: ReviewFlag[];
  omitted_checks: ReviewFlag[];
  reasons: string[];
}
export function auditSelection(input: RunRequest, untrustedDraft: unknown): GuardrailAudit {
  const request = RunRequestSchema.parse(input);
  const expected = requiredChecks(request);
  const unknowns = collectUnknowns(request.patient);
  const reasons = [
    'Clinical release blocked: pharmacist approval has not occurred; all material remains an unapproved research draft.',
    'Eligibility and treatment selection are not assessed. Medication and indication/HER2/history scopes remain unresolved.',
    'Conservative software coverage is not a complete label review or clinical validation.',
    'Independent input audit found unresolved scopes; missing/unknown patient fields and coarse organ-category uncertainty are listed in unknowns.'
  ];
  const parsed = SelectionSchema.safeParse(untrustedDraft);
  if (!parsed.success || parsed.data.product_id !== request.product_id || !isProductId(request.product_id)) {
    return { valid_selection: false, unknowns, flags: [], omitted_checks: expected, reasons: [...reasons, 'Selection rejected: invalid schema or exact product identity mismatch. All expected checks remain unestablished.'] };
  }
  const sourceAllowlist = new Set(productSources(request.product_id).map(s => s.id));
  const expectedById = new Map(expected.map(flag => [flag.id, flag]));
  const seen = new Set<string>();
  const selected: ReviewFlag[] = [];
  for (const selection of parsed.data.selections) {
    const template = expectedById.get(selection.flag_id);
    const sourceSet = new Set(selection.source_ids);
    if (!template || seen.has(selection.flag_id) || sourceSet.size !== selection.source_ids.length ||
        selection.source_ids.some(id => !sourceAllowlist.has(id)) ||
        sourceSet.size !== template.source_ids.length || template.source_ids.some(id => !sourceSet.has(id))) {
      return { valid_selection: false, unknowns, flags: [], omitted_checks: expected, reasons: [...reasons, 'Selection rejected: unknown, duplicate, irrelevant or cross-product flag/citation, or flag/source pair not entailed by the trusted template. All expected checks remain unestablished.'] };
    }
    seen.add(template.id);
    selected.push(template);
  }
  const omitted = expected.filter(flag => !seen.has(flag.id));
  if (omitted.length > 0) reasons.push('Independent guardrail detected omitted required checks. Omitted checks are shown separately and were not silently added to the draft selection.');
  return { valid_selection: true, unknowns, flags: selected, omitted_checks: omitted, reasons };
}
