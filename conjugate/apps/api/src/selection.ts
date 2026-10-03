import { z } from 'zod';

// The model may select identifiers only; it cannot supply clinical prose.
export const SelectionSchema = z.object({
  product_id: z.string().min(1).max(80),
  selections: z.array(z.object({
    flag_id: z.string().min(1).max(80),
    source_ids: z.array(z.string().min(1).max(120)).min(1).max(4)
  }).strict()).max(24)
}).strict();
export type SelectionDraft = z.infer<typeof SelectionSchema>;
