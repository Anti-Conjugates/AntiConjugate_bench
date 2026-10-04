import { useEffect, useRef, useState } from 'react';
import type { ModelCatalog, ModelRequest, ModelResult } from '@her2/shared';
import { describeFailure } from './boundaries';
import { fetchModelCatalog, submitModelRun } from './modelBoundaries';
import { LiveInference } from './LiveInference';

const display = (value: number | null | undefined, digits = 2) => value === null || value === undefined ? 'Not measured' : value.toFixed(digits);
function MoleculeImage({ svg, name }: { svg: string | null; name: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!svg) { setUrl(undefined); return; }
    const next = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [svg]);
  return url ? <img className="molecule-image" src={url} alt={`Molecular graph: ${name}`} /> : <div className="molecule-unavailable">No molecular graph: output is not a plain, valid SMILES.</div>;
}

export function ModelLab() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [product, setProduct] = useState<ModelRequest['product_id']>('DRG0ERKBH');
  const [molecule, setMolecule] = useState('control-01');
  const [policy, setPolicy] = useState<ModelRequest['observation_policy']>('all');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ModelResult | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchModelCatalog(controller.signal).then(data => { if (!controller.signal.aborted) setCatalog(data); }).catch(cause => { if (!controller.signal.aborted) setFailure(describeFailure(cause).message); });
    return () => { controller.abort(); active.current?.abort(); };
  }, []);
  function reset() { active.current?.abort(); active.current = null; setBusy(false); setResult(null); setFailure(null); }
  async function run(id = molecule) {
    if (!confirmed || !catalog) return;
    reset(); setMolecule(id); setBusy(true);
    const controller = new AbortController(); active.current = controller;
    try {
      const next = await submitModelRun({ product_id: product, molecule_id: id, observation_policy: policy, synthetic_confirmed: true }, catalog, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      if (!controller.signal.aborted && active.current === controller) setResult(next);
    } catch (cause) { if (!controller.signal.aborted && active.current === controller) setFailure(describeFailure(cause).message); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'conjugate-component-check.json'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!catalog) return <section>{failure ? <p className="error-alert" role="alert">{failure}</p> : <p role="status">Loading model observations…</p>}</section>;
  const selected = catalog.snapshot.molecules.find(m => m.id === molecule);
  const trials = catalog.snapshot.molecules.filter(m => m.adapter_trial);
  const descriptor = result?.molecule.descriptors;
  return <div className="model-lab">
    <header className="page-header"><p className="eyebrow">Components, not a treatment ranking</p><h1>Linker lab</h1><p>A molecule can score well and still fail a basic check. Compare chemistry, antibody sequences and target structure without turning them into an efficacy score.</p></header>
    <div className="model-flow" aria-label="Three separate research observations">
      <div><span className="model-type">Antibody</span><strong>ESM-2 650M</strong><small>Imported sequence comparisons</small></div><span aria-hidden="true">→</span>
      <div><span className="model-type">Molecule</span><strong>RDKit + checkpoint probes</strong><small>Calculated properties and graph checks</small></div><span aria-hidden="true">→</span>
      <div><span className="model-type">Target</span><strong>AlphaFold DB</strong><small>HER2 monomer confidence</small></div>
    </div>
    <section className="model-trap"><div><p className="eyebrow">Try the shortcut</p><h2>The proxy says 1.00. The handles are missing.</h2><p>A clipped QED/SA/ring proxy gives our no-handle control the same score as a two-handle fragment. A separate graph check catches the difference.</p></div><button className="button button-secondary" type="button" disabled={!confirmed || busy} onClick={() => void run('control-04')}>Check the no-handle control</button></section>
    <form className="model-controls" onSubmit={event => { event.preventDefault(); void run(); }}>
      <label>Antibody reference<select value={product} onChange={event => { reset(); setProduct(event.target.value as ModelRequest['product_id']); }}>{catalog.products.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
      <label>Research molecule<select value={molecule} onChange={event => { reset(); setMolecule(event.target.value); }}>{catalog.snapshot.molecules.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label>
      <label>Available observations<select value={policy} onChange={event => { reset(); setPolicy(event.target.value as ModelRequest['observation_policy']); }}><option value="all">All observations</option><option value="without_structure">Withhold structure</option><option value="without_sequence">Withhold sequence</option><option value="chemistry_only">Chemistry only</option></select></label>
      <label className="model-confirm"><input type="checkbox" checked={confirmed} onChange={event => { reset(); setConfirmed(event.target.checked); }} />I’m using these synthetic research examples.</label>
      <button className="button button-primary" disabled={!confirmed || busy} type="submit">{busy ? 'Checking…' : 'Check components'}</button>
      {busy && <button className="button button-secondary" type="button" onClick={reset}>Cancel</button>}
    </form>
    <p className="field-hint">Checks use frozen observations from {new Date(catalog.snapshot.generated_at).toLocaleDateString()}. Clicking does not call a model or spend inference credits. Synthetic fragments are not the marketed Kadcyla or Enhertu linkers.</p>
    {selected && <p className="model-smiles"><strong>{selected.adapter_trial ? 'Raw adapter output' : 'Synthetic SMILES'}</strong><code>{selected.smiles || '(empty output)'}</code></p>}
    {failure && <p className="error-alert" role="alert">{failure}</p>}
    {result && <section className="model-result" aria-live="polite">
      <div className="model-result-heading"><div><p className="eyebrow">{result.checks.filter(c => c.passed).length} of 3 representation checks passed</p><h2>{result.molecule.name}</h2></div><button className="button button-secondary" type="button" onClick={download}>Export check</button></div>
      <div className="model-score-grid"><article className="model-score"><h3>Molecule properties</h3><MoleculeImage svg={result.molecule.depiction_svg} name={result.molecule.name} /><dl className="model-metrics"><div><dt>Clipped proxy reward</dt><dd>{display(result.molecule.proxy_reward)}</dd></div><div><dt>QED</dt><dd>{display(descriptor?.qed)}</dd></div><div><dt>SA score · 1–10</dt><dd>{display(descriptor?.sa_score)}</dd></div><div><dt>cLogP</dt><dd>{display(descriptor?.logp)}</dd></div><div><dt>MW · g/mol</dt><dd>{display(descriptor?.molecular_weight)}</dd></div><div><dt>TPSA · Å²</dt><dd>{display(descriptor?.tpsa)}</dd></div></dl><p>Properties use hydrogen-capped fragments. QED and SA are proxies, not measured cleavage or synthesis success.</p></article>
        <article className="model-score"><h3>Antibody sequence</h3><div className="model-big-number">{display(result.sequence?.cosine, 5)}</div><p>ESM cosine to the Kadcyla antibody reference</p><dl className="model-metrics"><div><dt>Alignment identity baseline</dt><dd>{result.sequence ? `${(result.sequence.identity * 100).toFixed(1)}%` : 'Withheld'}</dd></div><div><dt>Antibody</dt><dd>{result.sequence?.antibody ?? 'Withheld'}</dd></div></dl><p>Kadcyla and Enhertu use the same matched variable-domain sequences. This signal cannot distinguish their payloads or rank ADC performance.</p></article>
        <article className="model-score"><h3>HER2 target structure</h3><div className="model-big-number">{display(result.structure?.mean_plddt)}</div><p>Mean pLDDT · 0–100 · target monomer only</p>{result.structure && <><svg className="plddt-chart" viewBox="0 0 400 100" role="img" aria-label="Local HER2 structure confidence by residue"><line x1="0" y1="50" x2="400" y2="50" stroke="currentColor" strokeDasharray="3 4" opacity=".3" /><polyline fill="none" stroke="currentColor" strokeWidth="1" points={result.structure.plddt.map((v, i) => `${i * 400 / 1254},${100 - v}`).join(' ')} /></svg><p>{(result.structure.below_50_fraction * 100).toFixed(1)}% of residues below pLDDT 50. {result.structure.residue_count} residues, model v{result.structure.version}.</p></>}<p>Local fold confidence is not antibody–HER2 affinity. No antibody complex or conjugated linker was folded.</p></article>
      </div>
      <div className="model-checks">{result.checks.map(check => <div key={check.id}><strong className={check.passed ? 'check-pass' : 'check-fail'}>{check.passed ? 'Pass' : 'Fail'}</strong><div><b>{check.id.replaceAll('_', ' ')}</b><p>{check.detail}</p></div></div>)}</div>
      <section className="model-missing"><h3>What a whole-ADC score would still need</h3><ul>{result.missing.map(item => <li key={item}>{item}</li>)}</ul><p><strong>Overall ADC score: not assessed.</strong> Passing these graph checks does not make a fragment a usable ADC linker.</p></section>
      <details><summary>Methods and source fingerprints</summary><p>Snapshot SHA-256: <code>{result.snapshot_sha256}</code></p><p>Sequence artifact SHA-256: <code>{result.sequence_artifact_sha256}</code></p><p>Controller SHA-256: <code>{result.code_sha256}</code></p><p>Hashes are server-reported. Offline replay compares this export with the pinned artifacts, not experimental truth.</p>{result.sequence && <p>ESM: {result.sequence.model_id}, revision <code>{result.sequence.revision}</code>, imported {result.sequence.generated_at}. Mean pooling over VH/VL variable domains; no new ESM inference in this check.</p>}{result.structure && <p><a href={result.structure.confidence_url} target="_blank" rel="noreferrer">AlphaFold DB confidence file</a> · {result.structure.entry_id} v6 · CC-BY-4.0 · {result.structure.method}. <code>{result.structure.confidence_sha256}</code></p>}</details>
    </section>}
    <LiveInference />
    <section className="model-method"><h2>The HF checkpoint is an experiment, not the ADC paper’s model</h2><p><a href={`https://huggingface.co/jarod0411/linkerGPT/tree/${catalog.snapshot.linker_model.revision}`} target="_blank" rel="noreferrer">jarod0411/linkerGPT</a> has no declared license or documented conditioning format. The published <a href="https://www.nature.com/articles/s41598-025-05555-3" target="_blank" rel="noreferrer">ADC Linker-GPT paper</a> uses a different architecture.</p><p>We retained {trials.length} unconditioned format probes at seed {catalog.snapshot.linker_model.seed}, capped at {catalog.snapshot.linker_model.max_new_tokens} new tokens each. They contain fragment markers or incomplete strings; they are not a molecular-validity benchmark or reproduced paper results. No outputs are repaired into candidates.</p><p>{trials.filter(m => m.completed_with_eos).length}/{trials.length} reached EOS; {trials.filter(m => m.valid).length}/{trials.length} parsed as plain SMILES. These describe this adapter trial only. NLL measures the generated serialization’s token fit, not molecule quality.</p><details><summary>Checkpoint settings</summary><pre>{JSON.stringify(catalog.snapshot.linker_model, null, 2)}</pre></details></section>
    <section className="model-unavailable"><h2>Not run</h2>{catalog.unavailable.map(item => <p key={item.name}><a href={item.url} target="_blank" rel="noreferrer">{item.name}</a> — {item.reason}</p>)}</section>
  </div>;
}
