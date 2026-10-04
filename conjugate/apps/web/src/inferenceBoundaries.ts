import { InferenceCatalogSchema, InferenceRequestSchema, InferenceResultSchema, InferenceProviderOutputSchema, type InferenceCatalog, type InferenceRequest } from '@her2/shared';
import { BoundaryError, responseData } from './boundaries';

export async function fetchInferenceCatalog(signal: AbortSignal) {
  return InferenceCatalogSchema.parse(await responseData(await fetch('/api/models/inference', { signal })));
}
async function fingerprint(input: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function validateInferenceResult(input: unknown, request: InferenceRequest, catalog: InferenceCatalog) {
  const parsed = InferenceResultSchema.safeParse(input);
  if (!parsed.success) throw new BoundaryError('Inference output failed validation. No score was displayed.', 'INVALID_RESPONSE');
  const expected = catalog.cases.find(c => c.id === request.sequence_id);
  const result = parsed.data;
  if (result.request.sequence_id !== request.sequence_id || !expected || Object.keys(expected).some(key => expected[key as keyof typeof expected] !== result.sequence[key as keyof typeof expected])) {
    throw new BoundaryError('Inference belongs to different sequence inputs.', 'INVALID_RESPONSE');
  }
  const provider = InferenceProviderOutputSchema.parse(JSON.parse(result.provider_response_json))[0]!;
  if (await fingerprint(result.provider_response_json) !== result.output_sha256 || await fingerprint(provider.sequence.replaceAll(' ', '')) !== expected.sequence_sha256) throw new BoundaryError('Inference response hash or sequence is inconsistent.', 'INVALID_RESPONSE');
  return result;
}
export async function submitInference(input: InferenceRequest, catalog: InferenceCatalog, signal: AbortSignal) {
  const request = InferenceRequestSchema.parse(input);
  if (!catalog.configured || catalog.remaining_calls === 0) throw new BoundaryError('Live inference is unavailable. Nothing was sent.', 'INVALID_REQUEST');
  const response = await fetch('/api/models/inference', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  return validateInferenceResult(await responseData(response), request, catalog);
}
