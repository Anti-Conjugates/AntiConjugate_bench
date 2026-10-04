import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ChatRequestSchema, ChatResultSchema, ChatEventSchema, type ChatEvent } from '@her2/shared';
import { runChat, type ChatOptions } from './chat.js';
import { ApiFailure } from './errors.js';

function body(request: FastifyRequest) {
  const parsed = ChatRequestSchema.safeParse(request.body);
  if (!parsed.success) throw new ApiFailure('INVALID_REQUEST', 400);
  return parsed.data;
}
function disconnect(request: FastifyRequest, reply: FastifyReply, controller: AbortController) {
  const cancel = () => controller.abort();
  request.raw.once('aborted', cancel); reply.raw.once('close', cancel);
  return () => { request.raw.off('aborted', cancel); reply.raw.off('close', cancel); };
}
export function registerChatRoutes(app: FastifyInstance, options: ChatOptions) {
  let active = 0;
  const reserve = () => {
    if (active >= 2) throw new ApiFailure('CHAT_BUSY', 429);
    active++;
    let released = false;
    return () => { if (!released) { active--; released = true; } };
  };
  app.post('/api/chat/turns', async (request, reply) => {
    const input = body(request);
    const release = reserve();
    const controller = new AbortController();
    const cleanup = disconnect(request, reply, controller);
    try {
      const result = ChatResultSchema.parse(await runChat(input, { ...options, signal: controller.signal }));
      if (!controller.signal.aborted) return reply.send(result);
      return reply;
    } finally { cleanup(); release(); }
  });
  app.post('/api/chat/turns/stream', (request, reply) => {
    const input = body(request);
    const release = reserve();
    const controller = new AbortController();
    const cleanup = disconnect(request, reply, controller);
    const output = new PassThrough();
    const deadline = performance.now() + Math.min(60000, Math.max(1, options.claude?.timeoutMs ?? 60000));
    output.once('error', () => controller.abort()); output.once('close', () => controller.abort());
    const emit = async (event: ChatEvent) => {
      if (controller.signal.aborted || output.destroyed) throw new ApiFailure('RESEARCH_CANCELLED', 499);
      if (!output.write(`${JSON.stringify(ChatEventSchema.parse(event))}\n`)) {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now())))]);
        try { await once(output, 'drain', { signal }); }
        catch { output.destroy(); controller.abort(); throw new ApiFailure('RESEARCH_CANCELLED', 499); }
      }
    };
    reply.type('application/x-ndjson; charset=utf-8').send(output);
    void (async () => {
      try { await emit({ type: 'result', result: await runChat(input, { ...options, signal: controller.signal, onGuard: guard => emit({ type: 'guard', guard }), onStep: step => emit({ type: 'trace', step }) }) }); }
      catch (error) {
        if (!controller.signal.aborted && !output.destroyed) {
          const failure = error instanceof ApiFailure ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: 'This question could not be checked. No answer was released.' };
          try { await emit({ type: 'error', error: failure }); } catch { /* Consumer disconnected. */ }
        }
      } finally { cleanup(); release(); if (!output.destroyed) output.end(); }
    })();
    return reply;
  });
}
