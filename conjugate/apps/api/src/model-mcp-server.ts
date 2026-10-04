import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createModelMcpServer } from './model-mcp.js';

try {
  const server = createModelMcpServer(process.env.HF_TOKEN ? { apiKey: process.env.HF_TOKEN } : {});
  await server.connect(new StdioServerTransport());
} catch { process.exitCode = 1; }
