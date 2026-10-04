import type { CSSProperties, ReactNode } from 'react';

/** Local stand-in for the shared premise report contract; swap for the zod-derived type once it lands in packages/shared. */
export type PremiseFindingKind = 'unverifiable_entity' | 'unverifiable_construct' | 'unverifiable_reference' | 'contradicted_premise';
export interface PremiseFindingLike { kind: PremiseFindingKind; text: string; stated?: string; recorded?: string }
export interface PremiseReportLike { decision: 'clear' | 'flagged' | 'blocked'; findings: PremiseFindingLike[] }

export const findingLabels: Record<PremiseFindingKind, string> = {
  contradicted_premise: 'Premise contradicted', unverifiable_entity: 'Product not recognised', unverifiable_construct: 'Construct not recognised', unverifiable_reference: 'Reference not found',
};
export const decisionLabels: Record<PremiseReportLike['decision'], string> = {
  clear: 'No premise finding', flagged: 'Premise flagged before any model call', blocked: 'Stopped before any model call',
};

/** Marks the first occurrence of each stated phrase in the question. */
export function markStated(question: string, findings: readonly PremiseFindingLike[]): ReactNode[] {
  const phrases = findings.map(finding => finding.stated).filter((phrase): phrase is string => Boolean(phrase));
  const parts: ReactNode[] = [];
  let rest = question;
  let key = 0;
  while (rest) {
    const hits = phrases.map(phrase => ({ phrase, at: rest.toLowerCase().indexOf(phrase.toLowerCase()) })).filter(hit => hit.at >= 0).sort((a, b) => a.at - b.at);
    const hit = hits[0];
    if (!hit) { parts.push(rest); break; }
    if (hit.at) parts.push(rest.slice(0, hit.at));
    parts.push(<mark key={key++} className="pg-match">{rest.slice(hit.at, hit.at + hit.phrase.length)}</mark>);
    rest = rest.slice(hit.at + hit.phrase.length);
  }
  return parts;
}

/** A premise check closing in front of the model. Shows findings only; it never writes a verdict. */
export function PremiseGateAnim({ report, question, source }: { report: PremiseReportLike; question: string; source: ReactNode }) {
  const closed = report.decision !== 'clear';
  return <figure className="pg" data-decision={report.decision}>
    <p className="pg-question"><span className="pg-tag">Question</span>{markStated(question, report.findings)}</p>
    <div className="pg-lane" aria-hidden="true">
      <span className="pg-stop">question</span>
      <span className="pg-wire" />
      <span className="pg-gate" data-closed={closed || undefined}><i className="pg-bar pg-bar-top" /><i className="pg-bar pg-bar-bottom" /></span>
      <span className="pg-wire pg-wire-after" />
      <span className="pg-stop pg-model">model</span>
    </div>
    <p className="pg-decision">{decisionLabels[report.decision]}</p>
    {report.findings.length > 0 && <ul className="pg-findings">{report.findings.map((finding, i) => <li key={i} className="pg-finding" data-kind={finding.kind} style={{ '--i': i } as CSSProperties}>
      <strong>{findingLabels[finding.kind]}</strong>
      <p>{finding.text}</p>
      {(finding.stated || finding.recorded) && <dl>{finding.stated && <div><dt>Question says</dt><dd>{finding.stated}</dd></div>}{finding.recorded && <div><dt>Sources say</dt><dd>{finding.recorded}</dd></div>}</dl>}
    </li>)}</ul>}
    <figcaption>{source}</figcaption>
  </figure>;
}
