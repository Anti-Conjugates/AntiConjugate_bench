import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { HarnessManifestSchema, type ResearchRequest, type ResearchReceipt } from '@her2/shared';
import { type RuntimeSkill } from './research-skills.js';

export const HARNESS_LIMITS = { deadline_ms: 60000, max_model_calls: 2, max_tool_calls: 4, retries: 0,
  max_request_bytes: 65536, max_response_bytes: 131072, network_during_retrieval: false,
  model_receives_expected_mapping: true } as const;
export function fingerprint(value: unknown) {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
    return item;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const codeHash = createHash('sha256');
for (const [relative, directory] of [['apps/api/src/', new URL('./', import.meta.url)], ['packages/shared/src/', new URL('../../../packages/shared/src/', import.meta.url)]] as const) {
  for (const name of readdirSync(directory).filter(name => (name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts') || name.endsWith('.snapshot.json')).sort()) {
    codeHash.update(relative + name).update('\0').update(readFileSync(new URL(name, directory))).update('\0');
  }
}
codeHash.update('package-lock.json\0').update(readFileSync(new URL('../../../package-lock.json', import.meta.url)));
export const HARNESS_CODE_SHA256 = codeHash.digest('hex');
export function harnessManifest(request: ResearchRequest, receipts: ResearchReceipt[], skills: RuntimeSkill[], toolCalls: number, deadlineMs: number) {
  return HarnessManifestSchema.parse({ version: 'conjugate-harness-1', code_sha256: HARNESS_CODE_SHA256,
    request_sha256: fingerprint(request), limits: { ...HARNESS_LIMITS, deadline_ms: deadlineMs },
    model_calls: request.engine === 'claude' ? 2 : 0, tool_calls: toolCalls,
    sources: receipts.map(receipt => ({ id: receipt.id, sha256: fingerprint(receipt) })),
    skills: skills.map(({ name, version, sha256 }) => ({ name, version, sha256 })) });
}
