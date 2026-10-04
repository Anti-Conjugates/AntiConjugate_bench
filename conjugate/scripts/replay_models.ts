import { readFileSync } from 'node:fs';
import { replayModels } from '../apps/api/src/models.js';

try {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error();
  console.log(JSON.stringify(replayModels(JSON.parse(readFileSync(path, 'utf8'))), null, 2));
} catch {
  console.error('Replay failed. Supply one JSON export from this build.');
  process.exitCode = 1;
}
