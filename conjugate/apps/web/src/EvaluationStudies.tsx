import type { ReactNode } from 'react';
import verifier from '../../../evals/verifier-study.json';
import beforeFix from '../../../evals/verifier-before-fix.json';
import selection from '../../../evals/selection-study.json';

function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}
const checkNames: Record<string, string> = {
  product_identity: 'Product identity', source_allowlist: 'Allowed sources', exact_source_claim_pairing: 'Exact citation pairing',
  source_eligibility: 'Primary-source eligibility', evidence_availability: 'Source was retrieved', unique_claims: 'No repeated claims',
  omitted_claim_ids: 'Missing claim', receipt_integrity: 'Source contents', citation_defenses_removed: 'Citation checks removed together',
  always_accept: 'Accept every draft',
};

/** Keyboard-scrollable region for tables wider than a phone screen. */
export function TableScroll({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <div className={`table-scroll${wide ? ' table-scroll-wide' : ''}`} role="region" aria-label={label} tabIndex={0}>
    {wide && <p className="scroll-hint" aria-hidden="true">Scroll sideways for more columns →</p>}
    {children}
  </div>;
}

/** Exact numbers stay one click away and open by default. */
export function ExactTable({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <details className="exact-numbers" open><summary>Exact numbers</summary><TableScroll label={label} wide={wide}>{children}</TableScroll></details>;
}

type Arm = (typeof selection.arms)[number];
const measures: { key: 'accepted' | 'verifier_rejected' | 'provider_errors'; label: string }[] = [
  { key: 'accepted', label: 'Accepted' }, { key: 'verifier_rejected', label: 'Verifier rejected' }, { key: 'provider_errors', label: 'Provider or format errors' },
];

/** Paired dot plot: one row per outcome, a filled dot for "mapping supplied" and a hollow dot for "mapping removed". */
export function PairedDots({ mapped, removed, difference }: { mapped: Arm; removed: Arm; difference: number | null }) {
  const width = 600, left = 176, right = 56, rowHeight = 44, top = 30;
  const max = Math.max(mapped.attempts, removed.attempts);
  const x = (value: number) => left + (value / max) * (width - left - right);
  const height = top + measures.length * rowHeight + 24;
  const description = measures.map(({ key, label }) => `${label}: ${mapped[key]}/${mapped.attempts} with mapping supplied, ${removed[key]}/${removed.attempts} with mapping removed`).join('. ');
  return <figure className="paired-dots">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={description}>
      {[0, max / 2, max].map(tick => <g key={tick} className="dots-tick"><line x1={x(tick)} x2={x(tick)} y1={top - 12} y2={height - 20} /><text x={x(tick)} y={height - 6} textAnchor="middle">{tick}</text></g>)}
      {measures.map(({ key, label }, index) => {
        const y = top + index * rowHeight + rowHeight / 2;
        const a = mapped[key], b = removed[key];
        return <g key={key}>
          <text className="dots-label" x={0} y={y + 4}>{label}</text>
          <line className="dots-link" x1={x(Math.min(a, b))} x2={x(Math.max(a, b))} y1={y} y2={y} />
          <circle className="dot-mapped" cx={x(a)} cy={y} r={7} />
          <circle className="dot-removed" cx={x(b)} cy={y} r={7} />
          <text className="dots-value" x={x(a)} y={y - 12} textAnchor="middle">{a}/{mapped.attempts}</text>
          <text className="dots-value dots-value-removed" x={x(b)} y={y + 24} textAnchor="middle">{b}/{removed.attempts}</text>
        </g>;
      })}
    </svg>
    <figcaption>
      <span className="dots-legend"><span className="key-mapped" aria-hidden="true" />Mapping supplied</span>
      <span className="dots-legend"><span className="key-removed" aria-hidden="true" />Mapping removed</span>
      <span>Paired acceptance difference: {difference == null ? 'not measured' : `${(difference * 100).toFixed(1)} percentage points (supplied minus removed)`}.</span>
    </figcaption>
  </figure>;
}

export function EvaluationStudies() {
  const mapped = selection.arms.find(arm => arm.arm === 'mapped');
  const removed = selection.arms.find(arm => arm.arm !== 'mapped');
  return <>
    <section aria-labelledby="broken-checker-heading">
      <h2 id="broken-checker-heading">Would the eval catch a broken checker?</h2>
      <p>We switch off verifier checks and see whether bad drafts get through.</p>
      <dl className="atlas-totals">
        <div><dt>Weakened verifiers detected</dt><dd>{verifier.mutants_detected}/{verifier.mutant_count}</dd></div>
        <div><dt>Valid controls accepted</dt><dd>{verifier.controls_accepted}/{verifier.control_count}</dd></div>
        <div><dt>Faults rejected by unchanged verifier</dt><dd>{verifier.faults_rejected}/{verifier.fault_count}</dd></div>
      </dl>
      <ExactTable label="Disabled checks and faults that escape, scrollable">
        <table className="checks-table"><caption className="sr-only">Disabled checks and faults that escape</caption>
          <thead><tr><th scope="col">Disabled check</th><th scope="col">Valid controls</th><th scope="col">Bad drafts accepted</th><th scope="col">Detected?</th></tr></thead>
          <tbody>{verifier.mutants.map(row => <tr key={row.name} className={row.detected ? '' : 'row-changed'}>
            <th scope="row">{checkNames[row.name] ?? row.name}</th><td>{row.controls_accepted}/{row.controls}</td><td>{row.escaped_faults}/{row.faults}</td>
            <td>{row.detected ? 'Yes' : 'No. The other checks still block these faults'}</td>
          </tr>)}</tbody>
        </table>
      </ExactTable>
      <p>Three single-check variants survive this suite. That shows overlap between defenses, not proof that those checks are unnecessary.</p>
      <p className="withholding-proof"><strong>A real failure, kept in the report:</strong> the first run accepted only {beforeFix.controls_accepted}/{beforeFix.control_count} valid controls. Source equality depended on JSON key order. We fixed that comparison and reran the same cases.</p>
      <details className="run-record"><summary>How this was measured</summary>
        <p>We compile copies of the real verifier with checks disabled. A variant is detected only when it accepts a bad draft that the unchanged verifier rejects. Crashes and hash changes do not count.</p>
        <p>{verifier.scope_count} known product, question and source settings, each with four harmless presentations. Reordering keys, sources and citation sets must preserve the verdict and omissions. More isolated cases may be needed.</p>
        <p>Gate: {verifier.passed ? 'passed' : 'failed'}. Unmodified compiled code matches production: {verifier.compiled_agrees ? 'yes' : 'no'}.</p>
        <TableScroll label="Check coverage, scrollable"><table className="checks-table"><caption className="sr-only">Check coverage</caption><thead><tr><th scope="col">Check</th><th scope="col">Faults that trigger it</th></tr></thead>
          <tbody>{verifier.mutants.filter(row => row.disabled_checks.length === 1).map(row => <tr key={row.name}><th scope="row">{checkNames[row.name]}</th><td>{verifier.rows.filter(fault => fault.kind === 'fault' && fault.caught_by.includes(row.name)).length}</td></tr>)}</tbody>
        </table></TableScroll>
        <p>{verifier.exclusions.length} scope-specific exclusions are listed in the download. Tests requiring a primary source are excluded when none was supplied; they are not counted as passes.</p>
        <p><code>npm run eval:verifier</code>. Generated {verifier.generated_at}. Code SHA-256 <code>{verifier.manifest.code_sha256}</code>. Evaluation SHA-256 <code>{verifier.manifest.evaluation_sha256}</code>.</p>
        <p>Ten deliberate variants of one function. No model calls or clinical benchmark.</p>
      </details>
      <div className="form-actions">
        <button type="button" className="quiet" onClick={() => download(verifier, 'verifier-study.json')}>Download verifier checks</button>
        <button type="button" className="quiet" onClick={() => download(beforeFix, 'verifier-before-fix.json')}>Download original failure</button>
      </div>
    </section>

    <section aria-labelledby="selection-study-heading">
      <h2 id="selection-study-heading">What changes without the supplied citation mapping?</h2>
      <p>Paired Claude drafts get the same sources and question. Only one also gets the expected citation mapping.</p>
      <p className="withholding-proof"><strong>Start with the simple baseline.</strong> Selecting every source marked eligible matches {selection.baseline.eligible_only_accepted}/{selection.baseline.total} expected sets. A source-kind rule also matches {selection.baseline.kind_only_accepted}/{selection.baseline.total}. These fixed tasks do not demonstrate a need for an LLM.</p>
      {selection.skipped ? <p>Not run. No model key was set; no score is reported.</p> : <>
        {mapped && removed && <PairedDots mapped={mapped} removed={removed} difference={selection.paired_acceptance_difference} />}
        <ExactTable label="Paired Claude selection results, scrollable" wide>
          <table className="checks-table"><caption className="sr-only">Paired Claude selection results</caption>
            <thead><tr><th scope="col">Condition</th><th scope="col">Accepted</th><th scope="col">Verifier rejected</th><th scope="col">Provider or format errors</th><th scope="col">Attempts</th></tr></thead>
            <tbody>{selection.arms.map(arm => <tr key={arm.arm}><th scope="row">{arm.arm === 'mapped' ? 'Mapping supplied' : 'Mapping removed'}</th><td>{arm.accepted}</td><td>{arm.verifier_rejected}</td><td>{arm.provider_errors}</td><td>{arm.attempts}</td></tr>)}</tbody>
          </table>
        </ExactTable>
        <p>Accepted drafts are contract matches, not correct clinical answers. Errors remain in the denominator.</p>
      </>}
      <p>{selection.independent_scopes} fixtures, {selection.repetitions} repeated presentations each. Repeats on the same fixture are correlated; we make no significance or calibration claim.</p>
      <details className="run-record"><summary>How this was measured</summary>
        <p>Paired Claude drafts receive the same sources, question, skills and schema. The eligibility flag is hidden in both. Only one draft receives the expected citation mapping. This tests selection from supplied records, not open-ended research. Presentation seeds do not control provider sampling.</p>
        <TableScroll label="Each paired observation, scrollable" wide><table className="checks-table"><caption className="sr-only">Each paired observation</caption>
          <thead><tr><th scope="col">Scope</th><th scope="col">Presentation seed</th><th scope="col">Mapping supplied</th><th scope="col">Mapping removed</th></tr></thead>
          <tbody>{selection.pairs.map(pair => <tr key={pair.scope + pair.repetition}><th scope="row"><code>{pair.scope}</code></th><td>{pair.seed}</td><td>{pair.mapped_status.replaceAll('_', ' ')}</td><td>{pair.unmapped_status.replaceAll('_', ' ')}</td></tr>)}</tbody>
        </table></TableScroll>
        <p><code>npm run eval:selection</code> uses a server-side key and paid inference. {selection.provider_calls}/{selection.max_provider_calls} provider calls; {selection.retries} retries. Two drafting calls share one 60-second pair deadline. The planner is deliberately excluded.</p>
        <p>Model <code>{selection.model}</code>. Generated {selection.generated_at}. Code SHA-256 <code>{selection.manifest.code_sha256}</code>. Evaluation SHA-256 <code>{selection.manifest.evaluation_sha256}</code>.</p>
        <ul className="plain-list">{selection.limits.map(limit => <li key={limit}>{limit}</li>)}</ul>
      </details>
      <div className="form-actions"><button type="button" className="quiet" onClick={() => download(selection, 'selection-study.json')}>Download paired results</button></div>
    </section>
  </>;
}
