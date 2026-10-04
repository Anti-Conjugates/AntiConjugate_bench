import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatExecutionIsConsistent, premiseFacts, premiseGate, teamExecutionIsConsistent, turnGuardIsConsistent, type ChatRequest } from '@her2/shared';
import { runChat } from './chat.js';
import { runTeam } from './team.js';
import { replayChatResult } from './chat-replay.js';
import { replayTeamResult } from './team-replay.js';
import { createLiveRetriever } from './live-retrieval.js';
import { PREMISE_FACTS } from './turn-guard.js';
import type { FetchLike } from './claude.js';

const request = (message: string, engine: ChatRequest['engine'] = 'claude'): ChatRequest => ({ message, context: [], engine, synthetic_confirmed: true });
const noProvider: FetchLike = async () => { assert.fail('The premise gate must stop before any provider call'); };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function liveRegistry() {
  const urls: string[] = [];
  const live = createLiveRetriever({ fetch: async url => { urls.push(url); if (url.includes('NCT09999999')) return json({ message: 'not found' }, 404); return json({ protocolSection: { identificationModule: { nctId: 'NCT03529110', officialTitle: 'Synthetic test title' } } }); } });
  return { live, urls };
}

test('an invented ADC stops chat and team before any model call or evidence read', async () => {
  const message = 'Compare trastuzumab novatecan and Enhertu composition.';
  const chat = await runChat(request(message), { claude: { apiKey: 'test-key', fetch: noProvider } });
  assert.equal(chat.status, 'premise_blocked'); assert.equal(chat.harness.model_calls, 0); assert.equal(chat.harness.evidence_reads, 0); assert.equal(chat.audits.length, 0);
  assert.equal(chat.guard?.premise.decision, 'blocked'); assert.ok(chatExecutionIsConsistent(chat)); assert.equal((await replayChatResult(chat)).passed, true);
  assert.ok(turnGuardIsConsistent(chat.guard!, message, PREMISE_FACTS, []));
  assert.equal(chat.guardrail.status, 'blocked'); assert.equal(chat.answer_correctness_probability, null); assert.equal(chat.omission_probability, null);
  const team = await runTeam(request(message), { claude: { apiKey: 'test-key', fetch: noProvider } });
  assert.equal(team.status, 'premise_blocked'); assert.deepEqual(team.trace.map(step => [step.node, step.status, step.code]), [['scope_gate', 'completed', null], ['premise_gate', 'failed', 'PREMISE_BLOCKED'], ['answer', 'completed', null]]);
  assert.equal(team.harness.lead_calls, 0); assert.equal(team.harness.worker_calls, 0); assert.equal(team.harness.evidence_reads, 0);
  assert.ok(teamExecutionIsConsistent(team)); assert.equal((await replayTeamResult(team)).passed, true);
});

test('a contradicted premise is flagged but the evidence checks still run', async () => {
  const message = 'Kadcyla has a cleavable linker, so how fast is DM1 released in blood?';
  const chat = await runChat(request(message, 'evidence'));
  assert.equal(chat.guard?.premise.decision, 'flagged'); assert.ok(chat.guard!.premise.findings.some(finding => finding.check === 'contradicted_linker'));
  assert.ok(['complete', 'incomplete'].includes(chat.status)); assert.ok(chat.audits.length > 0); assert.ok(chatExecutionIsConsistent(chat));
});

test('tampered or mismatched guards are rejected', async () => {
  const message = 'Kadcyla has a cleavable linker, so how fast is DM1 released in blood?';
  const chat = await runChat(request(message, 'evidence'));
  assert.ok(turnGuardIsConsistent(chat.guard!, message, PREMISE_FACTS, []));
  assert.equal(turnGuardIsConsistent(chat.guard!, 'What is Kadcyla made of?', PREMISE_FACTS, []), false);
  const cleared = structuredClone(chat.guard!); cleared.premise = { ...cleared.premise, decision: 'clear', findings: [] };
  assert.equal(turnGuardIsConsistent(cleared, message, PREMISE_FACTS, []), false);
  const forged = structuredClone(chat); forged.status = 'premise_blocked';
  assert.equal(chatExecutionIsConsistent(forged), false);
});

