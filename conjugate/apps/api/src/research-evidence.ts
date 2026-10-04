import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  WorkbookDatasetSchema, ResearchCatalogSchema, ResearchReceiptSchema,
  type ResearchCatalog, type ResearchRequest, type ResearchReceipt, type ClaimAudit
} from '@her2/shared';
import { CLAUDE_MODEL, getProduct, productSources } from './evidence.js';
import { openFdaReceipt } from './research-openfda.js';

// Frozen local import, not network retrieval and not a clinical evidence feed.
const snapshot = WorkbookDatasetSchema.parse(JSON.parse(readFileSync(new URL('./workbook.snapshot.json', import.meta.url), 'utf8')));
export const DATASET_SHA256 = snapshot.sha256;
export const RESEARCH_NOTICE = 'Unapproved synthetic research draft pending pharmacist approval. Human review required; clinical release blocked. No patient safety, eligibility, treatment choice or individual release rate is established.';
export const QUESTIONS: ResearchCatalog['questions'] = [
  { id: 'composition', title: 'Composition record audit', description: 'Audit only recorded payload and DAR, not efficacy or clinical safety.' },
  { id: 'linker_release', title: 'Linker release hypothesis', description: 'Audit the positive hypothesis: A cleavable linker establishes rapid release in blood.' },
  { id: 'payload_risk_transfer', title: 'Payload-to-risk hypothesis', description: 'Audit whether payload identity alone establishes patient safety or transferable clinical risk.' },
  { id: 'workbook_safety', title: 'Workbook-to-safety hypothesis', description: 'Audit whether workbook information alone establishes patient safety or eligibility.' },
  { id: 'label_identity', title: 'US label identity', description: 'Check brand, generic name and application number in a frozen openFDA identity record.' }
];
export type ToolId = 'read_workbook' | 'read_label' | 'read_derived' | 'read_openfda';
export const CANONICAL_TOOLS: readonly ToolId[] = ['read_workbook', 'read_label', 'read_derived', 'read_openfda'];
export function allowedTools(request: ResearchRequest): ToolId[] {
  return request.evidence_policy === 'workbook_only' ? ['read_workbook'] : [...CANONICAL_TOOLS];
}
export function workbookSourceId(id: ResearchRequest['product_id']) { return `WORKBOOK-${id}-COMPOSITION`; }
export function derivedSourceId(id: ResearchRequest['product_id']) { return `DERIVED-${id}-NOT-ADCDB`; }
export function labelSourceId(id: ResearchRequest['product_id']) {
  return id === 'DRG0ERKBH' ? 'UK-ENHERTU-SMPC' : 'UK-KADCYLA-SMPC';
}
export function researchCatalog(configured: boolean): ResearchCatalog {
  // Catalog raw data is a composition-only projection; uploaded PK/dose/clinical
  // snippets and author-derived prescribing flags never become app assertions.
  const dataset = { ...snapshot,
    limitations: [...snapshot.limitations, 'Catalogue displays only composition and author-derived mechanistic cells; raw pharmacology and prescribing snippets are excluded.'],
    records: snapshot.records.map(record => ({ ...record, cells: record.cells.filter(cell => catalogFields.has(cell.field)) })),
    derived_records: snapshot.derived_records.map(record => ({ ...record, cells: record.cells.filter(cell => derivedFields.has(cell.field)) }))
  };
  return ResearchCatalogSchema.parse({ questions: QUESTIONS, dataset, claude_configured: configured, model: CLAUDE_MODEL });
}
const compositionFields = new Set(['ADCdb_ID', 'ADC name', 'Brand', 'Antibody', 'Target', 'Linker', 'Payload', 'DAR']);
// The premise gate also reads Linker-payload, so the browser can re-derive the exact server facts.
const catalogFields = new Set([...compositionFields, 'Linker-payload']);
const derivedFields = new Set(['ADCdb_ID', 'ADC name', 'Linker class', 'Release behaviour', 'Payload class', 'Bystander potential']);

