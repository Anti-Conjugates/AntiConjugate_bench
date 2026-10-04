const stages = [
  { id: 'scope', actor: 'controller', note: 'Validates the request against the shared schema.' },
  { id: 'plan', actor: 'controller, or Claude if selected', note: 'Picks which sources to read.' },
  { id: 'retrieve', actor: 'local tools', note: 'Workbook, UK summary, derived notes, US identity.' },
  { id: 'draft', actor: 'controller, or Claude if selected', note: 'Chooses claim ids and source ids.' },
  { id: 'challenge', actor: 'deterministic verifier', note: 'Tries to break each citation.' },
  { id: 'verify', actor: 'deterministic verifier', note: 'Accepts or rejects the draft.' },
  { id: 'handoff', actor: 'controller', note: 'Marks the result draft, blocked, needs human.' },
] as const;

const checks = [
  { code: 'product_identity', what: 'The draft names the requested product and every cited source belongs to it.' },
  { code: 'source_allowlist', what: 'Every cited source id is on the allowlist for this product and source setting.' },
  { code: 'exact_source_claim_pairing', what: 'The claim id and its source set match the independent definition for the question. Nothing is repaired.' },
  { code: 'source_eligibility', what: 'No derived note or other ineligible source is cited as primary evidence.' },
  { code: 'evidence_availability', what: 'Every cited source was actually retrieved during the run.' },
  { code: 'unique_claims', what: 'No claim id appears twice.' },
  { code: 'omitted_claim_ids', what: 'The claim the question expects is present. If not, it is listed as omitted, not added.' },
  { code: 'receipt_integrity', what: 'Each source record matches what the local tool read, with no duplicates.' },
  { code: 'incomplete_provenance', what: 'Always unknown. The workbook has no extraction date or sheet name and the label summaries are paraphrases pending review.' },
  { code: 'uncalibrated_confidence', what: 'Always unknown. No probability is computed.' },
] as const;

const planReturns = { product_id: 'DRG0ERKBH', tool_ids: ['read_workbook', 'read_label'] };
const draftReturns = { product_id: 'DRG0ERKBH', claims: [{ claim_id: 'linker_release', source_ids: ['UK-ENHERTU-SMPC'] }] };
const toolReturns = { id: 'UK-ENHERTU-SMPC', kind: 'label', product_id: 'DRG0ERKBH', section: '4.4, 5.1', excerpt: '(paraphrase of the local label summary)', eligible_for_claim: true };
const verifierReturns = { draft_integrity: 'accepted', challenges: [{ code: 'source_allowlist', outcome: 'passed' }, { code: 'exact_source_claim_pairing', outcome: 'passed' }, { code: 'uncalibrated_confidence', outcome: 'unknown' }], claims: [{ id: 'linker_release', verdict: 'contradicted' }] };

const boxWidth = 112;
const gap = 20;
const diagramWidth = stages.length * (boxWidth + gap) + gap;

