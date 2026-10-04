import { readFile, stat } from 'node:fs/promises';
import { replayChatResult } from '../apps/api/src/chat-replay.js';

try {
  const path = process.argv[2];
  if (!path || (await stat(path)).size > 1000000) throw new Error('Missing or oversized file.');
  console.log(JSON.stringify(await replayChatResult(JSON.parse(await readFile(path, 'utf8'))), null, 2));
} catch { console.error('Chat replay failed. Use an exported turn with the same code and evidence snapshot.'); process.exitCode = 1; }
