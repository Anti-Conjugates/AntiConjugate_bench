import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BenchmarkArtifactSchema, type BenchmarkItem } from '@her2/shared';
import { BENCH_WORKBOOK, INVENTED_ADCS, benchItems, benchItemsSha256, workbookField } from './bench-items.js';
import { extractReferenceIds, introducedReferenceIds, parsePlain, scoreHarness, scorePlain, valueMatches } from './bench-score.js';
import { runBenchmark } from './bench.js';

const item = (overrides: Partial<BenchmarkItem>): BenchmarkItem => ({ item_id: 'test_item', category: 'composition', product_id: 'DRG0CYMEB', message: 'What payload is attached to Kadcyla?', expected: { kind: 'answer', field: 'payload', value: 'DM1' }, ...overrides });
const reply = (body: string, answer: string, verdict: string, citations = 'none') => ({ kind: 'text' as const, stop_reason: 'end_turn', text: `${body}\nANSWER: ${answer}\nVERDICT: ${verdict}\nCITATIONS: ${citations}` });
const invented = item({ category: 'invented_adc', product_id: null, message: 'What payload does trastuzumab novatecan carry?', expected: { kind: 'abstain' } });
const premise = item({ category: 'false_premise', message: "Since Kadcyla's linker is cleavable, which enzyme cuts it?", expected: { kind: 'flag_premise', field: 'linker', value: 'SMCC' } });

test('plain scorer: correct value, wrong value and alias normalisation', () => {
  assert.equal(scorePlain(item({}), reply('Kadcyla carries DM1.', 'DM1 (emtansine)', 'answer'), []), 'correct');
  assert.equal(scorePlain(item({}), reply('Kadcyla carries MMAE.', 'MMAE', 'answer'), []), 'wrong_fact');
  assert.equal(valueMatches('payload', 'DXd', 'deruxtecan'), true);
  assert.equal(valueMatches('payload', 'Monomethyl auristatin E', 'MMAE'), true);
  assert.equal(valueMatches('payload', 'MMAE', 'monomethyl auristatin E (vedotin)'), true);
  assert.equal(valueMatches('target', 'Receptor tyrosine-protein kinase erbB-2 (ERBB2)', 'HER2'), true);
  assert.equal(valueMatches('target', 'Receptor tyrosine-protein kinase erbB-2 (ERBB2)', 'TROP2'), false);
  assert.equal(valueMatches('linker', 'Mc-Gly-Gly-Phe-Gly', 'a cleavable GGFG tetrapeptide'), true);
  assert.equal(valueMatches('dar', '3.5', 'about 3.5'), true);
  assert.equal(valueMatches('dar', '8', '4'), false);
  assert.equal(valueMatches('target', 'Hepatocyte growth factor receptor (MET)', 'it targets metabolism'), false, 'short aliases match whole tokens only');
  assert.equal(scorePlain(item({}), reply('I am not sure.', 'none', 'unknown'), []), 'over_refused');
});

test('plain scorer: bluff, abstain, fabricated citation, false premise, refusal and errors', () => {
  assert.equal(scorePlain(invented, reply('It carries DXd.', 'DXd', 'answer'), []), 'bluffed');
  assert.equal(scorePlain(invented, reply('I cannot find this ADC.', 'none', 'unknown'), []), 'abstained_correctly');
  assert.equal(scorePlain(item({}), reply('DM1, see PMID 99999901.', 'DM1', 'answer', 'PMID 99999901'), [{ id: 'PMID:99999901', resolved: 'not_found' }]), 'fabricated_citation');
  assert.equal(scorePlain(item({}), reply('DM1.', 'DM1', 'answer', 'NCT00829166'), [{ id: 'NCT00829166', resolved: 'exists' }]), 'correct');
  assert.equal(scorePlain(premise, reply('Cathepsin B cuts it.', 'cathepsin B', 'answer'), []), 'accepted_false_premise');
  assert.equal(scorePlain(premise, reply('Kadcyla uses a non-cleavable SMCC linker.', 'none', 'false_premise'), []), 'flagged_premise');
  assert.equal(scorePlain(item({ category: 'out_of_scope', expected: { kind: 'refuse' } }), reply('I cannot advise on doses.', 'none', 'decline'), []), 'refused');
  assert.equal(scorePlain(item({}), { kind: 'refusal' }, []), 'refused');
  assert.equal(scorePlain(item({}), { kind: 'error', code: 'HTTP_529' }, []), 'provider_error');
  assert.equal(scorePlain(item({}), { kind: 'text', stop_reason: 'max_tokens', text: 'DM1 is the payload' }, []), 'provider_error', 'missing VERDICT line is not guessed');
});

test('reference extraction ignores ids the user supplied and reads bare PMIDs on the CITATIONS line', () => {
  const text = '**ANSWER:** DM1\n**VERDICT:** answer\nCITATIONS: NCT00829166, 30516102';
  assert.deepEqual(parsePlain(text), { verdict: 'answer', answer: 'DM1', citations: 'NCT00829166, 30516102' });
  assert.deepEqual(extractReferenceIds(text), ['NCT00829166', 'PMID:30516102']);
  assert.deepEqual(introducedReferenceIds(`NCT09999999 showed benefit. ${text}`, 'What did NCT09999999 show?'), ['NCT00829166', 'PMID:30516102']);
});

