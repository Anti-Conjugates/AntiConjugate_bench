import type { BenchmarkArm, BenchmarkArtifact, BenchmarkCategory, BenchmarkOutcome, BenchmarkRow } from '@her2/shared';
import type { BenchmarkLoad } from './presentationData';
import { BENCH_ARM_LABELS, BENCH_CATEGORY_LABELS, BenchmarkSection } from './BenchmarkSection';

export const HAND_AUDIT_URL = 'https://github.com/Anti-Conjugates/AntiConjugate-Devin/blob/main/conjugate/docs/BENCHMARK.md#hand-audit-of-the-first-live-run-2026-10-04';
const MISSES = [['bluffed', 'bluffed'], ['wrong_fact', 'wrong fact'], ['fabricated_citations', 'made-up citation'], ['accepted_false_premise', 'accepted false premise'], ['over_refused', 'over-refused'], ['errors', 'error']] as const;

export const OUTCOME_LABELS: Record<BenchmarkOutcome, string> = {
  correct: 'Correct', abstained_correctly: 'Declined, correctly', flagged_premise: 'Flagged the premise', bluffed: 'Bluffed', fabricated_citation: 'Made up a citation',
  accepted_false_premise: 'Accepted the false premise', wrong_fact: 'Wrong fact', over_refused: 'Refused a fair question', refused: 'Model refused', provider_error: 'Provider error',
};
const GOOD: ReadonlySet<BenchmarkOutcome> = new Set(['correct', 'abstained_correctly', 'flagged_premise']);

export function BenchmarkPending({ load }: { load: BenchmarkLoad }) {
  return <div className="pres-pending" role="note">
    <strong>Benchmark pending</strong>
    {load.state === 'invalid'
      ? <p><code>evals/benchmark.json</code> exists but does not match <code>BenchmarkArtifactSchema</code> ({load.issue}), so nothing from it is shown.</p>
      : <p>No <code>evals/benchmark.json</code> has been committed yet. This slot fills in from that file when it lands. Nothing here is made up in the meantime.</p>}
  </div>;
}

/** Says up front whether the benchmark called Claude. An offline artifact's Claude arms are a fixed mock. */
export function BenchmarkMode({ artifact }: { artifact: BenchmarkArtifact }) {
  const live = artifact.mode === 'live';
  return <p className="bench-mode" data-mode={artifact.mode}>
    <strong>{live ? 'Live run' : 'Offline mock run'}</strong>
    <span>{live ? `${artifact.model} answered. ${artifact.budget.calls_used} of ${artifact.budget.max_calls} model calls used, ${artifact.budget.retries} retries.` : 'No model was called. The Claude arms used a fixed mock, so these rows test the pipeline, not Claude.'}</span>
    <span className="bench-mode-date">evals/benchmark.json · {artifact.generated_at.slice(0, 10)}</span>
  </p>;
}

/** Mode banner plus BenchmarkSection when the artifact parses; otherwise the pending note. */
export function BenchmarkPanel({ load }: { load: BenchmarkLoad }) {
  if (load.state !== 'ready') return <BenchmarkPending load={load} />;
  return <div className="bench-panel"><BenchmarkMode artifact={load.artifact} /><BenchmarkBreakdown artifact={load.artifact} /><BenchmarkSection artifact={load.artifact} /></div>;
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
    <h4>{BENCH_ARM_LABELS[row.arm]}</h4>
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
    <BenchmarkMode artifact={load.artifact} />
    <p className="pres-side-q"><span>Same question, both arms</span>“{pair.item.message}”</p>
    <div className="pres-arms"><RowCard row={pair.plain} /><RowCard row={pair.harness} /></div>
    <p className="pres-cite">Excerpts from recorded responses in <code>evals/benchmark.json</code> ({load.artifact.mode}, {load.artifact.model}, {load.artifact.generated_at.slice(0, 10)}).</p>
  </div>;
}

type Cell = NonNullable<NonNullable<BenchmarkArtifact['summary'][BenchmarkArm]>[BenchmarkCategory]>;
const total = (artifact: BenchmarkArtifact, arm: BenchmarkArm, key: keyof Cell) => Object.values(artifact.summary[arm] ?? {}).reduce((sum: number, cell: Cell) => sum + cell[key], 0);

/** Where each arm lost points, per question type. Counts come from artifact.summary; refusals from artifact.rows. */
export function BenchmarkBreakdown({ artifact }: { artifact: BenchmarkArtifact }) {
  const categories = [...new Set(artifact.items.map(item => item.category))];
  const refusals = (arm: BenchmarkArm, category: BenchmarkCategory) => artifact.rows.filter(row => row.arm === arm && row.category === category && row.outcome === 'refused').length;
  return <div className="bench-breakdown">
    <h3>Not just "correct": what went wrong, per arm</h3>
    <ul className="bench-totals">{artifact.arms.map(arm => <li key={arm}>
      <strong>{BENCH_ARM_LABELS[arm]}</strong>: {total(artifact, arm, 'correct')}/{total(artifact, arm, 'n')} scored correct; {MISSES.map(([key, label]) => `${total(artifact, arm, key)} ${label}`).join(', ')}.
    </li>)}</ul>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Benchmark misses per question type, scrollable">
      <table className="bench-breakdown-table">
        <caption>Misses per question type. Empty means every row in that cell was scored correct.</caption>
        <thead><tr><th scope="col">Questions</th>{artifact.arms.map(arm => <th scope="col" key={arm}>{BENCH_ARM_LABELS[arm]}</th>)}</tr></thead>
        <tbody>{categories.map(category => <tr key={category}>
          <th scope="row">{BENCH_CATEGORY_LABELS[category]}</th>
          {artifact.arms.map(arm => {
            const cell = artifact.summary[arm]?.[category];
            if (!cell) return <td key={arm}>-</td>;
            const misses = MISSES.filter(([key]) => cell[key] > 0);
            const refused = refusals(arm, category);
            return <td key={arm}>
              <span className="bench-cell-correct">{cell.correct}/{cell.n} correct</span>
              {misses.map(([key, label]) => <span key={key} className="bench-cell-miss">{cell[key]} {label}{key === 'errors' && refused > 0 ? ` (${refused} Claude refusals)` : ''}</span>)}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    {artifact.mode === 'live' && artifact.generated_at.startsWith('2026-10-04') && <p className="bench-audit">Read the scorer caveats before quoting these: plain-Claude "wrong fact" rows can be wording the alias list missed, "bluffed" on clinical questions means it answered when it should have declined, and harness "over-refused" composition rows are a real gap (its claim template covers payload and DAR only). See <a href={HAND_AUDIT_URL} target="_blank" rel="noreferrer">docs/BENCHMARK.md, "Hand audit of the first live run"</a>.</p>}
  </div>;
}
