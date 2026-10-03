import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResearchCatalogSchema, ResearchResultSchema } from '@her2/shared';
import { createResearchEventParser, fetchResearchCatalog, initialResearchInputs, RequestEpoch, researchRequest, serializeResearchExport, streamResearchRun, validateResearchResult } from './researchBoundaries';

// Software sentinels only. No scientific answer, clinical case or benchmark score.
const compositionFields = ['ADCdb_ID', 'ADC name', 'Brand', 'Antibody', 'Target', 'Linker', 'Payload', 'DAR'];
// The API serves a composition-only projection: every record carries these eight cells and its ADCdb_ID cell equals its id.
function compositionRecords(count: number) {
  return Array.from({ length: count }, (_, recordIndex) => {
    const id = recordIndex === 0 ? 'DRG0ERKBH' : recordIndex === 1 ? 'DRG0CYMEB' : `DRG0TEST${recordIndex}`;
    const cells = compositionFields.map((field, cellIndex) => ({
      field, cell: `${String.fromCharCode(65 + cellIndex)}${recordIndex + 2}`,
      value: field === 'ADCdb_ID' ? id : recordIndex % 3 === 2 && field === 'DAR' ? null : 'Contract value',
    }));
    return { id, name: 'Contract record', brand: null, target: 'Contract target', payload: null, linker: null, dar: null,
      clinical_enabled: recordIndex < 2, row: recordIndex + 2, cells, missing_fields: cells.filter((cell) => cell.value === null).map((cell) => cell.field) };
  });
}
function catalogWith(records: ReturnType<typeof compositionRecords>) {
  return ResearchCatalogSchema.parse({
    questions: ['composition', 'linker_release', 'payload_risk_transfer', 'workbook_safety'].map((id) => ({ id, title: `Contract ${id}`, description: 'Software sentinel only.' })),
    claude_configured: false, model: 'claude-opus-5-5',
    dataset: { filename: 'adc_table_adcdb.xlsx', sha256: 'a'.repeat(64), imported_at: '2026-01-01T00:00:00Z',
      record_count: records.length, derived_record_count: 4, provenance: 'user_uploaded_unverified', limitations: ['Contract only.'], derived_notice: 'Contract only.', records,
      derived_records: Array.from({ length: 4 }, (_, index) => ({ id: `contract-derived-${index}`, row: index + 2, cells: [] })) },
  });
}
const catalog = catalogWith(compositionRecords(31));
const request = researchRequest({ ...initialResearchInputs(), synthetic_confirmed: true }, catalog);
const step = { id: 'contract-step', stage: 'scope' as const, actor: 'controller' as const, status: 'completed' as const, detail: 'Software sentinel – only.', duration_ms: 1, tool: null, source_ids: [] };
// Strict result does not have the confirmation field; keep the fixture itself contract-shaped.
function cleanResult() {
  const fields = { ...request } as Partial<typeof request>;
  delete fields.synthetic_confirmed;
  return ResearchResultSchema.parse({
    id: 'contract-result', created_at: '2026-01-01T00:00:00Z', ...fields,
    model: null, draft: { product_id: request.product_id, claims: [] }, draft_integrity: 'accepted', answer: 'Software sentinel only.',
    claims: [], omitted_claim_ids: [], receipts: [], challenges: [], unknowns: [], next_actions: [], trace: [step],
    dataset_sha256: catalog.dataset.sha256, clinical_status: 'draft_pending_pharmacist', eligibility: 'not_assessed', needs_human: true,
    guardrail: { status: 'blocked', reasons: ['Contract gate.'] }, answer_correctness_probability: null, omission_probability: null,
  });
}
const finalEvent = () => ({ type: 'result', result: cleanResult() });
const traceEvent = { type: 'trace', step };
const ndjson = (events: unknown[]) => new Response(events.map((event) => JSON.stringify(event)).join('\n'), { headers: { 'Content-Type': 'application/x-ndjson' } });
afterEach(() => vi.unstubAllGlobals());

