import type { ResearchCatalog } from '@her2/shared';
import results from '../../../evals/results.json';
import { faultTests, productLabel, questionTitles, verdictLabels } from './labels';

type Verdict = keyof typeof verdictLabels;
type QuestionId = keyof typeof questionTitles;
type Drill = keyof typeof faultTests;
type Policy = 'all' | 'workbook_only';
interface ShiftRow { product_id: string; question_id: QuestionId; with_label: Verdict; workbook_only: Verdict; changed: boolean }
interface DrillRow { product_id: string; question_id: QuestionId; evidence_policy: Policy; drill: Drill; rejected: boolean; caught_by: string[] }
interface StrategyRow { product_id: string; question_id: QuestionId; evidence_policy: Policy; strategy: string; accepted: boolean; caught_by: string[] }
interface StrategySummary { strategy: string; description: string; accepted: number; total: number; caught_by: string[] }
interface ClaudeRow { product_id: string; question_id: QuestionId; evidence_policy: Policy; ok: boolean; accepted?: boolean; verdict?: Verdict; error_code?: string; tools_planned?: string[]; plan_ms?: number; draft_ms?: number; wall_ms?: number }
interface Results {
  generated_at: string; dataset_sha256: string; notes: string[];
  verdicts: { shifts: ShiftRow[]; changed_count: number; total: number };
  drills: { rows: DrillRow[]; rejected_count: number; total: number };
  strategies: { rows: StrategyRow[]; by_strategy: StrategySummary[] };
  claude: { skipped: boolean; model: string; rows: ClaudeRow[]; completed: number; failed: number; accepted: number; total: number; median_plan_ms: number | null; median_draft_ms: number | null; median_wall_ms: number | null };
}
const data = results as unknown as Results;
const policyLabel = (policy: Policy) => policy === 'all' ? 'all' : 'workbook only';
const ms = (value: number | null | undefined) => value == null ? '' : `${Math.round(value)} ms`;

function groupDrills(rows: DrillRow[]) {
  return (Object.keys(faultTests) as Drill[]).filter((drill) => drill !== 'none').map((drill) => {
    const subset = rows.filter((row) => row.drill === drill);
    return { drill, rejected: subset.filter((row) => row.rejected).length, total: subset.length, caught_by: [...new Set(subset.flatMap((row) => row.caught_by))].sort() };
  });
}

function StrategyBars({ rows }: { rows: StrategySummary[] }) {
  const width = 560, rowHeight = 26, labelWidth = 150, barWidth = width - labelWidth - 60;
  return <svg className="bar-chart" width={width} height={rows.length * rowHeight + 8} viewBox={`0 0 ${width} ${rows.length * rowHeight + 8}`} role="img" aria-labelledby="strategy-chart-title">
    <title id="strategy-chart-title">Scripted drafts accepted by the verifier, out of 16 scopes each</title>
    {rows.map((row, index) => {
      const y = index * rowHeight + 4;
      const filled = row.total ? (row.accepted / row.total) * barWidth : 0;
      return <g key={row.strategy}>
        <text x={labelWidth - 8} y={y + 16} textAnchor="end" className="bar-label">{row.strategy}</text>
        <rect x={labelWidth} y={y + 4} width={barWidth} height={16} className="bar-track" />
        <rect x={labelWidth} y={y + 4} width={Math.max(filled, 0)} height={16} className={row.strategy === 'honest_expected' ? 'bar-fill bar-ok' : 'bar-fill'} />
        <text x={labelWidth + barWidth + 8} y={y + 16} className="bar-value">{row.accepted}/{row.total}</text>
      </g>;
    })}
  </svg>;
}

