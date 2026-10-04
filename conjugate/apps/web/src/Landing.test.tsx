import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { Landing, PREMISE_EXAMPLE, exhibitRow, landingStats } from './Landing';
import { viewFromHash } from './navigation';

const markup = renderToStaticMarkup(createElement(Landing, { onNavigate: () => {} }));
const visible = markup.replace(/<[^>]+>/g, ' ');

it('leads with the message, the recorded exhibit and the eval counts read from the artifacts', () => {
  expect(markup).toContain('Trust less.');
  expect(markup).toContain('Check more.');
  expect(markup).toContain('Take one source away');
  expect(exhibitRow('all').verdict).toBe('contradicted');
  expect(exhibitRow('workbook_only').verdict).toBe('insufficient');
  expect(markup).toContain('Contradicted');
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).toContain('UK label summary');
  expect(markup).toContain('Switching does not call a model');
  const stats = landingStats();
  expect(stats.faults).toBe('60/60');
  expect(stats.mutants).toBe('7/10');
  for (const value of [stats.faults, stats.shortcuts, stats.mutants, stats.mapped, stats.unmapped]) expect(markup).toContain(value);
  expect(markup).toContain('got through');
  expect(markup).toContain('not whether the science is right');
  expect(markup).toContain('Schematic only. Not a molecular structure');
});

it('tells the seven-beat story with every number read from the artifacts', () => {
  for (const id of ['beat-01', 'beat-02', 'beat-03', 'beat-04', 'beat-05', 'beat-06', 'beat-07']) {
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain(`href="#${id}"`);
  }
  for (const heading of ['Start with a question that already contains a mistake.', 'Now ask it about Enhertu, where the premise is true.', 'Drafts that cheat get thrown out. Checks that go missing stay visible.', 'We broke the verifier on purpose.']) {
    expect(visible.replace(/\s+/g, ' ')).toContain(heading);
  }
  expect(markup).toContain('Recorded example');
  expect(markup).toContain('Premise gate output for this exact question');
  expect(markup).toContain('the same gate runs before every turn');
  expect(markup).toContain('<mark class="pg-match">cleavable</mark>');
  expect(markup).toContain('openFDA, DailyMed, ClinicalTrials.gov, PubMed and ADCdb');
  const stats = landingStats();
  expect(stats.shiftsChanged).toBe('3/10');
  expect(stats.beforeFixControls).toBe('20/80');
  expect(stats.afterFixControls).toBe('80/80');
  expect(stats.survivingMutants).toEqual(['source_allowlist', 'source_eligibility', 'evidence_availability']);
  expect(stats.survivorEscapes).toBe(0);
  for (const value of [stats.shiftsChanged, stats.beforeFixControls, stats.afterFixControls, stats.harness, stats.claudeAccepted, stats.teamLiveFailed, stats.blockedRows]) expect(markup).toContain(value);
  expect(PREMISE_EXAMPLE.report.findings[0]!.kind).toBe('contradicted_premise');
});

it('renders static, visible content on the server with live regions for verdicts and the graph', () => {
  expect(markup).not.toContain('data-beat=');
  expect(markup).toContain('aria-live="polite"');
  expect(markup).toContain('class="tg-svg tg-row"');
  expect(markup).toContain('Agent team graph.');
  expect(markup).toMatch(/class="motion-toggle" aria-pressed="false"><span[^>]*><\/span>Pause orbit/);
  const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
  const block = css.slice(css.indexOf('/* === story-motion === */'), css.indexOf('/* === end story-motion === */'));
  expect(block.length).toBeGreaterThan(100);
  expect(block).toContain('prefers-reduced-motion: reduce');
  expect(block).not.toMatch(/animation:[^;]*infinite/);
  expect(block).not.toMatch(/transition:[^;]*\b(width|height|top|left|margin|padding)\b/);
});

it('uses plain copy and makes no clinical or model-quality claim', () => {
  for (const banned of ['immutable', 'bounded', 'dossier', 'epistemic', 'protocol', 'orchestrat', 'robust', 'seamless', 'cutting-edge', 'empower', 'unlock', 'leverage', 'journey', 'holistic', 'AI-powered', 'clinically validated', 'affinity', 'efficacy']) {
    expect(visible.toLowerCase()).not.toContain(banned.toLowerCase());
  }
  expect(visible).toContain('No doses, no eligibility, no confidence scores');
  expect(visible).toContain('OpenFold and ESMFold have not been run');
});

it('only resolves known views from the URL hash', () => {
  expect(viewFromHash('#evals')).toBe('evals');
  expect(viewFromHash('#/chat')).toBe('chat');
  expect(viewFromHash('')).toBeNull();
  expect(viewFromHash('#main-content')).toBeNull();
  expect(viewFromHash('#<script>alert(1)</script>')).toBeNull();
  expect(viewFromHash('#chat?product=DRG0ERKBH')).toBeNull();
});

it('ships share metadata, a static card, mobile rules and reduced motion', () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('property="og:image" content="https://ryukijano-conjugate.hf.space/og.png"');
  expect(html).toContain('property="og:image:alt"');
  expect(html.toLowerCase()).not.toContain('clinically validated');
  expect(readFileSync(resolve(__dirname, '../public/og.png')).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
  expect(css).toContain('prefers-reduced-motion: reduce');
  expect(css).toMatch(/@media \(max-width: 600px\) \{[^}]*\.hero, \.exhibit/);
  expect(css).toContain('.main-content.main-home');
});

it('uses real links for navigation, one primary action, and tap-sized controls', () => {
  expect(markup).toContain('href="#chat"');
  expect(markup).toContain('href="#evals"');
  expect(markup).toContain('href="#audit"');
  expect((markup.match(/class="hero-primary"/g) ?? []).length).toBe(1);
  expect(markup).not.toMatch(/<button[^>]*class="(hero-primary|hero-secondary|tool-card|landing-link)"/);
  const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
  expect(css).toMatch(/\.landing :focus-visible \{[^}]*outline-offset/);
  expect(css).toMatch(/\.exhibit-toggle button \{ min-height: 44px/);
  expect(css).toMatch(/\.hero-primary, \.hero-secondary \{ min-height: 52px/);
  expect(css).not.toMatch(/@import url\(|fonts\.googleapis/);
});
