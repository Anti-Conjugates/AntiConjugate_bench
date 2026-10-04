import { parseBenchmark, type BenchmarkLoad } from './presentationData';

/** evals/benchmark.json is written by a separate benchmark run. Until it is committed the glob resolves to {} and the page says so. */
const modules = import.meta.glob<unknown>('../../../evals/benchmark.json', { eager: true, import: 'default' });

export const loadBenchmark = (): BenchmarkLoad => parseBenchmark(Object.values(modules)[0]);
