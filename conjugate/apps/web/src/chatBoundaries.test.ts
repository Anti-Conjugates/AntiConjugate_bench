import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchCatalogSchema, type ChatRequest, type ChatResult, type ResearchCatalog } from '@her2/shared';
import { createApp } from '../../api/src/app';
import { runChat } from '../../api/src/chat';
import { AuditCard, ResearchChat } from './ResearchChat';
import { streamChatTurn, validateChatResult } from './chatBoundaries';
const request: ChatRequest = { message: 'What is Enhertu made of?', engine: 'evidence', synthetic_confirmed: true, context: [] };
let catalog: ResearchCatalog; let result: ChatResult;
beforeAll(async () => { const app = await createApp(); catalog = ResearchCatalogSchema.parse((await app.inject({ method: 'GET', url: '/api/research/catalog' })).json()); await app.close(); result = await runChat(request); });
afterEach(() => vi.restoreAllMocks());
function encoded(turn: ChatResult = result) { return JSON.stringify({ type: 'guard', guard: turn.guard }) + '\n' + turn.trace.map(step => JSON.stringify({ type: 'trace', step })).join('\n') + '\n' + JSON.stringify({ type: 'result', result: turn }) + '\n'; }
function mockStream(value: string, splits = [value.length]) {
  const data = new TextEncoder().encode(value); let cursor = 0; let index = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull(controller) { if (cursor >= data.length) { controller.close(); return; } const end = Math.min(data.length, cursor + (splits[index++] ?? 17)); controller.enqueue(data.slice(cursor, end)); cursor = end; } }), { headers: { 'content-type': 'application/x-ndjson' } })));
}
describe('chat client boundary', () => {
  it('accepts nested source-consistent audit results and rejects tampered scope, evidence, gates and counters', () => {
    expect(validateChatResult(result, request, catalog).status).toBe('complete');
    const mutations: ((copy: ChatResult) => void)[] = [copy => { copy.reply = 'RAW_PROVIDER_SENTINEL'; }, copy => { copy.followups[0] = 'FORGED'; }, copy => { copy.audits[0]!.result.unknowns[0] = 'FORGED'; }, copy => { copy.trace[0]!.detail = 'FORGED'; }, copy => { copy.audits[0]!.result.trace.find(step => step.tool === 'read_workbook')!.detail = 'FORGED'; }, copy => { copy.scopes[0]!.evidence_policy = 'workbook_only'; }, copy => { copy.harness.audit_calls = 0; }, copy => { copy.guardrail = { status: 'open' } as never; }, copy => { copy.selected_audit_ids = ['invented']; }, copy => { copy.audits[0]!.result.receipts[0]!.product_id = 'DRG0CYMEB'; }, copy => { copy.audits[0]!.result.dataset_sha256 = '0'.repeat(64); }];
    for (const mutate of mutations) { const copy = structuredClone(result); mutate(copy); expect(() => validateChatResult(copy, request, catalog)).toThrow(); }
  });
  it('recomputes the premise check and rejects missing, tampered or reordered guards', async () => {
    for (const mutate of [(copy: ChatResult) => { delete copy.guard; }, (copy: ChatResult) => { copy.guard!.premise.decision = 'blocked'; }, (copy: ChatResult) => { copy.guard!.live_enabled = false; copy.guard!.premise.findings.push({ ...copy.guard!.premise.findings[0]!, kind: 'unverifiable_entity', check: 'invented_inn', text: 'Forged.', stated: 'x', recorded: null, product_id: null, evidence_ids: [], limitation: copy.guard!.premise.findings[0]?.limitation ?? '' } as never); }]) {
      const copy = structuredClone(result); mutate(copy); expect(() => validateChatResult(copy, request, catalog)).toThrow();
    }
    mockStream(result.trace.map(step => JSON.stringify({ type: 'trace', step })).join('\n') + '\n' + JSON.stringify({ type: 'result', result }) + '\n');
    await expect(streamChatTurn(request, catalog, new AbortController().signal, () => undefined)).rejects.toThrow();
    mockStream(JSON.stringify({ type: 'trace', step: result.trace[0] }) + '\n' + encoded());
    await expect(streamChatTurn(request, catalog, new AbortController().signal, () => undefined)).rejects.toThrow();
    const guards: unknown[] = []; mockStream(encoded());
    await streamChatTurn(request, catalog, new AbortController().signal, () => undefined, guard => guards.push(guard)); expect(guards).toEqual([result.guard]);
  });
  it('decodes byte-split UTF-8 streams and requires exact completed-event equality', async () => {
    mockStream(encoded(), [1, 2, 3, 8, 33, 97]); const steps: unknown[] = [];
    expect((await streamChatTurn(request, catalog, new AbortController().signal, step => steps.push(step))).status).toBe('complete'); expect(steps).toEqual(result.trace);
    mockStream(encoded().replace(JSON.stringify(result.trace[0]), JSON.stringify({ ...result.trace[0], detail: 'CHANGED' })));
    await expect(streamChatTurn(request, catalog, new AbortController().signal, () => undefined)).rejects.toThrow();
  });
  it('rejects premature EOF, duplicate results, invalid JSON and trailing events without fallback', async () => {
    for (const value of ['{bad}\n', JSON.stringify({ type: 'trace', step: result.trace[0] }) + '\n', encoded() + JSON.stringify({ type: 'result', result }) + '\n', encoded() + JSON.stringify({ type: 'trace', step: result.trace[0] }) + '\n']) {
      mockStream(value); await expect(streamChatTurn(request, catalog, new AbortController().signal, () => undefined)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects cancelled requests and disabled Claude before a provider request', async () => {
    mockStream(encoded()); const controller = new AbortController(); controller.abort();
    await expect(streamChatTurn(request, catalog, controller.signal, () => undefined)).rejects.toThrow();
    vi.mocked(fetch).mockClear(); await expect(streamChatTurn({ ...request, engine: 'claude' }, catalog, new AbortController().signal, () => undefined)).rejects.toThrow(/Claude is off/); expect(fetch).not.toHaveBeenCalled();
  });
  it('never forwards upstream text or unknown error codes into a user-visible failure', async () => {
    for (const code of ['CLAUDE_UNAVAILABLE', 'RAW_PROVIDER_SENTINEL']) {
      mockStream(JSON.stringify({ type: 'error', error: { code, message: 'RAW_PROVIDER_SENTINEL' } }) + '\n');
      await expect(streamChatTurn(request, catalog, new AbortController().signal, () => undefined)).rejects.not.toThrow(/RAW_PROVIDER_SENTINEL/);
    }
  });
  it('renders the composer and examples, synthetic consent and no fake activity or automatic run', () => {
    const html = renderToStaticMarkup(createElement(ResearchChat, { catalog }));
    expect(html).toContain('Ask about the evidence'); expect(html).toContain('Compare the two ADCs'); expect(html).toContain('Synthetic research only'); expect(html).toContain('Claude is off'); expect(html).toContain('maxLength="1000"'); expect(html).not.toContain('completed events');
  });
  it('renders per-turn source anchors without collisions and exposes actual local reads', () => {
    const audit = result.audits[0]!;
    const html = ['first', 'second'].map(turnId => renderToStaticMarkup(createElement(AuditCard, { audit, turnId, catalog, previous: undefined }))).join('');
    const ids = [...html.matchAll(/id="(source-[^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length); expect(ids.length).toBe(8); expect(html).toContain('Local tool events');
    for (const href of html.matchAll(/href="#(source-[^"]+)"/g)) expect(ids).toContain(href[1]);
  });
});
