import type { FastifyInstance } from 'fastify';
import { buildModelCatalog, replayModels, runModels } from './models.js';
import { InferenceCatalogSchema, InferenceRequestSchema, LIVE_ESM_MODEL } from '@her2/shared';
import { INFERENCE_CASES } from './live-inference.js';
import { callModelMcp, type McpInferenceOptions } from './model-mcp.js';
import { ApiFailure } from './errors.js';

export function registerModelRoutes(app: FastifyInstance, options: McpInferenceOptions = {}) {
  app.get('/api/models/catalog', async () => buildModelCatalog());
  app.post('/api/models/runs', async request => runModels(request.body));
  app.post('/api/models/replay', { bodyLimit: 200_000 }, async request => replayModels(request.body));
  let active = false;
  let remaining = 20;
  app.get('/api/models/inference', async () => InferenceCatalogSchema.parse({
    configured: Boolean(options.apiKey?.trim()), provider: 'hf-inference', model_id: LIVE_ESM_MODEL,
    task: 'fill-mask', transport: 'mcp_stdio', remaining_calls: options.apiKey?.trim() ? remaining : 0, cases: INFERENCE_CASES
  }));
  app.post('/api/models/inference', async (request, reply) => {
    const input = InferenceRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiFailure('INVALID_REQUEST', 400);
    if (!options.apiKey?.trim()) throw new ApiFailure('INFERENCE_NOT_CONFIGURED', 503);
    if (active) throw new ApiFailure('INFERENCE_BUSY', 429);
    if (remaining <= 0) throw new ApiFailure('INFERENCE_BUDGET_EXCEEDED', 429);
    active = true; remaining--;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.raw.once('aborted', cancel); reply.raw.once('close', cancel);
    try {
      const result = await callModelMcp(input.data, { ...options, signal: controller.signal });
      if (!controller.signal.aborted) return reply.send(result);
      return reply;
    } finally { request.raw.off('aborted', cancel); reply.raw.off('close', cancel); active = false; }
  });
}
