import type { ResearchCatalog, ResearchReceipt, ResearchRequest, ResearchResult, ResearchTrace } from '@her2/shared';
import { WorkbookCellSchema } from '@her2/shared';
import { ArrowDownToLine, ExternalLink, LockKeyhole } from 'lucide-react';
import { z } from 'zod';
import { safeSourceUrl } from './boundaries';
import { downloadResearchResult } from './researchBoundaries';
import { productLabel, verdictLabels } from './labels';

const sourceKinds = { workbook: 'Workbook row', label: 'Label summary', derived: 'Derived note (not from ADCdb)' } as const;
const actorLabels = { controller: 'controller', local_tool: 'local tool', claude: 'Claude', deterministic_verifier: 'verifier' } as const;
const receiptAnchor = (id: string) => `source-${encodeURIComponent(id)}`;
const cellsSchema = z.array(WorkbookCellSchema);

export function ReceiptRefs({ ids, receipts }: { ids: string[]; receipts: ResearchReceipt[] }) {
  return <span className="receipt-refs">{ids.length ? ids.map((id) => receipts.some((receipt) => receipt.id === id)
    ? <a href={`#${receiptAnchor(id)}`} key={id}><code>{id}</code></a>
    : <code className="unresolved-ref" key={id}>{id} <span>(not in sources)</span></code>) : <span className="field-hint">No sources.</span>}</span>;
}

