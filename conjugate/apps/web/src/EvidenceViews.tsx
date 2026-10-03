import type { Catalog, Source } from '@her2/shared';
import { ExternalLink } from 'lucide-react';
import { safeSourceUrl } from './boundaries';

export function SourceLink({ source, compact = false }: { source: Source; compact?: boolean }) {
  const href = safeSourceUrl(source.url);
  const text = compact ? `${source.jurisdiction}, ${source.section}` : source.title;
  return href ? <a className={compact ? 'citation-link' : 'source-title-link'} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${source.title}, ${source.section} (opens in new tab)`}>{text}<ExternalLink size={12} aria-hidden="true" /></a> : <span className="source-title-link">{text} <small>(link unavailable)</small></span>;
}

export function SourceEntry({ source }: { source: Source }) {
  return (
    <article className="source-entry">
      <div className="source-metadata"><span>{source.jurisdiction} label</span><span>{source.section}</span><span>Revision {source.revision_date}</span></div>
      <h3><SourceLink source={source} /></h3>
      <p>{source.excerpt}</p>
      <div className="source-entry-footer"><span className="field-hint">Paraphrase, not a quotation. Pharmacist review pending.</span><code>{source.id}</code></div>
    </article>
  );
}

export function SourceLibrary({ catalog }: { catalog: Catalog | null }) {
  return (
    <section className="library-view" aria-labelledby="library-heading">
      <header className="view-heading"><h1 id="library-heading">Sources</h1><p>The UK label sections this app can cite. Each entry is a dated paraphrase with a link to the section. Runs read this list; they do not fetch anything live.</p></header>
      {!catalog ? <div className="empty-library"><h2>Catalog unavailable</h2><p>Connect to the local API to see its source list.</p></div> : <>
        <section aria-labelledby="label-sources-heading"><h2 id="label-sources-heading">Label sections <span className="mono-label">{catalog.sources.length}</span></h2>
          <div className="source-list">{catalog.sources.map((source) => <SourceEntry key={source.id} source={source} />)}</div>
        </section>
        <section aria-labelledby="structural-heading"><h2 id="structural-heading">ADCdb structure pages</h2><p>Structure pages give context for the ADC table. They are kept separate from the label sources above and do not feed the clinical gate.</p><div className="structure-links">{catalog.products.map((product) => {
          const href = safeSourceUrl(product.adcdb_url);
          return <div key={product.id}><strong>{product.brand}</strong><span>{product.antibody}, {product.payload}</span>{href ? <a href={href} target="_blank" rel="noopener noreferrer">ADCdb page <ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in new tab)</span></a> : <span>Link unavailable</span>}</div>;
        })}</div></section>
      </>}
    </section>
  );
}
