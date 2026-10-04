import { readFileSync } from 'node:fs';
import { LIVE_PRODUCT_QUESTIONS, TurnGuardSchema, WorkbookDatasetSchema, guardLiveReferences, premiseFacts, premiseGate, premiseReferencesFromLive, type ChatIntent, type LiveReceipt, type TurnGuard } from '@her2/shared';
import type { LiveRetriever } from './live-retrieval.js';

const dataset = WorkbookDatasetSchema.parse(JSON.parse(readFileSync(new URL('./workbook.snapshot.json', import.meta.url), 'utf8')));
export const PREMISE_FACTS = premiseFacts(dataset);

/**
 * Runs before any model call or evidence read. References are resolved live only when a retriever is
 * configured; product receipts are fetched only for composition or label-identity scopes and only when the
 * premise is not blocked. A failed fetch stays an error receipt, which keeps an unresolved reference blocked.
 */
export async function turnGuard(message: string, intent: ChatIntent, live: LiveRetriever | null | undefined, signal?: AbortSignal): Promise<TurnGuard> {
  const receipts: LiveReceipt[] = [];
  const references = intent.status === 'outside_scope' ? [] : guardLiveReferences(message);
  if (live && references.length) receipts.push(...(await live.check({ references }, signal)).receipts);
  // Outside-scope text is never echoed into findings; the gate is not evaluated for it.
  const premise = premiseGate(intent.status === 'outside_scope' ? '' : message, PREMISE_FACTS, { references: premiseReferencesFromLive(receipts) });
  if (live && premise.decision !== 'blocked' && intent.status === 'ready') {
    const products = [...new Set(intent.scopes.filter(scope => (LIVE_PRODUCT_QUESTIONS as readonly string[]).includes(scope.question_id)).map(scope => scope.product_id))];
    for (const result of await Promise.all(products.map(product_id => live.check({ product_id }, signal)))) receipts.push(...result.receipts);
  }
  return TurnGuardSchema.parse({ version: 'conjugate-guard-1', live_enabled: Boolean(live), premise, live: receipts });
}