function duration(ms: number) { return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(0)} ms`; }

export function AuditTrace({ steps, receipts, busy }: { steps: ResearchTrace[]; receipts: ResearchReceipt[]; busy: boolean }) {
  return <details className="trace" open={busy || undefined}>
    <summary><h2>Trace</h2><span className="mono-label">{steps.length} event{steps.length === 1 ? '' : 's'}{busy ? ', running' : ''}</span></summary>
    {!steps.length && <p className="empty-section-note">{busy ? 'Waiting for the first event.' : 'No events. Nothing has run.'}</p>}
    {steps.length > 0 && <div className="trace-table-wrap"><table className="trace-table"><caption className="sr-only">Pipeline events returned by the server</caption>
      <thead><tr><th scope="col">Stage</th><th scope="col">Actor</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Tool</th><th scope="col">Detail</th></tr></thead>
      <tbody>{steps.map((step) => <tr key={step.id}>
        <th scope="row">{step.stage}</th><td>{actorLabels[step.actor]}</td><td className={step.status === 'blocked' ? 'uncertainty' : ''}>{step.status}</td><td>{duration(step.duration_ms)}</td><td>{step.tool ?? ''}</td>
        <td className="trace-detail">{step.detail}{step.source_ids.length > 0 && <ReceiptRefs ids={step.source_ids} receipts={receipts} />}</td>
      </tr>)}</tbody></table></div>}
  </details>;
}

function Excerpt({ receipt }: { receipt: ResearchReceipt }) {
  if (receipt.kind !== 'label') {
    try {
      const cells = cellsSchema.parse(JSON.parse(receipt.excerpt));
      return <table className="cell-table"><caption className="sr-only">Cells read from the workbook</caption><thead><tr><th scope="col">Field</th><th scope="col">Cell</th><th scope="col">Value</th></tr></thead>
        <tbody>{cells.map((cell) => <tr key={cell.cell}><th scope="row">{cell.field}</th><td><code>{cell.cell}</code></td><td className={cell.value === null ? 'blank-cell' : ''}>{cell.value ?? 'Unknown (blank cell)'}</td></tr>)}</tbody></table>;
    } catch { /* Not a cell list; show the text. */ }
  }
  return <p className="receipt-excerpt">{receipt.excerpt}</p>;
}

function Receipt({ receipt, catalog }: { receipt: ResearchReceipt; catalog: ResearchCatalog }) {
  const product = catalog.dataset.records.find((record) => record.id === receipt.product_id);
  const href = receipt.url ? safeSourceUrl(receipt.url) : undefined;
  return <article className={`source-card kind-${receipt.kind}`} id={receiptAnchor(receipt.id)} tabIndex={-1}>
    <div className="source-card-top"><span className="source-kind">{sourceKinds[receipt.kind]}</span><code>{receipt.id}</code></div>
    <h4>{receipt.title}</h4>
    <dl className="source-meta">
      <div><dt>Product</dt><dd>{product ? productLabel(product) : receipt.product_id}</dd></div>
      <div><dt>{receipt.kind === 'label' ? 'Sections' : 'Cells'}</dt><dd>{receipt.section}</dd></div>
      <div><dt>{receipt.kind === 'label' ? 'Label revision' : 'Data date'}</dt><dd>{receipt.revision_date ?? 'Unknown'}</dd></div>
      <div><dt>Can support a claim</dt><dd>{receipt.eligible_for_claim ? 'Yes' : 'No'}</dd></div>
    </dl>
    <Excerpt receipt={receipt} />
    {receipt.kind === 'label' && <p className="field-hint">Paraphrase, not a quotation.</p>}
    {receipt.limitations.length > 0 && <ul className="source-limits">{receipt.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>}
    {href && <a className="external-link" href={href} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in new tab)</span></a>}
  </article>;
}

export function AuditResult({ result, request, catalog, trace, busy, onExportError }: {
  result: ResearchResult | null; request: ResearchRequest | null; catalog: ResearchCatalog; trace: ResearchTrace[]; busy: boolean; onExportError: (error: unknown) => void;
}) {
  if (!result) return <div className="audit-output">
    <section className="result-empty" aria-labelledby="audit-output-heading">
      <h2 id="audit-output-heading">Result</h2>
      <p>{busy ? 'Waiting for the server.' : 'Run a check to see the verdict, the sources it rests on and the verifier checks.'}</p>
    </section>
    <AuditTrace steps={trace} receipts={[]} busy={busy} />
  </div>;
  const verdict = result.claims.some((claim) => claim.verdict === 'contradicted') ? 'contradicted'
    : !result.claims.length || result.claims.some((claim) => claim.verdict === 'insufficient') ? 'insufficient' : 'supported';
  const product = catalog.dataset.records.find((record) => record.id === result.product_id);
  const faultOn = result.integrity_drill !== 'none';
  return <div className="audit-output">
    <section className="result" aria-labelledby="audit-output-heading">
      <div className="section-heading"><h2 id="audit-output-heading">Result</h2><button className="button button-secondary export-button" type="button" onClick={() => { if (request) { try { downloadResearchResult(result, request, catalog); } catch (error: unknown) { onExportError(error); } } }} disabled={!request}><ArrowDownToLine size={14} aria-hidden="true" />Export JSON</button></div>
      <p className="result-scope">{product ? productLabel(product) : result.product_id}. {result.engine === 'evidence' ? 'Rules only' : result.model}. Sources: {result.evidence_policy === 'all' ? 'all' : 'workbook only'}.</p>
      <div className="verdict-row"><span className={`verdict-badge verdict-${verdict}`}>{verdictLabels[verdict]}</span><span className={`gate-badge`}><LockKeyhole size={12} aria-hidden="true" />Clinical release blocked</span><span className={`integrity-badge ${result.draft_integrity === 'rejected' ? 'uncertainty' : ''}`}>Citations {result.draft_integrity}</span></div>
      {faultOn && <p className="fault-note">Fault test <code>{result.integrity_drill}</code>: a bad citation was injected after drafting.</p>}
      {result.claims.map((claim) => <article className="claim" key={claim.id}>
        <h3>{claim.statement}</h3>
        <p className="claim-verdict-line"><span className={`claim-verdict verdict-${claim.verdict}`}>{verdictLabels[claim.verdict]}</span> <code>{claim.id}</code></p>
        <p>{claim.explanation}</p>
        <p className="claim-sources">Rests on <ReceiptRefs ids={claim.source_ids} receipts={result.receipts} /></p>
        <p className="claim-limitation">{claim.limitation}</p>
      </article>)}
      {!result.claims.length && <p className="empty-section-note">{result.draft_integrity === 'rejected' ? 'The verifier rejected the draft, so no claim was accepted.' : 'No claim was accepted.'}</p>}
      {result.draft_integrity === 'rejected' && <section className="rejected-draft" aria-labelledby="rejected-heading"><h3 id="rejected-heading">Rejected draft</h3><p>Ids the verifier refused, shown as text only.</p><code>product_id: {result.draft.product_id}</code><ul>{result.draft.claims.map((claim, index) => <li key={index}><code>{claim.claim_id}</code> cites <code>{claim.source_ids.join(', ') || '(no sources)'}</code></li>)}</ul></section>}

      <section className="result-section" aria-labelledby="sources-heading"><h3 id="sources-heading">Sources used <span className="mono-label">{result.receipts.length}</span></h3>
        {result.receipts.map((receipt) => <Receipt key={receipt.id} receipt={receipt} catalog={catalog} />)}
        {!result.receipts.length && <p className="empty-section-note">No sources returned.</p>}
      </section>

      <section className="result-section" aria-labelledby="checks-heading"><h3 id="checks-heading">Checks</h3>
        {result.challenges.length > 0 && <table className="checks-table"><caption className="sr-only">Verifier checks</caption><thead><tr><th scope="col">Check</th><th scope="col">Outcome</th><th scope="col">Detail</th></tr></thead>
          <tbody>{result.challenges.map((challenge, index) => <tr key={index}><th scope="row"><code>{challenge.code}</code></th><td className={`outcome-${challenge.outcome}`}>{challenge.outcome}</td><td>{challenge.detail}{challenge.source_ids.length > 0 && <ReceiptRefs ids={challenge.source_ids} receipts={result.receipts} />}</td></tr>)}</tbody></table>}
        {!result.challenges.length && <p className="empty-section-note">No checks returned.</p>}
      </section>

      <div className="result-two-column">
        <section className="result-section" aria-labelledby="unknowns-heading"><h3 id="unknowns-heading">Unknowns</h3>{result.unknowns.length ? <ul>{result.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="empty-section-note">None listed.</p>}</section>
        <section className="result-section" aria-labelledby="omissions-heading"><h3 id="omissions-heading">Omitted claims</h3>{result.omitted_claim_ids.length ? <ul>{result.omitted_claim_ids.map((id) => <li key={id}><code>{id}</code></li>)}</ul> : <p className="empty-section-note">None.</p>}</section>
      </div>

      <section className="result-section" aria-labelledby="next-heading"><h3 id="next-heading">Next steps</h3>{result.next_actions.length ? <ol>{result.next_actions.map((item, index) => <li key={index}>{item}</li>)}</ol> : <p className="empty-section-note">None listed.</p>}</section>

      <section className="result-section clinical-gate" aria-labelledby="gate-heading"><h3 id="gate-heading"><LockKeyhole size={14} aria-hidden="true" />Clinical gate</h3>
        <p><code>{result.clinical_status}</code> <code>needs_human: {String(result.needs_human)}</code> <code>eligibility: {result.eligibility}</code></p>
        <ul>{result.guardrail.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        <p className="field-hint">{result.answer}</p>
      </section>

      <dl className="result-provenance">
        <div><dt>Result id</dt><dd><code>{result.id}</code></dd></div>
        <div><dt>Created</dt><dd>{result.created_at}</dd></div>
        <div><dt>Dataset SHA-256</dt><dd><code>{result.dataset_sha256}</code></dd></div>
        <div><dt>Probabilities</dt><dd>correctness {String(result.answer_correctness_probability)}, omission {String(result.omission_probability)}</dd></div>
      </dl>
    </section>
    <AuditTrace steps={result.trace} receipts={result.receipts} busy={false} />
  </div>;
}
