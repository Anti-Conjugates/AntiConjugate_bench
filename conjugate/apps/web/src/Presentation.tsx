import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type { ViewId } from './navigation';
import { AdcHero } from './AdcHero';
import { PremiseGateAnim } from './PremiseGateAnim';
import { verdictLabels } from './labels';
import { prefersReducedMotion, useRevealOnScroll } from './motion';
import { BaitFigure, EnvironmentFigure, HarnessFigure, PremiseFigure, RatioBar } from './figures';
import { BaitSideBySide, BenchmarkPanel } from './PresentationBenchmark';
import { PRESENTATION_SECTIONS, labelSourceName, loadPresentationData, type PresentationData } from './presentationData';
import { loadBenchmark } from './benchmarkArtifact';

type Verdict = keyof typeof verdictLabels;
const asVerdict = (value: string): Verdict => {
  if (!(value in verdictLabels)) throw new Error(`Unknown recorded verdict ${value}`);
  return value as Verdict;
};
const num = (fraction: string) => fraction.split('/').map(Number) as [number, number];

function ViewLink({ view, onNavigate, className = 'landing-link', children }: { view: ViewId; onNavigate: (view: ViewId) => void; className?: string; children: ReactNode }) {
  return <a href={`#${view}`} className={className} onClick={event => { event.preventDefault(); onNavigate(view); }}>{children}</a>;
}

/** Wide and tall drawings of the same figure; CSS shows one. The wrapper plays the entry animation once, only when motion is allowed. */
function Figure({ wide, tall, caption }: { wide: ReactNode; tall?: ReactNode; caption: ReactNode }) {
  const [ref, state] = useRevealOnScroll<HTMLElement>();
  return <figure className="pres-figure" ref={ref} data-play={state === 'static' ? undefined : state}>
    <div className={tall ? 'pf-wide' : undefined}>{wide}</div>
    {tall && <div className="pf-tall">{tall}</div>}
    <figcaption>{caption}</figcaption>
  </figure>;
}

function Section({ id, index, kicker, title, children, figure }: { id: string; index: number; kicker: string; title: ReactNode; children: ReactNode; figure: ReactNode }) {
  return <section id={id} className="pres-section" aria-labelledby={`${id}-heading`}>
    <div className="pres-copy">
      <p className="pres-kicker"><span className="beat-num">{String(index + 1).padStart(2, '0')}</span>{kicker}</p>
      <h2 id={`${id}-heading`} tabIndex={-1}>{title}</h2>
      {children}
    </div>
    <div className="pres-exhibit">{figure}</div>
  </section>;
}

const EDITABLE = 'input, textarea, select, [contenteditable="true"], [role="region"], [role="grid"], details';
/** Next or previous section start relative to the viewport top; null at either end. */
export function sectionTarget(tops: readonly number[], direction: 1 | -1, offset = 72): number | null {
  if (direction === 1) { const index = tops.findIndex(top => top > offset + 8); return index < 0 ? null : index; }
  for (let index = tops.length - 1; index >= 0; index -= 1) if (tops[index]! < offset - 8) return index;
  return null;
}
const NEXT_KEYS = new Set(['PageDown', 'ArrowDown', 'ArrowRight']);
const PREV_KEYS = new Set(['PageUp', 'ArrowUp', 'ArrowLeft']);

