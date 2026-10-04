import { writeFile } from 'node:fs/promises';
import { BenchmarkArmSchema } from '@her2/shared';
import { runBenchmark } from '../apps/api/src/bench.js';

// Usage: npm run bench -- --offline | --live [--max-calls N] [--arms plain_claude,harness_claude,harness_rules] [--out evals/benchmark.json]
const argv = process.argv.slice(2);
const flag = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
const live = argv.includes('--live');
if (live === argv.includes('--offline')) throw new Error('Pass exactly one of --offline or --live.');
const maxCalls = Number(flag('--max-calls') ?? 220);
const arms = flag('--arms')?.split(',').map(arm => BenchmarkArmSchema.parse(arm.trim()));
const out = new URL(flag('--out') ?? '../evals/benchmark.json', flag('--out') ? `file://${process.cwd()}/` : import.meta.url);

let done = 0;
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.CLAUDE_MODEL;
const artifact = await runBenchmark({
  mode: live ? 'live' : 'offline', maxCalls, ...(arms ? { arms } : {}), ...(apiKey ? { apiKey } : {}), ...(model ? { model } : {}),
  onRow: row => { done++; if (live) console.error(`${done} ${row.arm} ${row.item_id} ${row.outcome}`); }
});
await writeFile(out, JSON.stringify(artifact, null, 2) + '\n');
const totals = Object.fromEntries(artifact.arms.map(arm => [arm, Object.values(artifact.summary[arm] ?? {}).reduce((sum, cell) => ({ n: sum.n + cell.n, correct: sum.correct + cell.correct, errors: sum.errors + cell.errors }), { n: 0, correct: 0, errors: 0 })]));
console.log(JSON.stringify({ mode: artifact.mode, items: artifact.items.length, calls_used: artifact.budget.calls_used, max_calls: artifact.budget.max_calls, retries: 0, totals }));
