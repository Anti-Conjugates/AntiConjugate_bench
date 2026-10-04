import Fastify, { LogController, type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { access, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { posix } from 'node:path';
import { ApiErrorSchema, CatalogSchema, RunRequestSchema, RunResultSchema } from '@her2/shared';
import { buildCatalog, CLAUDE_MODEL } from './evidence.js';
import { ApiFailure } from './errors.js';
import { runReview, type RunOptions } from './run.js';
import { registerResearchRoutes } from './research-routes.js';
import { registerChatRoutes } from './chat-routes.js';
import { registerTeamRoutes } from './team-routes.js';
import { registerModelRoutes } from './models-routes.js';
import type { ChatOptions } from './chat.js';
import type { McpInferenceOptions } from './model-mcp.js';

export interface AppOptions extends RunOptions, ChatOptions {
  inference?: McpInferenceOptions;
  staticRoot?: string;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}
function errorBody(code: string, message: string) { return ApiErrorSchema.parse({ error: { code, message } }); }
function apiPath(url: string) {
  let path: string;
  try { path = posix.normalize(decodeURIComponent(url.split('?')[0] ?? '/').replaceAll('\\', '/')); } catch { return true; }
  return path === '/api' || path.startsWith('/api/');
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 16_384, requestTimeout: 65_000, trustProxy: false });
  const configured = Boolean(options.claude?.apiKey?.trim());
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });
  await app.register(rateLimit, {
    global: true, max: Math.min(30, Math.max(1, options.rateLimitMax ?? 30)),
    timeWindow: Math.min(60_000, Math.max(1, options.rateLimitWindowMs ?? 60_000)),
    errorResponseBuilder: () => Object.assign(new Error('Rate limit exceeded.'), { statusCode: 429 })
  });
  app.setErrorHandler((error, _request, reply) => {
    // Errors may carry request/model/credential strings. Never serialize them.
    if (error instanceof ApiFailure) return reply.code(error.status).send(errorBody(error.code, error.message));
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send(errorBody('BODY_TOO_LARGE', 'Request body exceeds the allowed size.'));
    if (status === 429) return reply.code(429).send(errorBody('RATE_LIMITED', 'Request rate limit exceeded. Try again later.'));
    if (status === 415) return reply.code(415).send(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Use application/json for API requests.'));
    if (status === 400) return reply.code(400).send(errorBody('INVALID_REQUEST', 'Malformed JSON or invalid request.'));
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'The request could not be completed safely. No clinical result was produced.'));
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(errorBody('NOT_FOUND', 'Route not found.')));
  app.get('/api/health', async () => ({ status: 'ok', claude_configured: configured, model: CLAUDE_MODEL }));
  app.get('/api/catalog', async () => CatalogSchema.parse(buildCatalog(configured)));
  app.post('/api/runs', async (request, reply) => {
    const parsed = RunRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiFailure('INVALID_REQUEST', 400);
    const result = await runReview(parsed.data, options);
    RunResultSchema.parse(result);
    return reply.code(200).send(result);
  });

  registerResearchRoutes(app, options);
  registerChatRoutes(app, options);
  registerTeamRoutes(app, options);
  registerModelRoutes(app, options.inference);

  if (options.staticRoot) {
    const root = resolve(options.staticRoot);
    let exists = false;
    try { await access(resolve(root, 'index.html')); exists = true; } catch { /* API-only if no web build exists. */ }
    if (exists) {
      // No automatic wildcard: explicitly prevent ANY /api route from static
      // handling, even if a file at that path happens to exist in the build.
      await app.register(fastifyStatic, { root, serve: false });
      app.get('/*', async (request, reply) => {
        if (apiPath(request.url)) return reply.code(404).send(errorBody('NOT_FOUND', 'API route not found.'));
        let decoded: string;
        try { decoded = decodeURIComponent(request.url.split('?')[0] ?? '/'); } catch { return reply.code(400).send(errorBody('INVALID_REQUEST', 'Invalid path.')); }
        const target = resolve(root, `.${decoded}`);
        if (!target.startsWith(`${root}${sep}`) && target !== root) return reply.code(404).send(errorBody('NOT_FOUND', 'Route not found.'));
        let fileExists = false;
        try { fileExists = (await stat(target)).isFile(); } catch { /* Known SPA routes may use index.html. */ }
        if (fileExists) return reply.sendFile(decoded.replace(/^\/+/, ''));
        if (decoded.startsWith('/assets/') || decoded.includes('.')) return reply.code(404).send(errorBody('NOT_FOUND', 'File not found.'));
        return reply.sendFile('index.html');
      });
    }
  }
  await app.ready();
  return app;
}
