import {
  ApiErrorSchema, ResearchCatalogSchema, ResearchEventSchema, ResearchRequestSchema, ResearchResultSchema,
  ResearchQuestionSchema, researchExecutionIsConsistent,
  type ResearchCatalog, type ResearchEvent, type ResearchRequest, type ResearchResult, type ResearchTrace,
} from '@her2/shared';
import { BoundaryError } from './boundaries';

export type ResearchInputs = Omit<ResearchRequest, 'synthetic_confirmed'> & { synthetic_confirmed: boolean };
export function initialResearchInputs(): ResearchInputs {
  return { product_id: 'DRG0ERKBH', question_id: 'linker_release', engine: 'evidence', evidence_policy: 'all', integrity_drill: 'none', synthetic_confirmed: false };
}

function invalid(message: string, code = 'INVALID_RESEARCH_RESULT'): never { throw new BoundaryError(message, code); }
async function jsonResponse(response: Response): Promise<unknown> {
  let data: unknown;
  try { data = await response.json(); } catch { return invalid('The server response was not readable JSON. No draft was accepted.', 'INVALID_RESPONSE'); }
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(data);
    if (parsed.success) throw new BoundaryError(parsed.data.error.message, parsed.data.error.code);
    return invalid('The research request failed. No endpoint or engine fallback was used.', 'REQUEST_FAILED');
  }
  return data;
}

export async function fetchResearchCatalog(signal: AbortSignal): Promise<ResearchCatalog> {
  const response = await fetch('/api/research/catalog', { signal, headers: { Accept: 'application/json' } });
  const parsed = ResearchCatalogSchema.safeParse(await jsonResponse(response));
  if (!parsed.success) return invalid('The research catalog failed shared-schema validation. Runs are unavailable.', 'INVALID_RESEARCH_CATALOG');
  const catalog = parsed.data;
  const { dataset } = catalog;
  const questionIds = new Set(catalog.questions.map((question) => question.id));
  const clinicalIds = dataset.records.filter((record) => record.clinical_enabled).map((record) => record.id).sort();
  // The API serves a composition-only projection of each record, so cell counts are not fixed here.
  if (dataset.record_count !== dataset.records.length || dataset.derived_record_count !== dataset.derived_records.length
    || dataset.records.length === 0
    || new Set(dataset.records.map((record) => record.id)).size !== dataset.records.length
    || dataset.records.some((record) => record.cells.length === 0 || !record.cells.some((cell) => cell.field === 'ADCdb_ID' && cell.value === record.id))
    || questionIds.size !== ResearchQuestionSchema.options.length || ResearchQuestionSchema.options.some((id) => !questionIds.has(id))
    || clinicalIds.join(',') !== 'DRG0CYMEB,DRG0ERKBH'
    || dataset.records.some((record) => new Set(record.cells.map((cell) => cell.field)).size !== record.cells.length)) {
    return invalid('The workbook catalog has inconsistent record identities or counts.', 'INVALID_RESEARCH_CATALOG');
  }
  return catalog;
}

export function researchRequest(inputs: ResearchInputs, catalog: ResearchCatalog): ResearchRequest {
  const request = ResearchRequestSchema.parse(inputs);
  if (!catalog.questions.some((question) => question.id === request.question_id)
    || !catalog.dataset.records.some((record) => record.id === request.product_id && record.clinical_enabled)
    || (request.engine === 'claude' && (!catalog.claude_configured || catalog.model !== 'claude-opus-5-5'))) {
    return invalid('This product, hypothesis or engine is unavailable in the server catalog. Nothing was sent.', 'UNAVAILABLE_SELECTION');
  }
  return request;
}

