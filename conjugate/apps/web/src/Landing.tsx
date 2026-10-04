import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, FileCheck2, FlaskConical, ListChecks, MessageSquare, Table2, Workflow } from 'lucide-react';
import results from '../../../evals/results.json';
import verifier from '../../../evals/verifier-study.json';
import verifierBeforeFix from '../../../evals/verifier-before-fix.json';
import selection from '../../../evals/selection-study.json';
import harness from '../../../evals/harness.json';
import chatLive from '../../../evals/chat-live.json';
import team from '../../../evals/team.json';
import teamLive from '../../../evals/team-live.json';
import { verdictLabels } from './labels';
import type { ViewId } from './navigation';
import { AdcHero } from './AdcHero';
import { Beat } from './Beat';
import { VerdictSwap } from './VerdictSwap';
import { TeamGraph, stepsFromTrace } from './TeamGraph';
import { PremiseGateAnim, type PremiseReportLike } from './PremiseGateAnim';
import { useRevealOnScroll } from './motion';

/** Real links keep the destinations shareable and keyboard-native; the click handler keeps in-app navigation. */
function ViewLink({ view, onNavigate, className, children }: { view: ViewId; onNavigate: (view: ViewId) => void; className: string; children: ReactNode }) {
  return <a href={`#${view}`} className={className} onClick={event => { event.preventDefault(); onNavigate(view); }}>{children}</a>;
}

const sourceNames: Record<string, string> = {
  'WORKBOOK-DRG0ERKBH-COMPOSITION': 'ADCdb workbook row',
  'UK-ENHERTU-SMPC': 'UK label summary',
  'DERIVED-DRG0ERKBH-NOT-ADCDB': 'Derived note',
  'US-OPENFDA-DRG0ERKBH-IDENTITY': 'US openFDA record',
};

const conditions = [
  { policy: 'all', label: 'All sources' },
  { policy: 'workbook_only', label: 'Workbook only' },
] as const;
type Policy = typeof conditions[number]['policy'];

export function exhibitRow(policy: Policy) {
  const row = results.verdicts.rows.find(item => item.product_id === 'DRG0ERKBH' && item.question_id === 'linker_release' && item.evidence_policy === policy);
  if (!row || !(row.verdict in verdictLabels)) throw new Error(`Missing recorded row for ${policy}`);
  return { ...row, verdict: row.verdict as keyof typeof verdictLabels };
}

const ratio = (count: number, total: number) => `${count}/${total}`;
function liveRow(id: string) {
  const row = chatLive.rows.find(item => item.id === id);
  if (!row) throw new Error(`Missing recorded chat row ${id}`);
  return row;
}
const recordedRuns = [...chatLive.rows, ...team.rows, ...teamLive.rows] as { clinical_release?: string }[];

/** Every number on the landing comes from here, read from evals/*.json at build time. */
export function landingStats() {
  const shortcuts = results.strategies.rows.filter(row => row.strategy !== 'honest_expected');
  const survivors = shortcuts.filter(row => row.accepted);
  const mapped = selection.arms.find(arm => arm.arm === 'mapped');
  const unmapped = selection.arms.find(arm => arm.arm === 'unmapped');
  const survivingMutants = verifier.mutants.filter(mutant => !mutant.detected);
  const finished = recordedRuns.filter(row => row.clinical_release !== undefined);
  const linker = liveRow('linker_counter_evidence');
  const boundary = liveRow('clinical_boundary');
  return {
    faults: ratio(results.drills.rejected_count, results.drills.total),
    shortcuts: ratio(shortcuts.length - survivors.length, shortcuts.length),
    survivors: survivors.length,
    mutants: ratio(verifier.mutants_detected, verifier.mutant_count),
    mapped: mapped ? ratio(mapped.accepted, mapped.attempts) : 'not run',
    unmapped: unmapped ? ratio(unmapped.accepted, unmapped.attempts) : 'not run',
    shiftsChanged: ratio(results.verdicts.changed_count, results.verdicts.total),
    claudeAccepted: ratio(results.claude.accepted, results.claude.total),
    linkerModelCalls: linker.model_calls,
    linkerSourceReads: linker.source_reads,
    boundaryModelCalls: boundary.model_calls,
    teamLiveFailed: ratio(teamLive.rows.filter(row => row.status === 'failed').length, teamLive.rows.length),
    omittedShown: team.rows.filter(row => (row.omitted_checks ?? 0) > 0).length,
    blockedRows: ratio(finished.filter(row => row.clinical_release === 'blocked').length, finished.length),
    survivingMutants: survivingMutants.map(mutant => mutant.name),
    survivorEscapes: survivingMutants.reduce((sum, mutant) => sum + mutant.escaped_faults, 0),
    beforeFixControls: ratio(verifierBeforeFix.controls_accepted, verifierBeforeFix.control_count),
    afterFixControls: ratio(verifier.controls_accepted, verifier.control_count),
    harness: ratio(harness.passed, harness.total),
  };
}

