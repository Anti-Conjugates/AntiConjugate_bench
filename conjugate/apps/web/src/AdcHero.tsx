import { useState, type CSSProperties } from 'react';
import { MOTION_STORAGE_KEY, readOrbitPreference, useOnScreen } from './motion';

function hexagon(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
}
const drugs = [[196, 262, 132, 262], [224, 262, 288, 262], [196, 306, 140, 318], [224, 306, 280, 318]] as const;
const index = (i: number) => ({ '--i': i }) as CSSProperties;

/** Pause control for the only looping motion on the page (WCAG 2.2.2). */
export function MotionToggle({ running, onChange }: { running: boolean; onChange: (running: boolean) => void }) {
  return <button type="button" className="motion-toggle" aria-pressed={!running} onClick={() => onChange(!running)}>
    <span aria-hidden="true" className="motion-toggle-icon" data-running={running || undefined} />Pause orbit
  </button>;
}

/** Hero schematic: antibody drawn in, linkers and payloads settle, a slow orbit that pauses off-screen or on request. */
export function AdcHero() {
  const [preferred, setPreferred] = useState(() => readOrbitPreference());
  const [ref, onScreen] = useOnScreen<HTMLElement>();
  const running = preferred && onScreen;
  const change = (next: boolean) => {
    setPreferred(next);
    try { localStorage.setItem(MOTION_STORAGE_KEY, next ? 'running' : 'paused'); } catch { /* storage unavailable: preference lasts for this view */ }
  };
  return <figure className="adc-figure adc-hero" ref={ref} data-orbit={running ? 'running' : 'paused'}>
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
        <path d="M196 330 L196 200 L120 96" pathLength={1} style={index(0)} />
        <path d="M224 330 L224 200 L300 96" pathLength={1} style={index(0)} />
        <path d="M172 214 L106 124" className="adc-light" pathLength={1} style={index(1)} />
        <path d="M248 214 L314 124" className="adc-light" pathLength={1} style={index(1)} />
      </g>
      <g className="adc-target" aria-hidden="true">
        <circle cx="108" cy="78" r="9" /><circle cx="312" cy="78" r="9" />
      </g>
      {drugs.map(([x1, y1, x2, y2], i) => <g key={i} className="adc-drug" style={index(i)}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="adc-linker" />
        <circle cx={x2} cy={y2} r="22" fill="url(#adc-glow)" className="adc-halo" />
        <polygon points={hexagon(x2, y2, 10)} className="adc-payload" />
      </g>)}
      <g className="adc-labels">
        <text x="20" y="40">Antibody</text><text x="20" y="58" className="adc-sub">trastuzumab, binds HER2</text>
        <text x="300" y="250">Linker</text><text x="300" y="268" className="adc-sub">holds the drug on</text>
        <text x="20" y="300">Payload</text><text x="20" y="318" className="adc-sub">DM1 or DXd</text>
      </g>
    </svg>
    <figcaption>Schematic only. Not a molecular structure or a model prediction.</figcaption>
    <MotionToggle running={preferred} onChange={change} />
  </figure>;
}