function jumpTo(id: string) {
  const node = document.getElementById(id);
  if (!node) return;
  node.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  node.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

function useSectionKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const direction = NEXT_KEYS.has(event.key) ? 1 : PREV_KEYS.has(event.key) ? -1 : 0;
      if (!direction) return;
      if (event.target instanceof Element && event.target.closest(EDITABLE)) return;
      const tops = PRESENTATION_SECTIONS.map(section => document.getElementById(section.id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY);
      const index = sectionTarget(tops, direction);
      if (index === null) return;
      event.preventDefault();
      jumpTo(PRESENTATION_SECTIONS[index]!.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function SectionNav() {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => {
      const hit = entries.find(entry => entry.isIntersecting);
      if (hit) setActive(PRESENTATION_SECTIONS.findIndex(section => section.id === hit.target.id));
    }, { rootMargin: '-40% 0px -55% 0px' });
    PRESENTATION_SECTIONS.forEach(section => { const node = document.getElementById(section.id); if (node) io.observe(node); });
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const section = PRESENTATION_SECTIONS[active];
    if (!section) return;
    const link = document.querySelector<HTMLElement>(`.pres-nav a[href="#${section.id}"]`);
    const list = link?.closest('ol');
    if (!link || !list) return;
    const linkBox = link.getBoundingClientRect(), listBox = list.getBoundingClientRect();
    list.scrollLeft += linkBox.left - listBox.left - (listBox.width - linkBox.width) / 2;
  }, [active]);
  const shown = Math.max(active, 0);
  return <nav className="pres-nav" aria-label="Presentation sections">
    <ol>{PRESENTATION_SECTIONS.map((section, index) => <li key={section.id}>
      <a href={`#${section.id}`} aria-current={active === index ? 'step' : undefined} onClick={event => { event.preventDefault(); jumpTo(section.id); setActive(index); }}>{section.short}</a>
    </li>)}</ol>
    <p className="pres-progress"><span className="sr-only">Section </span>{active < 0 ? 'Start' : `${shown + 1} / ${PRESENTATION_SECTIONS.length}`}</p>
    <span className="pres-progress-bar" aria-hidden="true" style={{ '--p': active < 0 ? 0 : (shown + 1) / PRESENTATION_SECTIONS.length } as CSSProperties} />
  </nav>;
}

