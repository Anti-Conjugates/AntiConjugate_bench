import { LIVE_PRODUCT_QUESTIONS, TurnGuardSchema, chatIntent, premiseFacts, turnGuardIsConsistent, type ChatRequest, type ResearchCatalog, type TurnGuard } from '@her2/shared';
import { BoundaryError } from './boundaries';

/** Recomputes the premise report in the browser from the question, the catalog snapshot and the saved reference receipts. */
export function validateTurnGuard(data: unknown, request: ChatRequest, catalog: ResearchCatalog): TurnGuard {
  const parsed = TurnGuardSchema.safeParse(data);
  if (!parsed.success) throw new BoundaryError('The premise check failed validation. No answer was accepted.', 'INVALID_GUARD');
  const guard = parsed.data;
  const intent = chatIntent(request);
  const products = intent.status === 'ready' ? [...new Set(intent.scopes.filter(scope => (LIVE_PRODUCT_QUESTIONS as readonly string[]).includes(scope.question_id)).map(scope => scope.product_id))] : [];
  if ((intent.status === 'outside_scope' && guard.live.length) || !turnGuardIsConsistent(guard, request.message, premiseFacts(catalog.dataset), products, intent.status !== 'outside_scope')) {
    throw new BoundaryError('The premise check did not match this question. No answer was accepted.', 'INVALID_GUARD');
  }
  return guard;
}