export const BEATS = [
  { id: 'beat-01', short: 'Hook' },
  { id: 'beat-02', short: 'False premise' },
  { id: 'beat-03', short: 'True premise' },
  { id: 'beat-04', short: 'Remove a source' },
  { id: 'beat-05', short: 'Cheating drafts' },
  { id: 'beat-06', short: 'Broken verifier' },
  { id: 'beat-07', short: 'Limits' },
] as const;

/**
 * Hand-written recorded example of the AntiConjugate guardrail (Python) premise check. It is not run by this app.
 * Replace with evals/premise-study.json once that artifact exists.
 */
export const PREMISE_EXAMPLE: { question: string; report: PremiseReportLike } = {
  question: 'Kadcyla has a cleavable linker, so how fast is DM1 released in blood?',
  report: {
    decision: 'flagged',
    findings: [{ kind: 'contradicted_premise', text: 'The question says the Kadcyla linker is cleavable. The recorded composition lists a non-cleavable MCC linker.', stated: 'cleavable linker', recorded: 'non-cleavable MCC linker' }],
  },
};

function StoryRail() {
  const [active, setActive] = useState<string>(BEATS[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => {
      const hit = entries.find(entry => entry.isIntersecting);
      if (hit) setActive(hit.target.id);
    }, { rootMargin: '-45% 0px -50% 0px' });
    BEATS.forEach(beat => { const node = document.getElementById(beat.id); if (node) io.observe(node); });
    return () => io.disconnect();
  }, []);
  return <nav className="story-rail" aria-label="Story">
    <ol>{BEATS.map(beat => <li key={beat.id}><a href={`#${beat.id}`} aria-current={active === beat.id ? 'step' : undefined} onClick={event => { event.preventDefault(); document.getElementById(beat.id)?.scrollIntoView({ block: 'start' }); setActive(beat.id); }}>{beat.short}</a></li>)}</ol>
  </nav>;
}

