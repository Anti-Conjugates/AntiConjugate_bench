import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { EvaluationStudies } from './EvaluationStudies';

it('shows surviving weakened verifiers and the preserved real failure, not just green counts', () => {
  const markup = renderToStaticMarkup(createElement(EvaluationStudies));
  expect(markup).toContain('Would the eval catch a broken checker?');
  expect(markup).toContain('other checks still block these faults');
  expect(markup).toContain('20/80');
  expect(markup).toContain('Source equality depended on JSON key order');
  expect(markup).toContain('Download original failure');
});
it('shows simple baselines, paired errors, fixed budget and limitations', () => {
  const markup = renderToStaticMarkup(createElement(EvaluationStudies));
  expect(markup).toContain('source-kind rule also matches 20/20');
  expect(markup).toContain('do not demonstrate a need for an LLM');
  expect(markup).toContain('120');
  expect(markup).toContain('The planner is deliberately excluded');
  expect(markup).toContain('we make no significance or calibration claim');
  expect(markup).not.toContain('clinical accuracy');
});
