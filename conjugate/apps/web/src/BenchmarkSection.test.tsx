import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { BenchmarkArtifactSchema } from '@her2/shared';
import artifactJson from '../../../evals/benchmark.json';
import { BenchmarkSection } from './BenchmarkSection';

const artifact = BenchmarkArtifactSchema.parse(artifactJson);

it('renders the headline table, budget line, every row and the limitations from the artifact', () => {
  const markup = renderToStaticMarkup(createElement(BenchmarkSection, { artifact }));
  expect(markup).toContain('Plain Claude against the Conjugate harness');
  expect(markup).toContain('Plain Claude, no tools');
  expect(markup).toContain('Fabricated citations');
  expect(markup).toContain('Accepted false premise');
  expect(markup).toContain(`Model calls ${artifact.budget.calls_used} of ${artifact.budget.max_calls}`);
  expect(markup).toContain(`${artifact.rows.length} of ${artifact.rows.length} rows`);
  for (const line of artifact.limitations) expect(markup).toContain(line.replace(/"/g, '&quot;').slice(0, 40));
  expect(markup).not.toMatch(/probabilit|confidence|clinical accuracy/i);
});

it('marks an offline artifact as not measuring Claude', () => {
  const markup = renderToStaticMarkup(createElement(BenchmarkSection, { artifact: { ...artifact, mode: 'offline' } }));
  expect(markup).toContain('class="bench-offline"');
  const live = renderToStaticMarkup(createElement(BenchmarkSection, { artifact: { ...artifact, mode: 'live' } }));
  expect(live).not.toContain('class="bench-offline"');
});
