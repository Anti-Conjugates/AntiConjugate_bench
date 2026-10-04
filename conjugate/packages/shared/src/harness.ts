import { z } from 'zod';
import { WorkbookProductIdSchema } from './products.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const HarnessLimitsSchema = z.object({
  deadline_ms: z.number().int().positive().max(60000),
  max_model_calls: z.literal(2), max_tool_calls: z.literal(4), retries: z.literal(0),
  max_request_bytes: z.literal(65536), max_response_bytes: z.literal(131072),
  network_during_retrieval: z.literal(false), model_receives_expected_mapping: z.literal(true)
}).strict();
export const HarnessManifestSchema = z.object({
  version: z.literal('conjugate-harness-1'), code_sha256: hash, request_sha256: hash,
  limits: HarnessLimitsSchema,
  model_calls: z.number().int().min(0).max(2), tool_calls: z.number().int().min(0).max(4),
  sources: z.array(z.object({ id: z.string(), sha256: hash }).strict()).max(4),
  skills: z.array(z.object({ name: z.string(), version: z.string(), sha256: hash }).strict()).max(3)
}).strict();
export type HarnessManifest = z.infer<typeof HarnessManifestSchema>;

export const OpenFdaRecordSchema = z.object({
  product_id: WorkbookProductIdSchema, jurisdiction: z.literal('US'),
  id: z.string().uuid(), set_id: z.string().uuid(), version: z.string().regex(/^\d+$/),
  effective_time: z.string().regex(/^\d{8}$/), fetched_at: z.string().datetime(),
  query_url: z.string().url(), record_url: z.string().url(), raw_response_sha256: hash,
  brand_name: z.array(z.string()).min(1), generic_name: z.array(z.string()).min(1),
  application_number: z.array(z.string()).min(1), manufacturer_name: z.array(z.string()).min(1)
}).strict();
export const OpenFdaSnapshotSchema = z.object({
  kind: z.literal('openfda_identity_snapshot'),
  records: z.array(OpenFdaRecordSchema).length(2)
}).strict();
export type OpenFdaRecord = z.infer<typeof OpenFdaRecordSchema>;
