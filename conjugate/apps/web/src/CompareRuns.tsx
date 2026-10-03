import type { ResearchRequest, ResearchResult } from '@her2/shared';
import { compareResults } from './auditSummary';

export type CompareChange = Partial<Pick<ResearchRequest, 'evidence_policy' | 'integrity_drill'>>;

export function CompareRuns({ request, result, compare, busy, onCompare }: {
  request: ResearchRequest; result: ResearchResult; compare: ResearchResult | null; busy: boolean; onCompare: (change: CompareChange) => void;
}) {
  const withheld = request.evidence_policy === 'workbook_only';
  const faulted = request.integrity_drill !== 'none';
  const rows = compare ? compareResults(result, compare) : [];
  return <section className="result-section compare" aria-labelledby="compare-heading">
    <h3 id="compare-heading">Run it again with one thing changed</h3>
    <p className="field-hint">Same product and question. The second run goes through the whole pipeline and lands next to the first.</p>
    <div className="compare-actions">
      <button className="button button-secondary" type="button" disabled={busy} onClick={() => onCompare({ evidence_policy: withheld ? 'all' : 'workbook_only' })}>
        {withheld ? 'Allow the label summary' : 'Withhold the label summary'}
      </button>
      <button className="button button-secondary" type="button" disabled={busy} onClick={() => onCompare({ integrity_drill: faulted ? 'none' : 'invented_source' })}>
        {faulted ? 'Remove the fault' : 'Inject an invented source id'}
      </button>
    </div>
    {busy && <p className="field-hint" role="status">Second run in progress.</p>}
    {compare && <table className="compare-table"><caption className="sr-only">First run against second run</caption>
      <thead><tr><th scope="col"><span className="sr-only">Field</span></th><th scope="col">First run</th><th scope="col">Second run</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.label} className={row.differs ? 'row-changed' : ''}>
        <th scope="row">{row.label}</th><td>{row.a}</td><td>{row.b}{row.differs && <span className="sr-only"> (changed)</span>}</td>
      </tr>)}</tbody>
    </table>}
    {compare && <p className="field-hint">{rows.filter((row) => row.differs).length} of {rows.length} fields changed. Clinical release is blocked in both.</p>}
  </section>;
}
