import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKS, compiledVerifier, runVerifierStudy, studyScopes } from '../../../scripts/eval_verifier.js';
import { auditResearchDraft } from './research.js';
import { allowedTools, expectedClaim, labelSourceId, readResearchTool } from './research-evidence.js';

test('software evaluation detects weakened real-source verifiers and preserves controls', () => {
  const out = runVerifierStudy();
  assert.equal(out.passed, true);
  assert.equal(out.compiled_agrees, true);
  assert.equal(out.control_semantics_hold, true);
  assert.equal(out.control_count, 80);
  assert.equal(out.controls_accepted, out.control_count);
  assert.equal(out.faults_rejected, out.fault_count);
  assert.ok(out.mutants_detected >= 7);
  assert.equal(out.mutants.length, CHECKS.length + 2);
  assert.ok(out.mutants.find(row => row.name === 'always_accept')!.escaped_faults === out.fault_count);
  assert.ok(out.exclusions.length > 0);
});
test('unknown or duplicated mutation targets fail instead of counting as detections', () => {
  assert.throws(() => compiledVerifier(['absent_check']), /match exactly once/);
  assert.throws(() => compiledVerifier(['unique_claims', 'unique_claims']), /match exactly once/);
});
test('compound citations stay rejected until overlapping citation defenses are all disabled', () => {
  const request = studyScopes.find(scope => scope.product_id === 'DRG0ERKBH' && scope.question_id === 'composition' && scope.evidence_policy === 'all')!;
  const receipts = allowedTools(request).flatMap(tool => readResearchTool(tool, request));
  const derived = receipts.find(source => source.kind === 'derived');
  assert.ok(derived);
  const draft = { product_id: request.product_id, claims: [{ claim_id: request.question_id, source_ids: expectedClaim(request, receipts).source_ids }] };
  assert.equal(auditResearchDraft(request, draft, receipts).accepted, true);
  draft.claims[0]!.source_ids = [labelSourceId('DRG0CYMEB'), 'INVENTED-SOFTWARE-SOURCE', derived.id];
  const checked = auditResearchDraft(request, draft, receipts);
  assert.equal(checked.accepted, false);
  const defenses = ['source_allowlist', 'exact_source_claim_pairing', 'source_eligibility', 'evidence_availability'];
  for (const code of defenses) {
    assert.equal(checked.challenges.find(check => check.code === code)!.outcome, 'caught');
    assert.equal(compiledVerifier([code])(request, draft, receipts).accepted, false);
  }
  assert.equal(compiledVerifier(defenses)(request, draft, receipts).accepted, true);
});
