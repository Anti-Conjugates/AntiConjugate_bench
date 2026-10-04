import { useState, type ReactNode } from 'react';
import { ArrowRight, FileCheck2, FlaskConical, ListChecks, MessageSquare, Table2, Workflow } from 'lucide-react';
import results from '../../../evals/results.json';
import verifier from '../../../evals/verifier-study.json';
import selection from '../../../evals/selection-study.json';
import { verdictLabels } from './labels';
import type { ViewId } from './navigation';

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

export function landingStats() {
  const shortcuts = results.strategies.rows.filter(row => row.strategy !== 'honest_expected');
  const survivors = shortcuts.filter(row => row.accepted);
  const mapped = selection.arms.find(arm => arm.arm === 'mapped');
  const unmapped = selection.arms.find(arm => arm.arm === 'unmapped');
  return {
    faults: `${results.drills.rejected_count}/${results.drills.total}`,
    shortcuts: `${shortcuts.length - survivors.length}/${shortcuts.length}`,
    survivors: survivors.length,
    mutants: `${verifier.mutants_detected}/${verifier.mutant_count}`,
    mapped: mapped ? `${mapped.accepted}/${mapped.attempts}` : 'not run',
    unmapped: unmapped ? `${unmapped.accepted}/${unmapped.attempts}` : 'not run',
  };
}

function AdcSchematic() {
  return <figure className="adc-figure">
    <svg viewBox="0 0 420 360" role="img" aria-labelledby="adc-title adc-desc" className="adc-svg">
      <title id="adc-title">Antibody-drug conjugate, drawn as a schematic</title>
      <desc id="adc-desc">A Y-shaped antibody with small drug molecules attached by linkers. Labels mark the antibody, which recognises HER2, the linker, and the payload. Not to scale and not a molecular structure.</desc>
      <defs>
        <linearGradient id="adc-arm" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#7fb2ff" /><stop offset="1" stopColor="#3b6fd8" /></linearGradient>
        <radialGradient id="adc-glow"><stop offset="0" stopColor="#c8ff4d" stopOpacity=".9" /><stop offset="1" stopColor="#c8ff4d" stopOpacity="0" /></radialGradient>
      </defs>
      <g className="adc-orbit" aria-hidden="true">
        <circle cx="210" cy="190" r="150" />
        <circle cx="210" cy="190" r="110" />
      </g>
      <g className="adc-antibody">
        <path d="M196 330 L196 200 L120 96" />
        <path d="M224 330 L224 200 L300 96" />
        <path d="M172 214 L106 124" className="adc-light" />
        <path d="M248 214 L314 124" className="adc-light" />
      </g>
      <g className="adc-target" aria-hidden="true">
        <circle cx="108" cy="78" r="9" /><circle cx="312" cy="78" r="9" />
      </g>
      {[[196, 262, 132, 262], [224, 262, 288, 262], [196, 306, 140, 318], [224, 306, 280, 318]].map(([x1, y1, x2, y2], index) => <g key={index} className="adc-drug">
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="adc-linker" />
        <circle cx={x2} cy={y2} r="22" fill="url(#adc-glow)" className="adc-halo" />
        <polygon points={hexagon(x2!, y2!, 10)} className="adc-payload" />
      </g>)}
      <g className="adc-labels">
        <text x="20" y="40">Antibody</text><text x="20" y="58" className="adc-sub">trastuzumab, binds HER2</text>
        <text x="300" y="250">Linker</text><text x="300" y="268" className="adc-sub">holds the drug on</text>
        <text x="20" y="300">Payload</text><text x="20" y="318" className="adc-sub">DM1 or DXd</text>
      </g>
    </svg>
    <figcaption>Schematic only. Not a molecular structure or a model prediction.</figcaption>
  </figure>;
}

function hexagon(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
}

