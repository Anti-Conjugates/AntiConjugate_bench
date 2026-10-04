import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { LiveCheckRequest, LiveReceipt } from '@her2/shared';
import { createLiveRetriever, LIVE_USER_AGENT } from '../apps/api/src/live-retrieval.js';

// Real network run against the five allowlisted sources. Software check of retrieval,
// identity and reference existence only. Not a clinical benchmark or evidence review.
const sha = (path: string) => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const expectedReferences: Record<string, LiveReceipt['status']> = { NCT03529110: 'ok', NCT09999999: 'not_found', 'PMID:29420467': 'ok', 'PMID:99999999': 'not_found' };

async function main() {
  const retriever = createLiveRetriever();
  const requests: LiveCheckRequest[] = [{ product_id: 'DRG0CYMEB' }, { product_id: 'DRG0ERKBH' }, { references: Object.keys(expectedReferences) }];
  const runs = [];
  for (const request of requests) runs.push(await retriever.check(request));
  const rows = runs.flatMap(run => run.receipts).map(receipt => ({
    source: receipt.source, subject: receipt.subject, url: receipt.url, status: receipt.status, error_code: receipt.error_code,
    expected_status: expectedReferences[receipt.subject] ?? null, http_status: receipt.http_status, bytes: receipt.bytes, raw_sha256: receipt.raw_sha256,
    duration_ms: receipt.duration_ms, fetched_at: receipt.fetched_at, parsed: receipt.parsed, comparison: receipt.comparison
  }));
  const checks = [
    { name: 'Reference existence matches the known real/fake ids', passed: rows.filter(row => row.expected_status).every(row => row.status === row.expected_status) },
    { name: 'Every product source returned a receipt without a transport or parse error', passed: rows.filter(row => !row.expected_status).every(row => row.status !== 'error') },
    { name: 'Safety fields stay blocked and null', passed: runs.every(run => run.guardrail.status === 'blocked' && run.needs_human && run.answer_correctness_probability === null && run.omission_probability === null && run.overall_adc_score === null) }
  ];
  const statuses = { ok: 0, not_found: 0, drift: 0, error: 0 };
  for (const row of rows) statuses[row.status]++;
  const out = {
    kind: 'live_source_retrieval_check_not_clinical',
    manifest: { generated_at: new Date().toISOString(), node: process.version, user_agent: LIVE_USER_AGENT, catalog: retriever.catalog(true),
      code_sha256: { 'apps/api/src/live-retrieval.ts': sha('../apps/api/src/live-retrieval.ts'), 'packages/shared/src/live.ts': sha('../packages/shared/src/live.ts') },
      snapshot_sha256: { 'apps/api/src/openfda.snapshot.json': sha('../apps/api/src/openfda.snapshot.json'), 'apps/api/src/workbook.snapshot.json': sha('../apps/api/src/workbook.snapshot.json') },
      requests },
    statuses, timings_ms: { total: runs.reduce((sum, run) => sum + run.duration_ms, 0), per_request: runs.map(run => run.duration_ms) },
    checks, rows,
    limits: ['One run at one point in time; live sources change.', 'Drift means the live record differs from the frozen snapshot; it is reported, not corrected.',
      'Live data supports identity, reference existence and composition corroboration only. It is not clinical evidence.', 'Raw bodies are not stored; hashes are fingerprints, not signatures.']
  };
  writeFileSync(new URL('../evals/live-retrieval.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ statuses, checks: checks.map(check => `${check.passed ? 'pass' : 'FAIL'}: ${check.name}`) }));
  if (!checks.every(check => check.passed)) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Live retrieval check failed.'); process.exitCode = 1; });