// Each actual invocation reads only the scoped product. Derived notes are never
// promoted into either approved-label evidence or the original clinical API.
export function readResearchTool(tool: ToolId, request: ResearchRequest): ResearchReceipt[] {
  if (!allowedTools(request).includes(tool)) throw new Error('Source policy forbids tool.');
  return trustedReceipts(tool, request);
}
function trustedReceipts(tool: ToolId, request: ResearchRequest): ResearchReceipt[] {
  const product = getProduct(request.product_id)!;
  if (tool === 'read_openfda') return [openFdaReceipt(request)];
  if (tool === 'read_label') {
    const source = productSources(request.product_id).find(item => item.id === labelSourceId(request.product_id));
    if (!source) return [];
    return [ResearchReceiptSchema.parse({
      id: source.id, product_id: request.product_id, kind: 'label', title: source.title,
      url: source.url, section: source.section, revision_date: source.revision_date, excerpt: source.excerpt,
      provenance: 'label_paraphrase_pending_review', eligible_for_claim: ['composition', 'linker_release'].includes(request.question_id),
      limitations: ['Local UK label summary, not a runtime network lookup or complete label copy; pending pharmacist approval.', 'No individual release rate, efficacy, safety or eligibility is established.']
    })];
  }
  if (tool === 'read_derived') {
    const record = snapshot.derived_records.find(item => item.id === request.product_id);
    if (!record) return [];
    // Mechanistic notes only; do not turn author-derived prescribing flags into clinical assertions.
    const cells = record.cells.filter(cell => derivedFields.has(cell.field));
    return [ResearchReceiptSchema.parse({
      id: derivedSourceId(request.product_id), product_id: request.product_id, kind: 'derived',
      title: `${product.brand} author-derived workbook notes — NOT ADCdb`, url: null,
      section: `Derived_NOT_ADCdb; row ${record.row}; cells ${cells.map(cell => cell.cell).join(', ')}; SHA-256 ${snapshot.sha256}`,
      revision_date: null, excerpt: JSON.stringify(cells), provenance: 'derived_not_adcdb', eligible_for_claim: false,
      limitations: [snapshot.derived_notice, 'Ineligible as primary clinical or claim evidence; author-derived material is not an approved label.', 'Import time is not an evidence revision date.']
    })];
  }
  const record = snapshot.records.find(item => item.id === request.product_id);
  if (!record) return [];
  const cells = record.cells.filter(cell => compositionFields.has(cell.field));
  const complete = ['ADCdb_ID', 'Payload', 'DAR'].every(field => cells.some(cell => cell.field === field && cell.value !== null));
  return [ResearchReceiptSchema.parse({
    id: workbookSourceId(request.product_id), product_id: request.product_id, kind: 'workbook',
    title: `${product.brand} raw workbook composition cells (unverified local snapshot)`, url: null,
    section: `Raw worksheet (original sheet name not retained in snapshot); row ${record.row}; cells ${cells.map(cell => cell.cell).join(', ')}; SHA-256 ${snapshot.sha256}`,
    revision_date: null, excerpt: JSON.stringify(cells), provenance: 'user_uploaded_unverified',
    eligible_for_claim: request.question_id === 'composition' && complete,
    limitations: [...snapshot.limitations, 'Original raw sheet name and primary assay provenance are unavailable. Composition cells cannot power clinical flags; import time is not a revision date.']
  })];
}

// Check only receipts that were actually supplied by executed tools; this is not another retrieval.
export function receiptIntegrity(receipt: ResearchReceipt, request: ResearchRequest): boolean {
  const tool: ToolId = receipt.kind === 'openfda' ? 'read_openfda' : receipt.kind === 'label' ? 'read_label' : receipt.kind === 'derived' ? 'read_derived' : 'read_workbook';
  if (!allowedTools(request).includes(tool)) return false;
  return trustedReceipts(tool, request).some(expected => isDeepStrictEqual(expected, receipt));
}