export function HowItWorks() {
  return (
    <section className="how-view" aria-labelledby="how-heading">
      <header className="view-heading">
        <h1 id="how-heading">How it works</h1>
        <p>A run goes through seven stages. The model, when selected, only plans and drafts. The verifier never sees model prose, only claim ids and source ids.</p>
      </header>

      <section aria-labelledby="pipeline-heading">
        <h2 id="pipeline-heading">Pipeline</h2>
        <div className="pipeline-scroll" tabIndex={0} role="region" aria-label="Pipeline diagram, scrollable">
          <svg className="pipeline-svg" width={diagramWidth} height={196} viewBox={`0 0 ${diagramWidth} 196`} role="img" aria-labelledby="pipeline-title pipeline-desc">
            <title id="pipeline-title">Seven pipeline stages from scope to handoff</title>
            <desc id="pipeline-desc">Scope, plan, retrieve, draft, challenge, verify, handoff, in a row. The controller runs scope, plan, draft and handoff. Claude replaces the controller for plan and draft only when selected. Local tools run retrieve. The deterministic verifier runs challenge and verify and receives only claim ids and source ids.</desc>
            <defs><marker id="pipeline-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" /></marker></defs>
            {[1, 3].map((index) => <rect key={index} className="pipeline-band pipeline-band-model" x={gap + index * (boxWidth + gap) - 6} y={6} width={boxWidth + 12} height={92} rx={3} />)}
            <text className="pipeline-band-label" x={gap + 1 * (boxWidth + gap)} y={20}>Claude if selected: plan and draft only</text>
            <rect className="pipeline-band pipeline-band-verifier" x={gap + 4 * (boxWidth + gap) - 8} y={6} width={2 * (boxWidth + gap) - gap + 16} height={92} rx={3} />
            <text className="pipeline-band-label" x={gap + 4 * (boxWidth + gap)} y={20}>verifier: ids only, no prose</text>
            {stages.map((stage, index) => {
              const x = gap + index * (boxWidth + gap);
              return <g key={stage.id} className={`pipeline-stage actor-${stage.actor.split(',')[0]?.replace(' ', '-')}`}>
                {index < stages.length - 1 && <line x1={x + boxWidth} y1={62} x2={x + boxWidth + gap - 1} y2={62} markerEnd="url(#pipeline-arrow)" />}
                <rect x={x} y={34} width={boxWidth} height={56} rx={3} />
                <text className="pipeline-stage-name" x={x + boxWidth / 2} y={58} textAnchor="middle">{stage.id}</text>
                <text className="pipeline-stage-step" x={x + boxWidth / 2} y={78} textAnchor="middle">{index + 1} of 7</text>
                <text className="pipeline-actor" x={x + boxWidth / 2} y={118} textAnchor="middle">{stage.actor.split(',')[0]}</text>
                {stage.id === 'retrieve' && <>
                  <text className="pipeline-tool" x={x + boxWidth / 2} y={136} textAnchor="middle">read_workbook</text>
                  <text className="pipeline-tool" x={x + boxWidth / 2} y={150} textAnchor="middle">read_label</text>
                  <text className="pipeline-tool" x={x + boxWidth / 2} y={164} textAnchor="middle">read_derived</text>
                  <text className="pipeline-tool" x={x + boxWidth / 2} y={178} textAnchor="middle">read_openfda</text>
                </>}
                {(stage.id === 'plan' || stage.id === 'draft') && <text className="pipeline-tool" x={x + boxWidth / 2} y={136} textAnchor="middle">or Claude</text>}
              </g>;
            })}
          </svg>
        </div>
        <ol className="pipeline-list">
          {stages.map((stage, index) => <li key={stage.id}><code>{stage.id}</code> <span className="pipeline-list-actor">{stage.actor}</span><span>{stage.note}</span>{index === 2 && <span className="field-hint">All four tools read frozen local data. US identity fields stay separate from UK summaries.</span>}</li>)}
        </ol>
        <p>Rules only mode makes no model calls. Claude returns ids for plan and draft. Raw model prose is discarded, not logged in the trace. If a Claude call fails, the run fails without switching engines.</p>
      </section>

      <section aria-labelledby="run-controls-heading">
        <h2 id="run-controls-heading">What keeps a run in scope</h2>
        <div className="harness-controls">
          <article><h3>Two model calls</h3><p>One plan, one draft. No retries or open-ended loop. Both share a 60-second deadline.</p></article>
          <article><h3>Four local tools</h3><p>Each runs at most once. Workbook only blocks the other three before execution.</p></article>
          <article><h3>Checked at each boundary</h3><p>Requests, tool selections, drafts and exports use strict schemas. Model requests are capped at 64 KiB and responses at 128 KiB.</p></article>
          <article><h3>Repeatable verification</h3><p>Every result records code, input, source and skill hashes. Export its JSON and replay the verifier without calling Claude.</p></article>
        </div>
        <p className="field-hint">Claude receives the expected citation mapping. This tests contract compliance, not independent citation discovery. Fingerprints are not signatures.</p>
      </section>

      <section aria-labelledby="who-sees-heading">
        <h2 id="who-sees-heading">Who sees what</h2>
        <p>The model and the verifier never share a channel. Claude gets ids and local text and returns ids. The verifier gets ids and the server's own expected mapping, and never reads the model's text. The shapes below are the real ones, trimmed.</p>
        <div className="who-sees-grid">
          <article className="party-model">
            <h3>Claude, when selected</h3>
            <h4>Gets</h4>
            <p>The product id, question id and source setting; the allowed tool ids; the local skill files; and, for the draft, the text of each source read plus the claim id under audit with its expected source ids.</p>
            <h4>Returns for plan</h4>
            <pre><code>{JSON.stringify(planReturns, null, 2)}</code></pre>
            <h4>Returns for draft</h4>
            <pre><code>{JSON.stringify(draftReturns, null, 2)}</code></pre>
            <p className="field-hint">Only validated identifiers continue downstream. Raw prose is discarded.</p>
          </article>
          <article className="party-tools">
            <h3>Local tools</h3>
            <h4>Get</h4>
            <p>One tool id, product id and question id. Each tool reads its product-specific local record. No network.</p>
            <h4>Return</h4>
            <pre><code>{JSON.stringify(toolReturns, null, 2)}</code></pre>
            <p className="field-hint">These records are the sources shown under Sources used. Derived notes come back with <code>eligible_for_claim: false</code>.</p>
          </article>
          <article className="party-verifier">
            <h3>Verifier</h3>
            <h4>Gets</h4>
            <p>The draft ids, the records the tools returned, and the server's own expected claim and source mapping for the question. Not the model's text.</p>
            <h4>Returns</h4>
            <pre><code>{JSON.stringify(verifierReturns, null, 2)}</code></pre>
            <p className="field-hint">One <code>caught</code> rejects the whole draft. The verdict per claim comes from the sources read, not from the model.</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="checks-list-heading">
        <h2 id="checks-list-heading">What the verifier checks</h2>
        <p>Each run reports these codes in the Checks table with an outcome of <code>passed</code>, <code>caught</code> or <code>unknown</code>. One <code>caught</code> rejects the whole draft.</p>
        <table className="checks-table"><caption className="sr-only">Verifier check codes</caption>
          <thead><tr><th scope="col">Code</th><th scope="col">What it checks</th></tr></thead>
          <tbody>{checks.map((check) => <tr key={check.code}><th scope="row"><code>{check.code}</code></th><td>{check.what}</td></tr>)}</tbody>
        </table>
        <p className="field-hint"><code>incomplete_provenance</code> and <code>uncalibrated_confidence</code> are always unknown. They are there so the result cannot read as fully provenanced or as a confidence score.</p>
      </section>

      <section aria-labelledby="not-heading">
        <h2 id="not-heading">What it does not do</h2>
        <ul className="plain-list">
          <li>It does not choose a treatment.</li>
          <li>It does not give a dose.</li>
          <li>It does not assess eligibility. <code>eligibility</code> is always <code>not_assessed</code>.</li>
          <li>It does not produce calibrated probabilities. <code>answer_correctness_probability</code> and <code>omission_probability</code> are always <code>null</code>.</li>
          <li>It does not fetch anything from the web during a run. openFDA is imported separately; runs read its frozen identity records.</li>
        </ul>
        <p>Every result is <code>draft_pending_pharmacist</code> with <code>needs_human: true</code> and a blocked clinical gate.</p>
      </section>

      <section aria-labelledby="credits-heading">
        <h2 id="credits-heading">Credits</h2>
        <p>The engineering workflow in this repository is adapted from pstack by poteto under the MIT license. That workflow builds the app; it is not the runtime agent.</p>
        <p>Harness design follows <a href="https://www.anthropic.com/engineering/building-effective-agents" target="_blank" rel="noopener noreferrer">simple, composable agent patterns</a> and <a href="https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents" target="_blank" rel="noopener noreferrer">separate execution and evaluation harnesses</a>. <a href="https://open.fda.gov/apis/drug/label/" target="_blank" rel="noopener noreferrer">openFDA documents its data limits</a>.</p>
      </section>
    </section>
  );
}
