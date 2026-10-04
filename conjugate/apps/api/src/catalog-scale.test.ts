import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatIntent, liveProductSources, liveSourceUrl, productLabel, ResearchResultSchema, WORKBOOK_PRODUCT_IDS, type ChatRequest, researchExecutionIsConsistent } from '@her2/shared';
import { allowedTools } from './research-evidence.js';
import { runResearch } from './research.js';
import { runChat } from './chat.js';

const ask = (message: string) => chatIntent({ message, context: [], engine: 'evidence', synthetic_confirmed: true } as unknown as ChatRequest);
const input = (product_id: string, question_id: string) => ({ product_id, question_id, engine: 'evidence', evidence_policy: 'all', integrity_drill: 'none', synthetic_confirmed: true });

test('all 31 workbook ADCs are scopeable and labelled from the workbook', () => {
  assert.equal(WORKBOOK_PRODUCT_IDS.length, 31);
  assert.equal(productLabel('DRG0BBQSE'), 'Padcev'); assert.equal(productLabel('DRG0CYMEB'), 'Kadcyla');
  assert.deepEqual(ask('What payload does Padcev carry?').scopes.map(scope => [scope.product_id, scope.question_id]), [['DRG0BBQSE', 'composition']]);
  assert.deepEqual([...new Set(ask('Compare Datroway and Enhertu composition.').scopes.map(scope => scope.product_id))].sort(), ['DRG0ERKBH', 'DRG0ZOYQV']);
  assert.deepEqual([...new Set(ask('What is datopotamab deruxtecan made of?').scopes.map(scope => scope.product_id))], ['DRG0ZOYQV']);
  assert.deepEqual([...new Set(ask('What is T-DXd made of?').scopes.map(scope => scope.product_id))], ['DRG0ERKBH']);
});

test('workbook-only products get composition from their own cells and no label or openFDA evidence', async () => {
  const request = input('DRG0EKTUN', 'composition');
  assert.deepEqual(allowedTools(request as never), ['read_workbook', 'read_derived']);
  const result = ResearchResultSchema.parse(await runResearch(request));
  const claim = result.claims.find(item => item.id === 'composition')!;
  assert.equal(claim.verdict, 'supported'); assert.deepEqual(claim.source_ids, ['WORKBOOK-DRG0EKTUN-COMPOSITION']);
  assert.match(claim.statement, /SN-38/);
  assert.ok(result.receipts.every(receipt => !/SMPC|OPENFDA/.test(receipt.id)));
  for (const question_id of ['linker_release', 'payload_risk_transfer', 'label_identity']) {
    const other = ResearchResultSchema.parse(await runResearch(input('DRG0EKTUN', question_id)));
    assert.ok(other.claims.every(item => item.verdict !== 'supported'), question_id);
    assert.equal(other.guardrail.status, 'blocked'); assert.equal(other.needs_human, true);
  }
});

test('live lookups use verified US brands only; unbranded rows get ADCdb only', () => {
  assert.deepEqual(liveProductSources('DRG0JEVIM'), ['adcdb']);
  assert.throws(() => liveSourceUrl('openfda', 'DRG0JEVIM'));
  assert.deepEqual(liveProductSources('DRG0QWZIT'), ['openfda', 'dailymed', 'adcdb']);
  assert.equal(liveSourceUrl('openfda', 'DRG0CYMEB'), 'https://api.fda.gov/drug/label.json?search=openfda.brand_name.exact%3A%22KADCYLA%22&limit=1&sort=effective_time%3Adesc');
  assert.equal(liveSourceUrl('adcdb', 'DRG0EKTUN'), 'https://adcdb.idrblab.net/data/adc/details/DRG0EKTUN');
  assert.throws(() => liveSourceUrl('adcdb', 'DRG0ZZZZZ'));
});

test('research chat answers a workbook-only product composition question through the evidence harness', async () => {
  const result = await runChat({ message: 'What payload is attached to Trodelvy?', context: [], engine: 'evidence', synthetic_confirmed: true } as never);
  assert.equal(result.status, 'complete');
  assert.ok(result.audits.length >= 1 && result.audits.every(audit => audit.scope.product_id === 'DRG0EKTUN' && audit.result.harness.tool_calls === 2));
  assert.match(JSON.stringify(result.audits[0]!.result.claims), /SN-38/);
  assert.equal(result.guardrail.status, 'blocked'); assert.equal(result.needs_human, true);
});

test('consistency check rejects a label receipt forged onto a product without a local label', async () => {
  const result = await runChat({ message: 'What payload is attached to Trodelvy?', context: [], engine: 'evidence', synthetic_confirmed: true } as never);
  const forged = structuredClone(result.audits[0]!.result);
  assert.equal(researchExecutionIsConsistent(forged), true);
  const derived = forged.receipts.find(receipt => receipt.kind === 'derived')!;
  const oldId = derived.id;
  Object.assign(derived, { kind: 'label', id: 'UK-KADCYLA-SMPC' });
  for (const step of forged.trace) if (step.tool === 'read_derived') Object.assign(step, { tool: 'read_label', source_ids: step.source_ids.map(id => id === oldId ? 'UK-KADCYLA-SMPC' : id) });
  assert.equal(researchExecutionIsConsistent(forged), false);
});