export interface ExpectedClaim {
  id: ResearchRequest['question_id'];
  statement: string;
  // Exact expected source set derived independently from trusted retrievals, not the draft.
  source_ids: string[];
  verdict: ClaimAudit['verdict'];
  explanation: string;
  limitation: string;
}
export function expectedClaim(request: ResearchRequest, receipts: ResearchReceipt[]): ExpectedClaim {
  if (request.question_id === 'label_identity') {
    const source = receipts.find(receipt => receipt.kind === 'openfda' && receiptIntegrity(receipt, request));
    return { id: 'label_identity', statement: 'The US openFDA record matches this product’s brand, generic name and application number.',
      source_ids: source ? [source.id] : [], verdict: source ? 'supported' : 'insufficient',
      explanation: source ? 'All three identity fields match the product-specific allowlist in the frozen US record.' : 'No matching openFDA record was retrieved. Workbook and UK label summaries cannot substitute for that record.',
      limitation: 'Identity match is not FDA approval verification, clinical evidence or a current-label check. US and UK records remain separate.' };
  }
  const has = (id: string) => receipts.some(receipt => receipt.id === id && receipt.product_id === request.product_id && receipt.eligible_for_claim);
  const workbook = has(workbookSourceId(request.product_id));
  // Explicit source ablation: not even hidden label metadata enters the claim.
  const label = request.evidence_policy === 'all' && has(labelSourceId(request.product_id));
  const common = 'Local snapshot only; no network retrieval, calibrated confidence or probabilities. All findings remain draft pending pharmacist approval; no clinical safety, efficacy or eligibility conclusion.';
  if (request.question_id === 'composition') {
    // Trust only the bounded values actually read. Do not infer arbitrary uploaded scientific claims.
    const receipt = receipts.find(item => item.id === workbookSourceId(request.product_id));
    const cells = receipt && receiptIntegrity(receipt, request) ? snapshot.records.find(item => item.id === request.product_id)?.cells : undefined;
    const payload = cells?.find(cell => cell.field === 'Payload')?.value;
    const dar = cells?.find(cell => cell.field === 'DAR')?.value;
    const expectedPayload = request.product_id === 'DRG0CYMEB' ? 'DM1' : 'DXd';
    const expectedDar = request.product_id === 'DRG0CYMEB' ? '3.5' : '8';
    const concordant = workbook && payload === expectedPayload && dar === expectedDar;
    const sources = [...(concordant ? [workbookSourceId(request.product_id)] : []), ...(label ? [labelSourceId(request.product_id)] : [])];
    return { id: 'composition',
      statement: concordant ? `The workbook records payload ${expectedPayload} and DAR ${expectedDar}.` : label ? `The local pending-review label summary records payload ${expectedPayload} and ${request.product_id === 'DRG0CYMEB' ? 'mean' : 'approximate'} DAR ${expectedDar}.` : 'Recorded payload and DAR can be established from the available composition evidence.',
      source_ids: sources, verdict: sources.length ? 'supported' : 'insufficient',
      explanation: concordant ? (label ? 'Retrieved workbook composition cells are concordant with the retrieved product-specific local label metadata.' : 'Supported only as a transcription of the retrieved unverified workbook composition cells; labels were not used.') : label ? 'Only retrieved local label metadata supports this bounded structural record; no workbook concordance is established.' : 'No eligible complete composition record was retrieved. No values are inferred.',
      limitation: `Mean/approximate DAR is not a fixed count on each molecule. Composition records do not verify clinical safety or efficacy. ${common}` };
  }
  if (request.question_id === 'linker_release') {
    const enhertu = request.product_id === 'DRG0ERKBH';
    return { id: 'linker_release', statement: 'A cleavable linker establishes rapid release in blood.',
      source_ids: label ? [labelSourceId(request.product_id)] : [],
      verdict: label && enhertu ? 'contradicted' : 'insufficient',
      explanation: !label ? 'No eligible product-specific release evidence was retrieved. Workbook linker text cannot establish blood release; no label or derived knowledge was used.' : enhertu ? 'Counter-evidence in the retrieved local Enhertu base-label paraphrase describes plasma stability and intracellular lysosomal cleavage. Cleavable alone does not establish rapid blood release.' : 'The retrieved Kadcyla base-label paraphrase describes a stable non-cleavable MCC linker. The cleavable-linker premise is not established for Kadcyla; another product’s release evidence cannot establish release for this product.',
      limitation: `No individual release rate, blood-release kinetics or affinity window was established; this is a bounded claim audit, not a quantitative release model. ${common}` };
  }
  return { id: request.question_id,
    statement: request.question_id === 'payload_risk_transfer' ? 'Payload identity alone establishes patient safety or transferable clinical risk.' : 'Workbook information alone establishes patient safety or eligibility.',
    source_ids: [], verdict: 'insufficient',
    explanation: request.question_id === 'payload_risk_transfer' ? 'Payload identity and structural records are not patient-level safety evidence. This audit cannot establish transferable clinical risk or false clinical reassurance.' : 'Unverified workbook composition and author-derived notes are not primary clinical evidence. Workbook information cannot establish patient safety or eligibility.',
    limitation: `Insufficient evidence is not proof of safety or absence of risk. Derived notes remain explicitly ineligible as primary evidence. ${common}` };
}
