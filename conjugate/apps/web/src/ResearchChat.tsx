import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUp, MessageSquare, Square, RotateCcw } from 'lucide-react';
import { chatConversationContext, type ChatAudit, type ChatRequest, type ChatResult, type ChatStep, type ResearchCatalog } from '@her2/shared';
import { describeFailure } from './boundaries';
import { RequestEpoch } from './researchBoundaries';
import { downloadChatResult, streamChatTurn } from './chatBoundaries';
import { Receipt, receiptAnchor } from './AuditResult';
import { compareResults, outcomeLabels, outcomeOf, policyLabels } from './auditSummary';
import { productLabel } from './labels';

const STARTERS = [
  { title: 'Compare the two ADCs', question: 'Compare Kadcyla and Enhertu composition.', note: 'Different payloads, different recorded ratios.' },
  { title: 'Check the linker claim', question: 'Does Enhertu’s cleavable linker establish release in blood?', note: 'Find counter-evidence, then withhold it.' },
  { title: 'Find the evidence limit', question: 'Can the Enhertu workbook establish safety?', note: 'See what these records cannot establish.' }
];
interface Turn { id: string; message: string; request: ChatRequest; steps: ChatStep[]; result: ChatResult | null; failure: ReturnType<typeof describeFailure> | null; state: 'pending' | 'complete' | 'failed' | 'cancelled' }
function ChatSteps({ steps, pending }: { steps: ChatStep[]; pending: boolean }) {
  return <details className="chat-steps" open={pending || undefined}><summary>Run steps <span className="mono-label">{steps.length} completed events</span></summary>
    <ol>{steps.map(step => <li key={step.id}><span className="mono-label">{step.actor === 'claude' ? 'Claude' : step.actor.replaceAll('_', ' ')} · {step.stage}</span><p>{step.detail}</p></li>)}</ol>
    {pending && <p>Waiting for the next server event.</p>}
  </details>;
}
export function AuditCard({ audit, turnId, catalog, previous }: { audit: ChatAudit; turnId: string; catalog: ResearchCatalog; previous: ChatAudit | undefined }) {
  const result = audit.result;
  const prefix = `${turnId}-${audit.id}-`;
  const product = catalog.dataset.records.find(record => record.id === audit.scope.product_id)!;
  const rows = previous && previous.scope.evidence_policy !== audit.scope.evidence_policy && previous.result.dataset_sha256 === result.dataset_sha256 ? compareResults(previous.result, result) : [];
  return <article className="chat-audit">
    <div className="chat-audit-heading"><h3>{productLabel(product)}</h3><span className={`verdict-badge verdict-${outcomeOf(result)}`}>{outcomeLabels[outcomeOf(result)]}</span></div>
    <p className="chat-scope">{catalog.questions.find(question => question.id === audit.scope.question_id)?.title} · {policyLabels[audit.scope.evidence_policy]}</p>
    {result.claims.map(claim => <section key={claim.id} className="chat-claim"><h4>{claim.statement}</h4><p>{claim.explanation}</p>
      <div className="chat-citations"><span>Rests on</span>{claim.source_ids.length ? claim.source_ids.map(id => {
        const source = result.receipts.find(receipt => receipt.id === id)!;
        const anchor = receiptAnchor(id, prefix);
        return <a key={id} href={`#${anchor}`} onClick={() => { const target = document.getElementById(anchor); let details = target?.closest('details'); while (details) { details.open = true; details = details.parentElement?.closest('details'); } target?.focus(); }}>{source.kind === 'label' ? 'UK label summary' : source.kind === 'openfda' ? 'US identity record' : 'Workbook cells'}</a>;
      }) : <span>No source settles this claim.</span>}</div>
      <details className="chat-limits"><summary>Limits of this finding</summary><p>{claim.limitation}</p><ul>{result.unknowns.map(item => <li key={item}>{item}</li>)}</ul></details>
    </section>)}
    {rows.length > 0 && <details className="chat-compare" open><summary>What changed from the previous check</summary><dl>{rows.slice(0, 6).map(row => <div key={row.label} className={row.differs ? 'changed' : ''}><dt>{row.label}{row.differs && <span>Changed</span>}</dt><dd><span>Before</span>{row.a}</dd><dd><span>Now</span>{row.b}</dd></div>)}</dl></details>}
    <details className="chat-sources"><summary>All sources read ({result.receipts.length}) · citation checks passed</summary><p>Sources read are not always sources cited. Derived notes cannot support a claim.</p>
      {result.receipts.map(source => <details className="chat-source" key={source.id}><summary>{source.title}</summary><Receipt receipt={source} catalog={catalog} anchorPrefix={prefix} /></details>)}
      <details className="chat-steps"><summary>Local tool events</summary><ol>{result.trace.filter(step => step.stage === 'retrieve' && step.status === 'completed').map(step => <li key={step.id}><code>{step.tool}</code><p>{step.detail}</p><code>{step.source_ids.join(', ')}</code></li>)}</ol></details>
      <details className="chat-limits"><summary>Verifier checks</summary><ul>{result.challenges.map((check, index) => <li key={index}><code>{check.code}</code> — {check.outcome}: {check.detail}</li>)}</ul></details>
    </details>
  </article>;
}

