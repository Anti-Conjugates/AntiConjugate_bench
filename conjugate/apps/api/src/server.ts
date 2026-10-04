import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

// Runtime configuration is server-only; never exposed in health/catalog/logs.
const configuredPort = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const port = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65_535 ? configuredPort : 3001;
const host = process.env.HOST ?? '127.0.0.1';
try {
  const app = await createApp({
    inference: process.env.HF_INFERENCE_ENABLED === 'true' && process.env.HF_TOKEN ? { apiKey: process.env.HF_TOKEN } : {},
    claude: { ...(process.env.ANTHROPIC_API_KEY ? { apiKey: process.env.ANTHROPIC_API_KEY } : {}) },
    staticRoot: fileURLToPath(new URL('../../web/dist/', import.meta.url))
  });
  await app.listen({ host, port });
  // No request contents, secrets, traces, raw exceptions or upstream errors.
  console.info('HER2 research-draft API started. Clinical release remains blocked.');
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await app.close(); } catch { process.exitCode = 1; }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  console.error('HER2 API startup failed. Details withheld for safety.');
  process.exitCode = 1;
}
