import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchCatalogSchema, type ResearchCatalog, type TeamRequest, type TeamResult } from '@her2/shared';
import { createApp } from '../../api/src/app';
import { runTeam } from '../../api/src/team';
import { TeamGraph, isTeamResult, modelCalls } from './ResearchChat';
import { streamTeamTurn, validateTeamResult } from './teamBoundaries';
const request: TeamRequest = { message: 'Compare Kadcyla and Enhertu composition.', engine: 'evidence', synthetic_confirmed: true, context: [] };
let catalog: ResearchCatalog; let result: TeamResult;
beforeAll(async () => { const app = await createApp(); catalog = ResearchCatalogSchema.parse((await app.inject({ method: 'GET', url: '/api/research/catalog' })).json()); await app.close(); result = await runTeam(request); });
afterEach(() => vi.restoreAllMocks());
function encoded(turn: TeamResult = result) { return turn.trace.map((step, index) => (index === 1 ? JSON.stringify({ type: 'guard', guard: turn.guard }) + '\n' : '') + JSON.stringify({ type: 'trace', step })).join('\n') + '\n' + JSON.stringify({ type: 'result', result: turn }) + '\n'; }
function mockStream(value: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(value)); controller.close(); } }), { headers: { 'content-type': 'application/x-ndjson' } })));
}
describe('agent-team client boundary', () => {
  it('accepts a consistent team result and rejects tampered workers, selections, counters and trace', () => {
    expect(validateTeamResult(result, request, catalog).status).toBe('complete');
    expect(isTeamResult(result)).toBe(true); expect(modelCalls(result)).toBe(0);
    const mutations: ((copy: TeamResult) => void)[] = [copy => { copy.reply = 'FORGED'; }, copy => { copy.selected_audit_ids.push('audit-3'); }, copy => { copy.harness.worker_calls = 2; }, copy => { copy.workers[0]!.status = 'failed'; copy.workers[0]!.code = 'CLAUDE_REFUSED'; },
      copy => { copy.trace.pop(); }, copy => { copy.audits[0]!.result.claims[0]!.source_ids = []; }, copy => { copy.engine = 'claude'; }, copy => { copy.revisions = 1; }, copy => { copy.missing_scopes = []; copy.scopes.push({ product_id: 'DRG0CYMEB', question_id: 'linker_release', evidence_policy: 'all' }); }];
    for (const mutate of mutations) { const copy = structuredClone(result); mutate(copy); expect(() => validateTeamResult(copy, request, catalog)).toThrow(); }
  });
  it('streams events in order and requires the trace to match the result exactly', async () => {
    mockStream(encoded()); const steps: unknown[] = [];
    expect((await streamTeamTurn(request, catalog, new AbortController().signal, step => steps.push(step))).status).toBe('complete'); expect(steps).toEqual(result.trace);
    mockStream(encoded().replace('"node":"answer"', '"node":"omission_gate"')); await expect(streamTeamTurn(request, catalog, new AbortController().signal, () => undefined)).rejects.toThrow();
    mockStream(JSON.stringify({ type: 'error', error: { code: 'CLAUDE_REFUSED', message: 'upstream text' } }) + '\n'); await expect(streamTeamTurn(request, catalog, new AbortController().signal, () => undefined)).rejects.toThrow(/refused/);
    mockStream(encoded()); await expect(streamTeamTurn({ ...request, engine: 'claude' }, catalog, new AbortController().signal, () => undefined)).rejects.toThrow(/Claude is off/); expect(fetch).not.toHaveBeenCalled();
  });
  it('renders every graph node with who ran it and marks failures', () => {
    const markup = renderToStaticMarkup(createElement(TeamGraph, { steps: result.trace, pending: false }));
    for (const label of ['Scope gate', 'Lead plans', 'Workers check', 'Verifier', 'Lead selects', 'Omission gate', 'Answer']) expect(markup).toContain(label);
    expect(markup).toContain('2 × code'); expect(markup).toContain('verifier code'); expect(markup).not.toContain('Claude lead');
    const failed = renderToStaticMarkup(createElement(TeamGraph, { steps: [{ ...result.trace[2]!, status: 'failed', code: 'CLAUDE_REFUSED', actor: 'worker_agent', model_calls: 1 }], pending: true }));
    expect(failed).toContain('data-state="failed"'); expect(failed).toContain('CLAUDE_REFUSED'); expect(failed).toContain('data-state="waiting"');
  });
});
