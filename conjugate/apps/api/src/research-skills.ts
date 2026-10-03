import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { type ResearchRequest } from '@her2/shared';
import { ApiFailure } from './errors.js';

// Fixed reviewed app-level prompt resources only. Not native hosted Skills,
// marketplace packages, pstack engineering instructions or executable code.
const SKILL_PATHS = {
  'evidence-retrieval': new URL('../../../runtime-skills/evidence-retrieval/SKILL.md', import.meta.url),
  'counter-evidence': new URL('../../../runtime-skills/counter-evidence/SKILL.md', import.meta.url),
  'provenance-review': new URL('../../../runtime-skills/provenance-review/SKILL.md', import.meta.url)
} as const;
export type RuntimeSkillName = keyof typeof SKILL_PATHS;
export interface RuntimeSkill {
  name: RuntimeSkillName;
  description: string;
  version: '1.0.0';
  sha256: string;
  instructions: string;
}
// Server-side dependency injection for software tests, never a request field or user path.
export type RuntimeSkillReader = (path: URL) => Promise<Uint8Array>;
export const MAX_SKILL_BYTES = 8_192;
async function boundedLocalRead(path: URL): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) throw new ApiFailure('RESEARCH_SKILL_INVALID', 503);
    const buffer = new Uint8Array(MAX_SKILL_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.slice(0, bytesRead);
  } finally { await handle.close(); }
}
export async function loadRuntimeSkills(question: ResearchRequest['question_id'], read: RuntimeSkillReader = boundedLocalRead): Promise<RuntimeSkill[]> {
  const selected: RuntimeSkillName[] = question === 'composition'
    ? ['evidence-retrieval', 'provenance-review']
    : ['evidence-retrieval', 'counter-evidence', 'provenance-review'];
  const result: RuntimeSkill[] = [];
  try {
    for (const name of selected) {
      const bytes = await read(SKILL_PATHS[name]);
      if (!bytes.length || bytes.byteLength > MAX_SKILL_BYTES) throw new ApiFailure('RESEARCH_SKILL_INVALID', 503);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      // Exact supported metadata layout/version; no YAML parser, plugins, shell,
      // template evaluation, imports or interpretation of instructions as code.
      const match = /^---\r?\nname: ([a-z-]+)\r?\ndescription: ([^\r\n]{1,500})\r?\nversion: (1\.0\.0)\r?\n---\r?\n([\s\S]+)$/.exec(text);
      const hasControlBytes = bytes.some(byte => byte < 32 && ![9, 10, 13].includes(byte));
      if (!match || match[1] !== name || !match[2]?.trim() || !match[4]?.trim() || hasControlBytes) throw new ApiFailure('RESEARCH_SKILL_INVALID', 503);
      result.push({ name, description: match[2], version: '1.0.0', sha256: createHash('sha256').update(bytes).digest('hex'), instructions: match[4].trim() });
    }
    return result;
  } catch { throw new ApiFailure('RESEARCH_SKILL_INVALID', 503); }
}
export function skillMetadata(skills: RuntimeSkill[]) {
  return skills.map(({ name, description, version, sha256 }) => ({ name, description, version, sha256 }));
}
export function skillTraceDetail(skills: RuntimeSkill[]) {
  return `Local app-level prompt packs actually loaded: ${skills.map(skill => `${skill.name}@${skill.version} SHA-256 ${skill.sha256}`).join('; ')}. Not native Anthropic hosted Skills, uploads or code execution.`;
}
