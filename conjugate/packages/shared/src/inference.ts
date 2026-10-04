import { z } from 'zod';

export const LIVE_ESM_MODEL = 'facebook/esm2_t33_650M_UR50D';
export const LIVE_ESM_HUB_REVISION = '08e4846e537177426273712802403f7ba8261b6c';
export const InferenceRequestSchema = z.object({
  sequence_id: z.enum(['trastuzumab_vh', 'reversed_vh_control']),
  synthetic_confirmed: z.literal(true)
}).strict();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const InferenceCaseSchema = z.object({
  id: InferenceRequestSchema.shape.sequence_id,
  name: z.string().max(100),
  kind: z.enum(['public_reference', 'synthetic_control']),
  sequence_sha256: Hash,
  request_sha256: Hash,
  residue_count: z.literal(120),
  masked_position: z.literal(33),
  scored_residue: z.literal('Y')
}).strict();
export const InferenceCatalogSchema = z.object({
  configured: z.boolean(),
  provider: z.literal('hf-inference'),
  model_id: z.literal(LIVE_ESM_MODEL),
  task: z.literal('fill-mask'),
  transport: z.literal('mcp_stdio'),
  remaining_calls: z.number().int().min(0).max(20),
  cases: z.array(InferenceCaseSchema).length(2)
}).strict().superRefine((value, ctx) => {
  if (new Set(value.cases.map(c => c.id)).size !== 2) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate sequence IDs.' });
});
export const InferenceProviderOutputSchema = z.array(z.object({
  score: z.number().finite().min(0).max(1), token: z.literal(19), token_str: z.literal('Y'), sequence: z.string().max(300)
}).strict()).length(1);
export const InferenceResultSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  request: InferenceRequestSchema,
  sequence: InferenceCaseSchema,
  execution: z.literal('live_inference'),
  transport: z.literal('mcp_stdio'),
  mcp_tool: z.literal('score_masked_antibody'),
  provider: z.literal('hf-inference'),
  model_id: z.literal(LIVE_ESM_MODEL),
  task: z.literal('fill-mask'),
  hub_revision: z.literal(LIVE_ESM_HUB_REVISION),
  served_revision_verified: z.literal(false),
  provider_calls: z.literal(1),
  input_sha256: Hash,
  output_sha256: Hash,
  provider_response_json: z.string().max(32_768),
  latency_ms: z.number().finite().nonnegative(),
  residue_probability: z.number().finite().min(0).max(1),
  residue_nll: z.number().finite().nonnegative().nullable(),
  overall_adc_score: z.null(),
  clinical_status: z.literal('draft_pending_pharmacist'),
  eligibility: z.literal('not_assessed'),
  needs_human: z.literal(true),
  guardrail: z.object({ status: z.literal('blocked') }).strict(),
  answer_correctness_probability: z.null(),
  omission_probability: z.null()
}).strict().superRefine((value, ctx) => {
  try {
    const provider = InferenceProviderOutputSchema.parse(JSON.parse(value.provider_response_json))[0]!;
    if (provider.score !== value.residue_probability) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Score does not match retained response.' });
  } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid retained provider response.' }); }
  const expected = value.residue_probability > 0 ? -Math.log(value.residue_probability) : null;
  if (value.input_sha256 !== value.sequence.request_sha256 || value.request.sequence_id !== value.sequence.id || (expected === null ? value.residue_nll !== null : value.residue_nll === null || Math.abs(value.residue_nll - expected) > 1e-9)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Sequence or score mismatch.' });
  }
});
export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;
export type InferenceCatalog = z.infer<typeof InferenceCatalogSchema>;
export type InferenceResult = z.infer<typeof InferenceResultSchema>;
