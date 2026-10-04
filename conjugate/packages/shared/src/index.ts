import { z } from 'zod';
export * from './research.js';
export * from './harness.js';

export const EngineSchema = z.enum(['evidence', 'claude']);
export const OrganFunctionSchema = z.enum(['unknown', 'normal', 'mild', 'moderate', 'severe']);
export const SourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  jurisdiction: z.literal('UK'),
  revision_date: z.string(),
  section: z.string(),
  excerpt: z.string(),
  review_status: z.literal('draft_pending_pharmacist')
});
export const ProductSchema = z.object({
  id: z.string(),
  brand: z.string(),
  name: z.string(),
  short_name: z.string(),
  antibody: z.string(),
  target: z.literal('HER2'),
  payload: z.string(),
  linker: z.string(),
  dar: z.number(),
  adcdb_url: z.string().url(),
  source_ids: z.array(z.string()),
  description: z.string()
});
export const PatientSchema = z.object({
  age: z.number().int().min(18).max(120).nullable(),
  renal: OrganFunctionSchema,
  hepatic: OrganFunctionSchema,
  lung_history: z.boolean().nullable(),
  neuropathy: z.boolean().nullable(),
  platelets: z.number().min(0).max(2000).nullable(),
  lvef: z.number().min(0).max(100).nullable(),
  neutrophils: z.number().min(0).max(100).nullable(),
  medications: z.array(z.string().trim().min(1).max(100)).max(30),
  medication_list_complete: z.boolean()
}).strict();
export const RunRequestSchema = z.object({
  product_id: z.string().trim().min(1).max(80),
  engine: EngineSchema,
  synthetic_confirmed: z.literal(true),
  patient: PatientSchema
}).strict();
export const FlagSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['review', 'priority']),
  basis: z.enum(['label', 'inference']),
  source_ids: z.array(z.string()),
  context: z.string()
});
export const TraceStepSchema = z.object({
  stage: z.enum(['retrieval', 'draft', 'guardrail']),
  status: z.enum(['completed', 'blocked', 'skipped']),
  detail: z.string(),
  duration_ms: z.number().nonnegative()
});
export const RunResultSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  engine: EngineSchema,
  model: z.string().nullable(),
  product: ProductSchema.nullable(),
  clinical_status: z.literal('draft_pending_pharmacist'),
  eligibility: z.literal('not_assessed'),
  verdict: z.enum(['supported', 'not_supported', 'dont_know']),
  answer: z.string(),
  flags: z.array(FlagSchema),
  omitted_checks: z.array(FlagSchema),
  sources: z.array(SourceSchema),
  unknowns: z.array(z.string()),
  evidence_confidence: z.object({
    kind: z.literal('heuristic'),
    level: z.enum(['high', 'medium', 'low', 'unknown']),
    reason: z.string()
  }),
  omission_probability: z.null(),
  answer_correctness_probability: z.null(),
  guardrail: z.object({
    kind: z.literal('deterministic'),
    status: z.literal('blocked'),
    reasons: z.array(z.string())
  }),
  needs_human: z.literal(true),
  trace: z.array(TraceStepSchema)
});
export const CatalogSchema = z.object({
  products: z.array(ProductSchema),
  sources: z.array(SourceSchema),
  default_engine: EngineSchema,
  claude_configured: z.boolean(),
  model: z.string(),
  scope: z.string(),
  disclaimer: z.string()
});
export const ApiErrorSchema = z.object({
  error: z.object({code: z.string(), message: z.string()})
});

export type Engine = z.infer<typeof EngineSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Patient = z.infer<typeof PatientSchema>;
export type RunRequest = z.infer<typeof RunRequestSchema>;
export type ReviewFlag = z.infer<typeof FlagSchema>;
export type TraceStep = z.infer<typeof TraceStepSchema>;
export type RunResult = z.infer<typeof RunResultSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
