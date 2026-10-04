import { createHash, randomUUID } from 'node:crypto';
import { InferenceRequestSchema, InferenceResultSchema, InferenceProviderOutputSchema, LIVE_ESM_MODEL, LIVE_ESM_HUB_REVISION, type InferenceRequest } from '@her2/shared';
import { ApiFailure } from './errors.js';

const REFERENCE = 'EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS';
const position = 32;
const reversed = [...REFERENCE].reverse();
const y = reversed.indexOf('Y');
[reversed[position], reversed[y]] = [reversed[y]!, reversed[position]!];
const sequences = { trastuzumab_vh: REFERENCE, reversed_vh_control: reversed.join('') };
export const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
export const INFERENCE_CASES = [
  { id: 'trastuzumab_vh' as const, name: 'Trastuzumab public VH reference', kind: 'public_reference' as const, sequence_sha256: fingerprint(REFERENCE), residue_count: 120 as const, masked_position: 33 as const, scored_residue: 'Y' as const },
  { id: 'reversed_vh_control' as const, name: 'Reversed VH synthetic control', kind: 'synthetic_control' as const, sequence_sha256: fingerprint(sequences.reversed_vh_control), residue_count: 120 as const, masked_position: 33 as const, scored_residue: 'Y' as const }
].map(c => ({ ...c, request_sha256: fingerprint(JSON.stringify(inferencePayload({ sequence_id: c.id, synthetic_confirmed: true }))) }));
export interface InferenceOptions { apiKey?: string; fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number }
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => {}); signal.throwIfAborted(); }
  let cancel: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try { return await Promise.race([operation, interrupted]); }
  finally { if (cancel) signal.removeEventListener('abort', cancel); }
}
export function inferencePayload(input: InferenceRequest) {
  const sequence = sequences[input.sequence_id];
  return { inputs: `${sequence.slice(0, position)}<mask>${sequence.slice(position + 1)}`, parameters: { top_k: 1, targets: ['Y'] } };
}
export async function scoreMaskedAntibody(input: unknown, options: InferenceOptions = {}) {
  const parsed = InferenceRequestSchema.safeParse(input);
  if (!parsed.success) throw new ApiFailure('INVALID_REQUEST', 400);
  if (!options.apiKey?.trim()) throw new ApiFailure('INFERENCE_NOT_CONFIGURED', 503);
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.min(45_000, Math.max(1, options.timeoutMs ?? 45_000)))]);
  const body = JSON.stringify(inferencePayload(parsed.data));
  const started = performance.now();
  try {
    signal.throwIfAborted();
    const response = await abortable((options.fetchImpl ?? fetch)(`https://router.huggingface.co/hf-inference/models/${LIVE_ESM_MODEL}`, {
      method: 'POST', redirect: 'error', signal,
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' }, body
    }).then(response => { if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted(); } return response; }), signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ApiFailure('INFERENCE_UNAVAILABLE', 502);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ApiFailure('INFERENCE_INVALID_OUTPUT', 502);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await abortable(reader.read(), signal);
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > 32_768) throw new ApiFailure('INFERENCE_INVALID_OUTPUT', 502);
        chunks.push(value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const raw = Buffer.concat(chunks).toString('utf8');
    const output = InferenceProviderOutputSchema.safeParse(JSON.parse(raw));
    if (!output.success || output.data[0]!.sequence.replaceAll(' ', '') !== sequences[parsed.data.sequence_id]) throw new ApiFailure('INFERENCE_INVALID_OUTPUT', 502);
    const probability = output.data[0]!.score;
    return InferenceResultSchema.parse({
      id: randomUUID(), created_at: new Date().toISOString(), request: parsed.data,
      sequence: INFERENCE_CASES.find(c => c.id === parsed.data.sequence_id), execution: 'live_inference', transport: 'mcp_stdio', mcp_tool: 'score_masked_antibody',
      provider: 'hf-inference', model_id: LIVE_ESM_MODEL, task: 'fill-mask', hub_revision: LIVE_ESM_HUB_REVISION, served_revision_verified: false,
      provider_calls: 1, input_sha256: fingerprint(body), output_sha256: fingerprint(raw), provider_response_json: raw, latency_ms: performance.now() - started,
      residue_probability: probability, residue_nll: probability > 0 ? -Math.log(probability) : null,
      overall_adc_score: null, clinical_status: 'draft_pending_pharmacist', eligibility: 'not_assessed', needs_human: true,
      guardrail: { status: 'blocked' }, answer_correctness_probability: null, omission_probability: null
    });
  } catch (error) {
    if (signal.aborted) throw new ApiFailure(options.signal?.aborted ? 'RESEARCH_CANCELLED' : 'INFERENCE_TIMEOUT', options.signal?.aborted ? 499 : 504);
    if (error instanceof ApiFailure) throw error;
    if (error instanceof TypeError) throw new ApiFailure('INFERENCE_UNAVAILABLE', 502);
    throw new ApiFailure('INFERENCE_INVALID_OUTPUT', 502);
  }
}
