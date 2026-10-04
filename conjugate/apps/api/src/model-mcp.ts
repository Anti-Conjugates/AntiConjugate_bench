import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InferenceRequestSchema, InferenceResultSchema, InferenceProviderOutputSchema } from '@her2/shared';
import { ApiFailure } from './errors.js';
import { scoreMaskedAntibody, fingerprint, INFERENCE_CASES, type InferenceOptions } from './live-inference.js';

export type McpInferenceOptions = Pick<InferenceOptions, 'apiKey' | 'signal' | 'timeoutMs'>;

export function createModelMcpServer(options: InferenceOptions = {}) {
  const server = new McpServer({ name: 'conjugate-models', version: '1.0.0' });
  let used = false;
  server.registerTool('score_masked_antibody', {
    description: 'Run ESM-2 650M fill-mask inference on a fixed public antibody reference or a synthetic reversed-sequence control. Score tyrosine at position 33. One provider call per server process. This measures sequence context, not binding or ADC efficacy.',
    inputSchema: InferenceRequestSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input, extra) => {
    try {
      if (used) throw new ApiFailure('INFERENCE_BUDGET_EXCEEDED', 429);
      used = true;
      const result = await scoreMaskedAntibody(input, { ...options, signal: AbortSignal.any([extra.signal, ...(options.signal ? [options.signal] : [])]) });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const failure = error instanceof ApiFailure ? error : new ApiFailure('INFERENCE_UNAVAILABLE', 502);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: failure.code }) }] };
    }
  });
  return server;
}
export async function callModelMcp(input: unknown, options: McpInferenceOptions = {}) {
  const parsed = InferenceRequestSchema.safeParse(input);
  if (!parsed.success) throw new ApiFailure('INVALID_REQUEST', 400);
  if ('fetchImpl' in options) throw new ApiFailure('INVALID_REQUEST', 400);
  if (!options.apiKey?.trim()) throw new ApiFailure('INFERENCE_NOT_CONFIGURED', 503);
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.min(55_000, Math.max(1, options.timeoutMs ?? 55_000)))]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('./model-mcp-server.ts', import.meta.url))],
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HF_TOKEN: options.apiKey }, stderr: 'ignore'
  });
  const client = new Client({ name: 'conjugate-app', version: '1.0.0' });
  const abort = () => { void transport.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await client.connect(transport);
    const reply = CallToolResultSchema.parse(await client.callTool({ name: 'score_masked_antibody', arguments: parsed.data }, undefined, { signal, timeout: 55_000 }));
    if (reply.isError) {
      const block = reply.content.find(c => c.type === 'text');
      const code = block && block.type === 'text' ? JSON.parse(block.text).code : undefined;
      if (code === 'INFERENCE_TIMEOUT') throw new ApiFailure('INFERENCE_TIMEOUT', 504);
      if (code === 'INFERENCE_INVALID_OUTPUT') throw new ApiFailure('INFERENCE_INVALID_OUTPUT', 502);
      if (code === 'INFERENCE_BUDGET_EXCEEDED') throw new ApiFailure('INFERENCE_BUDGET_EXCEEDED', 429);
      throw new ApiFailure('INFERENCE_UNAVAILABLE', 502);
    }
    const result = InferenceResultSchema.parse(reply.structuredContent);
    const expected = INFERENCE_CASES.find(c => c.id === parsed.data.sequence_id)!;
    const provider = InferenceProviderOutputSchema.parse(JSON.parse(result.provider_response_json))[0]!;
    if (result.request.sequence_id !== parsed.data.sequence_id || Object.keys(expected).some(key => expected[key as keyof typeof expected] !== result.sequence[key as keyof typeof expected]) || fingerprint(result.provider_response_json) !== result.output_sha256 || fingerprint(provider.sequence.replaceAll(' ', '')) !== expected.sequence_sha256) throw new ApiFailure('INFERENCE_INVALID_OUTPUT', 502);
    return result;
  } catch (error) {
    if (signal.aborted) throw new ApiFailure(options.signal?.aborted ? 'RESEARCH_CANCELLED' : 'INFERENCE_TIMEOUT', options.signal?.aborted ? 499 : 504);
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure('INFERENCE_UNAVAILABLE', 502);
  } finally { signal.removeEventListener('abort', abort); await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}
