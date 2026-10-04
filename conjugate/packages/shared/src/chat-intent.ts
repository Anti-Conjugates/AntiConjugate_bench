import { chatScopeKey, type ChatRequest, type ChatScope } from './chat.js';

const PRODUCT_TERMS = { DRG0CYMEB: ['kadcyla', 'emtansine', 'tdm1', 't-dm1'], DRG0ERKBH: ['enhertu', 'deruxtecan', 'tdxd', 't-dxd'] } as const;
const TERMS = new Set(('compare comparison same different both two what why how does do is are can cannot not no yes it they them that this and or with without only all sources source label labels workbook data evidence restore remove withhold again explain made composition target payload dar ratio linker cleavable release blood circulation risk transfer toxicity safety identity fda openfda name names works mechanism dm1 dxd her2').split(' '));
export interface ChatIntent { status: 'ready' | 'clarification' | 'outside_scope'; recognized_terms: string[]; scopes: ChatScope[]; action: 'check' | 'compare' | 'withhold' | 'restore' }

export function chatConversationContext(requests: readonly ChatRequest[]): ChatScope[] {
  for (const request of [...requests].reverse()) {
    const intent = chatIntent(request);
    if (intent.status === 'ready') return intent.scopes;
  }
  return [];
}

export function chatIntent(request: ChatRequest): ChatIntent {
  const text = request.message.toLowerCase().replaceAll('’', "'").replace(/\bdon'?t\b/g, 'do not');
  const words = text.match(/[a-z0-9-]+/g) ?? [];
  const recognized_terms = words.flatMap(word => {
    for (const [id, aliases] of Object.entries(PRODUCT_TERMS)) if ((aliases as readonly string[]).includes(word) || word === id.toLowerCase()) return [id];
    return TERMS.has(word) ? [word] : [];
  });
  const result: ChatIntent = { status: 'ready', recognized_terms, scopes: [], action: 'check' };
  // This scope guard is not a PHI detector. Unknown text is never sent to the provider.
  if (/\b(patient|dose|dosing|dosage|prescrib\w*|eligible|eligibility|recommend\w*|treat\w*|safer|safest|medication|symptoms?|my|mother|father|wife|husband|aged|years? old|ehr|mrn)\b/.test(text) || /@|https?:|\b\d{3,}\b|sk-ant-|hf_/.test(text)) { result.status = 'outside_scope'; return result; }
  const has = (...terms: string[]) => recognized_terms.some(term => terms.includes(term));
  const comparing = has('compare', 'comparison', 'same', 'different', 'both', 'two');
  const products = [...new Set(recognized_terms.filter((term): term is ChatScope['product_id'] => term === 'DRG0CYMEB' || term === 'DRG0ERKBH'))];
  if (comparing && has('both', 'two') && products.length < 2) products.push('DRG0CYMEB', 'DRG0ERKBH');
  if (comparing && products.length === 1 && request.context.length) {
    if (new Set(request.context.map(scope => scope.question_id)).size > 1 && /\bcompare\s+(?:(?:it|this|that)\s+)?with\b/.test(text)) { result.status = 'clarification'; return result; }
    products.push(...new Set(request.context.map(scope => scope.product_id)));
  }
  if (!products.length && request.context.length) products.push(...new Set(request.context.map(scope => scope.product_id)));
  if (!products.length) { result.status = 'clarification'; return result; }
  const negatedRestore = /\b(?:not|never|no)\s+(?:restore|include|use|add)\b/.test(text);
  const negatedWithdrawal = /\b(?:not|never|no)\s+(?:withhold|remove|exclude)\b/.test(text);
  const allSourcePhrase = /\b(?:restore|include|use|with)\s+all\s+(?:sources?|evidence)\b/.test(text) || /^all sources[.!?\s]*$/.test(text);
  const restorationMention = (has('restore') && has('label', 'labels', 'source', 'sources', 'evidence')) || allSourcePhrase;
  const ambiguousNegation = restorationMention && /\b(?:not|never|no|none|nothing|neither|cannot|without|withheld|[a-z]+n't)\b/.test(text) && !negatedRestore;
  const ambiguousRestoration = restorationMention && !allSourcePhrase && !negatedRestore && !ambiguousNegation;
  const withdrawing = negatedRestore || ((has('withhold', 'without', 'remove') && has('label', 'labels', 'source', 'sources', 'evidence')) || /\bno\s+(?:labels?|sources?|evidence)\b/.test(text)) || (has('only') && has('workbook'));
  const restoring = !negatedRestore && !ambiguousNegation && allSourcePhrase;
  if (ambiguousNegation || ambiguousRestoration || negatedWithdrawal || (withdrawing && restoring) || (!withdrawing && !restoring && new Set(request.context.map(scope => scope.evidence_policy)).size > 1)) { result.status = 'clarification'; return result; }
  result.action = withdrawing ? 'withhold' : restoring ? 'restore' : comparing ? 'compare' : 'check';
  const policy = withdrawing ? 'workbook_only' : restoring ? 'all' : request.context[0]?.evidence_policy ?? 'all';
  const topics: ChatScope['question_id'][] = [];
  const risk = has('risk', 'transfer', 'toxicity');
  if (has('composition', 'made', 'target', 'dar', 'ratio', 'dm1', 'dxd') || (has('payload') && !risk)) topics.push('composition');
  if (has('linker', 'cleavable', 'release', 'blood', 'circulation')) topics.push('linker_release');
  if (risk) topics.push('payload_risk_transfer');
  if (has('workbook') && has('safety')) topics.push('workbook_safety');
  if (has('identity', 'fda', 'openfda', 'name', 'names')) topics.push('label_identity');
  if (!topics.length && comparing && request.context.length) topics.push(...new Set(request.context.map(scope => scope.question_id)));
  if (!topics.length && request.context.length && has('why', 'explain', 'again', 'without', 'withhold', 'remove', 'restore', 'all', 'sources', 'only')) topics.push(...new Set(request.context.map(scope => scope.question_id)));
  if (!topics.length && (result.action === 'compare' || has('works', 'mechanism', 'how'))) topics.push('composition', 'linker_release');
  if (!topics.length) { result.status = 'clarification'; return result; }
  result.scopes = products.flatMap(product_id => topics.map(question_id => ({ product_id, question_id, evidence_policy: policy })));
  result.scopes = [...new Map(result.scopes.map(scope => [chatScopeKey(scope), scope])).values()];
  if (result.scopes.length > 4) { result.scopes = []; result.status = 'clarification'; }
  return result;
}
