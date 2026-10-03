import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Catalog, Engine, RunResult } from '@her2/shared';
import { Square } from 'lucide-react';
import { describeFailure, emptyInputs, postRun, validateInputs, type InputValues } from './boundaries';
import { PatientForm } from './PatientForm';
import { ResearchResult } from './ResearchResult';
import { RequestEpoch } from './researchBoundaries';
import { productLabel } from './labels';

export function ContextReview({ catalog }: { catalog: Catalog | null }) {
  const [productId, setProductId] = useState(catalog?.products.find((product) => product.id === 'DRG0ERKBH')?.id ?? catalog?.products[0]?.id ?? '');
  const [engine, setEngine] = useState<Engine>('evidence');
  const [values, setValues] = useState<InputValues>(emptyInputs);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ReturnType<typeof describeFailure> | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Nothing run yet. Blank fields stay unknown.');
  const epoch = useRef(new RequestEpoch());
  useEffect(() => { const current = epoch.current; return () => current.invalidate(); }, []);

  function invalidate(message = 'Inputs changed. Previous result cleared.') {
    epoch.current.invalidate(); setResult(null); setBusy(false); setError(null); setFieldErrors({}); setNotice(message);
  }
  function changeInput<K extends keyof InputValues>(field: K, value: InputValues[K]) {
    invalidate(); setValues((current) => ({ ...current, [field]: value }));
  }
  function clear() { invalidate('Inputs cleared.'); setValues(emptyInputs()); setEngine('evidence'); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!catalog || busy) return;
    invalidate('Checking inputs.');
    const parsed = validateInputs(values, productId, engine);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === 'patient' ? issue.path[1] : issue.path[0];
        if (typeof key === 'string' && !errors[key]) errors[key] = key === 'synthetic_confirmed' ? 'Tick the confirmation first.' : issue.message;
      }
      setFieldErrors(errors); setError({ code: 'INPUT_VALIDATION', message: 'Fix the marked fields. Nothing was sent.' }); return;
    }
    if (!catalog.products.some((product) => product.id === parsed.data.product_id)
      || (engine === 'claude' && (!catalog.claude_configured || catalog.model !== 'claude-opus-5-5'))) {
      setError({ code: 'UNAVAILABLE_SELECTION', message: 'That product or drafting option is not in the server catalog. Nothing was sent.' }); return;
    }
    const ticket = epoch.current.begin(); setBusy(true);
    setNotice('Running. Waiting for the server.');
    try {
      const draft = await postRun(parsed.data, catalog, AbortSignal.any([ticket.signal, AbortSignal.timeout(90000)]));
      if (epoch.current.current(ticket)) { setResult(draft); setNotice('Result returned.'); }
    } catch (cause: unknown) {
      if (epoch.current.current(ticket)) { setError(describeFailure(cause)); setNotice('No result.'); }
    } finally { if (epoch.current.current(ticket)) setBusy(false); }
  }
  return <section className="context-view" aria-labelledby="context-heading">
    <header className="view-heading"><h1 id="context-heading">Patient context</h1><p>Enter made-up context for Kadcyla (trastuzumab emtansine) or Enhertu (trastuzumab deruxtecan). The result lists the label checks that apply, what is unknown and which checks the draft left out.</p></header>
    <div className="context-product field"><label htmlFor="context-product">Product</label><select id="context-product" value={productId} disabled={!catalog} onChange={(event) => { invalidate(); setProductId(event.target.value); }}>{catalog?.products.map((product) => <option key={product.id} value={product.id}>{productLabel(product)}</option>)}</select></div>
    <p className="run-status" role="status" aria-live="polite" aria-atomic="true">{notice}</p>
    {error && <div className="error-alert" role="alert"><strong>Run failed.</strong><p>{error.message}</p><code>{error.code}</code></div>}
    {busy && <button className="button button-secondary context-cancel" type="button" onClick={() => invalidate('Run cancelled.')}><Square size={12} aria-hidden="true" />Cancel</button>}
    <div className="workflow-grid"><PatientForm values={values} engine={engine} catalog={catalog} busy={busy} errors={fieldErrors} onChange={changeInput} onEngineChange={(next) => { invalidate(); setEngine(next); setValues((current) => ({ ...current, synthetic_confirmed: false })); }} onSubmit={(event) => { void submit(event); }} onClear={clear} /><ResearchResult result={result} busy={busy} /></div>
  </section>;
}
