import { z } from 'zod';
import { LiveProductIdSchema, LiveReceiptSchema, LiveReferenceIdSchema, liveReceiptUrlIsTemplated, type LiveReceipt } from './live.js';
import { PremiseReportSchema, premiseGate, premiseReferences, premiseReportIsConsistent, type PremiseFacts, type PremiseReferences } from './premise.js';

/**
 * Per-turn guard: the premise gate plus any live source receipts the server fetched for this turn.
 * Live receipts can only establish that a reference exists or that a record still matches the frozen
 * snapshot. They never change a verdict and are not clinical evidence.
 */
export const LIVE_PRODUCT_QUESTIONS = ['composition', 'label_identity'] as const;
export const TurnGuardSchema = z.object({
  version: z.literal('conjugate-guard-1'), live_enabled: z.boolean(), premise: PremiseReportSchema,
  live: z.array(LiveReceiptSchema).max(16)
}).strict();
export type TurnGuard = z.infer<typeof TurnGuardSchema>;

/** NCT and PMID references in the message that live retrieval may resolve (max 4, message order). */
export function guardLiveReferences(message: string) {
  const found = premiseReferences(message);
  return [...found.nct, ...found.pmid].filter(id => LiveReferenceIdSchema.safeParse(id).success).slice(0, 4);
}

/** Maps reference receipts to premise-gate resolutions. Only existence is carried over. */
export function premiseReferencesFromLive(receipts: readonly LiveReceipt[]): PremiseReferences {
  const references: PremiseReferences = {};
  for (const receipt of receipts) {
    if (receipt.source !== 'clinicaltrials_gov' && receipt.source !== 'pubmed') continue;
    const title = receipt.parsed.official_title ?? receipt.parsed.brief_title ?? receipt.parsed.title ?? undefined;
    references[receipt.subject] = receipt.status === 'ok' ? { status: 'exists', ...(title ? { title: title.slice(0, 300) } : {}) } : receipt.status === 'not_found' ? { status: 'not_found' } : { status: 'error' };
  }
  return references;
}

/** Recomputes the premise report from the message, the facts and the saved reference receipts. */
export function turnGuardIsConsistent(guard: TurnGuard, message: string, facts: PremiseFacts, products: readonly string[], evaluated = true) {
  if (!TurnGuardSchema.safeParse(guard).success || !premiseReportIsConsistent(guard.premise)) return false;
  if (!guard.live_enabled && guard.live.length) return false;
  const allowed = guardLiveReferences(message);
  const refs = guard.live.filter(receipt => receipt.source === 'clinicaltrials_gov' || receipt.source === 'pubmed');
  const productReceipts = guard.live.filter(receipt => !refs.includes(receipt));
  if (refs.some(receipt => !allowed.includes(receipt.subject) || (receipt.source === 'pubmed') !== receipt.subject.startsWith('PMID:'))) return false;
  if (new Set(refs.map(receipt => receipt.subject)).size !== refs.length) return false;
  if (guard.live_enabled && refs.length && refs.length !== allowed.length) return false;
  if (productReceipts.some(receipt => !products.includes(receipt.subject)) || new Set(productReceipts.map(receipt => `${receipt.source}/${receipt.subject}`)).size !== productReceipts.length) return false;
  if (guard.premise.decision === 'blocked' && productReceipts.length) return false;
  if (guard.live.some(receipt => !liveReceiptUrlIsTemplated(receipt))) return false;
  if (!evaluated && guard.live.length) return false;
  const fresh = premiseGate(evaluated ? message : '', facts, { references: premiseReferencesFromLive(refs) });
  return JSON.stringify(fresh) === JSON.stringify(guard.premise);
}


/** What replay can check without the raw question: schema, internal consistency, frozen facts and receipt/decision coherence. */
export function guardReplayIsConsistent(guard: TurnGuard, factsSha256: string, status: string) {
  if (!TurnGuardSchema.safeParse(guard).success || !premiseReportIsConsistent(guard.premise) || guard.premise.facts_sha256 !== factsSha256) return false;
  if (!guard.live_enabled && guard.live.length) return false;
  const refs = guard.live.filter(receipt => receipt.source === 'clinicaltrials_gov' || receipt.source === 'pubmed');
  if (refs.some(receipt => !LiveReferenceIdSchema.safeParse(receipt.subject).success || (receipt.source === 'pubmed') !== receipt.subject.startsWith('PMID:'))) return false;
  if (guard.premise.decision === 'blocked' && guard.live.length !== refs.length) return false;
  if (status === 'outside_scope' && (guard.live.length || guard.premise.findings.length)) return false;
  const products = guard.live.filter(receipt => !refs.includes(receipt));
  if (products.some(receipt => !LiveProductIdSchema.safeParse(receipt.subject).success)) return false;
  if (new Set(guard.live.map(receipt => receipt.source + '/' + receipt.subject)).size !== guard.live.length) return false;
  if (guard.live.some(receipt => !liveReceiptUrlIsTemplated(receipt))) return false;
  const resolved = guard.premise.findings.filter(finding => finding.kind === 'resolved_reference').map(finding => finding.stated);
  const ok = refs.filter(receipt => receipt.status === 'ok').map(receipt => receipt.subject);
  if (resolved.length !== ok.length || resolved.some(id => !ok.includes(id ?? ''))) return false;
  return refs.every(receipt => receipt.status === 'ok' || guard.premise.findings.some(finding => finding.kind === 'unverifiable_reference' && finding.stated === receipt.subject));
}

