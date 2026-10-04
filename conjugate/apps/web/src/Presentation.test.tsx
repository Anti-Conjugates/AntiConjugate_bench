import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BenchmarkArtifact } from '@her2/shared';
import { Presentation, sectionTarget } from './Presentation';
import { labelSourceName, loadPresentationData, parseBenchmark, PRESENTATION_SECTIONS } from './presentationData';
import { pickBaitPair } from './PresentationBenchmark';
import { urlTemplate, wrap } from './figures';

const fixture: BenchmarkArtifact = {
  version: 'conjugate-bench-1', generated_at: '2026-10-04T00:00:00.000Z', mode: 'offline', model: 'fixture-model',
  items_sha256: 'a'.repeat(64), workbook_sha256: 'b'.repeat(64),
  arms: ['plain_claude', 'harness_claude'],
  items: [{ item_id: 'bait-fixture', category: 'invented_adc', product_id: null, message: 'Fixture question about an invented ADC.', expected: { kind: 'abstain' } }],
  rows: [
    { item_id: 'bait-fixture', category: 'invented_adc', product_id: null, arm: 'plain_claude', outcome: 'bluffed', citations: [{ id: 'NCT00000000', resolved: 'not_found' }], response_sha256: 'c'.repeat(64), excerpt: 'FIXTURE plain excerpt', model_calls: 1, duration_ms: 10 },
    { item_id: 'bait-fixture', category: 'invented_adc', product_id: null, arm: 'harness_claude', outcome: 'abstained_correctly', citations: [], response_sha256: null, excerpt: 'FIXTURE harness excerpt', model_calls: 0, duration_ms: 5 },
  ],
  summary: {
    plain_claude: { invented_adc: { n: 1, correct: 0, bluffed: 1, fabricated_citations: 1, accepted_false_premise: 0, wrong_fact: 0, over_refused: 0, errors: 0 } },
    harness_claude: { invented_adc: { n: 1, correct: 1, bluffed: 0, fabricated_citations: 0, accepted_false_premise: 0, wrong_fact: 0, over_refused: 0, errors: 0 } },
  },
  budget: { max_calls: 10, calls_used: 1, retries: 0 },
  limitations: ['Fixture limitation for the test.'],
};

const render = (data = loadPresentationData({ state: 'missing' })) => renderToStaticMarkup(<Presentation onNavigate={() => {}} data={data} />);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('Presentation', () => {
  const html = render();

  it('renders all eight sections in order with headings', () => {
    const positions = PRESENTATION_SECTIONS.map(section => html.indexOf(`id="${section.id}"`));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const section of PRESENTATION_SECTIONS) expect(html).toContain(`aria-labelledby="${section.id}-heading"`);
    expect(text(html)).toContain('Trust less.');
  });

  it('shows numbers read from the committed artifacts', () => {
    const data = loadPresentationData({ state: 'missing' });
    const body = text(html);
    expect(body).toContain(`${data.environment.workbookRecords} ADCs`);
    expect(body).toContain(data.premise.question);
    expect(body).toContain(`HTTP ${data.bait.receipt.http}`);
    expect(body).toContain(data.failures.mutants.caught);
    expect(body).toContain(data.failures.keyOrder.before);
    expect(body).toContain(data.failures.shortcut.eligibleOnly);
    expect(body).toContain(data.failures.withholding.changed);
    for (const source of data.environment.sources) expect(body).toContain(source.name);
    expect(body).toContain(`any of the ${data.environment.scopedProducts} workbook ADCs`);
    for (const product of data.environment.labelProducts) expect(body).toContain(product);
  });

  it('gives every figure an accessible title and description', () => {
    const svgs = html.match(/<svg[^>]*role="img"[^>]*>/g) ?? [];
    expect(svgs.length).toBeGreaterThanOrEqual(8);
    for (const svg of svgs) {
      const ids = /aria-labelledby="([^"]+)"/.exec(svg)?.[1]?.split(' ') ?? [];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(html).toMatch(new RegExp(`<(title|desc) id="${id}">[^<]+</(title|desc)>`));
    }
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows a labelled placeholder when the benchmark artifact is missing or invalid', () => {
    expect(text(html)).toContain('Benchmark pending');
    expect(text(html)).not.toContain('Plain Claude Bluffed');
    const invalid = parseBenchmark({ version: 'nope' });
    expect(invalid.state).toBe('invalid');
    expect(text(render(loadPresentationData(invalid)))).toContain('does not match BenchmarkArtifactSchema');
  });

  it('renders benchmark rows and the side-by-side slot from a valid artifact', () => {
    const load = parseBenchmark(fixture);
    expect(load.state).toBe('ready');
    if (load.state === 'ready') expect(pickBaitPair(load.artifact)?.plain.excerpt).toBe('FIXTURE plain excerpt');
    const body = text(render(loadPresentationData(load)));
    expect(body).toContain('FIXTURE plain excerpt');
    expect(body).toContain('FIXTURE harness excerpt');
    expect(body).toContain('Fixture limitation for the test.');
    expect(body).not.toContain('Benchmark pending');
  });

  it('keeps clinical-claim words out of everything except negations in the limits section', () => {
    const limitsAt = html.indexOf('id="p-limits"');
    const before = text(html.slice(0, limitsAt)).toLowerCase();
    for (const phrase of ['prescrib', 'calibrated', 'clinically validated', 'clinical validation']) expect(before).not.toContain(phrase);
    const limits = text(html.slice(limitsAt)).toLowerCase();
    for (const phrase of ['not clinically validated', 'no prescribing', 'no calibrated confidence', 'openfold and alphafold 3 were not run']) expect(limits).toContain(phrase);
  });
});

describe('presentation helpers', () => {
  it('jumps to the next or previous section start', () => {
    expect(sectionTarget([-900, -200, 72, 600, 1400], 1)).toBe(3);
    expect(sectionTarget([-900, -200, 72, 600, 1400], -1)).toBe(1);
    expect(sectionTarget([-900, -200], 1)).toBeNull();
    expect(sectionTarget([300, 900], -1)).toBeNull();
  });
  it('names label sources from the shared product list', () => {
    expect(labelSourceName('UK-KADCYLA-SMPC')).toBe('Kadcyla label');
    expect(labelSourceName('WORKBOOK-X')).toBe('WORKBOOK-X');
  });
  it('wraps text and shortens URLs to their template', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(urlTemplate('https://clinicaltrials.gov/api/v2/studies/NCT09999999?fields=x', 'NCT09999999')).toEqual({ host: 'clinicaltrials.gov', path: '/api/v2/studies/{id}?fields=…' });
  });
});
