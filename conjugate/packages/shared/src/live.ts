import { z } from 'zod';

// Live retrieval supports identity, reference existence and composition
// corroboration only. It is not clinical evidence and never changes a verdict.
export const LiveSourceIdSchema = z.enum(['clinicaltrials_gov', 'pubmed', 'openfda', 'dailymed', 'adcdb']);
export const LiveProductIdSchema = z.enum(['DRG0CYMEB', 'DRG0ERKBH']);
export const LiveReferenceIdSchema = z.string().regex(/^(NCT\d{8}|PMID:[1-9]\d{0,8})$/);
export const LiveStatusSchema = z.enum(['ok', 'not_found', 'drift', 'error']);
export const LiveErrorCodeSchema = z.enum([
  'HOST_REJECTED', 'REDIRECT_REJECTED', 'HTTP_STATUS', 'OVERSIZE', 'TIMEOUT', 'DEADLINE', 'CANCELLED', 'NETWORK', 'PARSE', 'IDENTITY_MISMATCH'
]);
export const LiveComparisonSchema = z.object({
  field: z.string(), snapshot: z.string().nullable(), live: z.string().nullable(), agrees: z.boolean()
}).strict();
export const LiveReceiptSchema = z.object({
  source: LiveSourceIdSchema,
  subject: z.string().max(40),
  url: z.string().url(),
  fetched_at: z.string().datetime(),
  http_status: z.number().int().nullable(),
  raw_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  bytes: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
  cached: z.boolean(),
  status: LiveStatusSchema,
  error_code: LiveErrorCodeSchema.nullable(),
  parsed: z.record(z.string(), z.string().nullable()),
  comparison: z.array(LiveComparisonSchema),
  provenance: z.literal('live_retrieved_unverified'),
  limitations: z.array(z.string()).min(1)
}).strict();
export const LiveCheckRequestSchema = z.object({
  product_id: LiveProductIdSchema.optional(),
  references: z.array(LiveReferenceIdSchema).max(4).optional()
}).strict().refine(value => value.product_id !== undefined || (value.references?.length ?? 0) > 0, { message: 'Provide a product_id or at least one reference.' });
export const LiveCheckResultSchema = z.object({
  kind: z.literal('live_source_retrieval_check_not_clinical'),
  created_at: z.string().datetime(),
  product_id: LiveProductIdSchema.nullable(),
  references: z.array(LiveReferenceIdSchema),
  receipts: z.array(LiveReceiptSchema),
  counts: z.object({ ok: z.number().int(), not_found: z.number().int(), drift: z.number().int(), error: z.number().int() }).strict(),
  duration_ms: z.number().nonnegative(),
  clinical_status: z.literal('draft_pending_pharmacist'),
  needs_human: z.literal(true),
  guardrail: z.object({ kind: z.literal('deterministic'), status: z.literal('blocked'), reasons: z.array(z.string()) }).strict(),
  answer_correctness_probability: z.null(),
  omission_probability: z.null(),
  overall_adc_score: z.null(),
  limitations: z.array(z.string()).min(1)
}).strict();
export const LiveCatalogSchema = z.object({
  enabled: z.boolean(),
  sources: z.array(z.object({ id: LiveSourceIdSchema, host: z.string(), max_bytes: z.number().int().positive(), purpose: z.string() }).strict()),
  timeout_ms: z.number().int().positive(),
  deadline_ms: z.number().int().positive(),
  max_references: z.literal(4),
  user_agent: z.string()
}).strict();

export type LiveSourceId = z.infer<typeof LiveSourceIdSchema>;
export type LiveProductId = z.infer<typeof LiveProductIdSchema>;
export type LiveStatus = z.infer<typeof LiveStatusSchema>;
export type LiveErrorCode = z.infer<typeof LiveErrorCodeSchema>;
export type LiveComparison = z.infer<typeof LiveComparisonSchema>;
export type LiveReceipt = z.infer<typeof LiveReceiptSchema>;
export type LiveCheckRequest = z.infer<typeof LiveCheckRequestSchema>;
export type LiveCheckResult = z.infer<typeof LiveCheckResultSchema>;
export type LiveCatalog = z.infer<typeof LiveCatalogSchema>;
