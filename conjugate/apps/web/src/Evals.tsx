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

interface Scope { key: string; short: string; long: string }
interface GridCell { ok: boolean; note: string }
interface GridRow { key: string; label: string; cells: Record<string, GridCell> }
const questionIds = Object.keys(questionTitles) as QuestionId[];
const policies: Policy[] = ['all', 'workbook_only'];
const scopeKey = (row: { product_id: string; question_id: QuestionId; evidence_policy: Policy }) => row.product_id + '|' + row.question_id + '|' + row.evidence_policy;
function buildScopes(productIds: string[], name: (id: string) => string): Scope[] {
  return productIds.flatMap((product) => questionIds.flatMap((question, index) => policies.map((policy) => ({
    key: scopeKey({ product_id: product, question_id: question, evidence_policy: policy }),
    short: name(product).charAt(0) + (index + 1) + ' ' + (policy === 'all' ? 'all' : 'wb'),
    long: name(product) + ', ' + questionTitles[question] + ', ' + policyLabel(policy),
  }))));
}
const cellsFor = <Row extends { product_id: string; question_id: QuestionId; evidence_policy: Policy }>(rows: Row[], cell: (row: Row) => GridCell): Record<string, GridCell> =>
  Object.fromEntries(rows.map((row) => [scopeKey(row), cell(row)]));

/** One square per scope. Blue means the verifier did what that eval expects; copper means it did not. */
function ScopeGrid({ caption, scopes, rows, okLabel, badLabel, axisNote }: { caption: string; scopes: Scope[]; rows: GridRow[]; okLabel: string; badLabel: string; axisNote: string }) {
  return <>
    <div className="trace-table-wrap"><table className="scope-grid"><caption className="sr-only">{caption}</caption>
      <thead><tr><th scope="col"><span className="sr-only">Row</span></th>{scopes.map((scope) => <th scope="col" key={scope.key}><abbr title={scope.long}>{scope.short}</abbr></th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}><th scope="row"><code>{row.label}</code></th>{scopes.map((scope) => {
        const cell = row.cells[scope.key];
        return <td key={scope.key} className={cell ? (cell.ok ? 'grid-ok' : 'grid-bad') : 'grid-none'} title={cell ? scope.long + ': ' + cell.note : scope.long + ': not run'}><span className="sr-only">{cell ? cell.note : 'not run'}</span></td>;
      })}</tr>)}</tbody>
    </table></div>
    <p className="grid-legend"><span className="legend-ok">{okLabel}</span><span className="legend-bad">{badLabel}</span><span className="legend-axis">{axisNote}</span></p>
  </>;
}

export function Evals({ catalog }: { catalog: ResearchCatalog | null }) {
  const name = (id: string) => { const product = catalog?.dataset.records.find((record) => record.id === id); return product ? productLabel(product) : id; };
  const drills = groupDrills(data.drills.rows);
  const honest = data.strategies.by_strategy.find((row) => row.strategy === 'honest_expected');
  const leaks = data.strategies.rows.filter((row) => row.accepted && row.strategy !== 'honest_expected');
  const strategiesCaughtEverywhere = data.strategies.by_strategy.filter((row) => row.strategy !== 'honest_expected' && row.accepted === 0).length;
  const strategiesTotal = data.strategies.by_strategy.filter((row) => row.strategy !== 'honest_expected').length;
  const productIds = [...new Set(data.strategies.rows.map((row) => row.product_id))].sort();
  const scopes = buildScopes(productIds, name);
  const axisNote = productIds.map((id) => name(id).charAt(0) + ' = ' + name(id)).join(', ') + '; 1 to 4 = the four questions in the order above; all / wb = all sources / workbook only.';
  const strategyGrid: GridRow[] = data.strategies.by_strategy.map((summary) => ({
    key: summary.strategy, label: summary.strategy,
    cells: cellsFor(data.strategies.rows.filter((row) => row.strategy === summary.strategy), (row) => ({
      ok: summary.strategy === 'honest_expected' ? row.accepted : !row.accepted,
      note: row.accepted ? 'accepted' : 'rejected, caught by ' + row.caught_by.join(', '),
    })),
  }));
  const drillGrid: GridRow[] = drills.map((group) => ({
    key: group.drill, label: group.drill,
    cells: cellsFor(data.drills.rows.filter((row) => row.drill === group.drill), (row) => ({
      ok: row.rejected, note: row.rejected ? 'rejected, caught by ' + row.caught_by.join(', ') : 'accepted, fault not caught',
    })),
  }));
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
      <ScopeGrid caption="Fault tests by scope" scopes={scopes} rows={drillGrid} okLabel="rejected" badLabel="accepted, fault not caught" axisNote={axisNote} />
    </section>

    <section aria-labelledby="strategies-heading">
      <h2 id="strategies-heading">Scripted strategies</h2>
      <p>Drafts written by us, not by a model, to see what the verifier lets through. Each one is tried on all 16 product, question and source-policy scopes. <code>honest_expected</code> is the control and should always pass.</p>
      <ScopeGrid caption="Scripted strategies by scope" scopes={scopes} rows={strategyGrid} okLabel="rejected the scripted draft, or accepted the honest control" badLabel="accepted a scripted draft" axisNote={axisNote} />
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
