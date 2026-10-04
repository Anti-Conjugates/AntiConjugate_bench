import { ApiErrorSchema, ChatEventSchema, ChatRequestSchema, ChatResultSchema, chatExecutionIsConsistent, chatIntent, chatScopeKey, renderChatReply, type ChatRequest, type ChatResult, type ChatStep, type ResearchCatalog } from '@her2/shared';
import { BoundaryError } from './boundaries';
import { validateResearchResult } from './researchBoundaries';

function invalid(message = 'The chat response failed validation. No answer was accepted.'): never { throw new BoundaryError(message, 'INVALID_CHAT_RESULT'); }
function failure(code: string): BoundaryError {
  const messages: Record<string, string> = {
    CLAUDE_NOT_CONFIGURED: 'Claude is off. Choose rules only to make a new request.', CLAUDE_UNAVAILABLE: 'The Claude API is unavailable.', CLAUDE_TIMEOUT: 'The question timed out.', CLAUDE_REFUSED: 'Claude refused this request.', CLAUDE_INVALID_OUTPUT: 'Claude returned an invalid tool request or selection.', CLAUDE_CONTEXT_LIMIT: 'The provider request exceeded its size limit.', CHAT_BUDGET_EXCEEDED: 'The question reached its call limit.', CHAT_BUSY: 'Two questions are already running. Try after one finishes.', RESEARCH_SKILL_INVALID: 'A required local prompt file failed validation.', RESEARCH_CANCELLED: 'The request was cancelled.', INVALID_REQUEST: 'The request failed validation.', RATE_LIMITED: 'Too many requests. Try again later.', BODY_TOO_LARGE: 'The request was too large.'
  };
  const message = Object.hasOwn(messages, code) ? messages[code] : undefined;
  return new BoundaryError(`${message ?? 'The chat request could not be completed.'} No answer was accepted. No fallback was used.`, message ? code : 'REQUEST_FAILED');
}
export function validateChatResult(data: unknown, request: ChatRequest, catalog: ResearchCatalog): ChatResult {
  const parsed = ChatResultSchema.safeParse(data);
  if (!parsed.success) return invalid();
  const result = parsed.data;
  if (result.reply !== renderChatReply(result.status, result.audits, result.selected_audit_ids, result.missing_scopes.length)) return invalid();
  const intent = chatIntent(request);
  if (result.engine !== request.engine || !chatExecutionIsConsistent(result) || JSON.stringify(result.scopes.map(chatScopeKey)) !== JSON.stringify(intent.scopes.map(chatScopeKey)) || (intent.status !== 'ready' && result.status !== intent.status)) return invalid();
  for (const audit of result.audits) validateResearchResult(audit.result, { ...audit.scope, engine: 'evidence', synthetic_confirmed: true, integrity_drill: 'none' }, catalog);
  return result;
}

export async function streamChatTurn(input: ChatRequest, catalog: ResearchCatalog, signal: AbortSignal, onStep: (step: ChatStep) => void): Promise<ChatResult> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const request = ChatRequestSchema.parse(input);
  if (request.engine === 'claude' && !catalog.claude_configured) throw new BoundaryError('Claude is off. Choose rules only to make a new request.', 'CLAUDE_NOT_CONFIGURED');
  const response = await fetch('/api/chat/turns/stream', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify(request), signal });
  if (!response.ok) {
    let error: unknown;
    try { error = await response.json(); } catch { throw new BoundaryError('The chat request failed. No answer was accepted.', 'REQUEST_FAILED'); }
    const parsed = ApiErrorSchema.safeParse(error);
    if (parsed.success) throw failure(parsed.data.error.code);
    return invalid();
  }
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) return invalid('The server did not return a chat stream. No fallback was used.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let bytes = 0;
  let result: ChatResult | undefined;
  const steps: ChatStep[] = [];
  const line = (value: string) => {
    if (!value.trim()) return;
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (result) return invalid('The chat stream continued after its result.');
    let data: unknown;
    try { data = JSON.parse(value); } catch { return invalid(); }
    const parsed = ChatEventSchema.safeParse(data);
    if (!parsed.success) return invalid();
    const event = parsed.data;
    if (event.type === 'error') throw failure(event.error.code);
    if (event.type === 'result') { result = validateChatResult(event.result, request, catalog); return; }
    if (steps.length >= 12 || event.step.id !== `step-${steps.length + 1}` || steps.some(step => step.stage === 'answer') || (event.step.scope && !chatIntent(request).scopes.some(scope => chatScopeKey(scope) === chatScopeKey(event.step.scope!)))) return invalid();
    steps.push(event.step); onStep(event.step);
  };
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1000000) return invalid('The chat stream exceeded its size limit.');
      pending += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) { line(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
      if (pending.length > 300000) return invalid();
    }
    pending += decoder.decode(); line(pending);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const completed = result as ChatResult | undefined;
    if (!completed || JSON.stringify(completed.trace) !== JSON.stringify(steps)) return invalid('The chat stream ended without a matching checked result.');
    return completed;
  } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

export function downloadChatResult(result: ChatResult, request: ChatRequest, catalog: ResearchCatalog) {
  const blob = new Blob([JSON.stringify(validateChatResult(result, request, catalog), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'conjugate-chat-turn.json';
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
