import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { ResearchRequestSchema, ResearchResultSchema, ResearchEventSchema, type ResearchEvent } from '@her2/shared';
import { ApiFailure } from './errors.js';
import { type RunOptions } from './run.js';
import { researchCatalog } from './research-evidence.js';
import { runResearch } from './research.js';

function validatedBody(request: FastifyRequest) {
  const parsed = ResearchRequestSchema.safeParse(request.body);
  if (!parsed.success) throw new ApiFailure('INVALID_REQUEST', 400);
  return parsed.data;
}
function disconnect(request: FastifyRequest, reply: FastifyReply, controller: AbortController) {
  const cancel = () => controller.abort();
  request.raw.once('aborted', cancel);
  reply.raw.once('close', cancel);
  return () => { request.raw.off('aborted', cancel); reply.raw.off('close', cancel); };
}
export function registerResearchRoutes(app: FastifyInstance, options: RunOptions) {
  app.get('/api/research/catalog', async () => researchCatalog(Boolean(options.claude?.apiKey?.trim())));
  app.post('/api/research/runs', async (request, reply) => {
    const input = validatedBody(request);
    const controller = new AbortController();
    const cleanup = disconnect(request, reply, controller);
    try {
      const result = ResearchResultSchema.parse(await runResearch(input, { ...options, signal: controller.signal }));
      if (!controller.signal.aborted) return reply.send(result);
      return reply;
    } finally { cleanup(); }
  });
  app.post('/api/research/runs/stream', (request, reply) => {
    const input = validatedBody(request);
    const controller = new AbortController();
    const cleanup = disconnect(request, reply, controller);
    const output = new PassThrough();
    const deadline = performance.now() + Math.min(60_000, Math.max(1, options.claude?.timeoutMs ?? 60_000));
    output.once('error', () => controller.abort());
    output.once('close', () => controller.abort());
    const emit = async (event: ResearchEvent) => {
      if (controller.signal.aborted || output.destroyed) throw new ApiFailure('RESEARCH_CANCELLED', 499);
      const line = `${JSON.stringify(ResearchEventSchema.parse(event))}\n`;
      if (!output.write(line)) {
        const waitSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now())))]);
        try { await once(output, 'drain', { signal: waitSignal }); }
        catch { output.destroy(); controller.abort(); throw new ApiFailure('RESEARCH_CANCELLED', 499); }
      }
    };
    // Send a normal Fastify stream, not hijack: onSend security/cache hooks and
    // rate/body protections still apply. Each event is an actual finished step.
    reply.type('application/x-ndjson; charset=utf-8');
    reply.send(output);
    void (async () => {
      try {
        const result = await runResearch(input, { ...options, signal: controller.signal, onTrace: step => emit({ type: 'trace', step }) });
        await emit({ type: 'result', result });
      } catch (error) {
        if (!controller.signal.aborted && !output.destroyed) {
          const failure = error instanceof ApiFailure ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: 'The research request could not be completed safely. No clinical result was produced.' };
          // No upstream/body/key/model prose or thrown error serialization.
          try { await emit({ type: 'error', error: failure }); } catch { /* Disconnected consumer; no further writes. */ }
        }
      } finally {
        cleanup();
        if (!output.destroyed) output.end();
      }
    })();
    return reply;
  });
}
