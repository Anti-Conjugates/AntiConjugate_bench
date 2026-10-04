import { z } from 'zod';

export const BenchmarkArmSchema = z.enum(['plain_claude', 'harness_claude', 'harness_rules']);
export const BenchmarkCategorySchema = z.enum(['composition', 'invented_adc', 'fake_reference', 'false_premise', 'out_of_scope']);
export const BenchmarkOutcomeSchema = z.enum([
  'correct', 'abstained_correctly', 'flagged_premise', 'bluffed', 'fabricated_citation',
  'accepted_false_premise', 'wrong_fact', 'over_refused', 'refused', 'provider_error'
]);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const BenchmarkItemSchema = z.object({
  item_id: z.string().regex(/^[a-z0-9_-]{3,64}$/),
  category: BenchmarkCategorySchema,
  product_id: z.string().regex(/^DRG0[A-Z]{5}$/).nullable(),
  message: z.string().min(1).max(500),
  expected: z.object({
    kind: z.enum(['answer', 'abstain', 'flag_premise', 'refuse']),
    field: z.enum(['payload', 'linker', 'target', 'dar', 'antibody']).optional(),
    value: z.string().optional()
  }).strict()
}).strict();

export const BenchmarkCitationSchema = z.object({
  id: z.string(), resolved: z.enum(['exists', 'not_found', 'error', 'not_checked'])
}).strict();

export const BenchmarkRowSchema = z.object({
  item_id: z.string(), category: BenchmarkCategorySchema, product_id: z.string().nullable(), arm: BenchmarkArmSchema,
  outcome: BenchmarkOutcomeSchema, citations: z.array(BenchmarkCitationSchema).max(20),
  response_sha256: Sha256.nullable(), excerpt: z.string().max(400), model_calls: z.number().int().min(0), duration_ms: z.number().int().min(0)
}).strict();

export const BenchmarkCellSchema = z.object({
  n: z.number().int().min(0), correct: z.number().int().min(0), bluffed: z.number().int().min(0),
  fabricated_citations: z.number().int().min(0), accepted_false_premise: z.number().int().min(0),
  wrong_fact: z.number().int().min(0), over_refused: z.number().int().min(0), errors: z.number().int().min(0)
}).strict();

export const BenchmarkArtifactSchema = z.object({
  version: z.literal('conjugate-bench-1'),
  generated_at: z.string().datetime(),
  mode: z.enum(['live', 'offline']),
  model: z.string(),
  items_sha256: Sha256,
  workbook_sha256: Sha256,
  budget: z.object({ max_calls: z.number().int().positive(), calls_used: z.number().int().min(0), retries: z.literal(0) }).strict(),
  arms: z.array(BenchmarkArmSchema).min(1),
  items: z.array(BenchmarkItemSchema).min(1),
  rows: z.array(BenchmarkRowSchema),
  summary: z.record(BenchmarkArmSchema, z.record(BenchmarkCategorySchema, BenchmarkCellSchema)),
  limitations: z.array(z.string()).min(1)
}).strict();

export type BenchmarkArm = z.infer<typeof BenchmarkArmSchema>;
export type BenchmarkCategory = z.infer<typeof BenchmarkCategorySchema>;
export type BenchmarkOutcome = z.infer<typeof BenchmarkOutcomeSchema>;
export type BenchmarkItem = z.infer<typeof BenchmarkItemSchema>;
export type BenchmarkRow = z.infer<typeof BenchmarkRowSchema>;
export type BenchmarkArtifact = z.infer<typeof BenchmarkArtifactSchema>;

