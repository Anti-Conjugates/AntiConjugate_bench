import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { type ResearchRequest } from '@her2/shared';
import { ApiFailure } from './errors.js';
import { runResearch } from './research.js';
import { loadRuntimeSkills, MAX_SKILL_BYTES, skillMetadata, type RuntimeSkillReader } from './research-skills.js';
import { modelResponse, NON_CREDENTIAL } from './test-support.js';

const input: ResearchRequest = { product_id: 'DRG0ERKBH', question_id: 'linker_release', engine: 'claude', evidence_policy: 'workbook_only', integrity_drill: 'none', synthetic_confirmed: true };
const encode = (text: string) => new TextEncoder().encode(text);
const basename = (path: URL) => path.pathname.split('/').at(-2)!;
const injectedPack: RuntimeSkillReader = async path => encode(`---\nname: ${basename(path)}\ndescription: Reviewed local prompt pack fixture.\nversion: 1.0.0\n---\n\n# Local instructions\nAPP-SKILL-BODY-${basename(path)}\nUse only identifier mappings and retrieved evidence.\n`);
function hasCode(code: string) { return (error: unknown) => error instanceof ApiFailure && error.code === code; }

test('fixed allowlisted skill loader reads reviewed parent resources, exact byte hashes and question-relevant packs', async () => {
  for (const question of ['composition', 'linker_release', 'payload_risk_transfer', 'workbook_safety'] as const) {
    const skills = await loadRuntimeSkills(question);
    assert.deepEqual(skills.map(skill => skill.name), question === 'composition' ? ['evidence-retrieval', 'provenance-review'] : ['evidence-retrieval', 'counter-evidence', 'provenance-review']);
    for (const skill of skills) {
      const bytes = await readFile(new URL(`../../../runtime-skills/${skill.name}/SKILL.md`, import.meta.url));
      assert.equal(skill.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(skill.version, '1.0.0'); assert.ok(skill.description); assert.ok(skill.instructions);
      assert.ok(skill.instructions.includes('identifiers') || skill.instructions.includes('source'));
    }
  }
});

test('injected allowlisted skill metadata is in the actual planner; instructions enter actual draft; both completed traces name byte hashes', async () => {
  const paths: URL[] = [];
  const reader: RuntimeSkillReader = async path => { paths.push(path); return injectedPack(path); };
  const expected = await loadRuntimeSkills(input.question_id, injectedPack); let calls = 0;
  const result = await runResearch(input, { skillReader: reader, claude: { apiKey: NON_CREDENTIAL, fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const data = JSON.parse(body.messages[0].content);
    assert.equal(body.tools, undefined); assert.equal(body.tool_choice, undefined);
    assert.equal(body.container, undefined); assert.equal(body.betas, undefined);
    if (++calls === 1) {
      assert.deepEqual(data.local_runtime_skill_metadata, skillMetadata(expected));
      assert.ok(!String(init?.body).includes('APP-SKILL-BODY'));
      return modelResponse({ product_id: input.product_id, tool_ids: ['read_workbook'] });
    }
    assert.deepEqual(data.local_runtime_skill_prompt_packs, expected);
    for (const skill of expected) assert.ok(String(init?.body).includes(`APP-SKILL-BODY-${skill.name}`));
    assert.match(body.system, /prompt files inside this app, not hosted skills or code execution/);
    return modelResponse({ product_id: input.product_id, claims: [{ claim_id: input.question_id, source_ids: [] }] });
  } } });
  assert.equal(calls, 2); assert.equal(paths.length, 3);
  assert.ok(paths.every(path => path.pathname.startsWith('/home/ubuntu/repos/her2-agent/runtime-skills/') && path.pathname.endsWith('/SKILL.md')));
  assert.equal(result.claims[0]!.verdict, 'insufficient');
  for (const stage of ['plan', 'draft'] as const) {
    const trace = result.trace.find(step => step.stage === stage)!;
    for (const skill of expected) { assert.ok(trace.detail.includes(skill.name)); assert.ok(trace.detail.includes(skill.sha256)); }
    assert.match(trace.detail, /Not native Anthropic hosted Skills/);
    assert.ok(!trace.detail.includes('APP-SKILL-BODY'));
  }
});

