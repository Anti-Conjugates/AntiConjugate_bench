import type { LiveReceipt, TurnGuard } from '@her2/shared';
import { PremiseGateAnim } from './PremiseGateAnim';

const liveStatus: Record<LiveReceipt['status'], string> = { ok: 'Matches', not_found: 'Not found', drift: 'Differs from snapshot', error: 'Fetch failed' };
const liveSources: Record<LiveReceipt['source'], string> = { clinicaltrials_gov: 'ClinicalTrials.gov', pubmed: 'PubMed', openfda: 'openFDA', dailymed: 'DailyMed', adcdb: 'ADCdb' };
const subjectLabel = (subject: string) => subject === 'DRG0CYMEB' ? 'Kadcyla' : subject === 'DRG0ERKBH' ? 'Enhertu' : subject;

function receiptDetail(receipt: LiveReceipt) {
  if (receipt.status === 'error') return `No result accepted (${receipt.error_code ?? 'error'}). Nothing replaced it.`;
  if (receipt.status === 'not_found') return 'The source has no record with this id.';
  const differs = receipt.comparison.filter(row => !row.agrees);
  if (differs.length) return `Differs on ${differs.map(row => row.field).join(', ')}.`;
  const title = receipt.parsed.official_title ?? receipt.parsed.brief_title ?? receipt.parsed.title;
  if (title) return title;
  return receipt.comparison.length ? `${receipt.comparison.length} fields match the frozen snapshot.` : 'Record found.';
}

/** Premise findings and live receipts for one turn. Receipts never change a verdict. */
export function GuardPanel({ guard, question }: { guard: TurnGuard; question: string }) {
  const { premise, live } = guard;
  return <section className="guard-panel" aria-label="Premise and live source checks" data-decision={premise.decision}>
    {premise.decision === 'clear'
      ? <p className="guard-clear"><span className="mono-label">Premise gate</span> No finding against the recorded composition.</p>
      : <PremiseGateAnim question={question} report={premise} source={<>Deterministic premise gate, checked against the frozen workbook snapshot. Adapted from adc-guardrail (premise checks only).</>} />}
    <details className="guard-live" open={live.some(receipt => receipt.status !== 'ok') || undefined}>
      <summary><span className="mono-label">Live sources</span> {guard.live_enabled ? `${live.length} fetched this turn` : 'off on this server'}</summary>
      {!guard.live_enabled ? <p>Live retrieval is off on this server. Nothing was fetched.</p>
        : live.length ? <ul className="guard-receipts">{live.map(receipt => <li key={`${receipt.source}-${receipt.subject}`} data-status={receipt.status}>
          <div><strong>{liveSources[receipt.source]} · {subjectLabel(receipt.subject)}</strong><span className={`live-status live-${receipt.status}`}>{liveStatus[receipt.status]}</span></div>
          <p>{receiptDetail(receipt)}</p>
          <p className="guard-meta"><a href={receipt.url} target="_blank" rel="noreferrer">Source request</a>{receipt.http_status !== null && <> · HTTP {receipt.http_status}</>}{receipt.raw_sha256 && <> · <code title={receipt.raw_sha256}>sha256 {receipt.raw_sha256.slice(0, 12)}</code></>}{receipt.cached && <> · cached</>}</p>
        </li>)}</ul>
        : <p>Nothing in this question needed a live lookup.</p>}
      <p className="guard-note">Live receipts only show whether a reference exists or a record still matches the frozen snapshot. They never change a verdict and are not clinical evidence.</p>
    </details>
  </section>;
}

