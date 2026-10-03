import { RunRequestSchema, type RunRequest } from '@her2/shared';
import { CLAUDE_MODEL } from './evidence.js';

// Software contract fixture only: deliberately empty/unknown synthetic data.
// Not a clinician case, clinical benchmark, answer key or scoring artifact.
export function requestFixture(overrides: Partial<RunRequest> = {}): RunRequest {
  return RunRequestSchema.parse({
    product_id: 'DRG0CYMEB', engine: 'evidence', synthetic_confirmed: true,
    patient: { age: null, renal: 'unknown', hepatic: 'unknown', lung_history: null,
      neuropathy: null, platelets: null, lvef: null, neutrophils: null,
      medications: [], medication_list_complete: false },
    ...overrides
  });
}
export function modelResponse(selection: unknown, extraBlocks: unknown[] = []): Response {
  return new Response(JSON.stringify({ model: CLAUDE_MODEL, stop_reason: 'end_turn', content: [...extraBlocks, { type: 'text', text: JSON.stringify(selection) }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}
export const NON_CREDENTIAL = 'software-test-placeholder-not-a-credential';