export function Evals({ catalog }: { catalog: ResearchCatalog | null }) {
  const name = (id: string) => { const product = catalog?.dataset.records.find((record) => record.id === id); return product ? productLabel(product) : id; };
  const drills = groupDrills(data.drills.rows);
  const honest = data.strategies.by_strategy.find((row) => row.strategy === 'honest_expected');
  const leaks = data.strategies.rows.filter((row) => row.accepted && row.strategy !== 'honest_expected');
  const strategiesCaughtEverywhere = data.strategies.by_strategy.filter((row) => row.strategy !== 'honest_expected' && row.accepted === 0).length;
  const strategiesTotal = data.strategies.by_strategy.filter((row) => row.strategy !== 'honest_expected').length;
  return <section className="evals-view" aria-labelledby="evals-heading">
    <header className="view-heading">
      <h1 id="evals-heading">Evals</h1>
      <p>Software checks on the pipeline, run by <code>scripts/eval.ts</code> against the same server code the app uses. They test whether the verifier enforces its rules. They are not a clinical benchmark and say nothing about whether the sources themselves are right.</p>
    </header>

    <dl className="atlas-totals">
      <div><dt>Injected bad citations rejected</dt><dd>{data.drills.rejected_count}/{data.drills.total}</dd></div>
      <div><dt>Scripted strategies caught in every scope</dt><dd>{strategiesCaughtEverywhere}/{strategiesTotal}</dd></div>
      <div><dt>Honest control accepted</dt><dd>{honest ? `${honest.accepted}/${honest.total}` : 'n/a'}</dd></div>
      <div><dt>Verdicts that changed without the label</dt><dd>{data.verdicts.changed_count}/{data.verdicts.total}</dd></div>
      <div><dt>Claude drafts accepted</dt><dd>{data.claude.skipped ? 'not run' : `${data.claude.accepted}/${data.claude.total}`}</dd></div>
    </dl>

    <section aria-labelledby="shifts-heading">
      <h2 id="shifts-heading">Source withholding</h2>
      <p>Each product and question run twice in rules only mode: once with all sources, once with the label summary withheld. A verdict that changes shows what it rested on.</p>
      <table className="checks-table"><caption className="sr-only">Verdict with all sources against workbook only</caption>
        <thead><tr><th scope="col">Product</th><th scope="col">Question</th><th scope="col">All sources</th><th scope="col">Workbook only</th><th scope="col">Changed</th></tr></thead>
        <tbody>{data.verdicts.shifts.map((row) => <tr key={row.product_id + row.question_id} className={row.changed ? 'row-changed' : ''}>
          <td>{name(row.product_id)}</td><td>{questionTitles[row.question_id]}</td>
          <td><span className={`claim-verdict verdict-${row.with_label}`}>{verdictLabels[row.with_label]}</span></td>
          <td><span className={`claim-verdict verdict-${row.workbook_only}`}>{verdictLabels[row.workbook_only]}</span></td>
          <td>{row.changed ? 'Yes' : 'No'}</td>
        </tr>)}</tbody>
      </table>
    </section>

    <section aria-labelledby="drills-heading">
      <h2 id="drills-heading">Fault tests</h2>
      <p>After a normal draft, one citation is swapped for a bad one. The verifier has to reject the draft. {data.drills.total} runs: 2 products, 4 questions, 2 source policies, 3 faults.</p>
      <table className="checks-table"><caption className="sr-only">Fault tests by fault type</caption>
        <thead><tr><th scope="col">Fault</th><th scope="col">Rejected</th><th scope="col">Caught by</th></tr></thead>
        <tbody>{drills.map((row) => <tr key={row.drill}><th scope="row">{faultTests[row.drill]}</th><td>{row.rejected}/{row.total}</td><td>{row.caught_by.map((code) => <code key={code}>{code} </code>)}</td></tr>)}</tbody>
      </table>
    </section>

    <section aria-labelledby="strategies-heading">
      <h2 id="strategies-heading">Scripted strategies</h2>
      <p>Drafts written by us, not by a model, to see what the verifier lets through. Each one is tried on all 16 product, question and source-policy scopes. <code>honest_expected</code> is the control and should always pass.</p>
      <div className="chart-scroll" tabIndex={0} role="region" aria-label="Strategy chart, scrollable"><StrategyBars rows={data.strategies.by_strategy} /></div>
      <table className="checks-table"><caption className="sr-only">Scripted strategies</caption>
        <thead><tr><th scope="col">Strategy</th><th scope="col">What it does</th><th scope="col">Accepted</th><th scope="col">Caught by</th></tr></thead>
        <tbody>{data.strategies.by_strategy.map((row) => <tr key={row.strategy}><th scope="row"><code>{row.strategy}</code></th><td>{row.description}</td><td>{row.accepted}/{row.total}</td><td>{row.caught_by.map((code) => <code key={code}>{code} </code>)}</td></tr>)}</tbody>
      </table>
      {leaks.length > 0 && <p className="field-hint">Accepted non-control drafts: {leaks.map((row) => `${row.strategy} on ${name(row.product_id)}, ${questionTitles[row.question_id].toLowerCase()}, ${policyLabel(row.evidence_policy)}`).join('; ')}. In those scopes the only retrieved source is the one expected source, so citing everything is the same as citing the right thing. This is a property of the scope, not a gap the verifier missed.</p>}
    </section>

    <section aria-labelledby="claude-heading">
      <h2 id="claude-heading">Claude ({data.claude.model})</h2>
      {data.claude.skipped ? <p>Not run. No server key was set when the evals ran.</p> : <>
        <p>Claude planned the tools and drafted the citation ids for all 16 scopes. The verifier judged every draft. Completed {data.claude.completed}/{data.claude.total}, accepted {data.claude.accepted}/{data.claude.total}, failed {data.claude.failed}. Median plan {ms(data.claude.median_plan_ms)}, draft {ms(data.claude.median_draft_ms)}, end to end {ms(data.claude.median_wall_ms)}.</p>
        <div className="trace-table-wrap"><table className="checks-table"><caption className="sr-only">Claude runs by scope</caption>
          <thead><tr><th scope="col">Product</th><th scope="col">Question</th><th scope="col">Sources</th><th scope="col">Outcome</th><th scope="col">Tools planned</th><th scope="col">Plan</th><th scope="col">Draft</th><th scope="col">Total</th></tr></thead>
          <tbody>{data.claude.rows.map((row) => <tr key={row.product_id + row.question_id + row.evidence_policy}>
            <td>{name(row.product_id)}</td><td>{questionTitles[row.question_id]}</td><td>{policyLabel(row.evidence_policy)}</td>
            <td>{row.ok && row.verdict ? <span className={`claim-verdict verdict-${row.verdict}`}>{verdictLabels[row.verdict]}</span> : <code className="uncertainty">{row.error_code ?? 'failed'}</code>}</td>
            <td>{row.tools_planned?.join(', ') ?? ''}</td><td>{ms(row.plan_ms)}</td><td>{ms(row.draft_ms)}</td><td>{ms(row.wall_ms)}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </section>

    <section aria-labelledby="eval-notes-heading">
      <h2 id="eval-notes-heading">Read these numbers carefully</h2>
      <ul className="plain-list">{data.notes.map((note) => <li key={note}>{note}</li>)}
        <li>Passing these checks means the verifier enforces its own rules. It does not mean the app is safe, calibrated or resistant to every way a model could game it.</li>
      </ul>
      <dl className="result-provenance">
        <div><dt>Generated</dt><dd>{data.generated_at}</dd></div>
        <div><dt>Dataset SHA-256</dt><dd><code>{data.dataset_sha256}</code></dd></div>
        <div><dt>Command</dt><dd><code>npm run eval</code></dd></div>
      </dl>
    </section>
  </section>;
}
