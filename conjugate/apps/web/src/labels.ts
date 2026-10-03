import type { ResearchRequest } from '@her2/shared';

export const questionTitles: Record<ResearchRequest['question_id'], string> = {
  composition: 'What is it made of?',
  linker_release: 'Does a cleavable linker mean release in blood?',
  payload_risk_transfer: 'Does the payload alone tell you the patient risk?',
  workbook_safety: 'Can the workbook alone tell you it is safe?',
  label_identity: 'Does the US label record match this product?',
};

export const faultTests: Record<ResearchRequest['integrity_drill'], string> = {
  none: 'None', cross_product_citation: 'Cross-product citation', derived_as_primary: 'Derived note cited as a primary source', invented_source: 'Invented source id',
};

export const verdictLabels = { supported: 'Supported', contradicted: 'Contradicted', insufficient: 'Not enough evidence' } as const;

/** "Kadcyla (trastuzumab emtansine)" on first mention; falls back to the name when the brand cell is blank. */
export function productLabel(product: { brand: string | null; name: string }) {
  return product.brand ? `${product.brand} (${product.name.toLowerCase()})` : product.name;
}
