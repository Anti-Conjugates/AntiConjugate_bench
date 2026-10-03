import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EvidencePolicySchema, IntegrityDrillSchema, ResearchQuestionSchema, ResearchRequestSchema, type Engine, type ResearchCatalog, type ResearchRequest, type ResearchResult, type ResearchTrace } from '@her2/shared';
import { Play, RotateCcw, Square } from 'lucide-react';
import { describeFailure } from './boundaries';
import { AuditResult } from './AuditResult';
import { initialResearchInputs, RequestEpoch, researchRequest, streamResearchRun, type ResearchInputs } from './researchBoundaries';
import { faultTests, productLabel, questionTitles } from './labels';

type Failure = ReturnType<typeof describeFailure>;

export function EvidenceAudit({ catalog }: { catalog: ResearchCatalog }) {
  const [inputs, setInputs] = useState(initialResearchInputs);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [acceptedRequest, setAcceptedRequest] = useState<ResearchRequest | null>(null);
  const [trace, setTrace] = useState<ResearchTrace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [status, setStatus] = useState('Nothing run yet.');
  const epoch = useRef(new RequestEpoch());
  const catalogRef = useRef(catalog);
  // A replaced catalog can never inherit a result based on a previous snapshot.
  useEffect(() => {
    if (catalogRef.current !== catalog) {
      catalogRef.current = catalog;
      epoch.current.invalidate(); setResult(null); setAcceptedRequest(null); setTrace([]); setBusy(false); setError(null);
      setStatus('Catalog changed. Previous result cleared.');
    }
  }, [catalog]);
  useEffect(() => { const current = epoch.current; return () => current.invalidate(); }, []);

  function invalidate(message: string) {
    epoch.current.invalidate(); setResult(null); setAcceptedRequest(null); setTrace([]); setBusy(false); setError(null); setStatus(message);
  }
  function change<K extends keyof ResearchInputs>(field: K, value: ResearchInputs[K]) {
    invalidate('Inputs changed. Previous result cleared.');
    setInputs((current) => ({ ...current, [field]: value, ...(field === 'engine' ? { synthetic_confirmed: false } : {}) }));
  }
  function reset() { invalidate('Inputs reset.'); setInputs(initialResearchInputs()); }
  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    invalidate('Checking inputs.');
    let request: ResearchRequest;
    try { request = researchRequest(inputs, catalog); } catch (cause: unknown) {
      const parsed = ResearchRequestSchema.safeParse(inputs);
      setError(parsed.success ? describeFailure(cause) : { code: 'INPUT_VALIDATION', message: 'Pick a product and a question, then tick the confirmation. Nothing was sent.' });
      setStatus('Not sent.'); return;
    }
    const ticket = epoch.current.begin();
    setBusy(true); setStatus('Running. Waiting for the server.');
    try {
      const returned = await streamResearchRun(request, catalog, AbortSignal.any([ticket.signal, AbortSignal.timeout(90000)]), (step) => {
        if (epoch.current.current(ticket)) {
          setTrace((current) => [...current, step]);
          setStatus(`Server finished ${step.stage} (${step.status}).`);
        }
      });
      if (epoch.current.current(ticket)) {
        setResult(returned); setAcceptedRequest(request);
        setStatus('Result returned.');
      }
    } catch (cause: unknown) {
      if (epoch.current.current(ticket)) {
        setError(describeFailure(cause)); setResult(null); setAcceptedRequest(null);
        setStatus('No result. Events already received stay visible.');
      }
    } finally { if (epoch.current.current(ticket)) setBusy(false); }
  }
  const products = catalog.dataset.records.filter((record) => record.clinical_enabled && (record.id === 'DRG0CYMEB' || record.id === 'DRG0ERKBH'));
  const question = catalog.questions.find((option) => option.id === inputs.question_id);
  return <>
    <header className="view-heading"><h1>Check a claim</h1><p>Pick a product and a question. The verifier checks each claim against the workbook row and the label summary, then reports what it rests on.</p></header>
    <div className="audit-layout">
      <section className="audit-input" aria-labelledby="audit-scope-heading">
        <h2 id="audit-scope-heading">Claim</h2>
        <form onSubmit={(event) => { void run(event); }} noValidate>
          <div className="field"><label htmlFor="research-product">Product</label><select id="research-product" value={inputs.product_id} onChange={(event) => change('product_id', ResearchRequestSchema.shape.product_id.parse(event.target.value))}>{products.map((product) => <option value={product.id} key={product.id}>{productLabel(product)}</option>)}</select></div>
          <fieldset className="question-options"><legend>Question</legend>{catalog.questions.map((option) => <label className={`option-row ${inputs.question_id === option.id ? 'selected' : ''}`} key={option.id}><input type="radio" name="research-question" checked={inputs.question_id === option.id} value={option.id} onChange={() => change('question_id', ResearchQuestionSchema.parse(option.id))} /><span>{questionTitles[option.id]}</span></label>)}</fieldset>
          <fieldset className="inline-options"><legend>Sources</legend>
            <div className="inline-option-row">{EvidencePolicySchema.options.map((policy) => <label key={policy} className={`option-chip ${inputs.evidence_policy === policy ? 'selected' : ''}`}><input type="radio" name="research-sources" checked={inputs.evidence_policy === policy} onChange={() => change('evidence_policy', policy)} aria-describedby="research-sources-help" /><span>{policy === 'all' ? 'All' : 'Workbook only'}</span></label>)}</div>
            <p id="research-sources-help" className="field-hint">Workbook only withholds the label summary so you can see what the verdict rests on.</p>
          </fieldset>
          <fieldset className="inline-options"><legend>Drafting</legend>
            <div className="inline-option-row">{(['evidence', 'claude'] as Engine[]).map((engine) => <label key={engine} className={`option-chip ${inputs.engine === engine ? 'selected' : ''}`}><input type="radio" name="research-engine" checked={inputs.engine === engine} disabled={engine === 'claude' && !catalog.claude_configured} onChange={() => change('engine', engine)} aria-describedby={engine === 'claude' ? 'research-claude-status' : undefined} /><span>{engine === 'evidence' ? 'Rules only' : 'Claude (claude-opus-5-5)'}</span></label>)}</div>
            <p id="research-claude-status" className="field-hint">{catalog.claude_configured ? 'Claude plans and drafts only. The verifier never sees its prose.' : 'Add ANTHROPIC_API_KEY on the server to enable.'}</p>
          </fieldset>
          <details className="fault-test"><summary>Fault test{inputs.integrity_drill !== 'none' && <span className="uncertainty"> (on)</span>}</summary>
            <p className="field-hint">Injects a bad citation after drafting to check the verifier rejects it.</p>
            <div className="field"><label htmlFor="integrity-drill">Fault</label><select id="integrity-drill" value={inputs.integrity_drill} onChange={(event) => change('integrity_drill', IntegrityDrillSchema.parse(event.target.value))}>{IntegrityDrillSchema.options.map((id) => <option value={id} key={id}>{faultTests[id]}</option>)}</select></div>
          </details>
          <label className="check-row confirm-row" htmlFor="research-confirmed"><input id="research-confirmed" type="checkbox" checked={inputs.synthetic_confirmed} required onChange={(event) => change('synthetic_confirmed', event.target.checked)} /><span>This is synthetic research use. No patient data.</span></label>
          {inputs.engine === 'claude' && <p className="field-hint">The product id, question id and local source text go to Anthropic through this server.</p>}
          <button className="button button-primary run-button" type="submit" disabled={busy || !inputs.synthetic_confirmed || !products.length || !question}><Play size={14} aria-hidden="true" />{busy ? 'Running' : 'Run check'}</button>
          <div className="scope-actions"><button className="button button-secondary" type="button" disabled={!busy} onClick={() => invalidate('Run cancelled.')}><Square size={12} aria-hidden="true" />Cancel</button><button className="button button-secondary" type="button" onClick={reset}><RotateCcw size={13} aria-hidden="true" />Reset</button></div>
        </form>
      </section>
      <div className="audit-results-region">
        <p className="run-status" role="status" aria-live="polite" aria-atomic="true">{status}</p>
        {error && <div className="error-alert" role="alert"><strong>Run failed.</strong><p>{error.message}</p><code>{error.code}</code></div>}
        <AuditResult result={result} request={acceptedRequest} catalog={catalog} trace={trace} busy={busy} onExportError={(cause) => setError(describeFailure(cause))} />
      </div>
    </div>
  </>;
}
