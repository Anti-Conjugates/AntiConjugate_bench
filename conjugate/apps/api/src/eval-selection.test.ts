import assert from 'node:assert/strict';
import test from 'node:test';
import { CLAUDE_MODEL } from './evidence.js';
import { expectedClaim, allowedTools, readResearchTool } from './research-evidence.js';
import { studyScopes } from '../../../scripts/eval_verifier.js';
import { runSelectionStudy, selectionCall } from '../../../scripts/eval_selection.js';

test('ablation removes mapping and eligibility shortcuts without changing paired context or schema', () => {
  for (const request of studyScopes) {
    const receipts = allowedTools(request).flatMap(tool => readResearchTool(tool, request));
    const mapped = selectionCall(request, receipts, [], 'mapped');
    const unmapped = selectionCall(request, receipts, [], 'unmapped');
    assert.equal(mapped.system, unmapped.system); assert.deepEqual(mapped.schema, unmapped.schema);
    const { trusted_claim_mapping, ...remaining } = mapped.data as Record<string, unknown>;
    assert.ok(trusted_claim_mapping); assert.deepEqual(remaining, unmapped.data);
    assert.equal(JSON.stringify(unmapped.data).includes('eligible_for_claim'), false);
    assert.equal(JSON.stringify(unmapped.data).includes('trusted_claim_mapping'), false);
    assert.equal(JSON.stringify(unmapped.schema).includes('trusted_claim_mapping'), false);
  }
});
test('fixed model grid uses 120 calls, never retries, retains provider errors and scores with the real verifier', async () => {
  let calls = 0;
  const out = await runSelectionStudy({ apiKey: 'UNIT-TEST-NOT-A-KEY', fetch: async (_url, init) => {
    calls++;
    if (calls === 1) return new Response('synthetic provider failure', { status: 503 });
    const sent = JSON.parse(String(init?.body)); const data = JSON.parse(sent.messages[0].content);
    const request = studyScopes.find(scope => scope.product_id === data.product_id && scope.question_id === data.question_id && scope.evidence_policy === data.evidence_policy)!;
    const receipts = allowedTools(request).flatMap(tool => readResearchTool(tool, request));
    const draft = { product_id: request.product_id, claims: [{ claim_id: request.question_id, source_ids: expectedClaim(request, receipts).source_ids }] };
    return new Response(JSON.stringify({ model: CLAUDE_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(draft) }] }));
  } });
  assert.equal(calls, 120); assert.equal(out.provider_calls, 120); assert.equal(out.rows.length, 120);
  assert.equal(out.pairs.length, 60); assert.equal(out.baseline.eligible_only_accepted, 20);
  assert.equal(out.arms.reduce((sum, arm) => sum + arm.provider_errors, 0), 1);
  assert.equal(out.arms.reduce((sum, arm) => sum + arm.accepted, 0), 119);
  assert.equal(out.rows[0]!.error_code, 'CLAUDE_UNAVAILABLE');
});
test('missing key produces skipped rows, not a fabricated passing model score', async () => {
  const out = await runSelectionStudy();
  assert.equal(out.skipped, true); assert.equal(out.provider_calls, 0);
  assert.equal(out.rows.length, 0); assert.equal(out.paired_acceptance_difference, null);
});