describe('research request and catalog contracts', () => {
  it('defaults to explicit evidence mode with synthetic use unconfirmed', () => {
    expect(initialResearchInputs()).toMatchObject({ product_id: 'DRG0ERKBH', question_id: 'linker_release', engine: 'evidence', synthetic_confirmed: false });
    expect(() => researchRequest(initialResearchInputs(), catalog)).toThrow();
  });
  it('rejects unavailable engines, questions, products and extra input fields', () => {
    expect(() => researchRequest({ ...request, engine: 'claude' }, catalog)).toThrow('unavailable');
    const withoutComposition = { ...catalog, questions: catalog.questions.filter((question) => question.id !== 'composition') };
    expect(() => researchRequest({ ...request, question_id: 'composition' }, withoutComposition)).toThrow('unavailable');
    const withoutEnabledProduct = { ...catalog, dataset: { ...catalog.dataset, records: catalog.dataset.records.map((record) => record.id === request.product_id ? { ...record, clinical_enabled: false } : record) } };
    expect(() => researchRequest(request, withoutEnabledProduct)).toThrow('unavailable');
    expect(() => researchRequest({ ...request, ...{ patient: 'not allowed' } }, catalog)).toThrow();
  });
  it('validates the actual research catalog GET and refuses inconsistent totals', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog)));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchResearchCatalog(new AbortController().signal)).toEqual(catalog);
    expect(fetch).toHaveBeenCalledWith('/api/research/catalog', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    fetch.mockResolvedValue(new Response(JSON.stringify({ ...catalog, dataset: { ...catalog.dataset, record_count: 2 } })));
    await expect(fetchResearchCatalog(new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESEARCH_CATALOG' });
  });
  it('accepts a composition-only projection of eight cells per record and any record count', async () => {
    const projected = catalogWith(compositionRecords(5));
    expect(projected.dataset.records.every((record) => record.cells.length === 8 && record.cells.map((cell) => cell.field).join() === compositionFields.join())).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(projected))));
    await expect(fetchResearchCatalog(new AbortController().signal)).resolves.toEqual(projected);
  });
  it('rejects a record whose ADCdb_ID cell is missing or does not equal its id', async () => {
    const [first, ...rest] = compositionRecords(3);
    if (!first) throw new Error('Fixture must have a record.');
    const mismatched = { ...first, cells: first.cells.map((cell) => cell.field === 'ADCdb_ID' ? { ...cell, value: 'DRG0OTHER' } : cell) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(catalogWith([mismatched, ...rest])))));
    await expect(fetchResearchCatalog(new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESEARCH_CATALOG' });
    const withoutIdCell = { ...first, cells: first.cells.filter((cell) => cell.field !== 'ADCdb_ID') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(catalogWith([withoutIdCell, ...rest])))));
    await expect(fetchResearchCatalog(new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESEARCH_CATALOG' });
  });
});

