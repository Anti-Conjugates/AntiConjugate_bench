import { useState } from 'react';
import type { BenchmarkArm, BenchmarkArtifact, BenchmarkCategory, BenchmarkOutcome } from '@her2/shared';

export const BENCH_ARM_LABELS: Record<BenchmarkArm, string> = {
  plain_claude: 'Plain Claude, no tools',
  harness_claude: 'Conjugate harness with Claude',
  harness_rules: 'Conjugate harness, rules only'
};
export const BENCH_CATEGORY_LABELS: Record<BenchmarkCategory, string> = {
  composition: 'Composition facts',
  invented_adc: 'Invented ADCs',
  fake_reference: 'Fake and real references',
  false_premise: 'False premises',
  out_of_scope: 'Clinical questions'
};
const OUTCOME_LABELS: Record<BenchmarkOutcome, string> = {
  correct: 'correct', abstained_correctly: 'abstained (correct)', flagged_premise: 'flagged premise (correct)', bluffed: 'bluffed',
  fabricated_citation: 'fabricated citation', accepted_false_premise: 'accepted false premise', wrong_fact: 'wrong fact',
  over_refused: 'over-refused', refused: 'refused', provider_error: 'error'
};
const COLUMNS = [
  ['correct', 'Correct'], ['bluffed', 'Bluffed'], ['fabricated_citations', 'Fabricated citations'], ['accepted_false_premise', 'Accepted false premise'],
  ['wrong_fact', 'Wrong fact'], ['over_refused', 'Over-refused'], ['errors', 'Errors']
] as const;

/** Pure view of a parsed benchmark artifact. Every number shown is read from the artifact. */
export function BenchmarkSection({ artifact }: { artifact: BenchmarkArtifact }) {
  const [arm, setArm] = useState<BenchmarkArm | 'all'>('all');
  const [category, setCategory] = useState<BenchmarkCategory | 'all'>('all');
  const [outcome, setOutcome] = useState<BenchmarkOutcome | 'all'>('all');
  const categories = [...new Set(artifact.items.map(item => item.category))];
  const outcomes = [...new Set(artifact.rows.map(row => row.outcome))];
  const messages = new Map(artifact.items.map(item => [item.item_id, item.message]));
  const rows = artifact.rows.filter(row => (arm === 'all' || row.arm === arm) && (category === 'all' || row.category === category) && (outcome === 'all' || row.outcome === outcome));
  return (
    <section className="bench-section" aria-labelledby="bench-title">
      <p className="eyebrow">Benchmark</p>
      <h2 id="bench-title">Plain Claude against the Conjugate harness</h2>
      <p className="bench-lede">The same {artifact.items.length} research questions went to each arm: facts from the workbook, invented ADCs, made-up trial and paper ids, wrong premises and clinical questions that should be declined.</p>
      {artifact.mode === 'offline' && <p className="bench-offline" role="note">Offline run. No model was called: the Claude arms used a fixed mock, so their counts test the pipeline, not Claude.</p>}
      <p className="bench-budget">Mode {artifact.mode}. Model {artifact.model}. Model calls {artifact.budget.calls_used} of {artifact.budget.max_calls}. Retries {artifact.budget.retries}. Generated {artifact.generated_at}.</p>
      <div className="table-scroll">
        <table className="bench-table">
          <caption>Counts per arm and question type. Each row adds up to n.</caption>
          <thead><tr><th scope="col">Questions</th><th scope="col">Arm</th><th scope="col">n</th>{COLUMNS.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
          <tbody>
            {categories.flatMap(cat => artifact.arms.map((name, index) => {
              const cell = artifact.summary[name]?.[cat];
              return (
                <tr key={`${cat}-${name}`} className={index === 0 ? 'bench-group' : undefined}>
                  {index === 0 && <th scope="rowgroup" rowSpan={artifact.arms.length}>{BENCH_CATEGORY_LABELS[cat]}</th>}
                  <td>{BENCH_ARM_LABELS[name]}</td>
                  <td>{cell?.n ?? 0}</td>
                  {COLUMNS.map(([key]) => <td key={key} className={key !== 'correct' && (cell?.[key] ?? 0) > 0 ? 'bench-bad' : undefined}>{cell?.[key] ?? 0}</td>)}
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
      <div className="bench-filters" role="group" aria-label="Filter rows">
        <label>Arm <select value={arm} onChange={event => setArm(event.target.value as BenchmarkArm | 'all')}><option value="all">All arms</option>{artifact.arms.map(name => <option key={name} value={name}>{BENCH_ARM_LABELS[name]}</option>)}</select></label>
        <label>Questions <select value={category} onChange={event => setCategory(event.target.value as BenchmarkCategory | 'all')}><option value="all">All types</option>{categories.map(cat => <option key={cat} value={cat}>{BENCH_CATEGORY_LABELS[cat]}</option>)}</select></label>
        <label>Outcome <select value={outcome} onChange={event => setOutcome(event.target.value as BenchmarkOutcome | 'all')}><option value="all">All outcomes</option>{outcomes.map(name => <option key={name} value={name}>{OUTCOME_LABELS[name]}</option>)}</select></label>
        <span className="bench-count">{rows.length} of {artifact.rows.length} rows</span>
      </div>
      <ol className="bench-rows">
        {rows.map(row => (
          <li key={`${row.item_id}-${row.arm}`} className={`bench-row bench-${row.outcome}`}>
            <div className="bench-row-top"><span className="bench-outcome">{OUTCOME_LABELS[row.outcome]}</span><span>{BENCH_ARM_LABELS[row.arm]}</span><code>{row.item_id}</code></div>
            <p className="bench-question">{messages.get(row.item_id)}</p>
            {row.citations.length > 0 && <p className="bench-citations">Cited: {row.citations.map(citation => `${citation.id} (${citation.resolved.replace('_', ' ')})`).join(', ')}</p>}
            <details><summary>Response excerpt</summary><p className="bench-excerpt">{row.excerpt || 'No text.'}</p></details>
          </li>
        ))}
      </ol>
      <h3>Limitations</h3>
      <ul className="bench-limits">{artifact.limitations.map(item => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}
