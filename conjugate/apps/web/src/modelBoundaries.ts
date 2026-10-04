import { ModelCatalogSchema, ModelRequestSchema, ModelResultSchema, type ModelCatalog, type ModelRequest } from '@her2/shared';
import { BoundaryError, responseData } from './boundaries';

export async function fetchModelCatalog(signal: AbortSignal) {
  const response = await fetch('/api/models/catalog', { signal });
  return ModelCatalogSchema.parse(await responseData(response));
}

export function validateModelResult(input: unknown, request: ModelRequest, catalog: ModelCatalog) {
  const parsed = ModelResultSchema.safeParse(input);
  if (!parsed.success) throw new BoundaryError('Model observations failed validation. No result was displayed.', 'INVALID_RESPONSE');
  const result = parsed.data;
  const molecule = catalog.snapshot.molecules.find(m => m.id === request.molecule_id);
  if (JSON.stringify(result.request) !== JSON.stringify(request) || result.snapshot_sha256 !== catalog.snapshot_sha256
    || result.code_sha256 !== catalog.code_sha256 || result.sequence_artifact_sha256 !== catalog.sequence_artifact_sha256
    || (result.sequence !== null && JSON.stringify(result.sequence) !== JSON.stringify(catalog.sequences[request.product_id]))
    || JSON.stringify(result.molecule) !== JSON.stringify(molecule)
    || (result.structure !== null && JSON.stringify(result.structure) !== JSON.stringify(catalog.snapshot.structure))) {
    throw new BoundaryError('Model observations belong to different inputs or sources.', 'INVALID_RESPONSE');
  }
  return result;
}

export async function submitModelRun(input: ModelRequest, catalog: ModelCatalog, signal: AbortSignal) {
  const request = ModelRequestSchema.parse(input);
  if (!catalog.snapshot.molecules.some(m => m.id === request.molecule_id)) throw new BoundaryError('That molecule is unavailable. Nothing was sent.', 'INVALID_REQUEST');
  const response = await fetch('/api/models/runs', {
    method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
  });
  return validateModelResult(await responseData(response), request, catalog);
}