function Exhibit({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const [policy, setPolicy] = useState<Policy>('all');
  const [ref, reveal] = useRevealOnScroll<HTMLElement>();
  const stats = landingStats();
  const row = exhibitRow(policy);
  const full = exhibitRow('all');
  const missing = full.receipts_read.filter(id => !row.receipts_read.includes(id));
  return <section id="beat-04" ref={ref} className="exhibit beat-exhibit-section" data-beat={reveal === 'static' ? undefined : reveal} aria-labelledby="exhibit-heading">
    <div className="exhibit-copy">
      <p className="rise" style={{ '--i': 0 } as CSSProperties}><span className="beat-num">04</span><span className="beat-kicker">Recorded example</span></p>
      <h2 id="exhibit-heading" className="rise" style={{ '--i': 1 } as CSSProperties}>Take one source away. Watch the answer change.</h2>
      <p className="rise" style={{ '--i': 2 } as CSSProperties}>Same claim, same rules, same verifier. Remove the label summaries and the app stops claiming anything. That is how you see what an answer rests on. Across the recorded grid, {stats.shiftsChanged} answers changed when the labels were withheld.</p>
      <p className="rise beat-aside" style={{ '--i': 3 } as CSSProperties}>Sources are now also retrieved live from openFDA, DailyMed, ClinicalTrials.gov, PubMed and ADCdb, each read stored with a hashed receipt.</p>
      <ViewLink view="audit" onNavigate={onNavigate} className="landing-link">Run it yourself in Check a claim <ArrowRight size={16} aria-hidden="true" /></ViewLink>
    </div>
    <div className="exhibit-card rise" style={{ '--i': 2 } as CSSProperties}>
      <div className="exhibit-toggle" role="group" aria-label="Sources available">
        {conditions.map(item => <button key={item.policy} type="button" aria-pressed={policy === item.policy} onClick={() => setPolicy(item.policy)}>{item.label}</button>)}
      </div>
      <p className="exhibit-claim"><span>Enhertu (trastuzumab deruxtecan)</span>“A cleavable linker establishes rapid release in blood.”</p>
      <VerdictSwap verdict={row.verdict} label={verdictLabels[row.verdict]} className="exhibit-verdict-slot" itemClass={verdict => `exhibit-verdict exhibit-${verdict}`} />
      <ul className="source-chips" aria-label="Sources">
        {full.receipts_read.map(id => <li key={id} className="source-chip" data-withheld={missing.includes(id) || undefined}>{sourceNames[id] ?? id}{missing.includes(id) && <span className="sr-only"> (withheld)</span>}</li>)}
      </ul>
      <dl className="exhibit-facts">
        <div><dt>Cited</dt><dd>{row.source_ids.length ? row.source_ids.map(id => sourceNames[id] ?? id).join(', ') : 'Nothing. No source read settles the claim.'}</dd></div>
        <div><dt>Sources read</dt><dd>{row.receipts_read.length} of {full.receipts_read.length}</dd></div>
        <div><dt>Withheld</dt><dd>{missing.length ? missing.map(id => sourceNames[id] ?? id).join(', ') : 'None'}</dd></div>
      </dl>
      <p className="exhibit-note">Rules-only result recorded in <code>evals/results.json</code> ({results.generated_at.slice(0, 10)}). Switching does not call a model.</p>
    </div>
  </section>;
}

function ShortcutGrid() {
  const rows = results.strategies.rows.filter(row => row.strategy !== 'honest_expected');
  return <div className="dot-grid" role="img" aria-label={`${rows.length} scripted shortcut drafts; ${rows.filter(row => row.accepted).length} got through, the rest were rejected.`}>
    {rows.map((row, index) => <span key={index} className="dot" data-accepted={row.accepted || undefined} style={{ '--i': index % 20 } as CSSProperties} />)}
  </div>;
}

function MutantGrid() {
  return <ol className="mutant-grid" aria-label="Deliberately broken verifiers">
    {verifier.mutants.map((mutant, index) => <li key={mutant.name} data-detected={mutant.detected || undefined} style={{ '--i': index } as CSSProperties}>
      <span className="mutant-name">{mutant.name.replaceAll('_', ' ')}</span><span className="mutant-state">{mutant.detected ? 'caught' : 'survived'}</span>
    </li>)}
  </ol>;
}

const omissionRow = team.rows.find(row => row.id === 'scripted_lead_drops_audit_always');
const boundaryRow = teamLive.rows.find(row => row.id === 'live_clinical_boundary');

const tools = [
  { id: 'chat', icon: MessageSquare, title: 'Research chat', text: 'Ask in plain English. Every answer is a checked audit with its sources.' },
  { id: 'audit', icon: FileCheck2, title: 'Check a claim', text: 'Pick a product and question, withhold a source or plant a bad citation.' },
  { id: 'models', icon: FlaskConical, title: 'Linker lab', text: 'Chemistry checks and ESM-2 sequence observations, kept apart from verdicts.' },
  { id: 'atlas', icon: Table2, title: 'ADC table', text: 'The ADCdb rows behind the demo. Blank cells stay blank.' },
  { id: 'evals', icon: ListChecks, title: 'Evals', text: 'Every fault test and shortcut, including the ones that got through.' },
  { id: 'how', icon: Workflow, title: 'How it works', text: 'Who sees what: Claude, local tools and the verifier.' },
] as const;

export function Landing({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const stats = landingStats();
  const linker = exhibitRow('all');
  const limits = [...results.notes.slice(0, 1), ...verifier.limits.slice(1, 2), ...selection.limits.slice(0, 1), ...teamLive.limitations.slice(1, 2)];
  return <div className="landing">
    <section id="beat-01" className="hero" aria-labelledby="hero-heading">
      <div className="hero-copy">
        <p className="landing-kicker hero-rise" style={{ '--i': 0 } as CSSProperties}>HER2 antibody-drug conjugates · research prototype</p>
        <h1 id="hero-heading" className="hero-rise" style={{ '--i': 1 } as CSSProperties}>Trust less.<br /><em>Check more.</em></h1>
        <p className="hero-lede hero-rise" style={{ '--i': 2 } as CSSProperties}>Conjugate is a research agent that has to show its work. A separate verifier checks every citation and throws out drafts that cheat. Remove a source and you see exactly what each answer depends on.</p>
        <div className="hero-actions hero-rise" style={{ '--i': 3 } as CSSProperties}>
          <ViewLink view="chat" onNavigate={onNavigate} className="hero-primary">Ask a research question <ArrowRight size={18} aria-hidden="true" /></ViewLink>
          <ViewLink view="evals" onNavigate={onNavigate} className="hero-secondary">See what the evals caught</ViewLink>
        </div>
        <ol className="hero-flow hero-rise" style={{ '--i': 4 } as CSSProperties} aria-label="How one answer is made">
          <li><strong>You ask</strong><span>Kadcyla or Enhertu</span></li>
          <li><strong>Agents pick checks</strong><span>ids only, no prose</span></li>
          <li><strong>Tools read sources</strong><span>workbook, labels</span></li>
          <li><strong>Verifier decides</strong><span>or rejects the draft</span></li>
        </ol>
      </div>
      <AdcHero />
    </section>

    <StoryRail />

    <Beat id="beat-02" number="02" kicker="Before any model call" tone="b"
      heading="Start with a question that already contains a mistake."
      lede={<>Kadcyla’s linker is not cleavable. A premise check reads the question against the recorded composition and flags the mistake before Claude sees it. Questions about doses or who should get a drug stop at the scope gate: the recorded live run made {stats.boundaryModelCalls} model calls.</>}
      exhibit={<>
        <p className="recorded-tag">Recorded example</p>
        <PremiseGateAnim question={PREMISE_EXAMPLE.question} report={PREMISE_EXAMPLE.report} source={<>AntiConjugate guardrail (Python), recorded output. Written up by hand; not yet a live check in this app. Its product list is marked unverified.</>} />
        {boundaryRow && 'trace' in boundaryRow && boundaryRow.trace && <TeamGraph steps={stepsFromTrace(boundaryRow.trace)} sequence caption="Live agent team, clinical question: stopped at the scope gate. From evals/team-live.json." />}
      </>} />

    <Beat id="beat-03" number="03" kicker="Only the verifier settles it"
      heading="Now ask it about Enhertu, where the premise is true."
      lede={<>Enhertu’s linker is cleavable, so the premise check has nothing to flag. The wrong step is the inference. The verifier reads the UK label summary, which describes plasma stability and cleavage inside the cell, and marks the claim {verdictLabels[linker.verdict]}. Claude only picks which checks to run; it never writes the verdict.</>}
      exhibit={<div className="beat-card">
        <p className="exhibit-claim"><span>Enhertu (trastuzumab deruxtecan)</span>“A cleavable linker establishes rapid release in blood.”</p>
        <VerdictSwap verdict={linker.verdict} label={verdictLabels[linker.verdict]} className="exhibit-verdict-slot" itemClass={verdict => `exhibit-verdict exhibit-${verdict}`} />
        <dl className="beat-facts">
          <div><dt>Model calls</dt><dd>{stats.linkerModelCalls}</dd></div>
          <div><dt>Sources read</dt><dd>{stats.linkerSourceReads}</dd></div>
          <div><dt>Claude drafts accepted, fixed grid</dt><dd>{stats.claudeAccepted}</dd></div>
          <div><dt>Live agent-team turns failed</dt><dd>{stats.teamLiveFailed}</dd></div>
        </dl>
        <p className="exhibit-note">From <code>evals/chat-live.json</code> and <code>evals/team-live.json</code>. The same question to the live agent team was refused by Claude; that failure is recorded, not retried.</p>
      </div>}>
    </Beat>

    <Exhibit onNavigate={onNavigate} />

    <Beat id="beat-05" number="05" kicker="Scripted drafts, real verifier" tone="b"
      heading="Drafts that cheat get thrown out. Checks that go missing stay visible."
      lede={<>We planted bad citations and scripted shortcut drafts. The verifier rejected {stats.faults} planted citations and {stats.shortcuts} shortcuts. {stats.survivors} “cite everything” drafts got through, and they are shown. When the lead agent drops a check, the omission gate keeps it on the answer instead of hiding it.</>}
      exhibit={<div className="beat-card beat-card-dark">
        <ShortcutGrid />
        <p className="exhibit-note">Each dot is one scripted shortcut draft. Lit dots got through. From <code>evals/results.json</code>.</p>
        {omissionRow?.trace && <TeamGraph steps={stepsFromTrace(omissionRow.trace)} sequence caption="Scripted lead drops a check every time: the omission gate sends it back, then records it as missing. From evals/team.json." />}
        <p className="exhibit-note">Claude drafts accepted with the citation mapping supplied: {stats.mapped}; without it: {stats.unmapped}.</p>
      </div>} />

    <Beat id="beat-06" number="06" kicker="Testing the tester"
      heading="We broke the verifier on purpose."
      lede={<>Each broken copy switches off one or more checks. {stats.mutants} were caught. The ones that survived ({stats.survivingMutants.map(name => name.replaceAll('_', ' ')).join(', ')}) switch off a check another check also covers, and let {stats.survivorEscapes} faults through. An earlier version accepted only {stats.beforeFixControls} honest controls; after the fix it accepts {stats.afterFixControls}.</>}
      exhibit={<div className="beat-card beat-card-dark">
        <MutantGrid />
        <p className="exhibit-note">From <code>evals/verifier-study.json</code> and <code>evals/verifier-before-fix.json</code>. Harness checks passing: {stats.harness}.</p>
      </div>} />

    <section id="beat-07" className="stat-band" aria-labelledby="stats-heading">
      <p><span className="beat-num">07</span><span className="beat-kicker">Read the numbers for what they are</span></p>
      <h2 id="stats-heading">What the evals caught</h2>
      <dl className="stat-grid">
        <div><dt>Planted bad citations rejected</dt><dd>{stats.faults}</dd></div>
        <div><dt>Shortcut drafts rejected</dt><dd>{stats.shortcuts}</dd><p>{stats.survivors} “cite everything” drafts got through. They are shown, not hidden.</p></div>
        <div><dt>Deliberately broken verifiers caught</dt><dd>{stats.mutants}</dd><p>The {stats.survivingMutants.length} that survived are listed in Evals.</p></div>
        <div><dt>Claude drafts accepted</dt><dd>{stats.mapped}<small> vs {stats.unmapped}</small></dd><p>With the citation mapping supplied, and without it.</p></div>
      </dl>
      <p className="stat-note">Software checks against the app’s own definitions. They test whether the verifier holds, not whether the science is right. Clinical release stayed blocked in {stats.blockedRows} recorded runs that finished.</p>
      <ul className="limit-list">{limits.map(limit => <li key={limit}>{limit}</li>)}</ul>
    </section>

    <section className="tool-band" aria-labelledby="tools-heading">
      <h2 id="tools-heading">Open the workbench</h2>
      <div className="tool-grid">
        {tools.map(({ id, icon: Icon, title, text }) => <ViewLink key={id} view={id} onNavigate={onNavigate} className="tool-card">
          <Icon size={20} strokeWidth={1.6} aria-hidden="true" /><strong>{title}</strong><span>{text}</span>
        </ViewLink>)}
      </div>
    </section>

    <footer className="landing-footer">
      <p>Two products, five questions, synthetic use only. No doses, no eligibility, no confidence scores. OpenFold and ESMFold have not been run.</p>
    </footer>
  </div>;
}
