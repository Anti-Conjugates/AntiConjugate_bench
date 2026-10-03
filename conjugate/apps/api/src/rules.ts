import { RunRequestSchema, type RunRequest } from '@her2/shared';
import { isProductId, trustedFlag } from './evidence.js';
import { medicationContext } from './medications.js';
import { SelectionSchema, type SelectionDraft } from './selection.js';

// Draft-stage rules. Guardrail coverage is deliberately derived separately.
export function deterministicDraft(input: RunRequest): SelectionDraft {
  const request = RunRequestSchema.parse(input);
  if (!isProductId(request.product_id)) throw new Error('Unsupported product');
  const p = request.patient;
  const meds = medicationContext(p.medications);
  const ids = request.product_id === 'DRG0CYMEB'
    ? ['K-LIVER-NRH', 'K-PLATELETS-BLEEDING', 'K-CARDIAC', 'K-PULMONARY', 'K-NEUROPATHY', 'K-MEDICATION-REVIEW']
    : ['E-ILD', 'E-CBC-NEUTROPENIA', 'E-CARDIAC', 'E-LIVER-PLATELETS', 'E-MEDICATION-REVIEW'];
  const prefix = request.product_id === 'DRG0CYMEB' ? 'K' : 'E';
  if (p.renal !== 'normal') ids.push(`${prefix}-RENAL`);
  if (p.hepatic !== 'normal') ids.push(`${prefix}-HEPATIC`);
  if (p.age === null || p.age >= 75) ids.push(`${prefix}-ELDERLY`);
  if (prefix === 'K') {
    if (meds.has_cyp3a4_example) ids.push('K-CYP3A4');
    if (meds.has_antithrombotic_example) ids.push('K-ANTITHROMBOTIC');
  } else {
    if (meds.has_studied_enhertu_inhibitor) ids.push('E-INHIBITOR-STUDY');
    if (meds.has_antithrombotic_example) ids.push('E-ANTITHROMBOTIC-CONTEXT');
    if (p.neuropathy === true) ids.push('E-NEUROPATHY-CONTEXT');
  }
  const productId = request.product_id;
  return SelectionSchema.parse({ product_id: productId, selections: ids.map(id => {
    const flag = trustedFlag(productId, id);
    if (!flag) throw new Error('Missing trusted template');
    return { flag_id: flag.id, source_ids: flag.source_ids };
  }) });
}
