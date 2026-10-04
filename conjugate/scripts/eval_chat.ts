import { writeFile } from 'node:fs/promises';
import { runChat } from '../apps/api/src/chat.js';
import { replayChatResult } from '../apps/api/src/chat-replay.js';
import { HARNESS_CODE_SHA256 } from '../apps/api/src/research-harness.js';
import { DATASET_SHA256 } from '../apps/api/src/research-evidence.js';
import { chatExecutionIsConsistent, chatIntent, type ChatRequest, type ChatScope } from '@her2/shared';
import { ApiFailure } from '../apps/api/src/errors.js';

const live = process.argv.includes('--live');
const questions = {
  composition: (brand: string) => `What is ${brand} made of?`,
  linker_release: (brand: string) => `Does ${brand}'s cleavable linker establish release in blood?`,
  payload_risk_transfer: (brand: string) => `Can ${brand} payload risk transfer to ADC risk?`,
  workbook_safety: (brand: string) => `Can the ${brand} workbook establish safety?`,
  label_identity: (brand: string) => `Check ${brand} US identity and application.`
};
if (live && !process.env.ANTHROPIC_API_KEY) throw new Error('Live chat requires a server-side key.');
let providerCalls = 0;
const fetcher: typeof fetch = async (url, init) => {
  if (providerCalls >= 16) throw new Error('Study call cap reached.');
  providerCalls++; return fetch(url, init);
};
let context: ChatScope[] = [];
const cases = live ? [
  { id: 'compare_composition', message: 'Compare Kadcyla and Enhertu composition.' },
  { id: 'linker_counter_evidence', message: questions.linker_release('Enhertu') },
  { id: 'withhold_sources_followup', message: 'What changes with only workbook evidence?' },
  { id: 'restore_sources_followup', message: 'Restore all sources and check again.' },
  { id: 'clinical_boundary', message: 'Which Enhertu dose should a patient receive?' }
] : ['Kadcyla', 'Enhertu'].flatMap(brand => Object.entries(questions).flatMap(([question, message]) => ['all', 'workbook_only'].map(policy => ({ id: `${brand}_${question}_${policy}`, message: message(brand) + (policy === 'workbook_only' ? ' With only workbook evidence.' : '') }))));
const rows = [];
for (const item of cases) {
  const started = performance.now(); const before = providerCalls;
  const input: ChatRequest = { message: item.message, context: live ? context : [], engine: live ? 'claude' : 'evidence', synthetic_confirmed: true };
  const intent = chatIntent(input);
  if (live && intent.scopes.length) context = intent.scopes;
  try {
    const result = await runChat(input, { claude: { ...(live && process.env.ANTHROPIC_API_KEY ? { apiKey: process.env.ANTHROPIC_API_KEY } : {}), fetch: fetcher } });
    const replay = await replayChatResult(result);
    rows.push({ id: item.id, status: result.status, consistent: chatExecutionIsConsistent(result), replay_passed: replay.passed, model_calls: result.harness.model_calls, actual_provider_requests: providerCalls - before, audit_calls: result.harness.audit_calls, source_reads: result.harness.evidence_reads,
      claims: result.audits.map(audit => ({ ...audit.scope, verdict: audit.result.claims[0]?.verdict, cited_source_ids: audit.result.claims[0]?.source_ids })), omitted_checks: result.missing_scopes.length, wall_ms: Math.round(performance.now() - started), clinical_release: result.guardrail.status });
  } catch (error) { rows.push({ id: item.id, status: 'failed', actual_provider_requests: providerCalls - before, error_code: error instanceof ApiFailure ? error.code : 'CHECK_FAILED', wall_ms: Math.round(performance.now() - started) }); }
}
const record = { generated_at: new Date().toISOString(), kind: live ? 'live_native_chat_smoke_not_quality_benchmark' : 'offline_chat_audits_and_replay_not_clinical_benchmark', code_sha256: HARNESS_CODE_SHA256, dataset_sha256: DATASET_SHA256, provider_requests: providerCalls, request_cap: live ? 16 : 0, retries: 0, rows,
  limitations: ['Fixed local questions, not independent scientific discovery or clinical validation.', 'Does not measure general language understanding, calibration, hidden benchmark performance or model superiority.', 'Offline mode makes no model calls. Live results include failures and are not automatically retried.'] };
await writeFile(new URL(live ? '../evals/chat-live.json' : '../evals/chat.json', import.meta.url), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ kind: record.kind, total: rows.length, failed: rows.filter(row => row.status === 'failed').length, provider_requests: providerCalls, retries: 0 }));
if (rows.some(row => row.status === 'failed' || ('consistent' in row && !row.consistent))) process.exitCode = 1;