describe('validated NDJSON framing', () => {
  it('handles arbitrary boundaries, CRLF, blank lines and an unterminated final line', () => {
    const received: unknown[] = [];
    const parser = createResearchEventParser((event) => received.push(event));
    const text = JSON.stringify(traceEvent) + '\r\n\n' + JSON.stringify(finalEvent());
    for (let offset = 0; offset < text.length; offset += 7) parser.push(text.slice(offset, offset + 7));
    parser.finish();
    expect(received).toEqual([traceEvent, finalEvent()]);
  });
  it('rejects malformed JSON, malformed events and oversized lines', () => {
    expect(() => createResearchEventParser(() => undefined).push('bad\n')).toThrow('unreadable');
    expect(() => createResearchEventParser(() => undefined).push('{"type":"progress"}\n')).toThrow('shared-schema');
    expect(() => createResearchEventParser(() => undefined).push('x'.repeat(1_000_001))).toThrow('limit');
  });
  it('only publishes trace events actually received, then returns a validated result', async () => {
    const fetch = vi.fn().mockResolvedValue(ndjson([traceEvent, finalEvent()]));
    vi.stubGlobal('fetch', fetch);
    const trace = vi.fn();
    expect(await streamResearchRun(request, catalog, new AbortController().signal, trace)).toEqual(cleanResult());
    expect(trace).toHaveBeenCalledExactlyOnceWith(step);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/research/runs/stream', expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }));
  });
  it('decodes UTF-8 characters even when bytes split inside a codepoint', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(traceEvent) + '\n' + JSON.stringify(finalEvent()));
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })));
    const trace = vi.fn();
    await streamResearchRun(request, catalog, new AbortController().signal, trace);
    expect(trace).toHaveBeenCalledWith(step);
  });
  it.each([404, 503])('does not retry or fallback on HTTP %s', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'CONTRACT_UNAVAILABLE', message: 'Contract sentinel.' } }), { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(streamResearchRun(request, catalog, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'CONTRACT_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not retry on an actual streamed engine error', async () => {
    const fetch = vi.fn().mockResolvedValue(ndjson([traceEvent, { type: 'error', error: { code: 'CLAUDE_FAILED', message: 'Contract engine failure.' } }]));
    vi.stubGlobal('fetch', fetch);
    await expect(streamResearchRun(request, catalog, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'CLAUDE_FAILED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a missing result, repeated trace and duplicate or post-result events', async () => {
    for (const events of [[traceEvent], [traceEvent, traceEvent], [finalEvent(), finalEvent()], [finalEvent(), traceEvent]]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjson(events)));
      await expect(streamResearchRun(request, catalog, new AbortController().signal, vi.fn())).rejects.toThrow();
    }
  });
  it('rejects a final execution record that differs from the actual streamed events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjson([{ ...traceEvent, step: { ...step, duration_ms: 2 } }, finalEvent()])));
    await expect(streamResearchRun(request, catalog, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'TRACE_MISMATCH' });
  });
  it('rejects JSON success instead of quietly calling a second endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(cleanResult()), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(streamResearchRun(request, catalog, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'INVALID_STREAM' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('research result and export integrity', () => {
  it('serializes only the validated result, not request confirmation or hidden extras', () => {
    const exported = JSON.parse(serializeResearchExport(cleanResult(), request, catalog));
    expect(exported).toEqual(cleanResult());
    expect(exported).not.toHaveProperty('synthetic_confirmed');
    expect(exported).not.toHaveProperty('patient');
    expect(() => serializeResearchExport({ ...cleanResult(), raw_model: 'hidden' }, request, catalog)).toThrow('validation');
  });
  it.each([{ needs_human: false }, { clinical_status: 'approved' }, { omission_probability: 0.5 }, { answer_correctness_probability: 0.9 }])('rejects clinical safety literal violations %o', (change) => {
    expect(() => validateResearchResult({ ...cleanResult(), ...change }, request, catalog)).toThrow('validation');
  });
  it('rejects mismatched dataset, question or engine', () => {
    for (const mutation of [{ dataset_sha256: 'b'.repeat(64) }, { question_id: 'composition' }, { model: 'unconfigured' }]) {
      expect(() => validateResearchResult({ ...cleanResult(), ...mutation }, request, catalog)).toThrow('does not match');
    }
  });
  it('rejects dangling claim citations and derived receipts eligible for a claim', () => {
    const claim = { id: 'contract-claim', statement: 'Software sentinel.', verdict: 'insufficient', explanation: 'Contract only.', source_ids: ['contract-receipt'], limitation: 'Contract only.' };
    expect(() => validateResearchResult({ ...cleanResult(), claims: [claim] }, request, catalog)).toThrow('citations');
    const receipt = { id: 'contract-receipt', product_id: request.product_id, kind: 'derived', title: 'Software sentinel', url: null, section: 'A2', revision_date: null, excerpt: 'Contract only.', provenance: 'derived_not_adcdb', eligible_for_claim: true, limitations: [] };
    expect(() => validateResearchResult({ ...cleanResult(), receipts: [receipt] }, request, catalog)).toThrow('citations');
  });
  it('keeps rejected draft identifiers as data rather than promoting them to trusted citations', () => {
    const rejected = { ...cleanResult(), draft_integrity: 'rejected', draft: { product_id: 'deliberate-invalid-id', claims: [{ claim_id: 'contract-claim', source_ids: ['deliberate-invented-id'] }] } };
    expect(validateResearchResult(rejected, request, catalog).draft.claims[0]?.source_ids).toEqual(['deliberate-invented-id']);
  });
});

describe('request invalidation', () => {
  it('aborts superseded requests and makes late callbacks inert', () => {
    const epoch = new RequestEpoch();
    const first = epoch.begin();
    expect(epoch.current(first)).toBe(true);
    const second = epoch.begin();
    expect(first.signal.aborted).toBe(true);
    expect(epoch.current(first)).toBe(false);
    expect(epoch.current(second)).toBe(true);
    epoch.invalidate();
    expect(second.signal.aborted).toBe(true);
    expect(epoch.current(second)).toBe(false);
  });
});