export function validateResearchResult(data: unknown, request: ResearchRequest, catalog: ResearchCatalog): ResearchResult {
  const parsed = ResearchResultSchema.safeParse(data);
  if (!parsed.success) return invalid('The returned research draft failed contract or safety validation. It was not displayed.');
  const result = parsed.data;
  if (result.product_id !== request.product_id || result.question_id !== request.question_id || result.engine !== request.engine
    || result.evidence_policy !== request.evidence_policy || result.integrity_drill !== request.integrity_drill
    || result.dataset_sha256 !== catalog.dataset.sha256
    || (request.engine === 'evidence' ? result.model !== null : result.model !== catalog.model)) {
    return invalid('The returned research scope, engine or dataset does not match this request.', 'RESULT_MISMATCH');
  }
  const receipts = new Map(result.receipts.map((receipt) => [receipt.id, receipt]));
  const expectedReceiptId = (kind: ResearchResult['receipts'][number]['kind']) => kind === 'workbook'
    ? `WORKBOOK-${request.product_id}-COMPOSITION`
    : kind === 'openfda' ? `US-OPENFDA-${request.product_id}-IDENTITY`
      : kind === 'derived' ? `DERIVED-${request.product_id}-NOT-ADCDB`
      : request.product_id === 'DRG0ERKBH' ? 'UK-ENHERTU-SMPC' : 'UK-KADCYLA-SMPC';
  const acceptedDraftMatchesClaims = result.draft_integrity === 'accepted'
    && result.draft.claims.length === result.claims.length
    && result.draft.claims.every((draftClaim) => result.claims.some((claim) => claim.id === draftClaim.claim_id
      && claim.source_ids.length === draftClaim.source_ids.length && claim.source_ids.every((id) => draftClaim.source_ids.includes(id))));
  if (receipts.size !== result.receipts.length || new Set(result.claims.map((claim) => claim.id)).size !== result.claims.length
    || new Set(result.trace.map((step) => step.id)).size !== result.trace.length
    || !researchExecutionIsConsistent(result)
    || result.receipts.some((receipt) => receipt.product_id !== request.product_id || receipt.id !== expectedReceiptId(receipt.kind)
      || (request.evidence_policy === 'workbook_only' && receipt.kind !== 'workbook')
      || (receipt.kind === 'derived' && (receipt.provenance !== 'derived_not_adcdb' || receipt.eligible_for_claim))
      || (receipt.kind === 'workbook' && receipt.provenance !== 'user_uploaded_unverified')
      || (receipt.kind === 'label' && (receipt.provenance !== 'label_paraphrase_pending_review' || request.evidence_policy === 'workbook_only'))
      || (receipt.kind === 'openfda' && (receipt.provenance !== 'openfda_identity_snapshot' || request.evidence_policy === 'workbook_only'
        || receipt.eligible_for_claim !== (request.question_id === 'label_identity'))))
    || result.harness.sources.length !== result.receipts.length
    || new Set(result.harness.sources.map(source => source.id)).size !== result.harness.sources.length
    || result.harness.sources.some(source => !receipts.has(source.id))
    || result.harness.model_calls !== (request.engine === 'claude' ? 2 : 0)
    || (request.engine === 'evidence' && result.harness.skills.length > 0)
    || result.harness.tool_calls !== result.trace.filter(step => step.stage === 'retrieve' && step.tool !== null && step.status === 'completed').length
    || result.claims.some((claim) => claim.source_ids.some((id) => !receipts.get(id)?.eligible_for_claim))
    || result.challenges.some((challenge) => challenge.source_ids.some((id) => !receipts.has(id)))
    || result.trace.some((step) => step.source_ids.some((id) => !receipts.has(id)))
    || (result.draft_integrity === 'accepted' && (!acceptedDraftMatchesClaims || result.draft.product_id !== request.product_id
      || result.draft.claims.some((claim) => claim.source_ids.some((id) => !receipts.get(id)?.eligible_for_claim))))
    || (result.draft_integrity === 'rejected' && result.claims.length > 0)) {
    return invalid('The trusted result contains inconsistent or ineligible citations. No draft was displayed.', 'INVALID_CITATIONS');
  }
  return result;
}

