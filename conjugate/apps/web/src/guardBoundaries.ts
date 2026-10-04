import { LIVE_PRODUCT_QUESTIONS, TurnGuardSchema, chatIntent, premiseFacts, turnGuardIsConsistent, type ChatRequest, type ResearchCatalog, type TurnGuard } from '@her2/shared';
import { BoundaryError } from './boundaries';

/** Premise facts come from the full snapshot; every field the catalogue also shows must agree with it. */
function catalogFacts(catalog: ResearchCatalog) {
  const shown = premiseFacts(catalog.dataset);
  const facts = catalog.premise_facts;
  const same = facts.dataset_sha256 === shown.dataset_sha256 && JSON.stringify(facts.allowlisted) === JSON.stringify(shown.allowlisted) && facts.rows.length === shown.rows.length
    && facts.rows.every((row, index) => JSON.stringify({ ...row, linker_payload: null }) === JSON.stringify({ ...shown.rows[index], linker_payload: null }));
  if (!same) throw new BoundaryError('The catalogue premise facts did not match its dataset. No answer was accepted.', 'INVALID_GUARD');
  return facts;
}

/** Recomputes the premise report in the browser from the question, the catalog snapshot and the saved reference receipts. */
export function validateTurnGuard(data: unknown, request: ChatRequest, catalog: ResearchCatalog): TurnGuard {
  const parsed = TurnGuardSchema.safeParse(data);
  if (!parsed.success) throw new BoundaryError('The premise check failed validation. No answer was accepted.', 'INVALID_GUARD');
  const guard = parsed.data;
  const intent = chatIntent(request);
  const products = intent.status === 'ready' ? [...new Set(intent.scopes.filter(scope => (LIVE_PRODUCT_QUESTIONS as readonly string[]).includes(scope.question_id)).map(scope => scope.product_id))] : [];
  if ((intent.status === 'outside_scope' && guard.live.length) || !turnGuardIsConsistent(guard, request.message, catalogFacts(catalog), products)) {
    throw new BoundaryError('The premise check did not match this question. No answer was accepted.', 'INVALID_GUARD');
  }
  return guard;
}

