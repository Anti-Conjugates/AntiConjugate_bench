import {
  ApiErrorSchema,
  CatalogSchema,
  RunRequestSchema,
  RunResultSchema,
  type Catalog,
  type Engine,
  type Patient,
  type RunRequest,
  type RunResult,
} from '@her2/shared';

export type HistoryValue = 'unknown' | 'true' | 'false';
export type InputValues = {
  age: string;
  renal: Patient['renal'];
  hepatic: Patient['hepatic'];
  lung_history: HistoryValue;
  neuropathy: HistoryValue;
  platelets: string;
  lvef: string;
  neutrophils: string;
  medications: string;
  medication_list_complete: boolean;
  synthetic_confirmed: boolean;
};

export function emptyInputs(): InputValues {
  return {
    age: '',
    renal: 'unknown',
    hepatic: 'unknown',
    lung_history: 'unknown',
    neuropathy: 'unknown',
    platelets: '',
    lvef: '',
    neutrophils: '',
    medications: '',
    medication_list_complete: false,
    synthetic_confirmed: false,
  };
}

const numberOrNull = (value: string): number | null => value.trim() === '' ? null : Number(value);
const historyOrNull = (value: HistoryValue): boolean | null => value === 'unknown' ? null : value === 'true';

export function validateInputs(values: InputValues, productId: string, engine: Engine) {
  return RunRequestSchema.safeParse({
    product_id: productId,
    engine,
    synthetic_confirmed: values.synthetic_confirmed,
    patient: {
      age: numberOrNull(values.age),
      renal: values.renal,
      hepatic: values.hepatic,
      lung_history: historyOrNull(values.lung_history),
      neuropathy: historyOrNull(values.neuropathy),
      platelets: numberOrNull(values.platelets),
      lvef: numberOrNull(values.lvef),
      neutrophils: numberOrNull(values.neutrophils),
      medications: values.medications.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
      medication_list_complete: values.medication_list_complete,
    },
  });
}

export function safeSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

export class BoundaryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'BoundaryError';
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new BoundaryError('The server returned an unreadable response. No research draft was accepted.', 'INVALID_RESPONSE');
  }
}

export async function responseData(response: Response): Promise<unknown> {
  const data = await readJson(response);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(data);
    if (parsed.success) throw new BoundaryError(parsed.data.error.message, parsed.data.error.code);
    throw new BoundaryError('The server could not complete this request. No fallback engine was used.', 'REQUEST_FAILED');
  }
  return data;
}

export async function fetchCatalog(signal: AbortSignal): Promise<Catalog> {
  const response = await fetch('/api/catalog', { signal, headers: { Accept: 'application/json' } });
  const parsed = CatalogSchema.safeParse(await responseData(response));
  if (!parsed.success) throw new BoundaryError('The source catalog did not match the shared contract. Runs are unavailable.', 'INVALID_CATALOG');
  const catalog = parsed.data;
  const sources = new Set(catalog.sources.map((source) => source.id));
  const products = new Set(catalog.products.map((product) => product.id));
  if (sources.size !== catalog.sources.length || products.size !== catalog.products.length
    || catalog.products.some((product) => product.source_ids.some((id) => !sources.has(id)))) {
    throw new BoundaryError('The catalog contains inconsistent source references. Runs are unavailable.', 'INVALID_CATALOG');
  }
  return catalog;
}

export function validateRunResponse(data: unknown, request: RunRequest, catalog: Catalog): RunResult {
  const parsed = RunResultSchema.safeParse(data);
  if (!parsed.success) throw new BoundaryError('The returned draft failed contract or safety validation. It was not displayed.', 'INVALID_RESULT');
  const result = parsed.data;
  const product = catalog.products.find((item) => item.id === request.product_id);
  if (!product || JSON.stringify(result.product) !== JSON.stringify(product) || result.engine !== request.engine
    || (request.engine === 'claude' && (result.model !== catalog.model || result.model !== 'claude-opus-5-5'))
    || (request.engine === 'evidence' && result.model !== null)) {
    throw new BoundaryError('The returned product or engine does not match this request. The draft was not displayed.', 'RESULT_MISMATCH');
  }
  const allowed = new Set(product.source_ids);
  const returned = new Set(result.sources.map((source) => source.id));
  const invalidSource = result.sources.some((source) => {
    const original = catalog.sources.find((item) => item.id === source.id);
    return !allowed.has(source.id) || !original || source.url !== original.url
      || source.title !== original.title || source.section !== original.section
      || source.revision_date !== original.revision_date || source.excerpt !== original.excerpt;
  });
  if (invalidSource || returned.size !== result.sources.length
    || [...result.flags, ...result.omitted_checks].some((flag) => flag.source_ids.some((id) => !allowed.has(id) || !returned.has(id)))) {
    throw new BoundaryError('The returned citations do not match the product-specific catalog. The draft was not displayed.', 'INVALID_CITATIONS');
  }
  return result;
}

export async function postRun(request: RunRequest, catalog: Catalog, signal: AbortSignal): Promise<RunResult> {
  const body = RunRequestSchema.parse(request);
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return validateRunResponse(await responseData(response), body, catalog);
}

export function describeFailure(error: unknown): { message: string; code: string } {
  if (error instanceof BoundaryError) return { message: error.message, code: error.code };
  return {
    message: 'The backend is unreachable or the connection was interrupted. Check the local API, then try again. No fallback engine was used.',
    code: 'CONNECTION_UNAVAILABLE',
  };
}

export function exportDraft(result: RunResult): void {
  const validated = RunResultSchema.parse(result);
  const blob = new Blob([JSON.stringify(validated, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'conjugate-research-draft.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
