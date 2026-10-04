import { useEffect, useRef, useState } from 'react';
import type { InferenceCatalog, InferenceRequest, InferenceResult } from '@her2/shared';
import { describeFailure } from './boundaries';
import { fetchInferenceCatalog, submitInference } from './inferenceBoundaries';

export function LiveInference() {
  const [catalog, setCatalog] = useState<InferenceCatalog | null>(null);
  const [sequence, setSequence] = useState<InferenceRequest['sequence_id']>('trastuzumab_vh');
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<InferenceResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchInferenceCatalog(controller.signal).then(data => { if (!controller.signal.aborted) setCatalog(data); }).catch(cause => { if (!controller.signal.aborted) setFailure(describeFailure(cause).message); });
    return () => { controller.abort(); active.current?.abort(); };
  }, []);
  function reset() { active.current?.abort(); active.current = null; setResult(null); setFailure(null); setBusy(false); }
  async function run() {
    if (!confirmed || !catalog?.configured) return;
    reset(); setBusy(true);
    const controller = new AbortController(); active.current = controller;
    try {
      const next = await submitInference({ sequence_id: sequence, synthetic_confirmed: true }, catalog, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]));
      if (active.current === controller && !controller.signal.aborted) setResult(next);
    } catch (cause) { if (active.current === controller && !controller.signal.aborted) setFailure(describeFailure(cause).message); }
    finally {
      if (active.current === controller) {
        try {
          const next = await fetchInferenceCatalog(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
          if (!controller.signal.aborted && active.current === controller) setCatalog(next);
        } catch { /* Keep the last server-reported budget when refresh fails. */ }
        if (active.current === controller) { setBusy(false); active.current = null; }
      }
    }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'conjugate-live-esm.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="model-method live-inference">
    <p className="eyebrow">MCP tool connected to HF Inference</p><h2>Run ESM on a sequence now</h2>
    <p>Mask tyrosine at position 33, then ask ESM-2 650M how well it fits the surrounding sequence. Compare a public trastuzumab VH reference with a composition-matched reversed control.</p>
    <div className="model-flow"><div><strong>This app</strong><small>Fixed sequence ID</small></div><span aria-hidden="true">→</span><div><strong>MCP tool</strong><small>score_masked_antibody</small></div><span aria-hidden="true">→</span><div><strong>HF inference service</strong><small>ESM-2 650M · fill-mask</small></div></div>
    <form className="model-controls" onSubmit={event => { event.preventDefault(); void run(); }}>
      <label>Sequence<select value={sequence} onChange={event => { reset(); setSequence(event.target.value as InferenceRequest['sequence_id']); }}>{catalog?.cases.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="model-confirm"><input type="checkbox" checked={confirmed} onChange={event => { reset(); setConfirmed(event.target.checked); }} />I am using the public reference and synthetic control for research.</label>
      <button type="submit" className="button button-primary" disabled={!confirmed || !catalog?.configured || busy || catalog.remaining_calls === 0}>{busy ? 'Running ESM through MCP…' : 'Run live inference'}</button>
      {busy && <button type="button" className="button button-secondary" onClick={reset}>Cancel</button>}
    </form>
    <p className="field-hint">{catalog ? catalog.configured ? `${catalog.remaining_calls} calls left in this server session. Each run spends HF inference credits. Failures are not replaced with saved scores.` : 'Live inference is off on this server.' : 'Checking inference availability…'}</p>
    {failure && <p className="error-alert" role="alert">{failure}</p>}
    {result && <div className="model-result" aria-live="polite"><div className="model-result-heading"><h3>{result.sequence.name}</h3><button type="button" className="button button-secondary" onClick={download}>Export live result</button></div><dl className="model-metrics"><div><dt>ESM residue probability</dt><dd>{result.residue_probability.toFixed(6)}</dd></div><div><dt>Single-residue NLL · nats</dt><dd>{result.residue_nll?.toFixed(4) ?? 'Underflow'}</dd></div><div><dt>Provider request time</dt><dd>{(result.latency_ms / 1000).toFixed(2)} s</dd></div><div><dt>Provider calls</dt><dd>{result.provider_calls}</dd></div></dl><p>One residue in one sequence context. This is not binding affinity or a whole-sequence fitness score.</p><details><summary>Live result and provenance</summary><p>The retained response and sequence hashes were checked before display. This checks consistency, not scientific truth or the served weight revision.</p><pre>{JSON.stringify(result, null, 2)}</pre></details></div>}
    <p>Live scoring is separate from the saved embedding comparisons below. Research chat still uses its native evidence tool. Clinical release stays blocked.</p>
  </section>;
}
