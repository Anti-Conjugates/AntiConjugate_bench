import { readFileSync, statSync } from 'node:fs';
import { replayResearchResult } from '../apps/api/src/research-replay.js';

async function main() {
  const path = process.argv[2];
  if (!path || statSync(path).size > 1_000_000) throw new Error('Supply a research JSON export under 1 MB.');
  console.log(JSON.stringify(await replayResearchResult(JSON.parse(readFileSync(path, 'utf8')))));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Replay failed.'); process.exitCode = 1; });