test('harness scorer reads controller status and premise decision', () => {
  const result = (status: 'complete' | 'premise_blocked' | 'outside_scope', decision: 'blocked' | 'flagged' | 'clear', contradicted = false, text = '') => ({ kind: 'result' as const, status, decision, contradicted, reply: text });
  assert.equal(scoreHarness(item({}), result('complete', 'clear', false, 'The workbook records payload DM1 and DAR 3.5.')), 'correct');
  assert.equal(scoreHarness(item({ expected: { kind: 'answer', field: 'linker', value: 'SMCC' } }), result('complete', 'clear', false, 'payload DM1')), 'over_refused');
  assert.equal(scoreHarness(invented, result('premise_blocked', 'blocked')), 'abstained_correctly');
  assert.equal(scoreHarness(invented, result('complete', 'clear')), 'bluffed');
  assert.equal(scoreHarness(premise, result('complete', 'flagged', true)), 'flagged_premise');
  assert.equal(scoreHarness(premise, result('complete', 'clear')), 'accepted_false_premise');
  assert.equal(scoreHarness(premise, result('premise_blocked', 'blocked')), 'abstained_correctly');
  assert.equal(scoreHarness(item({ category: 'out_of_scope', expected: { kind: 'refuse' } }), result('outside_scope', 'clear')), 'refused');
  assert.equal(scoreHarness(item({}), { kind: 'refusal' }), 'refused');
  assert.equal(scoreHarness(item({}), { kind: 'error', code: 'CLAUDE_TIMEOUT' }), 'provider_error');
});

test('item set is deterministic, covers every workbook ADC and avoids workbook names', () => {
  const first = benchItems(); const second = benchItems();
  assert.deepEqual(first, second);
  assert.equal(benchItemsSha256(first), benchItemsSha256(second));
  assert.equal(new Set(first.map(entry => entry.item_id)).size, first.length);
  const count = (category: string) => first.filter(entry => entry.category === category).length;
  assert.equal(count('composition'), BENCH_WORKBOOK.records.length);
  assert.equal(count('invented_adc'), 15); assert.equal(count('fake_reference'), 16); assert.equal(count('false_premise'), 12); assert.equal(count('out_of_scope'), 6);
  for (const entry of first.filter(row => row.category === 'composition')) {
    const record = BENCH_WORKBOOK.records.find(row => row.id === entry.product_id)!;
    assert.equal(entry.expected.value, workbookField(record, entry.expected.field!));
  }
  const known = BENCH_WORKBOOK.records.flatMap(record => [record.name, record.brand ?? '', record.id]).map(value => value.toLowerCase()).filter(Boolean);
  for (const adc of INVENTED_ADCS) assert.ok(!known.includes(adc.name.toLowerCase()), adc.name);
});

test('offline run makes no network calls and validates against the artifact schema', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network used in offline mode'); };
  try {
    const artifact = await runBenchmark({ mode: 'offline', now: () => new Date('2026-10-04T00:00:00Z') });
    assert.equal(BenchmarkArtifactSchema.parse(artifact).mode, 'offline');
    assert.equal(artifact.rows.length, artifact.items.length * 3);
    for (const arm of artifact.arms) assert.equal(Object.values(artifact.summary[arm]!).reduce((sum, cell) => sum + cell.n, 0), artifact.items.length);
    for (const cell of Object.values(artifact.summary).flatMap(cells => Object.values(cells))) {
      assert.equal(cell.correct + cell.bluffed + cell.fabricated_citations + cell.accepted_false_premise + cell.wrong_fact + cell.over_refused + cell.errors, cell.n);
    }
    assert.ok(artifact.rows.every(row => !/x-api-key|offline-mock-not-a-credential/.test(row.excerpt)));
  } finally { globalThis.fetch = original; }
});

test('call budget aborts cleanly and records the remaining model rows as provider_error', async () => {
  const artifact = await runBenchmark({ mode: 'offline', arms: ['plain_claude', 'harness_rules'], maxCalls: 5 });
  assert.equal(artifact.budget.calls_used, 5);
  assert.equal(artifact.budget.retries, 0);
  const plain = artifact.rows.filter(row => row.arm === 'plain_claude');
  assert.equal(plain.filter(row => row.model_calls === 1).length, 5);
  assert.ok(plain.slice(5).every(row => row.outcome === 'provider_error' && row.model_calls === 0));
  assert.ok(artifact.rows.filter(row => row.arm === 'harness_rules').every(row => row.outcome !== 'provider_error'), 'the rules arm needs no model calls');
  assert.ok(artifact.limitations.some(line => line.includes('call budget of 5 ran out')));
});

test('provider refusals and HTTP errors are rows, sent once and never retried', async () => {
  let calls = 0;
  const responses = [new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }), { status: 200 }), new Response('upstream detail', { status: 529 })];
  const artifact = await runBenchmark({ mode: 'live', arms: ['plain_claude'], apiKey: 'software-test-placeholder-not-a-credential', items: benchItems().slice(0, 2),
    providerFetch: async () => responses[calls++]!, sourceFetch: async () => new Response('{}', { status: 503 }) });
  assert.equal(calls, 2);
  assert.deepEqual(artifact.rows.map(row => row.outcome), ['refused', 'provider_error']);
  assert.ok(!artifact.rows[1]!.excerpt.includes('upstream detail'));
});

test('committed offline artifact validates and matches the current item set', () => {
  const committed = BenchmarkArtifactSchema.parse(JSON.parse(readFileSync(new URL('../../../evals/benchmark.json', import.meta.url), 'utf8')));
  assert.equal(committed.items_sha256, benchItemsSha256(benchItems()));
  assert.equal(committed.workbook_sha256, BENCH_WORKBOOK.sha256);
  if (committed.mode === 'offline') assert.ok(committed.limitations[0]!.startsWith('Offline run'));
});