function Exhibit({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const [policy, setPolicy] = useState<Policy>('all');
  const row = exhibitRow(policy);
  const full = exhibitRow('all');
  const missing = full.receipts_read.filter(id => !row.receipts_read.includes(id));
  return <section className="exhibit" aria-labelledby="exhibit-heading">
    <div className="exhibit-copy">
      <p className="landing-kicker">Recorded example</p>
      <h2 id="exhibit-heading">Take one source away. Watch the answer change.</h2>
      <p>Same claim, same rules, same verifier. Remove the label summaries and the app stops claiming anything. That is how you see what an answer rests on.</p>
      <ViewLink view="audit" onNavigate={onNavigate} className="landing-link">Run it yourself in Check a claim <ArrowRight size={16} aria-hidden="true" /></ViewLink>
    </div>
    <div className="exhibit-card">
      <div className="exhibit-toggle" role="group" aria-label="Sources available">
        {conditions.map(item => <button key={item.policy} type="button" aria-pressed={policy === item.policy} onClick={() => setPolicy(item.policy)}>{item.label}</button>)}
      </div>
      <p className="exhibit-claim"><span>Enhertu (trastuzumab deruxtecan)</span>“A cleavable linker establishes rapid release in blood.”</p>
      <p className={`exhibit-verdict exhibit-${row.verdict}`} aria-live="polite">{verdictLabels[row.verdict]}</p>
      <dl className="exhibit-facts">
        <div><dt>Cited</dt><dd>{row.source_ids.length ? row.source_ids.map(id => sourceNames[id] ?? id).join(', ') : 'Nothing. No source read settles the claim.'}</dd></div>
        <div><dt>Sources read</dt><dd>{row.receipts_read.length} of {full.receipts_read.length}</dd></div>
        <div><dt>Withheld</dt><dd>{missing.length ? missing.map(id => sourceNames[id] ?? id).join(', ') : 'None'}</dd></div>
      </dl>
      <p className="exhibit-note">Rules-only result recorded in <code>evals/results.json</code> ({results.generated_at.slice(0, 10)}). Switching does not call a model.</p>
    </div>
  </section>;
}

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
  return <div className="landing">
    <section className="hero" aria-labelledby="hero-heading">
      <div className="hero-copy">
        <p className="landing-kicker">HER2 antibody-drug conjugates · research prototype</p>
        <h1 id="hero-heading">Trust less.<br /><em>Check more.</em></h1>
        <p className="hero-lede">Conjugate is a research agent that has to show its work. A separate verifier checks every citation and throws out drafts that cheat. Remove a source and you see exactly what each answer depends on.</p>
        <div className="hero-actions">
          <ViewLink view="chat" onNavigate={onNavigate} className="hero-primary">Ask a research question <ArrowRight size={18} aria-hidden="true" /></ViewLink>
          <ViewLink view="evals" onNavigate={onNavigate} className="hero-secondary">See what the evals caught</ViewLink>
        </div>
        <ol className="hero-flow" aria-label="How one answer is made">
          <li><strong>You ask</strong><span>Kadcyla or Enhertu</span></li>
          <li><strong>Agents pick checks</strong><span>ids only, no prose</span></li>
          <li><strong>Tools read sources</strong><span>workbook, labels</span></li>
          <li><strong>Verifier decides</strong><span>or rejects the draft</span></li>
        </ol>
      </div>
      <AdcSchematic />
    </section>

    <Exhibit onNavigate={onNavigate} />

    <section className="stat-band" aria-labelledby="stats-heading">
      <h2 id="stats-heading">What the evals caught</h2>
      <dl className="stat-grid">
        <div><dt>Planted bad citations rejected</dt><dd>{stats.faults}</dd></div>
        <div><dt>Shortcut drafts rejected</dt><dd>{stats.shortcuts}</dd><p>{stats.survivors} “cite everything” drafts got through. They are shown, not hidden.</p></div>
        <div><dt>Deliberately broken verifiers caught</dt><dd>{stats.mutants}</dd><p>The 3 that survived are listed in Evals.</p></div>
        <div><dt>Claude drafts accepted</dt><dd>{stats.mapped}<small> vs {stats.unmapped}</small></dd><p>With the citation mapping supplied, and without it.</p></div>
      </dl>
      <p className="stat-note">Software checks against the app’s own definitions. They test whether the verifier holds, not whether the science is right.</p>
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
