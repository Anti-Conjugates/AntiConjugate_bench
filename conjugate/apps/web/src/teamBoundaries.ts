import { ApiErrorSchema, TeamEventSchema, TeamRequestSchema, TeamResultSchema, chatIntent, chatScopeKey, renderChatReply, teamExecutionIsConsistent, type ResearchCatalog, type TeamRequest, type TeamResult, type TeamStep } from '@her2/shared';
import { BoundaryError } from './boundaries';
import { validateResearchResult } from './researchBoundaries';

function invalid(message = 'The agent-team response failed validation. No answer was accepted.'): never { throw new BoundaryError(message, 'INVALID_TEAM_RESULT'); }
function failure(code: string): BoundaryError {
  const messages: Record<string, string> = {
    CLAUDE_NOT_CONFIGURED: 'Claude is off. Choose rules only to make a new request.', CLAUDE_UNAVAILABLE: 'The Claude API is unavailable.', CLAUDE_TIMEOUT: 'The question timed out.', CLAUDE_REFUSED: 'Claude refused this request.',
    CLAUDE_INVALID_OUTPUT: 'An agent returned output outside its contract.', CLAUDE_CONTEXT_LIMIT: 'A model request exceeded the local size limit.', CHAT_BUDGET_EXCEEDED: 'The team reached its call limit.', CHAT_BUSY: 'An agent-team question is already running on this server.',
    RESEARCH_CANCELLED: 'The question was cancelled.', RESEARCH_SKILL_INVALID: 'A local prompt file failed validation.', INVALID_REQUEST: 'The request did not match the API schema.', RATE_LIMITED: 'The server rate limit was reached.'
  };
  const message = Object.hasOwn(messages, code) ? messages[code] : undefined;
  return new BoundaryError(`${message ?? 'The agent-team request could not be completed.'} No answer was accepted. No fallback was used.`, message ? code : 'REQUEST_FAILED');
}
export function validateTeamResult(data: unknown, request: TeamRequest, catalog: ResearchCatalog): TeamResult {
  const parsed = TeamResultSchema.safeParse(data);
  if (!parsed.success) return invalid();
  const result = parsed.data;
  const intent = chatIntent(request);
  if (result.reply !== renderChatReply(result.status, result.audits, result.selected_audit_ids, result.missing_scopes.length) || result.engine !== request.engine || !teamExecutionIsConsistent(result)
    || JSON.stringify(result.scopes.map(chatScopeKey)) !== JSON.stringify(intent.scopes.map(chatScopeKey)) || (intent.status !== 'ready' && result.status !== intent.status)) return invalid();
  for (const audit of result.audits) validateResearchResult(audit.result, { ...audit.scope, engine: 'evidence', synthetic_confirmed: true, integrity_drill: 'none' }, catalog);
  return result;
}
export async function streamTeamTurn(input: TeamRequest, catalog: ResearchCatalog, signal: AbortSignal, onStep: (step: TeamStep) => void): Promise<TeamResult> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const request = TeamRequestSchema.parse(input);
  if (request.engine === 'claude' && !catalog.claude_configured) throw new BoundaryError('Claude is off. Choose rules only to make a new request.', 'CLAUDE_NOT_CONFIGURED');
  const response = await fetch('/api/team/turns/stream', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify(request), signal });
  if (!response.ok) {
    let error: unknown;
    try { error = await response.json(); } catch { throw new BoundaryError('The agent-team request failed. No answer was accepted.', 'REQUEST_FAILED'); }
    const parsed = ApiErrorSchema.safeParse(error);
    if (parsed.success) throw failure(parsed.data.error.code);
    return invalid();
  }
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) return invalid('The server did not return an agent-team stream. No fallback was used.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let bytes = 0;
  let result: TeamResult | undefined;
  const steps: TeamStep[] = [];
  const authorized = chatIntent(request).scopes.map(chatScopeKey);
  const line = (value: string) => {
    if (!value.trim()) return;
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (result) return invalid('The agent-team stream continued after its result.');
    let data: unknown;
    try { data = JSON.parse(value); } catch { return invalid(); }
    const parsed = TeamEventSchema.safeParse(data);
    if (!parsed.success) return invalid();
    const event = parsed.data;
    if (event.type === 'error') throw failure(event.error.code);
    if (event.type === 'result') { result = validateTeamResult(event.result, request, catalog); return; }
    if (steps.length >= 24 || event.step.id !== `step-${steps.length + 1}` || steps.some(step => step.node === 'answer') || (event.step.scope && !authorized.includes(chatScopeKey(event.step.scope)))) return invalid();
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
      if (bytes > 1000000) return invalid('The agent-team stream exceeded its size limit.');
      pending += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) { line(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
      if (pending.length > 300000) return invalid();
    }
    pending += decoder.decode(); line(pending);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const completed = result as TeamResult | undefined;
    if (!completed || JSON.stringify(completed.trace) !== JSON.stringify(steps)) return invalid('The agent-team stream ended without a matching checked result.');
    return completed;
  } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
export function downloadTeamResult(result: TeamResult, request: TeamRequest, catalog: ResearchCatalog) {
  const blob = new Blob([JSON.stringify(validateTeamResult(result, request, catalog), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'conjugate-team-turn.json';
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