/** Incremental NDJSON framing; validates each event before it leaves the boundary. */
export function createResearchEventParser(onEvent: (event: ResearchEvent) => void) {
  let pending = '';
  let total = 0;
  const line = (value: string) => {
    if (!value.trim()) return;
    let data: unknown;
    try { data = JSON.parse(value); } catch { return invalid('A research stream event was unreadable. No draft was accepted.', 'INVALID_STREAM'); }
    const parsed = ResearchEventSchema.safeParse(data);
    if (!parsed.success) return invalid('A research stream event failed shared-schema validation.', 'INVALID_STREAM');
    onEvent(parsed.data);
  };
  return {
    push(chunk: string) {
      total += chunk.length;
      if (total > 4_000_000) return invalid('The research stream exceeded the client safety limit.', 'INVALID_STREAM');
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        if (newline > 1_000_000) return invalid('A research stream event exceeded the client safety limit.', 'INVALID_STREAM');
        line(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > 1_000_000) return invalid('A research stream event exceeded the client safety limit.', 'INVALID_STREAM');
    },
    finish() { line(pending); pending = ''; },
  };
}

/** No fallback: even an unsupported stream route remains an explicit failure. */
export async function streamResearchRun(
  request: ResearchRequest, catalog: ResearchCatalog, signal: AbortSignal, onTrace: (step: ResearchTrace) => void,
): Promise<ResearchResult> {
  const body = researchRequest(request, catalog);
  const response = await fetch('/api/research/runs/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(body), signal,
  });
  if (!response.ok) { await jsonResponse(response); return invalid('Research request failed.', 'REQUEST_FAILED'); }
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    return invalid('The server did not return an NDJSON research stream. No fallback request was made.', 'INVALID_STREAM');
  }
  let result: ResearchResult | null = null;
  const streamedTrace: ResearchTrace[] = [];
  const traceIds = new Set<string>();
  const parser = createResearchEventParser((event) => {
    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (result) return invalid('The research stream continued after its final result.', 'INVALID_STREAM');
    if (event.type === 'error') throw new BoundaryError(event.error.message, event.error.code);
    if (event.type === 'result') { result = validateResearchResult(event.result, body, catalog); return; }
    if (traceIds.has(event.step.id)) return invalid('The research stream repeated a trace identity.', 'INVALID_STREAM');
    traceIds.add(event.step.id);
    streamedTrace.push(event.step);
    onTrace(event.step);
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const chunk = await reader.read();
      if (chunk.done) break;
      parser.push(decoder.decode(chunk.value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const completed = result as ResearchResult | null;
    if (!completed) return invalid('The stream ended without a validated result. No draft was accepted.', 'INCOMPLETE_STREAM');
    if (JSON.stringify(completed.trace) !== JSON.stringify(streamedTrace)) {
      return invalid('The final execution record does not match the events actually streamed.', 'TRACE_MISMATCH');
    }
    return completed;
  } catch (error: unknown) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

export function serializeResearchExport(result: unknown, request: ResearchRequest, catalog: ResearchCatalog): string {
  return JSON.stringify(validateResearchResult(result, request, catalog), null, 2);
}
export function downloadResearchResult(result: ResearchResult, request: ResearchRequest, catalog: ResearchCatalog): void {
  const blob = new Blob([serializeResearchExport(result, request, catalog)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'conjugate-evidence-audit.json';
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Request identity is independent of React state and makes superseded callbacks inert. */
export class RequestEpoch {
  private revision = 0;
  private controller: AbortController | null = null;
  invalidate() { this.revision += 1; this.controller?.abort(); this.controller = null; }
  begin() {
    this.invalidate();
    this.controller = new AbortController();
    return { revision: this.revision, signal: this.controller.signal };
  }
  current(ticket: { revision: number; signal: AbortSignal }) { return ticket.revision === this.revision && !ticket.signal.aborted; }
}
