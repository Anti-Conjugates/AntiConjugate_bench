import type { FastifyInstance } from 'fastify';
import { ApiErrorSchema, LiveCheckRequestSchema } from '@her2/shared';
import { ApiFailure } from './errors.js';
import { createLiveRetriever, type LiveRetriever } from './live-retrieval.js';

export interface LiveRouteOptions { env?: Record<string, string | undefined>; retriever?: LiveRetriever; enabled?: boolean }
const MAX_ACTIVE = 2;
let shared: LiveRetriever | undefined;
/** Off unless LIVE_RETRIEVAL=on, so tests and local runs never reach the network by accident. */
export const liveRetrievalEnabled = (env: Record<string, string | undefined> = process.env) => env.LIVE_RETRIEVAL?.trim().toLowerCase() === 'on';
export const sharedLiveRetriever = () => (shared ??= createLiveRetriever());
const errorBody = (code: string, message: string) => ApiErrorSchema.parse({ error: { code, message } });

export function registerLiveRoutes(app: FastifyInstance, options: LiveRouteOptions = {}) {
  const enabled = options.enabled ?? liveRetrievalEnabled(options.env);
  const retriever = options.retriever ?? sharedLiveRetriever();
  let active = 0;
  app.get('/api/live/sources', async () => retriever.catalog(enabled));
  app.post('/api/live/check', async (request, reply) => {
    if (!enabled) return reply.code(503).send(errorBody('LIVE_RETRIEVAL_OFF', 'Live retrieval is off on this server. Nothing was fetched.'));
    const input = LiveCheckRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiFailure('INVALID_REQUEST', 400);
    if (active >= MAX_ACTIVE) return reply.code(429).send(errorBody('LIVE_BUSY', 'Two live checks are already running. Try again after one finishes.'));
    active++;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.raw.once('aborted', cancel); reply.raw.once('close', cancel);
    try {
      const result = await retriever.check(input.data, controller.signal);
      if (!controller.signal.aborted) return reply.send(result);
      return reply;
    } finally { request.raw.off('aborted', cancel); reply.raw.off('close', cancel); active--; }
  });
}
