import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { InferenceResultSchema } from '@her2/shared';
import { createModelMcpServer, callModelMcp, type McpInferenceOptions } from './model-mcp.js';
import { createApp } from './app.js';
import { ApiFailure } from './errors.js';

test('MCP initializes, lists its tool, rejects extra arguments and calls inference exactly once', async () => {
  let calls = 0;
  const server = createModelMcpServer({ apiKey: 'unit-test-key', fetchImpl: async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify([{ token: 19, token_str: 'Y', score: 0.25, sequence: body.inputs.replace('<mask>', 'Y') }]));
  } });
  const client = new Client({ name: 'unit-tests', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const tools = await client.listTools(); assert.deepEqual(tools.tools.map(t => t.name), ['score_masked_antibody']);
    const args = { sequence_id: 'trastuzumab_vh', synthetic_confirmed: true };
    const invalid = await client.callTool({ name: 'score_masked_antibody', arguments: { ...args, url: 'https://example.org' } });
    assert.equal(invalid.isError, true); assert.equal(calls, 0);
    const good = await client.callTool({ name: 'score_masked_antibody', arguments: args });
    assert.equal(good.isError, undefined); assert.equal(InferenceResultSchema.parse(good.structuredContent).residue_probability, 0.25); assert.equal(calls, 1);
    const extra = await client.callTool({ name: 'score_masked_antibody', arguments: args });
    assert.equal(extra.isError, true); assert.equal(calls, 1); assert.match(JSON.stringify(extra), /INFERENCE_BUDGET_EXCEEDED/);
  } finally { await client.close(); await server.close(); }
});
test('the subprocess client rejects invalid requests and cancels before spawning', async () => {
  await assert.rejects(callModelMcp({ sequence_id: 'trastuzumab_vh', synthetic_confirmed: true }, { apiKey: 'unit-test-key', fetchImpl: async () => new Response('[]') } as unknown as McpInferenceOptions), (e: unknown) => e instanceof ApiFailure && e.code === 'INVALID_REQUEST');
  await assert.rejects(callModelMcp({ sequence_id: 'anything', synthetic_confirmed: true }), (e: unknown) => e instanceof ApiFailure && e.code === 'INVALID_REQUEST');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(callModelMcp({ sequence_id: 'trastuzumab_vh', synthetic_confirmed: true }, { apiKey: 'unit-test-key', signal: controller.signal }), (e: unknown) => e instanceof ApiFailure && e.code === 'RESEARCH_CANCELLED');
});
test('HTTP inference is off by default and rejects unconfirmed requests without a call', async () => {
  const app = await createApp();
  try {
    const catalog = await app.inject({ method: 'GET', url: '/api/models/inference' });
    assert.equal(catalog.json().configured, false); assert.equal(catalog.json().remaining_calls, 0);
    const disabled = await app.inject({ method: 'POST', url: '/api/models/inference', payload: { sequence_id: 'trastuzumab_vh', synthetic_confirmed: true } });
    assert.equal(disabled.statusCode, 503); assert.equal(disabled.json().error.code, 'INFERENCE_NOT_CONFIGURED');
    const invalid = await app.inject({ method: 'POST', url: '/api/models/inference', payload: { sequence_id: 'trastuzumab_vh', synthetic_confirmed: false } });
    assert.equal(invalid.statusCode, 400);
  } finally { await app.close(); }
});