function FailureCard({ title, artifact, children, bar, view, onNavigate }: { title: string; artifact: string; children: ReactNode; bar?: { label: string; value: string; tone: 'ok' | 'bad' }; view?: ViewId; onNavigate: (view: ViewId) => void }) {
  const id = `fail-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const [count, total] = bar ? num(bar.value) : [0, 0];
  return <li className="pres-card">
    <h3>{title}</h3>
    <p>{children}</p>
    {bar && <div className="pres-card-bar"><RatioBar id={id} label={bar.label} count={count} total={total} tone={bar.tone} /><span>{bar.value} {bar.label}</span></div>}
    <p className="pres-cite">From <code>{artifact}</code>{view && <> · <ViewLink view={view} onNavigate={onNavigate}>open</ViewLink></>}</p>
  </li>;
}

export function Presentation({ onNavigate, data: given }: { onNavigate: (view: ViewId) => void; data?: PresentationData }) {
  const data = useMemo(() => given ?? loadPresentationData(loadBenchmark()), [given]);
  useSectionKeys();
  const { environment: env, harness, premise, bait, failures: f } = data;
  const finding = premise.report.findings[0];
  const { labelProducts } = env;
  const kadcylaVerdict = asVerdict(premise.kadcylaVerdict.verdict);
  const enhertuVerdict = asVerdict(premise.enhertuLive.verdict);
  const premiseFigure = (variant: 'wide' | 'tall') => <PremiseFigure variant={variant} question={premise.question} stated={finding?.stated ?? ''} recorded={finding?.recorded ?? ''} check={finding?.check ?? ''} verdict={kadcylaVerdict} cited={premise.kadcylaVerdict.source_ids.map(labelSourceName)} />;
  const baitFigure = (variant: 'wide' | 'tall') => <BaitFigure variant={variant} invented={bait.invented} fakeNct={bait.fakeNct} receipt={bait.receipt} modelCalls={bait.modelCalls} />;
  const envFigure = (variant: 'wide' | 'tall') => <EnvironmentFigure variant={variant} workbookRecords={env.workbookRecords} labelProducts={labelProducts} sources={env.sources} />;

  return <div className="landing pres">
    <header className="pres-hero">
      <p className="landing-kicker">Antibody-drug conjugates · research prototype</p>
      <h1>Trust less.<br /><em>Check more.</em></h1>
      <p className="hero-lede">Research agents fail in ways that read well. Conjugate is a small harness around Claude where code, not the model, decides what counts as evidence. This page walks through it in eight sections, using only recorded runs.</p>
      <p className="pres-keys">Presenting? <kbd>PageDown</kbd> or <kbd>↓</kbd> jumps to the next section, <kbd>PageUp</kbd> or <kbd>↑</kbd> goes back.</p>
      <div className="hero-actions">
        <a className="hero-primary" href={`#${PRESENTATION_SECTIONS[0].id}`} onClick={event => { event.preventDefault(); jumpTo(PRESENTATION_SECTIONS[0].id); }}>Start <ArrowRight size={18} aria-hidden="true" /></a>
        <ViewLink view="chat" onNavigate={onNavigate} className="hero-secondary">Skip to the research chat</ViewLink>
      </div>
    </header>

    <SectionNav />

    <Section id="p-problem" index={0} kicker="The problem" title="Research agents sound sure of themselves when they are wrong."
      figure={<><AdcHero /><p className="pres-cite">An antibody-drug conjugate: an antibody that finds the cancer cell, a linker, and a toxic payload. The questions in this demo are about how these parts are recorded.</p></>}>
      <p>Ask an agent about antibody-drug conjugates and it will answer in fluent paragraphs. Some of those paragraphs describe ADCs that do not exist, cite trials that were never registered, or go along with a wrong fact hidden in the question. Give it a score to chase and it learns the score, not the chemistry.</p>
      <ul className="pres-list">
        <li><strong>Invented products.</strong> A made-up drug name gets a confident description.</li>
        <li><strong>Fake citations.</strong> An NCT number or PMID that resolves to nothing.</li>
        <li><strong>False premises.</strong> “Since the linker is cleavable…” when it is not.</li>
        <li><strong>Proxy hacking.</strong> A high score for a molecule that cannot do the job.</li>
      </ul>
      <p className="pres-thesis">Thesis: don’t grade the agent’s prose. Make code check each claim against a source you can show, and record every failure.</p>
    </Section>

    <Section id="p-environment" index={1} kicker="The environment" title="What the agent is allowed to touch."
      figure={<Figure wide={envFigure('wide')} tall={envFigure('tall')} caption={<>Example receipts from the recorded live run in <code>evals/live-retrieval.json</code> ({f.live.generatedAt.slice(0, 10)}).</>} />}>
      <p>Two local files: an ADCdb workbook snapshot with {env.workbookRecords} ADCs, and short draft paraphrases of the UK labels for {labelProducts.join(' and ')}. That is the evidence the verifier can cite.</p>
      <p>On top of that, {env.sources.length} live sources: {env.sources.map(source => source.name).join(', ')}. Each is reached through one fixed URL template written in code. The model never picks a URL. Every fetch leaves a receipt with the HTTP status and a SHA-256 of the body, including the ones that fail.</p>
      <p className="pres-aside">You can ask about any of the {env.scopedProducts} workbook ADCs. Only {labelProducts.join(' and ')} have label text; for the rest the agent has the workbook composition plus an ADCdb lookup, and openFDA and DailyMed only for the {env.usLabelProducts} with a recorded US label name.</p>
      <p className="pres-aside">Live lookups only answer “does this id exist?” and “does this record match the snapshot?”. They are never used as clinical evidence.</p>
    </Section>

    <Section id="p-harness" index={2} kicker="The harness" title="Code decides. The model only suggests."
      figure={<Figure wide={<HarnessFigure variant="wide" />} tall={<HarnessFigure variant="tall" />} caption={<>Node order from the LangGraph team in <code>evals/team-live.json</code>: <code>{harness.teamGraph}</code></>} />}>
      <p>Every turn starts with two plain-code checks. The scope gate stops questions about doses or who should get a drug. The premise gate compares the facts stated in the question with the workbook. If either stops the turn, no model is called.</p>
      <p>Otherwise a Claude lead picks which checks to run, by id, and Claude workers run them in parallel. A deterministic verifier writes every verdict. An omission gate keeps any check the lead skipped visible on the answer. Models never write verdicts.</p>
      <p className="pres-aside">Two ways to run it: a single Claude agent ({harness.chatLiveComplete}/{harness.chatLiveRows} recorded live chat turns finished) or the LangGraph team with a lead and workers (capped at {harness.leadCap} lead and {harness.workerCap} worker calls, {harness.retries} retries; {harness.teamLiveRefused}/{harness.teamLiveRows} recorded live team runs were refused by Claude and kept as failures).</p>
    </Section>

    <Section id="p-premise" index={3} kicker="Demo 1 · false premise" title="“Kadcyla has a cleavable linker…”"
      figure={<>
        <Figure wide={premiseFigure('wide')} tall={premiseFigure('tall')} caption={<>Premise gate output from <code>evals/premise-study.json</code>; verdict from <code>evals/results.json</code>.</>} />
        <PremiseGateAnim question={premise.question} report={premise.report} source={<>Recorded premise-gate report for this exact question, <code>evals/premise-study.json</code>.</>} />
      </>}>
      <p>Kadcyla’s linker is recorded as non-cleavable (SMCC). The premise gate catches the mismatch before any model call and shows it to the user.</p>
      <p>The claim is still checked. The verifier read the sources and returned <strong>{verdictLabels[kadcylaVerdict]}</strong>, citing {premise.kadcylaVerdict.source_ids.map(labelSourceName).join(', ') || 'nothing'}. In the offline chat replay the same turn made {premise.kadcylaChat.modelCalls} model calls and read {premise.kadcylaChat.sourceReads} sources.</p>
      <dl className="pres-facts">
        <div><dt>Same idea, true premise (Enhertu), live single agent</dt><dd>{verdictLabels[enhertuVerdict]} · {premise.enhertuLive.modelCalls} model calls · <code>evals/chat-live.json</code></dd></div>
        <div><dt>Same Enhertu question, live agent team</dt><dd>{premise.teamLinker.status}{premise.teamLinker.code ? ` (${premise.teamLinker.code})` : ''}, not retried · <code>evals/team-live.json</code></dd></div>
      </dl>
      <ViewLink view="chat" onNavigate={onNavigate}>Ask it yourself in the research chat <ArrowRight size={16} aria-hidden="true" /></ViewLink>
    </Section>

    <Section id="p-bait" index={4} kicker="Demo 2 · hallucination bait" title="An ADC that doesn’t exist and a trial that was never registered."
      figure={<><Figure wide={baitFigure('wide')} tall={baitFigure('tall')} caption={<>Gate decisions from <code>evals/premise-study.json</code>; receipt from <code>evals/live-retrieval.json</code>.</>} /><BaitSideBySide load={data.benchmark} /></>}>
      <p>We ask about “Zentrovab-7”, which we made up, and about {bait.receipt.subject}, a trial id that does not exist. The premise gate stops both before Claude sees them: {bait.modelCalls} model calls.</p>
      <p>When live retrieval is on, the trial id is looked up on ClinicalTrials.gov through the fixed template. The recorded receipt says HTTP {bait.receipt.http}, <code>{bait.receipt.status}</code>. A real id ({bait.realReceipt.subject}) came back HTTP {bait.realReceipt.http}. Existence alone is never treated as evidence.</p>
      <p className="pres-aside">The panel below compares plain Claude with the harness on the same bait, using rows from the benchmark file when it exists.</p>
    </Section>

    <Section id="p-benchmark" index={5} kicker="Benchmark" title="Plain Claude against the harness, same questions."
      figure={<BenchmarkPanel load={data.benchmark} />}>
      <p>The benchmark asks plain Claude and the harness the same composition, invented-ADC, fake-reference, false-premise and out-of-scope questions, and records what each one did: answered correctly, declined, flagged the premise, bluffed, or made up a citation.</p>
      <p>Counts come straight from <code>evals/benchmark.json</code>. If that file is missing or does not match the shared schema, this section says so instead of showing numbers.</p>
    </Section>

    <Section id="p-failures" index={6} kicker="What went wrong" title="Failures we hit while building this, kept in the record."
      figure={<ul className="pres-cards">
        <FailureCard title="Claude refused, and we kept the row" artifact="evals/team-live.json, evals/chat-live.json" bar={{ label: 'live team runs refused', value: f.refusals.team, tone: 'bad' }} onNavigate={onNavigate} view="evals">
          Anthropic’s API sometimes stops with a refusal and no text. Those runs are recorded as failed ({f.refusals.chat} live chat turns, {f.refusals.team} live team runs) with {f.refusals.retries} retries and no fallback answer.
        </FailureCard>
        <FailureCard title="Our own verifier was wrong" artifact="evals/verifier-before-fix.json" bar={{ label: 'valid controls accepted before the fix', value: f.keyOrder.before, tone: 'bad' }} onNavigate={onNavigate} view="evals">
          The first run rejected good answers because comparing sources depended on JSON key order. After the fix it accepted {f.keyOrder.after}. The broken run stays in the repo.
        </FailureCard>
        <FailureCard title="A shortcut matched the contract" artifact="evals/selection-study.json" bar={{ label: 'scopes passed by an eligibility-flag baseline', value: f.shortcut.eligibleOnly, tone: 'bad' }} onNavigate={onNavigate} view="evals">
          Picking records by their eligibility flag alone passes every scope, as does picking by record kind ({f.shortcut.kindOnly}). Claude drafts were accepted {f.shortcut.mapped} with the citation mapping supplied and {f.shortcut.unmapped} without it.
        </FailureCard>
        <FailureCard title="Some broken verifiers survived" artifact="evals/verifier-study.json" bar={{ label: 'deliberately broken verifiers caught', value: f.mutants.caught, tone: 'ok' }} onNavigate={onNavigate} view="evals">
          We switched checks off one at a time. Survivors: {f.mutants.survivors.map(name => name.replaceAll('_', ' ')).join(', ')}. Another check covers each, so {f.mutants.escaped} faults got through, but the overlap means those checks are untested on their own.
        </FailureCard>
        <FailureCard title="A proxy score of 1.00 for a useless molecule" artifact="data/model_observations.json, evals/models.json" onNavigate={onNavigate} view="models">
          A LinkerGPT-style clipped proxy reward gives the “{f.proxy.name}” a score of {f.proxy.reward?.toFixed(2)} with {f.proxy.handles} attachment points, the same as {f.proxy.sameScoreTwoHandle} two-handle fragments. A separate graph check catches it.
        </FailureCard>
        <FailureCard title="Withholding a source flips the verdict" artifact="evals/results.json" bar={{ label: 'verdicts changed when labels were withheld', value: f.withholding.changed, tone: 'bad' }} onNavigate={onNavigate} view="audit">
          With the Enhertu label paraphrase the linker claim is {verdictLabels[asVerdict(f.withholding.withLabel)]}. With the workbook only it becomes {verdictLabels[asVerdict(f.withholding.workbookOnly)]}. An agent that hides a source can change the answer without lying.
        </FailureCard>
        <FailureCard title="Live sources drift and go missing" artifact="evals/live-retrieval.json" bar={{ label: 'live lookups returned ok', value: `${f.live.ok}/${f.live.total}`, tone: 'ok' }} onNavigate={onNavigate} view="evals">
          One recorded run: {f.live.ok} ok, {f.live.not_found} not found (the planted fake ids), {f.live.drift} drift, {f.live.error} errors. Drift and errors are reported as receipts, never patched from the snapshot.
        </FailureCard>
      </ul>}>
      <p>A demo that only shows wins is hiding something. These are the real problems we found, each with the file it came from.</p>
      <p>Some are model behaviour, some are bugs in our own checks, and some are holes in the design that a shortcut could use.</p>
      <ViewLink view="evals" onNavigate={onNavigate}>All evals, including the ones that got through <ArrowRight size={16} aria-hidden="true" /></ViewLink>
    </Section>

    <Section id="p-limits" index={7} kicker="Limits" title="What this is not."
      figure={<div className="pres-limits">
        <h3>From the artifacts themselves</h3>
        <ul className="pres-small-list">{[data.limits.chat[0], data.limits.team[2], data.limits.live[2], data.limits.models[2], data.limits.premise[1]].filter((item): item is string => Boolean(item)).map(item => <li key={item}>{item}</li>)}</ul>
      </div>}>
      <ul className="pres-list">
        <li>Not clinically validated. No pharmacist or clinician has reviewed the label paraphrases; clinical release is blocked in every run.</li>
        <li>No prescribing, dose or treatment-selection advice. Those questions stop at the scope gate.</li>
        <li>No calibrated confidence. Probabilities stay null; counts are software coverage, not a chance of being right.</li>
        <li>Small n: {data.limits.premiseCases} premise-gate cases, {data.harness.chatLiveRows} recorded live chat turns, {data.harness.teamLiveRows} live team runs, label text for {data.environment.labelProducts.length} products. Developer-written fixtures, not an unseen holdout.</li>
        <li>Model scores (proxy rewards, ESM-2 similarity, AlphaFold DB confidence) are proxies, not ADC performance.</li>
        <li>OpenFold and AlphaFold 3 were not run.</li>
      </ul>
    </Section>

    <section className="tool-band" aria-labelledby="pres-tools-heading">
      <h2 id="pres-tools-heading">Open the workbench</h2>
      <div className="tool-grid">
        {([['chat', 'Research chat', 'Ask in plain English; every answer is a checked audit.'], ['audit', 'Check a claim', 'Withhold a source or plant a bad citation.'], ['evals', 'Evals', 'Every test, including the failures.'], ['models', 'Linker lab', 'Chemistry checks and the proxy-score trap.']] as const).map(([view, title, text]) =>
          <ViewLink key={view} view={view} onNavigate={onNavigate} className="tool-card"><strong>{title}</strong><span>{text}</span></ViewLink>)}
      </div>
    </section>
  </div>;
}
