/**
 * Writes the presentation figures as standalone SVG files to apps/web/public/figures, using the same
 * components and committed artifacts as the page. Run from conjugate/: npm run figures
 * og.png is rendered from figures/share-card.svg with headless Chrome (see docs/PRESENTATION.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BaitFigure, EnvironmentFigure, HarnessFigure, PremiseFigure, ShareCard, WhyFigure } from '../src/figures';
import { labelSourceName, loadPresentationData } from '../src/presentationData';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'figures');
const data = loadPresentationData({ state: 'missing' });
const finding = data.premise.report.findings[0];
if (!finding) throw new Error('Recorded premise exhibit has no finding');
const verdict = data.premise.kadcylaVerdict.verdict;
if (verdict !== 'supported' && verdict !== 'contradicted' && verdict !== 'insufficient') throw new Error(`Unknown verdict ${verdict}`);

const figures: Record<string, ReactElement> = {
  'why.svg': <WhyFigure />,
  'environment.svg': <EnvironmentFigure workbookRecords={data.environment.workbookRecords} labelProducts={data.environment.labelProducts} sources={data.environment.sources} />,
  'harness.svg': <HarnessFigure />,
  'false-premise.svg': <PremiseFigure question={data.premise.question} stated={finding.stated ?? ''} recorded={finding.recorded ?? ''} check={finding.check} verdict={verdict} cited={data.premise.kadcylaVerdict.source_ids.map(labelSourceName)} />,
  'hallucination-bait.svg': <BaitFigure invented={data.bait.invented} fakeNct={data.bait.fakeNct} receipt={data.bait.receipt} modelCalls={data.bait.modelCalls} />,
  'share-card.svg': <ShareCard workbookRecords={data.environment.workbookRecords} sourceCount={data.environment.sources.length} />,
};
mkdirSync(out, { recursive: true });
for (const [name, element] of Object.entries(figures)) {
  writeFileSync(join(out, name), `<?xml version="1.0" encoding="UTF-8"?>\n${renderToStaticMarkup(element)}\n`);
  console.log(`wrote public/figures/${name}`);
}
