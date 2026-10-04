import type { BenchmarkArm, BenchmarkArtifact, BenchmarkCategory, BenchmarkOutcome, BenchmarkRow } from '@her2/shared';
import type { BenchmarkLoad } from './presentationData';
import { TableScroll } from './EvaluationStudies';

export const ARM_LABELS: Record<BenchmarkArm, string> = { plain_claude: 'Plain Claude', harness_claude: 'Harness + Claude', harness_rules: 'Harness, rules only' };
export const CATEGORY_LABELS: Record<BenchmarkCategory, string> = { composition: 'Composition', invented_adc: 'Invented ADC', fake_reference: 'Fake reference', false_premise: 'False premise', out_of_scope: 'Out of scope' };
export const OUTCOME_LABELS: Record<BenchmarkOutcome, string> = {
  correct: 'Correct', abstained_correctly: 'Declined, correctly', flagged_premise: 'Flagged the premise', bluffed: 'Bluffed', fabricated_citation: 'Made up a citation',
  accepted_false_premise: 'Accepted the false premise', wrong_fact: 'Wrong fact', over_refused: 'Refused a fair question', refused: 'Model refused', provider_error: 'Provider error',
};
const GOOD: ReadonlySet<BenchmarkOutcome> = new Set(['correct', 'abstained_correctly', 'flagged_premise']);
const COLUMNS = [
  ['correct', 'Correct'], ['bluffed', 'Bluffed'], ['fabricated_citations', 'Made-up citations'], ['accepted_false_premise', 'Accepted false premise'],
  ['wrong_fact', 'Wrong fact'], ['over_refused', 'Over-refused'], ['errors', 'Errors'],
] as const;

export function BenchmarkPending({ load }: { load: BenchmarkLoad }) {
  return <div className="pres-pending" role="note">
    <strong>Benchmark pending</strong>
    {load.state === 'invalid'
      ? <p><code>evals/benchmark.json</code> exists but does not match <code>BenchmarkArtifactSchema</code> ({load.issue}), so nothing from it is shown.</p>
      : <p>No <code>evals/benchmark.json</code> has been committed yet. This slot fills in from that file when it lands. Nothing here is made up in the meantime.</p>}
  </div>;
}

/** Picks the first bait item that has both a plain-Claude row and a harness row. */
export function pickBaitPair(artifact: BenchmarkArtifact): { item: BenchmarkArtifact['items'][number]; plain: BenchmarkRow; harness: BenchmarkRow } | null {
  for (const category of ['invented_adc', 'fake_reference'] as const) {
    for (const item of artifact.items.filter(candidate => candidate.category === category)) {
      const rows = artifact.rows.filter(row => row.item_id === item.item_id);
      const plain = rows.find(row => row.arm === 'plain_claude');
      const harness = rows.find(row => row.arm === 'harness_claude') ?? rows.find(row => row.arm === 'harness_rules');
      if (plain && harness) return { item, plain, harness };
    }
  }
  return null;
}

function RowCard({ row }: { row: BenchmarkRow }) {
  const good = GOOD.has(row.outcome);
  return <article className="pres-arm" data-good={good || undefined}>
    <h4>{ARM_LABELS[row.arm]}</h4>
    <p className="pres-outcome">{OUTCOME_LABELS[row.outcome]}</p>
    <blockquote>{row.excerpt || <em>No text returned.</em>}</blockquote>
    <dl className="pres-facts">
      <div><dt>Model calls</dt><dd>{row.model_calls}</dd></div>
      <div><dt>Citations</dt><dd>{row.citations.length ? row.citations.map(citation => `${citation.id} (${citation.resolved.replace('_', ' ')})`).join(', ') : 'none'}</dd></div>
    </dl>
  </article>;
}

export function BaitSideBySide({ load }: { load: BenchmarkLoad }) {
  if (load.state !== 'ready') return <BenchmarkPending load={load} />;
  const pair = pickBaitPair(load.artifact);
  if (!pair) return <div className="pres-pending" role="note"><strong>No paired bait row yet</strong><p>The benchmark file has no invented-ADC or fake-reference item answered by both plain Claude and the harness.</p></div>;
  return <div className="pres-side">
    <p className="pres-side-q"><span>Same question, both arms</span>“{pair.item.message}”</p>
    <div className="pres-arms"><RowCard row={pair.plain} /><RowCard row={pair.harness} /></div>
    <p className="pres-cite">Excerpts from recorded responses in <code>evals/benchmark.json</code> ({load.artifact.mode}, {load.artifact.model}, {load.artifact.generated_at.slice(0, 10)}).</p>
  </div>;
}

// TODO: replace this minimal table with BenchmarkSection once BenchmarkSection.tsx lands on the base branch.
export function BenchmarkTable({ load }: { load: BenchmarkLoad }) {
  if (load.state !== 'ready') return <BenchmarkPending load={load} />;
  const { artifact } = load;
  const categories = [...new Set(artifact.items.map(item => item.category))];
  return <div className="pres-bench">
    <p className="pres-cite">{artifact.mode === 'live' ? 'Live run' : 'Offline run'} · {artifact.model} · {artifact.items.length} items · {artifact.budget.calls_used}/{artifact.budget.max_calls} model calls used · {artifact.budget.retries} retries · {artifact.generated_at.slice(0, 10)}</p>
    <TableScroll label="Benchmark results by arm and category, scrollable">
      <table className="pres-table">
        <caption className="sr-only">Benchmark counts per arm and question category, from evals/benchmark.json</caption>
        <thead><tr><th scope="col">Arm</th><th scope="col">Category</th><th scope="col">n</th>{COLUMNS.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
        <tbody>{artifact.arms.flatMap(arm => categories.map(category => {
          const cell = artifact.summary[arm]?.[category];
          return <tr key={`${arm}-${category}`}><th scope="row">{ARM_LABELS[arm]}</th><td>{CATEGORY_LABELS[category]}</td><td>{cell?.n ?? '-'}</td>{COLUMNS.map(([key]) => <td key={key}>{cell ? cell[key] : '-'}</td>)}</tr>;
        }))}</tbody>
      </table>
    </TableScroll>
    <ul className="pres-small-list">{artifact.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul>
  </div>;
}
