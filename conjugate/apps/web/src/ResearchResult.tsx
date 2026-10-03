import type { ReviewFlag, RunResult, Source } from '@her2/shared';
import { ArrowDownToLine, LockKeyhole } from 'lucide-react';
import { exportDraft } from './boundaries';
import { SourceEntry, SourceLink } from './EvidenceViews';

function FlagItem({ flag, sources, omitted = false }: { flag: ReviewFlag; sources: Source[]; omitted?: boolean }) {
  return (
    <article className={`flag-item ${omitted ? 'omitted-item' : ''}`}>
      <div className="flag-meta"><span>{omitted ? 'Omitted' : flag.severity === 'priority' ? 'Priority' : 'Review'}</span><span>{flag.basis === 'label' ? 'From the label' : 'Inference, not label text'}</span></div>
      <h4>{flag.title}</h4>
      <p>{flag.description}</p>
      {flag.context && <p className="flag-context">{flag.context}</p>}
      <div className="citation-row">{flag.source_ids.map((id) => {
        const source = sources.find((item) => item.id === id);
        return source ? <SourceLink key={id} source={source} compact /> : <span className="citation-link" key={id}>Source not returned</span>;
      })}{flag.source_ids.length === 0 && <span className="field-hint">No label citation.</span>}</div>
    </article>
  );
}

const verdictLabels = { supported: 'Supported', not_supported: 'Not supported', dont_know: 'Not enough evidence' };
const stageLabels = { retrieval: 'retrieve', draft: 'draft', guardrail: 'verify' };

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ResearchResult({ result, busy }: { result: RunResult | null; busy: boolean }) {
  if (!result) return (
    <section className="result-empty" aria-labelledby="result-heading">
      <h2 id="result-heading">Result</h2>
      <p>{busy ? 'Waiting for the server.' : 'Run a review to see the flags, unknowns and omitted checks for this product.'}</p>
    </section>
  );

  return (
    <section className="result" aria-labelledby="result-heading">
      <div className="section-heading"><h2 id="result-heading">Result</h2><button className="button button-secondary export-button" type="button" onClick={() => exportDraft(result)}><ArrowDownToLine size={14} aria-hidden="true" />Export JSON</button></div>
      <p className="result-scope">{result.product?.brand ?? 'Product unavailable'}. {result.engine === 'claude' ? result.model : 'Rules only'}. {timestamp(result.created_at)}.</p>
      <div className="verdict-row"><span className={`verdict-badge verdict-${result.verdict === 'supported' ? 'supported' : result.verdict === 'not_supported' ? 'contradicted' : 'insufficient'}`}>{verdictLabels[result.verdict]}</span><span className="gate-badge"><LockKeyhole size={12} aria-hidden="true" />Clinical release blocked</span></div>
      <p className="result-answer">{result.answer}</p>

      <section className="result-section" aria-labelledby="flags-heading"><h3 id="flags-heading">Review flags <span className="mono-label">{result.flags.length}</span></h3>
        {result.flags.length ? result.flags.map((flag, index) => <FlagItem key={`${index}-${flag.id}`} flag={flag} sources={result.sources} />) : <p className="empty-section-note">No flags selected.</p>}
      </section>
      <section className="result-section" aria-labelledby="omitted-heading"><h3 id="omitted-heading">Omitted checks <span className="mono-label">{result.omitted_checks.length}</span></h3>
        <p className="field-hint">Checks the verifier expected that the draft left out.</p>
        {result.omitted_checks.length ? result.omitted_checks.map((flag, index) => <FlagItem key={`${index}-${flag.id}`} flag={flag} sources={result.sources} omitted />) : <p className="empty-section-note">None.</p>}
      </section>
      <section className="result-section" aria-labelledby="context-unknowns-heading"><h3 id="context-unknowns-heading">Unknowns</h3>
        {result.unknowns.length ? <ul>{result.unknowns.map((unknown, index) => <li key={`${index}-${unknown}`}>{unknown}</li>)}</ul> : <p className="empty-section-note">None listed.</p>}
      </section>
      <section className="result-section" aria-labelledby="provenance-heading"><h3 id="provenance-heading">Provenance</h3>
        <p>{result.evidence_confidence.reason}</p>
        <p className="field-hint">Probabilities: correctness {String(result.answer_correctness_probability)}, omission {String(result.omission_probability)}.</p>
      </section>
      <section className="result-section clinical-gate" aria-labelledby="context-gate-heading"><h3 id="context-gate-heading"><LockKeyhole size={14} aria-hidden="true" />Clinical gate</h3>
        <p><code>{result.clinical_status}</code> <code>needs_human: {String(result.needs_human)}</code> <code>eligibility: {result.eligibility}</code></p>
        <ul>{result.guardrail.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>
      </section>
      <details className="result-sources"><summary><h3>Sources used</h3><span className="mono-label">{result.sources.length}</span></summary><div>{result.sources.map((source) => <SourceEntry key={source.id} source={source} />)}</div></details>
      <details className="trace"><summary><h3>Trace</h3><span className="mono-label">{result.trace.length} event{result.trace.length === 1 ? '' : 's'}</span></summary>
        {result.trace.length ? <div className="trace-table-wrap"><table className="trace-table"><caption className="sr-only">Pipeline events returned by the server</caption>
          <thead><tr><th scope="col">Stage</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Detail</th></tr></thead>
          <tbody>{result.trace.map((step, index) => <tr key={`${index}-${step.stage}`}><th scope="row">{stageLabels[step.stage]}</th><td className={step.status === 'blocked' ? 'uncertainty' : ''}>{step.status}</td><td>{step.duration_ms} ms</td><td className="trace-detail">{step.detail}</td></tr>)}</tbody></table></div>
          : <p className="empty-section-note">No events returned.</p>}
      </details>
    </section>
  );
}
