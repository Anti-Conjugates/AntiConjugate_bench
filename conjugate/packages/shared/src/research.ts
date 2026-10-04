import { z } from 'zod';
import { HarnessManifestSchema } from './harness.js';

export const ResearchQuestionSchema = z.enum(['composition', 'linker_release', 'payload_risk_transfer', 'workbook_safety', 'label_identity']);
export const ResearchToolSchema = z.enum(['read_workbook', 'read_label', 'read_derived', 'read_openfda']);
export const EvidencePolicySchema = z.enum(['all', 'workbook_only']);
export const IntegrityDrillSchema = z.enum(['none', 'cross_product_citation', 'derived_as_primary', 'invented_source']);
export const WorkbookCellSchema = z.object({
  field: z.string().min(1), cell: z.string().regex(/^[A-Z]+[0-9]+$/), value: z.string().nullable()
}).strict();
export const WorkbookRecordSchema = z.object({
  id: z.string().regex(/^DRG0[A-Z0-9]+$/), name: z.string(), brand: z.string().nullable(),
  target: z.string(), payload: z.string().nullable(), linker: z.string().nullable(), dar: z.string().nullable(),
  clinical_enabled: z.boolean(), row: z.number().int().positive(),
  cells: z.array(WorkbookCellSchema), missing_fields: z.array(z.string())
}).strict();
export const DerivedRecordSchema = z.object({
  id: z.string(), row: z.number().int().positive(), cells: z.array(WorkbookCellSchema)
}).strict();
export const WorkbookDatasetSchema = z.object({
  filename: z.literal('adc_table_adcdb.xlsx'), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  imported_at: z.string().datetime(), record_count: z.number().int().nonnegative(),
  derived_record_count: z.number().int().nonnegative(),
  provenance: z.literal('user_uploaded_unverified'), limitations: z.array(z.string()),
  derived_notice: z.string(), records: z.array(WorkbookRecordSchema), derived_records: z.array(DerivedRecordSchema)
}).strict();
export const ResearchQuestionOptionSchema = z.object({
  id: ResearchQuestionSchema, title: z.string(), description: z.string()
}).strict();
export const ResearchCatalogSchema = z.object({
  questions: z.array(ResearchQuestionOptionSchema), dataset: WorkbookDatasetSchema,
  claude_configured: z.boolean(), model: z.literal('claude-opus-5-5')
}).strict();
export const ResearchRequestSchema = z.object({
  product_id: z.enum(['DRG0CYMEB', 'DRG0ERKBH']), question_id: ResearchQuestionSchema,
  engine: z.enum(['evidence', 'claude']), evidence_policy: EvidencePolicySchema,
  integrity_drill: IntegrityDrillSchema, synthetic_confirmed: z.literal(true)
}).strict();
export const ResearchReceiptSchema = z.object({
  id: z.string(), product_id: z.string(), kind: z.enum(['workbook', 'label', 'derived', 'openfda']),
  title: z.string(), url: z.string().url().nullable(), section: z.string(),
  revision_date: z.string().nullable(), excerpt: z.string(),
  provenance: z.enum(['user_uploaded_unverified', 'label_paraphrase_pending_review', 'derived_not_adcdb', 'openfda_identity_snapshot']),
  eligible_for_claim: z.boolean(), limitations: z.array(z.string())
}).strict();
export const ClaimAuditSchema = z.object({
  id: z.string(), statement: z.string(), verdict: z.enum(['supported', 'contradicted', 'insufficient']),
  explanation: z.string(), source_ids: z.array(z.string()), limitation: z.string()
}).strict();
export const ResearchTraceSchema = z.object({
  id: z.string(), stage: z.enum(['scope', 'plan', 'retrieve', 'draft', 'challenge', 'verify', 'handoff']),
  actor: z.enum(['controller', 'local_tool', 'claude', 'deterministic_verifier']),
  status: z.enum(['completed', 'blocked', 'skipped']), detail: z.string(),
  duration_ms: z.number().nonnegative(), tool: ResearchToolSchema.nullable(), source_ids: z.array(z.string())
}).strict();
export const ResearchChallengeSchema = z.object({
  code: z.string(), outcome: z.enum(['passed', 'caught', 'unknown']), detail: z.string(), source_ids: z.array(z.string())
}).strict();
export const ResearchDraftSchema = z.object({
  product_id: z.string().max(80), claims: z.array(z.object({
    claim_id: z.string().max(120), source_ids: z.array(z.string().max(120)).max(8)
  }).strict()).max(8)
}).strict();
export const ResearchResultSchema = z.object({
  id: z.string(), created_at: z.string().datetime(), product_id: z.enum(['DRG0CYMEB', 'DRG0ERKBH']),
  question_id: ResearchQuestionSchema, engine: z.enum(['evidence', 'claude']), model: z.string().nullable(),
  evidence_policy: EvidencePolicySchema, integrity_drill: IntegrityDrillSchema,
  draft: ResearchDraftSchema, draft_integrity: z.enum(['accepted', 'rejected']),
  answer: z.string(), claims: z.array(ClaimAuditSchema), omitted_claim_ids: z.array(z.string()),
  receipts: z.array(ResearchReceiptSchema), challenges: z.array(ResearchChallengeSchema),
  unknowns: z.array(z.string()), next_actions: z.array(z.string()), trace: z.array(ResearchTraceSchema),
  dataset_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  harness: HarnessManifestSchema,
  clinical_status: z.literal('draft_pending_pharmacist'), eligibility: z.literal('not_assessed'),
  needs_human: z.literal(true), guardrail: z.object({status: z.literal('blocked'), reasons: z.array(z.string())}).strict(),
  answer_correctness_probability: z.null(), omission_probability: z.null()
}).strict();
export const ResearchEventSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('trace'), step: ResearchTraceSchema}).strict(),
  z.object({type: z.literal('result'), result: ResearchResultSchema}).strict(),
  z.object({type: z.literal('error'), error: z.object({code: z.string(), message: z.string()}).strict()}).strict()
]);
export type WorkbookDataset = z.infer<typeof WorkbookDatasetSchema>;
export type WorkbookRecord = z.infer<typeof WorkbookRecordSchema>;
export type ResearchCatalog = z.infer<typeof ResearchCatalogSchema>;
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;
export type ResearchReceipt = z.infer<typeof ResearchReceiptSchema>;
export type ClaimAudit = z.infer<typeof ClaimAuditSchema>;
export type ResearchTrace = z.infer<typeof ResearchTraceSchema>;
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
export type ResearchDraft = z.infer<typeof ResearchDraftSchema>;
export type ResearchEvent = z.infer<typeof ResearchEventSchema>;

export function researchExecutionIsConsistent(result: ResearchResult) {
  const kinds = { read_workbook: 'workbook', read_label: 'label', read_derived: 'derived', read_openfda: 'openfda' } as const;
  const executed = result.trace.filter(step => step.stage === 'retrieve' && step.status === 'completed');
  if (executed.length !== result.harness.tool_calls || new Set(executed.map(step => step.tool)).size !== executed.length
    || result.trace.some(step => step.tool !== null && (step.stage !== 'retrieve' || step.status !== 'completed' || step.actor !== 'local_tool'))) return false;
  const readIds: string[] = [];
  for (const step of executed) {
    if (step.tool === null || step.actor !== 'local_tool' || (result.evidence_policy === 'workbook_only' && step.tool !== 'read_workbook')) return false;
    for (const id of step.source_ids) {
      if (!result.receipts.some(receipt => receipt.id === id && receipt.kind === kinds[step.tool!] && receipt.product_id === result.product_id)) return false;
      readIds.push(id);
    }
  }
  return readIds.length === result.receipts.length && new Set(readIds).size === readIds.length
    && result.receipts.every(receipt => readIds.includes(receipt.id));
}