test('live reference lookups resolve existence only: a missing NCT blocks, a real one lets the checks run', async () => {
  const missing = liveRegistry();
  const blocked = await runChat(request('Does NCT09999999 show Enhertu linker release in blood?'), { live: missing.live, claude: { apiKey: 'test-key', fetch: noProvider } });
  assert.equal(blocked.status, 'premise_blocked'); assert.equal(blocked.harness.model_calls, 0);
  assert.deepEqual(blocked.guard?.live.map(receipt => [receipt.source, receipt.subject, receipt.status]), [['clinicaltrials_gov', 'NCT09999999', 'not_found']]);
  assert.equal(missing.urls.length, 1); assert.ok(missing.urls[0]!.startsWith('https://clinicaltrials.gov/'));
  assert.equal((await replayChatResult(blocked)).passed, true);
  const real = liveRegistry();
  const found = await runChat(request('Does NCT03529110 show Enhertu linker release in blood?', 'evidence'), { live: real.live });
  assert.notEqual(found.status, 'premise_blocked'); assert.equal(found.guard?.live[0]?.status, 'ok'); assert.ok(found.audits.length > 0);
  assert.ok(turnGuardIsConsistent(found.guard!, 'Does NCT03529110 show Enhertu linker release in blood?', PREMISE_FACTS, []));
  const off = await runChat(request('Does NCT09999999 show Enhertu linker release in blood?', 'evidence'));
  assert.equal(off.guard?.live_enabled, false); assert.equal(off.guard?.live.length, 0);
});

test('the landing exhibit is the real gate output for its question', () => {
  const study = JSON.parse(readFileSync(new URL('../../../evals/premise-study.json', import.meta.url), 'utf8'));
  assert.deepEqual(study.exhibit.report, premiseGate(study.exhibit.question, PREMISE_FACTS));
});


test('review regressions: browser facts, receipt URLs, replay coherence and outside-scope text', async () => {
  const { researchCatalog } = await import('./research-evidence.js');
  const { liveUrl } = await import('./live-retrieval.js');
  const { chatIntent, guardReplayIsConsistent, liveSourceUrl } = await import('@her2/shared');
  assert.deepEqual(premiseFacts(researchCatalog(false).dataset), PREMISE_FACTS);
  for (const source of ['openfda', 'dailymed', 'adcdb'] as const) for (const id of ['DRG0CYMEB', 'DRG0ERKBH']) assert.equal(liveSourceUrl(source, id), liveUrl(source, id));
  for (const [source, id] of [['clinicaltrials_gov', 'NCT03529110'], ['pubmed', 'PMID:29420467']] as const) assert.equal(liveSourceUrl(source, id), liveUrl(source, id));
  const message = 'Does NCT03529110 show Enhertu linker release in blood?';
  const found = await runChat(request(message, 'evidence'), { live: liveRegistry().live });
  const sha = premiseGate('', PREMISE_FACTS).facts_sha256;
  assert.ok(guardReplayIsConsistent(found.guard!, sha, found.status));
  const phish = structuredClone(found.guard!); phish.live[0]!.url = 'https://evil.example/phish';
  assert.equal(turnGuardIsConsistent(phish, message, PREMISE_FACTS, []), false); assert.equal(guardReplayIsConsistent(phish, sha, found.status), false);
  const orphan = structuredClone(found.guard!); orphan.live = []; orphan.live_enabled = false;
  assert.equal(guardReplayIsConsistent(orphan, sha, found.status), false);
  const product = structuredClone(found.guard!); product.live.push({ ...found.guard!.live[0]!, source: 'openfda', subject: 'NOT_A_PRODUCT' });
  assert.equal(guardReplayIsConsistent(product, sha, found.status), false);
  const outside = await runChat(request('My mother Jane and Smith 1950 asked about trastuzumab foobarine with Kadcyla', 'evidence'), { live: liveRegistry().live });
  assert.equal(outside.status, 'outside_scope'); assert.deepEqual(outside.guard?.premise.findings, []); assert.equal(outside.guard?.live.length, 0);
  assert.ok(!JSON.stringify(outside).includes('Jane'));
  const injected = structuredClone(outside.guard!); injected.live_enabled = true; injected.live = [found.guard!.live[0]!];
  assert.equal(guardReplayIsConsistent(injected, sha, 'outside_scope'), false);
  assert.equal(chatIntent({ message: 'Patient and Smith 2020: what is Kadcyla made of?', context: [], engine: 'evidence', synthetic_confirmed: true }).status, 'outside_scope');
});