test('composition draft receives only relevant packs; evidence mode does not load or pretend to execute skills', async () => {
  const request = { ...input, question_id: 'composition' as const };
  let calls = 0;
  await runResearch(request, { skillReader: injectedPack, claude: { apiKey: NON_CREDENTIAL, fetch: async (_url, init) => {
    const data = JSON.parse(JSON.parse(String(init?.body)).messages[0].content);
    if (++calls === 1) {
      assert.deepEqual(data.local_runtime_skill_metadata.map((skill: { name: string }) => skill.name), ['evidence-retrieval', 'provenance-review']);
      return modelResponse({ product_id: input.product_id, tool_ids: ['read_workbook'] });
    }
    assert.deepEqual(data.local_runtime_skill_prompt_packs.map((skill: { name: string }) => skill.name), ['evidence-retrieval', 'provenance-review']);
    return modelResponse({ product_id: input.product_id, claims: [{ claim_id: 'composition', source_ids: ['WORKBOOK-DRG0ERKBH-COMPOSITION'] }] });
  } } });
  let reads = 0;
  const evidence = await runResearch({ ...input, engine: 'evidence' }, { skillReader: async () => { reads++; throw new Error('must not load'); } });
  assert.equal(reads, 0); assert.equal(evidence.model, null);
  assert.ok(!evidence.trace.some(step => step.detail.includes('prompt packs actually loaded')));
});

test('missing/oversized/invalid UTF/metadata/version/body skill resources fail closed before any model call', async () => {
  const readers: RuntimeSkillReader[] = [
    async () => { throw new Error('PRIVATE-FILE-FAILURE'); },
    async () => new Uint8Array(MAX_SKILL_BYTES + 1),
    async () => new Uint8Array(),
    async () => new Uint8Array([0xff, 0xfe]),
    async path => encode(new TextDecoder().decode(await injectedPack(path)).replace('version: 1.0.0', 'version: 2.0.0')),
    async path => encode(new TextDecoder().decode(await injectedPack(path)).replace(`name: ${basename(path)}`, 'name: unreviewed-marketplace')),
    async path => encode(new TextDecoder().decode(await injectedPack(path)).replace('version: 1.0.0', 'version: 1.0.0\nexecute: arbitrary-code')),
    async path => encode(new TextDecoder().decode(await injectedPack(path)).split('# Local instructions')[0]!),
    async path => encode(`${new TextDecoder().decode(await injectedPack(path))}\u0000`)
  ];
  for (const reader of readers) {
    await assert.rejects(() => loadRuntimeSkills(input.question_id, reader), hasCode('RESEARCH_SKILL_INVALID'));
    let calls = 0;
    await assert.rejects(() => runResearch(input, { skillReader: reader, claude: { apiKey: NON_CREDENTIAL, fetch: async () => { calls++; throw new Error('must not call'); } } }), error => {
      assert.ok(error instanceof ApiFailure); assert.equal(error.code, 'RESEARCH_SKILL_INVALID');
      assert.ok(!error.message.includes('PRIVATE-FILE-FAILURE')); return true;
    });
    assert.equal(calls, 0);
  }
});

test('skill loading shares total run deadline and cannot bypass explicit missing-key failure', async () => {
  let calls = 0;
  await assert.rejects(() => runResearch(input, { skillReader: async () => new Promise<Uint8Array>(() => {}), claude: { apiKey: NON_CREDENTIAL, timeoutMs: 5, fetch: async () => { calls++; throw new Error('must not call'); } } }), hasCode('CLAUDE_TIMEOUT'));
  assert.equal(calls, 0);
  let reads = 0;
  await assert.rejects(() => runResearch(input, { skillReader: async () => { reads++; throw new Error('must not read'); } }), hasCode('CLAUDE_NOT_CONFIGURED'));
  assert.equal(reads, 0);
});
