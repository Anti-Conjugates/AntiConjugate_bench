import type { CSSProperties, ReactNode } from 'react';
import { verdictLabels } from './labels';

/** Same values as the dark landing palette in styles.css; inlined so exported SVG files render on their own. */
export const PALETTE = {
  bg: '#0b1216', panel: '#121d24', raised: '#18242c', line: '#2c3d47', lineStrong: '#6b7c86',
  ink: '#eef3f4', fog: '#c9d4d8', fog2: '#9aa9b0', lime: '#c8ff4d', sky: '#7fb2ff', copper: '#f0a974', ok: '#7fe0a8', bad: '#ff9a85',
} as const;
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

type Kind = 'code' | 'model' | 'source' | 'stop' | 'out' | 'plain';
const STROKE: Record<Kind, string> = { code: PALETTE.lime, model: PALETTE.sky, source: PALETTE.copper, stop: PALETTE.bad, out: PALETTE.ok, plain: PALETTE.lineStrong };
export type Variant = 'wide' | 'tall';

/** Word wrap by character count; SVG text does not wrap by itself. */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

function Svg({ id, width, height, title, desc, children, className = '' }: { id: string; width: number; height: number; title: string; desc: string; children: ReactNode; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-labelledby={`${id}-title ${id}-desc`} className={`pf-svg ${className}`.trim()} fontFamily={SANS}>
    <title id={`${id}-title`}>{title}</title>
    <desc id={`${id}-desc`}>{desc}</desc>
    <defs>
      <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill={PALETTE.lineStrong} /></marker>
      <marker id={`${id}-arrow-bad`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill={PALETTE.bad} /></marker>
    </defs>
    <rect width={width} height={height} rx="10" fill={PALETTE.bg} />
    {children}
  </svg>;
}

function Box({ x, y, w, h, kind, title, lines = [], n = 0, titleSize = 15, lineSize = 12.5, mono = false }: { x: number; y: number; w: number; h: number; kind: Kind; title: string; lines?: string[]; n?: number; titleSize?: number; lineSize?: number; mono?: boolean }) {
  const top = y + (h - (titleSize + lines.length * (lineSize + 4))) / 2 + titleSize - 2;
  return <g className="pf-node" style={{ '--n': n } as CSSProperties}>
    <rect x={x} y={y} width={w} height={h} rx="8" fill={PALETTE.panel} stroke={STROKE[kind]} strokeWidth="1.6" strokeDasharray={kind === 'model' ? '5 3' : undefined} />
    <text x={x + w / 2} y={top} textAnchor="middle" fill={PALETTE.ink} fontSize={titleSize} fontWeight="600">{title}</text>
    {lines.map((line, i) => <text key={i} x={x + w / 2} y={top + (i + 1) * (lineSize + 4)} textAnchor="middle" fill={PALETTE.fog2} fontSize={lineSize} fontFamily={mono ? MONO : undefined}>{line}</text>)}
  </g>;
}

function Arrow({ id, d, bad = false, label, lx, ly, anchor = 'middle' }: { id: string; d: string; bad?: boolean; label?: string; lx?: number; ly?: number; anchor?: 'start' | 'middle' | 'end' }) {
  return <g>
    <path className="pf-flow" d={d} fill="none" stroke={bad ? PALETTE.bad : PALETTE.lineStrong} strokeWidth="1.6" markerEnd={`url(#${id}-${bad ? 'arrow-bad' : 'arrow'})`} />
    {label && <text x={lx} y={ly} textAnchor={anchor} fill={bad ? PALETTE.bad : PALETTE.fog2} fontSize="12">{label}</text>}
  </g>;
}

function Legend({ x, y, items }: { x: number; y: number; items: { kind: Kind; label: string }[] }) {
  let offset = 0;
  return <g fontSize="12.5">{items.map(item => {
    const at = offset; offset += 34 + item.label.length * 7;
    return <g key={item.label} transform={`translate(${x + at} ${y})`}>
      <rect width="22" height="14" y="-11" rx="3" fill={PALETTE.panel} stroke={STROKE[item.kind]} strokeWidth="1.6" strokeDasharray={item.kind === 'model' ? '4 2' : undefined} />
      <text x="28" fill={PALETTE.fog}>{item.label}</text>
    </g>;
  })}</g>;
}

/* ---------------------------------------------------------------- environment */

export interface EnvSource { id: string; name: string; host: string; example_url: string; example_status: string; example_http: number | null; example_sha256: string | null; subject?: string }
export interface EnvironmentFigureProps { workbookRecords: number; labelProducts: string[]; sources: EnvSource[]; variant?: Variant }

/** "clinicaltrials.gov/api/v2/studies/NCT03529110?..." -> host + path with the looked-up id shown as {id}. */
export function urlTemplate(url: string, subject?: string): { host: string; path: string } {
  const parsed = new URL(url);
  let path = parsed.pathname;
  const id = subject?.replace(/^PMID:/, '');
  if (id && path.includes(id)) path = path.replace(id, '{id}');
  const query = [...parsed.searchParams.keys()].length ? '?' + [...parsed.searchParams.keys()].map(key => `${key}=…`).join('&') : '';
  return { host: parsed.host, path: path + query };
}
const clip = (text: string, max: number) => text.length > max ? text.slice(0, Math.max(max - 1, 0)) + '…' : text;
const short = (sha: string | null) => sha ? sha.slice(0, 12) + '…' : 'no hash';

export function EnvironmentFigure({ workbookRecords, labelProducts, sources, variant = 'wide' }: EnvironmentFigureProps) {
  const id = `fig-env-${variant}`;
  const title = 'What the agent is allowed to touch';
  const desc = `Local files: the ADCdb workbook snapshot with ${workbookRecords} ADCs and draft label paraphrases for ${labelProducts.join(' and ')}. Live sources: ${sources.map(s => s.name).join(', ')}. Each live source is reached only through a fixed URL template written in code, and every fetch leaves a receipt with its HTTP status and a SHA-256 hash.`;
  const local = `${workbookRecords} ADCs · ADCdb workbook`;
  if (variant === 'tall') {
    const rowH = 118, top = 196;
    const height = top + sources.length * rowH + 50;
    return <Svg id={id} width={360} height={height} title={title} desc={desc}>
      <text x="20" y="34" fill={PALETTE.lime} fontSize="12" fontFamily={MONO} letterSpacing="1">LOCAL, NO NETWORK</text>
      <Box x={20} y={46} w={320} h={56} kind="source" title="ADCdb workbook snapshot" lines={[`${workbookRecords} ADCs`]} />
      <Box x={20} y={112} w={320} h={56} kind="source" title="Label paraphrases" lines={[labelProducts.join(', ') + ' · draft text']} n={1} />
      <text x="20" y={top - 8} fill={PALETTE.lime} fontSize="12" fontFamily={MONO} letterSpacing="1">LIVE, FIXED TEMPLATES</text>
      {sources.map((source, i) => {
        const y = top + i * rowH; const t = urlTemplate(source.example_url, source.subject);
        return <g key={source.id}>
          <Box x={20} y={y + 4} w={320} h={34} kind="source" title={source.name} n={i + 2} titleSize={14} />
          <text x="30" y={y + 58} fill={PALETTE.fog} fontSize="11.5" fontFamily={MONO}>{t.host}</text>
          <text x="30" y={y + 74} fill={PALETTE.fog2} fontSize="11" fontFamily={MONO}>{t.path.length > 44 ? t.path.slice(0, 43) + '…' : t.path}</text>
          <text x="30" y={y + 96} fill={source.example_status === 'ok' ? PALETTE.ok : PALETTE.bad} fontSize="12" fontFamily={MONO}>receipt: HTTP {source.example_http ?? '-'} · {source.example_status} · {short(source.example_sha256)}</text>
        </g>;
      })}
      <text x="20" y={height - 20} fill={PALETTE.fog2} fontSize="12">The model never picks a URL. No retries.</text>
    </Svg>;
  }
  const top = 176, rowH = 54, width = 1130;
  const height = top + sources.length * rowH + 56;
  return <Svg id={id} width={width} height={height} title={title} desc={desc}>
    <text x="20" y="34" fill={PALETTE.lime} fontSize="12" fontFamily={MONO} letterSpacing="1">LOCAL, NO NETWORK</text>
    <Box x={20} y={48} w={330} h={62} kind="source" title="ADCdb workbook snapshot" lines={[local]} />
    <Box x={370} y={48} w={330} h={62} kind="source" title="Label paraphrases" lines={[labelProducts.join(', ') + ' · draft UK text']} n={1} />
    <Arrow id={id} d="M700 79 L800 79" />
    <Box x={810} y={48} w={300} h={62} kind="code" title="Read by source id" lines={['receipt with content hash']} n={2} />
    {(['Live source', 'Fixed URL template (in code)', 'Receipt'] as const).map((head, i) => <text key={head} x={[20, 270, 800][i]} y={top - 18} fill={PALETTE.lime} fontSize="12" fontFamily={MONO} letterSpacing="1">{head.toUpperCase()}</text>)}
    {sources.map((source, i) => {
      const y = top + i * rowH; const t = urlTemplate(source.example_url, source.subject);
      return <g key={source.id}>
        <Box x={20} y={y} w={200} h={40} kind="source" title={source.name} n={i + 3} titleSize={14} />
        <Arrow id={id} d={`M220 ${y + 20} L262 ${y + 20}`} />
        <g className="pf-node" style={{ '--n': i + 3 } as CSSProperties}>
          <rect x="270" y={y} width="480" height="40" rx="8" fill={PALETTE.raised} stroke={PALETTE.lime} strokeWidth="1.6" />
          <text x="284" y={y + 25} fill={PALETTE.fog} fontSize="12" fontFamily={MONO}><tspan fill={PALETTE.ink}>{t.host}</tspan>{clip(t.path, 60 - t.host.length)}</text>
        </g>
        <Arrow id={id} d={`M750 ${y + 20} L792 ${y + 20}`} />
        <g className="pf-node" style={{ '--n': i + 4 } as CSSProperties}>
          <rect x="800" y={y} width="310" height="40" rx="8" fill={PALETTE.panel} stroke={source.example_status === 'ok' ? PALETTE.ok : PALETTE.bad} strokeWidth="1.6" />
          <text x="814" y={y + 25} fill={source.example_status === 'ok' ? PALETTE.ok : PALETTE.bad} fontSize="12.5" fontFamily={MONO}>HTTP {source.example_http ?? '-'} · {source.example_status} · {short(source.example_sha256)}</text>
        </g>
      </g>;
    })}
    <text x="20" y={height - 22} fill={PALETTE.fog2} fontSize="13">The model never picks a URL. One fetch per reference, no retries, no fallback to the snapshot. Receipts are hashes of what came back, not signatures.</text>
  </Svg>;
}

/* ---------------------------------------------------------------- harness */

const HARNESS_STEPS: { key: string; title: string; lines: string[]; kind: Kind }[] = [
  { key: 'question', title: 'Question', lines: ['plain English'], kind: 'plain' },
  { key: 'scope_gate', title: 'Scope gate', lines: ['code', 'off-topic stops'], kind: 'code' },
  { key: 'premise_gate', title: 'Premise gate', lines: ['code', 'checks the facts'], kind: 'code' },
  { key: 'lead_plan', title: 'Claude lead', lines: ['model', 'picks check ids'], kind: 'model' },
  { key: 'evidence_worker', title: 'Workers', lines: ['model, parallel', 'one per check'], kind: 'model' },
  { key: 'verifier', title: 'Verifier', lines: ['code', 'writes verdicts'], kind: 'code' },
  { key: 'omission_gate', title: 'Omission gate', lines: ['code', 'gaps stay visible'], kind: 'code' },
  { key: 'answer', title: 'Answer', lines: ['audit + sources'], kind: 'out' },
];
export const HARNESS_STEP_KEYS = HARNESS_STEPS.map(step => step.key);

const WHY_STEPS: { kind: Kind; title: string; lines: string[] }[] = [
  { kind: 'plain', title: 'Medicines are complex', lines: ['components, labels,', 'evidence trails'] },
  { kind: 'model', title: 'AI narrowed the gap', lines: ['answers fast,', 'acts as an agent'] },
  { kind: 'stop', title: 'Not trust-ready', lines: ['sounds sure when', 'it is wrong'] },
  { kind: 'code', title: 'Framework + test env', lines: ['code checks claims,', 'failures recorded'] },
  { kind: 'source', title: 'Starting point', lines: ['HER2 antibody-drug', 'conjugates, breast cancer'] },
];

export function WhyFigure({ variant = 'wide' }: { variant?: Variant }) {
  const id = `fig-why-${variant}`;
  const title = 'Why this project exists';
  const desc = 'Medicines are complex. AI assistants narrowed the knowledge gap and can act as agents, but they are not trust-ready for pharmacies or clinicians because they sound sure when they are wrong. This project builds a framework and test environment, starting with HER2-targeted antibody-drug conjugates used in breast cancer.';
  if (variant === 'tall') {
    const w = 260, h = 70, gap = 24, x = 50, top = 20;
    const y = (i: number) => top + i * (h + gap);
    return <Svg id={id} width={360} height={y(WHY_STEPS.length) + 6} title={title} desc={desc}>
      {WHY_STEPS.slice(0, -1).map((_, i) => <Arrow key={i} id={id} d={`M${x + w / 2} ${y(i) + h} L${x + w / 2} ${y(i + 1) - 4}`} />)}
      {WHY_STEPS.map((step, i) => <Box key={step.title} x={x} y={y(i)} w={w} h={h} kind={step.kind} title={step.title} lines={step.lines} n={i} />)}
    </Svg>;
  }
  const w = 200, h = 88, gap = 30, left = 20, row1 = 20, row2 = 172;
  const x = (i: number) => left + i * (w + gap);
  const [complex, gap1, notReady, framework, start] = WHY_STEPS as [typeof WHY_STEPS[number], typeof WHY_STEPS[number], typeof WHY_STEPS[number], typeof WHY_STEPS[number], typeof WHY_STEPS[number]];
  return <Svg id={id} width={x(2) + w + left} height={row2 + h + 20} title={title} desc={desc}>
    <Arrow id={id} d={`M${x(0) + w} ${row1 + h / 2} L${x(1) - 3} ${row1 + h / 2}`} />
    <Arrow id={id} d={`M${x(1) + w} ${row1 + h / 2} L${x(2) - 3} ${row1 + h / 2}`} />
    <Arrow id={id} d={`M${x(2) + w / 2} ${row1 + h} L${x(2) + w / 2} ${row2 - 3}`} />
    <Arrow id={id} d={`M${x(2)} ${row2 + h / 2} L${x(1) + w + 3} ${row2 + h / 2}`} />
    {[complex, gap1, notReady].map((step, i) => <Box key={step.title} x={x(i)} y={row1} w={w} h={h} kind={step.kind} title={step.title} lines={step.lines} n={i} titleSize={14} />)}
    <Box x={x(2)} y={row2} w={w} h={h} kind={framework.kind} title={framework.title} lines={framework.lines} n={3} titleSize={14} />
    <Box x={x(1)} y={row2} w={w} h={h} kind={start.kind} title={start.title} lines={start.lines} n={4} titleSize={14} lineSize={12} />
  </Svg>;
}

export function HarnessFigure({ variant = 'wide' }: { variant?: Variant }) {
  const id = `fig-harness-${variant}`;
  const title = 'The harness: where code decides and where the model only suggests';
  const desc = 'A question passes a scope gate and a premise gate, both plain code. If either stops it, no model is called. Otherwise a Claude lead picks which checks to run, Claude workers run them in parallel, a deterministic verifier writes every verdict, and an omission gate keeps missing checks on the answer, sending the lead back once. Models never write verdicts.';
  const legend = [{ kind: 'code' as const, label: 'code decides' }, { kind: 'model' as const, label: 'Claude suggests' }, { kind: 'stop' as const, label: 'stops, no model call' }];
  if (variant === 'tall') {
    const w = 210, h = 62, gap = 24, x = 20, top = 60;
    const y = (i: number) => top + i * (h + gap);
    const height = y(HARNESS_STEPS.length) + 30;
    return <Svg id={id} width={360} height={height} title={title} desc={desc} className="pf-harness">
      <Legend x={20} y={28} items={legend.slice(0, 2)} />
      {HARNESS_STEPS.slice(0, -1).map((_, i) => <Arrow key={i} id={id} d={`M${x + w / 2} ${y(i) + h} L${x + w / 2} ${y(i + 1) - 4}`} />)}
      {HARNESS_STEPS.map((step, i) => step.key === 'evidence_worker'
        ? <g key={step.key}><rect x={x + 8} y={y(i) - 8} width={w} height={h} rx="8" fill={PALETTE.panel} stroke={PALETTE.sky} strokeOpacity=".5" strokeDasharray="5 3" /><rect x={x + 4} y={y(i) - 4} width={w} height={h} rx="8" fill={PALETTE.panel} stroke={PALETTE.sky} strokeOpacity=".7" strokeDasharray="5 3" /><Box x={x} y={y(i)} w={w} h={h} kind={step.kind} title={step.title} lines={step.lines} n={i} /></g>
        : <Box key={step.key} x={x} y={y(i)} w={w} h={h} kind={step.kind} title={step.title} lines={step.lines} n={i} />)}
      <Box x={252} y={y(1) + 20} w={96} h={y(2) - y(1) + 22} kind="stop" title="Stopped" lines={['0 model', 'calls']} n={2} titleSize={14} lineSize={12} />
      <Arrow id={id} bad d={`M${x + w} ${y(1) + h / 2} L248 ${y(1) + h / 2 + 10}`} />
      <Arrow id={id} bad d={`M${x + w} ${y(2) + h / 2} L248 ${y(2) + h / 2 - 6}`} />
      <Arrow id={id} d={`M${x + w} ${y(6) + h / 2} C${x + w + 70} ${y(6) + h / 2}, ${x + w + 70} ${y(3) + h / 2}, ${x + w + 2} ${y(3) + h / 2}`} label="missing check:" lx={x + w + 24} ly={y(4) + 30} anchor="start" />
      <text x={x + w + 24} y={y(4) + 46} fill={PALETTE.fog2} fontSize="12">back once</text>
    </Svg>;
  }
  const w = 124, h = 84, gap = 14, left = 20, rowY = 110;
  const x = (i: number) => left + i * (w + gap);
  const width = x(HARNESS_STEPS.length) - gap + left;
  return <Svg id={id} width={width} height={380} title={title} desc={desc} className="pf-harness">
    <Legend x={20} y={354} items={legend} />
    {HARNESS_STEPS.slice(0, -1).map((_, i) => <Arrow key={i} id={id} d={`M${x(i) + w} ${rowY + h / 2} L${x(i + 1) - 3} ${rowY + h / 2}`} />)}
    {HARNESS_STEPS.map((step, i) => step.key === 'evidence_worker'
      ? <g key={step.key}><rect x={x(i) + 8} y={rowY - 8} width={w} height={h} rx="8" fill={PALETTE.panel} stroke={PALETTE.sky} strokeOpacity=".5" strokeDasharray="5 3" /><rect x={x(i) + 4} y={rowY - 4} width={w} height={h} rx="8" fill={PALETTE.panel} stroke={PALETTE.sky} strokeOpacity=".7" strokeDasharray="5 3" /><Box x={x(i)} y={rowY} w={w} h={h} kind={step.kind} title={step.title} lines={step.lines} n={i} titleSize={14} lineSize={12} /></g>
      : <Box key={step.key} x={x(i)} y={rowY} w={w} h={h} kind={step.kind} title={step.title} lines={step.lines} n={i} titleSize={14} lineSize={12} />)}
    <Box x={x(1)} y={262} w={w * 2 + gap} h={56} kind="stop" title="Stopped before the model" lines={['0 model calls']} n={3} />
    <Arrow id={id} bad d={`M${x(1) + w / 2} ${rowY + h} L${x(1) + w / 2} 258`} />
    <Arrow id={id} bad d={`M${x(2) + w / 2} ${rowY + h} L${x(2) + w / 2} 258`} />
    <Arrow id={id} d={`M${x(6) + w / 2} ${rowY} C${x(6) + w / 2} 40, ${x(3) + w / 2} 40, ${x(3) + w / 2} ${rowY - 3}`} label="missing check: back to the lead, once" lx={(x(3) + x(6) + w) / 2} ly={46} />
    <text x={x(5) + w / 2} y={rowY + h + 26} textAnchor="middle" fill={PALETTE.lime} fontSize="12.5">only code writes verdicts</text>
  </Svg>;
}

/* ---------------------------------------------------------------- false premise */

export interface PremiseFigureProps { question: string; stated: string; recorded: string; check: string; verdict: keyof typeof verdictLabels; cited: string[]; variant?: Variant }

function Marked({ lines, stated, x, y, size, lineGap, anchor = 'start' }: { lines: string[]; stated: string; x: number; y: number; size: number; lineGap: number; anchor?: 'start' | 'middle' }) {
  return <>{lines.map((line, i) => <text key={i} x={x} y={y + i * lineGap} fill={PALETTE.ink} fontSize={size} textAnchor={anchor}>
    {line.split(/(\s+)/).map((part, j) => <tspan key={j} fill={part.replace(/[^\w-]/g, '').toLowerCase() === stated.toLowerCase() ? PALETTE.copper : undefined} fontWeight={part.replace(/[^\w-]/g, '').toLowerCase() === stated.toLowerCase() ? 700 : undefined}>{part}</tspan>)}
  </text>)}</>;
}

export function PremiseFigure({ question, stated, recorded, check, verdict, cited, variant = 'wide' }: PremiseFigureProps) {
  const id = `fig-premise-${variant}`;
  const title = 'A question with a false premise';
  const desc = `Question: "${question}". The premise gate compares "${stated}" with the recorded linker, ${recorded}, and flags it (${check}) before any model call. The claim is still checked against the sources; the verifier's recorded verdict is ${verdictLabels[verdict]}, citing ${cited.join(', ') || 'nothing'}.`;
  const citedText = cited.length ? cited.join(', ') : 'nothing';
  const recordedShort = recorded.length > 30 ? recorded.replace(/^.*\((\w+)\)$/, '$1') : recorded;
  if (variant === 'tall') {
    const q = wrap(`“${question}”`, 34);
    return <Svg id={id} width={360} height={520} title={title} desc={desc}>
      <rect x="20" y="20" width="320" height={36 + q.length * 22} rx="8" fill={PALETTE.panel} stroke={PALETTE.lineStrong} />
      <Marked lines={q} stated={stated} x={36} y={50} size={15} lineGap={22} />
      <Arrow id={id} d={`M180 ${56 + q.length * 22} L180 ${82 + q.length * 22}`} />
      <Box x={20} y={160} w={320} h={84} kind="code" title="Premise gate: flagged" lines={[`question says: ${stated}`, `sources say: ${recordedShort} (non-cleavable)`]} n={1} />
      <Arrow id={id} d="M180 244 L180 280" />
      <Box x={20} y={284} w={320} h={84} kind="code" title="Verifier still checks the claim" lines={[`cited: ${citedText}`]} n={2} />
      <Arrow id={id} d="M180 368 L180 404" />
      <Box x={70} y={408} w={220} h={56} kind="out" title={verdictLabels[verdict]} lines={['recorded verdict']} n={3} titleSize={17} />
      <text x="20" y="500" fill={PALETTE.fog2} fontSize="12">The flag is a table mismatch, not a ruling.</text>
    </Svg>;
  }
  const q = wrap(`“${question}”`, 30);
  return <Svg id={id} width={1130} height={300} title={title} desc={desc}>
    <rect x="20" y="60" width="290" height={40 + q.length * 24} rx="8" fill={PALETTE.panel} stroke={PALETTE.lineStrong} />
    <Marked lines={q} stated={stated} x={36} y={92} size={16} lineGap={24} />
    <text x="20" y="44" fill={PALETTE.lime} fontSize="12" fontFamily={MONO} letterSpacing="1">QUESTION</text>
    <Arrow id={id} d="M310 120 L352 120" />
    <Box x={360} y={70} w={300} h={100} kind="code" title="Premise gate: flagged" lines={[`question says: ${stated}`, `sources say: ${recordedShort}`, '(non-cleavable)']} n={1} />
    <text x="360" y="200" fill={PALETTE.fog2} fontSize="12.5">before any model call · shown to the user</text>
    <Arrow id={id} d="M660 120 L702 120" />
    <Box x={710} y={70} w={190} h={100} kind="code" title="Verifier" lines={['still checks the claim', `cited: ${citedText}`]} n={2} />
    <Arrow id={id} d="M900 120 L942 120" />
    <Box x={950} y={84} w={160} h={72} kind="out" title={verdictLabels[verdict]} lines={['recorded verdict']} n={3} titleSize={verdictLabels[verdict].length > 12 ? 14 : 17} />
    <text x="20" y="272" fill={PALETTE.fog2} fontSize="13">The premise flag is a table mismatch against the workbook and label paraphrase, not a scientific ruling. The verdict comes from the verifier, not the model.</text>
  </Svg>;
}

/* ---------------------------------------------------------------- hallucination bait */

export interface BaitFigureProps {
  invented: { message: string; decision: string; checks: string[] };
  fakeNct: { message: string; decision: string; checks: string[] };
  receipt: { subject: string; url: string; http: number | null; status: string; sha256: string | null };
  modelCalls: number; variant?: Variant;
}
export const CHECK_LABELS: Record<string, string> = { invented_code: 'product not recognised', nct_reference: 'trial id not verified', invented_inn: 'name not recognised', pmid_reference: 'PubMed id not verified' };
const checkText = (checks: string[]) => checks.map(check => CHECK_LABELS[check] ?? check.replaceAll('_', ' ')).join(', ');

export function BaitFigure({ invented, fakeNct, receipt, modelCalls, variant = 'wide' }: BaitFigureProps) {
  const id = `fig-bait-${variant}`;
  const title = 'Hallucination bait: an invented ADC and a fake trial id';
  const desc = `"${invented.message}" is ${invented.decision} by the premise gate (${checkText(invented.checks)}). "${fakeNct.message}" is ${fakeNct.decision} (${checkText(fakeNct.checks)}). A live ClinicalTrials.gov lookup for ${receipt.subject} returned HTTP ${receipt.http}, status ${receipt.status}. Model calls: ${modelCalls}.`;
  const t = urlTemplate(receipt.url);
  if (variant === 'tall') {
    const a = wrap(`“${invented.message}”`, 36), b = wrap(`“${fakeNct.message}”`, 36);
    return <Svg id={id} width={360} height={600} title={title} desc={desc}>
      <rect x="20" y="20" width="320" height={22 + a.length * 20} rx="8" fill={PALETTE.panel} stroke={PALETTE.lineStrong} />
      {a.map((line, i) => <text key={i} x="34" y={44 + i * 20} fill={PALETTE.ink} fontSize="14">{line}</text>)}
      <Arrow id={id} bad d={`M180 ${42 + a.length * 20} L180 ${96 + (a.length - 2) * 20}`} />
      <Box x={20} y={100 + (a.length - 2) * 20} w={320} h={56} kind="stop" title={`Premise gate: ${invented.decision}`} lines={[checkText(invented.checks)]} n={1} />
      <rect x="20" y="210" width="320" height={22 + b.length * 20} rx="8" fill={PALETTE.panel} stroke={PALETTE.lineStrong} />
      {b.map((line, i) => <text key={i} x="34" y={234 + i * 20} fill={PALETTE.ink} fontSize="14">{line}</text>)}
      <Arrow id={id} bad d={`M180 ${232 + b.length * 20} L180 ${286 + (b.length - 2) * 20}`} />
      <Box x={20} y={290 + (b.length - 2) * 20} w={320} h={56} kind="stop" title={`Premise gate: ${fakeNct.decision}`} lines={[checkText(fakeNct.checks)]} n={2} />
      <Box x={20} y={400} w={320} h={82} kind="source" title="Live lookup receipt" lines={[t.host + '/…/' + receipt.subject, `HTTP ${receipt.http ?? '-'} · ${receipt.status} · ${short(receipt.sha256)}`]} n={3} mono lineSize={11.5} />
      <text x="180" y="540" textAnchor="middle" fill={PALETTE.lime} fontSize="30" fontFamily={SERIF}>{modelCalls} model calls</text>
      <text x="180" y="566" textAnchor="middle" fill={PALETTE.fog2} fontSize="12">in the recorded premise-gate study</text>
    </Svg>;
  }
  const lane = (y: number, message: string, decision: string, checks: string[], n: number) => <g>
    <rect x="20" y={y} width="420" height="56" rx="8" fill={PALETTE.panel} stroke={PALETTE.lineStrong} />
    <text x="36" y={y + 33} fill={PALETTE.ink} fontSize="15">“{message.length > 50 ? message.slice(0, 49) + '…' : message}”</text>
    <Arrow id={id} bad d={`M440 ${y + 28} L492 ${y + 28}`} />
    <Box x={500} y={y} w={260} h={56} kind="stop" title={`Premise gate: ${decision}`} lines={[checkText(checks)]} n={n} />
  </g>;
  return <Svg id={id} width={1130} height={330} title={title} desc={desc}>
    <text x="20" y="40" fill={PALETTE.lime} fontSize="12" fontFamily={MONO} letterSpacing="1">BAIT QUESTIONS</text>
    {lane(56, invented.message, invented.decision, invented.checks, 1)}
    {lane(136, fakeNct.message, fakeNct.decision, fakeNct.checks, 2)}
    <path className="pf-flow" d="M630 192 L630 236" fill="none" stroke={PALETTE.copper} strokeWidth="1.6" strokeDasharray="4 3" markerEnd={`url(#${id}-arrow)`} />
    <g className="pf-node" style={{ '--n': 3 } as CSSProperties}>
      <rect x="20" y="240" width="740" height="56" rx="8" fill={PALETTE.panel} stroke={PALETTE.copper} strokeWidth="1.6" />
      <text x="36" y="263" fill={PALETTE.ink} fontSize="13.5" fontWeight="600">Live lookup receipt (existence only)</text>
      <text x="36" y="284" fill={PALETTE.bad} fontSize="12.5" fontFamily={MONO}>{t.host}{t.path.replace('{id}', receipt.subject).slice(0, 40)}  →  HTTP {receipt.http ?? '-'} · {receipt.status} · {short(receipt.sha256)}</text>
    </g>
    <g className="pf-node" style={{ '--n': 4 } as CSSProperties}>
      <rect x="800" y="56" width="310" height="240" rx="10" fill={PALETTE.panel} stroke={PALETTE.lime} strokeWidth="1.6" />
      <text x="955" y="160" textAnchor="middle" fill={PALETTE.lime} fontSize="64" fontFamily={SERIF}>{modelCalls}</text>
      <text x="955" y="196" textAnchor="middle" fill={PALETTE.ink} fontSize="17">model calls</text>
      <text x="955" y="222" textAnchor="middle" fill={PALETTE.fog2} fontSize="12.5">recorded premise-gate study</text>
      <text x="955" y="242" textAnchor="middle" fill={PALETTE.fog2} fontSize="12.5">nothing reaches Claude</text>
    </g>
  </Svg>;
}

/* ---------------------------------------------------------------- small ratio bar for the failure cards */

export function RatioBar({ id, label, count, total, tone }: { id: string; label: string; count: number; total: number; tone: 'ok' | 'bad' }) {
  const width = 240, fill = total ? (count / total) * width : 0;
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} 14`} width={width} height="14" role="img" aria-labelledby={`${id}-title`} className="pf-ratio">
    <title id={`${id}-title`}>{`${label}: ${count} of ${total}`}</title>
    <rect width={width} height="14" rx="3" fill={PALETTE.raised} stroke={PALETTE.line} />
    <rect width={fill} height="14" rx="3" fill={tone === 'ok' ? PALETTE.ok : PALETTE.bad} />
  </svg>;
}

/* ---------------------------------------------------------------- share card (og:image source) */

export function ShareCard({ workbookRecords, sourceCount }: { workbookRecords: number; sourceCount: number }) {
  const id = 'fig-share';
  const steps = HARNESS_STEPS;
  const w = 124, gap = 12, left = 64;
  return <Svg id={id} width={1200} height={630} title="Conjugate: trust less, check more" desc={`How research agents fail and the code checks that catch them. Harness steps: ${steps.map(s => s.title).join(', ')}. ADCdb workbook with ${workbookRecords} ADCs and ${sourceCount} allowlisted live sources. Research prototype, not a clinical tool.`}>
    <text x={left} y="96" fill={PALETTE.lime} fontSize="20" fontFamily={MONO} letterSpacing="2">CONJUGATE · HER2 ADC RESEARCH PROTOTYPE</text>
    <text x={left} y="210" fill={PALETTE.ink} fontSize="104" fontFamily={SERIF}>Trust less.</text>
    <text x={left} y="318" fill={PALETTE.lime} fontSize="104" fontFamily={SERIF} fontStyle="italic">Check more.</text>
    <text x={left} y="380" fill={PALETTE.fog} fontSize="28">How research agents fail, and the code checks that catch them.</text>
    {steps.map((step, i) => <g key={step.key}>
      {i > 0 && <line x1={left + i * (w + gap) - gap} x2={left + i * (w + gap)} y1="470" y2="470" stroke={PALETTE.lineStrong} strokeWidth="2" />}
      <rect x={left + i * (w + gap)} y="440" width={w} height="60" rx="8" fill={PALETTE.panel} stroke={STROKE[step.kind]} strokeWidth="2" strokeDasharray={step.kind === 'model' ? '6 4' : undefined} />
      <text x={left + i * (w + gap) + w / 2} y="476" textAnchor="middle" fill={PALETTE.ink} fontSize="14" fontWeight="600">{step.title}</text>
    </g>)}
    <text x={left} y="568" fill={PALETTE.fog2} fontSize="20">{workbookRecords} ADCs from an ADCdb workbook · {sourceCount} allowlisted live sources · not a clinical tool</text>
  </Svg>;
}