export function ResearchChat({ catalog }: { catalog: ResearchCatalog }) {
  const [engine, setEngine] = useState<ChatRequest['engine']>(catalog.claude_configured ? 'claude' : 'evidence');
  const [confirmed, setConfirmed] = useState(false);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const epochs = useRef(new RequestEpoch());
  const busy = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const active = turns.find(turn => turn.state === 'pending');
  const maxTurns = turns.length >= 8;
  useEffect(() => {
    const epoch = epochs.current; epoch.invalidate(); busy.current = false;
    setTurns([]); setDraft(''); setConfirmed(false); setEngine(catalog.claude_configured ? 'claude' : 'evidence');
    return () => epoch.invalidate();
  }, [catalog]);
  const update = (id: string, change: (turn: Turn) => Turn) => setTurns(current => current.map(turn => turn.id === id ? change(turn) : turn));
  const cancel = () => { epochs.current.invalidate(); busy.current = false; if (active) update(active.id, turn => ({ ...turn, state: 'cancelled' })); };
  const send = async (message: string) => {
    if (busy.current || maxTurns || !confirmed || !message.trim()) return;
    busy.current = true;
    const request: ChatRequest = { message: message.trim(), engine, context: chatConversationContext(turns.map(turn => turn.request)), synthetic_confirmed: true };
    const ticket = epochs.current.begin();
    const id = crypto.randomUUID();
    setTurns(current => [...current, { id, message: request.message, request, steps: [], result: null, failure: null, state: 'pending' }]);
    setDraft(''); composer.current?.focus();
    try {
      const result = await streamChatTurn(request, catalog, AbortSignal.any([ticket.signal, AbortSignal.timeout(65000)]), step => { if (epochs.current.current(ticket)) update(id, turn => ({ ...turn, steps: [...turn.steps, step] })); });
      if (epochs.current.current(ticket)) update(id, turn => ({ ...turn, result, state: 'complete' }));
    } catch (error) { if (epochs.current.current(ticket)) update(id, turn => ({ ...turn, failure: describeFailure(error), state: 'failed' })); }
    finally { if (epochs.current.current(ticket)) busy.current = false; }
  };
  const status = active ? active.steps.at(-1)?.detail ?? 'Waiting for the server.' : turns.at(-1)?.state === 'complete' ? 'Question checked. Sources and limits are available.' : turns.at(-1)?.state === 'cancelled' ? 'Cancelled here. No answer accepted.' : '';
  return <section className="research-chat" aria-labelledby="chat-heading">
    <header className="chat-header"><div><p className="eyebrow">Evidence, not reassurance</p><h1 id="chat-heading">Ask about the evidence</h1><p>Compare Kadcyla and Enhertu. Check a claim. See where the sources stop.</p></div>
      <button className="button button-secondary" type="button" onClick={() => { epochs.current.invalidate(); busy.current = false; setTurns([]); setDraft(''); setExportError(null); composer.current?.focus(); }} disabled={!turns.length && !draft}><RotateCcw size={14} aria-hidden="true" />New chat</button>
    </header>
    <div className="chat-mode"><fieldset disabled={Boolean(active)}><legend>Run with</legend><label><input type="radio" name="chat-engine" checked={engine === 'claude'} disabled={!catalog.claude_configured} onChange={() => setEngine('claude')} />Claude</label><label><input type="radio" name="chat-engine" checked={engine === 'evidence'} onChange={() => setEngine('evidence')} />Rules only</label></fieldset>
      <p>{catalog.claude_configured ? 'Claude chooses evidence checks. The independent verifier owns each verdict.' : 'Claude is off on this server. Rules-only answers use the same evidence checks.'}</p>
    </div>
    {!turns.length && <div className="chat-starters" aria-label="Start with a research question">{STARTERS.map(starter => <button key={starter.title} type="button" onClick={() => { setDraft(starter.question); composer.current?.focus(); }}><MessageSquare size={17} aria-hidden="true" /><strong>{starter.title}</strong><span>{starter.note}</span></button>)}</div>}
    <ol className="chat-thread" aria-label="Research conversation">{turns.map((turn, index) => <li key={turn.id}>
      <div className="chat-question"><span className="mono-label">Your question</span><p>{turn.message}</p></div>
      <div className="chat-answer">
        <div className="chat-answer-top"><span className="mono-label">{turn.result?.harness.model_calls ? 'Claude + evidence checks' : turn.request.engine === 'claude' && turn.state === 'pending' ? 'Claude' : 'Evidence checks'}</span><span>{index + 1} / 8</span></div>
        {turn.state === 'pending' && <p>Checking the question. Only completed server events appear below.</p>}
        {turn.state === 'cancelled' && <p>Cancelled here. No answer accepted. Provider billing may already have started.</p>}
        {turn.failure && <div role="alert" className="error-alert"><strong>Question not checked.</strong><p>{turn.failure.message}</p><code>{turn.failure.code}</code></div>}
        {turn.result && <>
          {!turn.result.audits.length && <p>{turn.result.reply}</p>}
          {turn.result.audits.length > 0 && <p className="chat-scope">Recognized scope: {turn.result.scopes.length} checks · {policyLabels[turn.result.scopes[0]!.evidence_policy]}. {turn.result.harness.model_calls} model calls; {turn.result.harness.evidence_reads} local source reads.</p>}
          {turn.result.missing_scopes.length > 0 && <div className="chat-omissions"><strong>Unanswered checks</strong><ul>{turn.result.missing_scopes.map(scope => <li key={`${scope.product_id}-${scope.question_id}`}>{scope.product_id} · {scope.question_id}</li>)}</ul></div>}
          {turn.result.audits.filter(audit => turn.result!.selected_audit_ids.includes(audit.id)).map(audit => <AuditCard key={audit.id} audit={audit} turnId={turn.id} catalog={catalog} previous={turns.slice(0, index).flatMap(prior => prior.result?.audits ?? []).reverse().find(prior => prior.scope.product_id === audit.scope.product_id && prior.scope.question_id === audit.scope.question_id)} />)}
          {turn.result.audits.some(audit => !turn.result!.selected_audit_ids.includes(audit.id)) && <details><summary>Checked but omitted from the answer</summary>{turn.result.audits.filter(audit => !turn.result!.selected_audit_ids.includes(audit.id)).map(audit => <AuditCard key={audit.id} audit={audit} turnId={turn.id} catalog={catalog} previous={undefined} />)}</details>}
          <div className="chat-followups">{turn.result.followups.map(question => <button key={question} className="button button-secondary" type="button" disabled={Boolean(active) || maxTurns || !confirmed} onClick={() => { void send(question); }}>{question}</button>)}</div>
          <details className="chat-run-record"><summary>Run record and export</summary><p>Server-reported fingerprints. Replay checks the saved audits and rendered reply; it does not rerun Claude.</p><dl><dt>Code SHA-256</dt><dd><code>{turn.result.harness.code_sha256}</code></dd><dt>Intent SHA-256</dt><dd><code>{turn.result.harness.intent_sha256}</code></dd><dt>Limits per question</dt><dd>4 model calls · 4 audits · 16 local source reads · 60 seconds · no retries</dd><dt>Local prompt packs</dt><dd>{turn.result.harness.skills.map(skill => <p key={skill.name}>{skill.name} @{skill.version} <code>{skill.sha256}</code></p>)}</dd></dl><button className="button button-secondary" type="button" onClick={() => { try { downloadChatResult(turn.result!, turn.request, catalog); } catch { setExportError('Export failed validation. Nothing was downloaded.'); } }}><ArrowDownToLine size={14} aria-hidden="true" />Export this turn</button></details>
        </>}
        <ChatSteps steps={turn.steps} pending={turn.state === 'pending'} />
      </div>
    </li>)}</ol>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</p>
    {exportError && <p role="alert">{exportError}</p>}
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(draft); }}>
      <label htmlFor="research-question">Your research question</label>
      <textarea ref={composer} id="research-question" value={draft} maxLength={1000} rows={3} aria-describedby="chat-scope-help" disabled={Boolean(active) || maxTurns} placeholder="How do Kadcyla and Enhertu differ in payload and DAR?" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }} />
      <p id="chat-scope-help">Two products, five evidence checks. Claude receives recognized research terms, not your raw text.</p>
      <div className="chat-composer-actions"><label className="synthetic-check"><input type="checkbox" checked={confirmed} disabled={Boolean(active)} onChange={event => setConfirmed(event.target.checked)} />Synthetic research only. No personal details.</label>{active ? <button className="button button-secondary" type="button" onClick={cancel}><Square size={13} aria-hidden="true" />Cancel</button> : <button className="button button-primary" type="submit" disabled={!confirmed || !draft.trim() || maxTurns}><ArrowUp size={16} aria-hidden="true" />Check question</button>}</div>
      {maxTurns && <p>Eight turns reached. Start a new chat to continue.</p>}
      <p className="chat-privacy">This app saves no chat history. Refreshing or leaving clears this view. That does not establish zero retention by Claude’s provider.</p>
    </form>
  </section>;
}
