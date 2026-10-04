import { useCallback, useEffect, useRef, useState } from 'react';

/** Material 3 motion scale. Mirrors the --dur-* and --ease-* custom properties in styles.css. */
export const MOTION = {
  durXs: 100, durS: 200, durM: 300, durL: 450, durXl: 700, stagger: 60, burst: 90,
  easeStandard: 'cubic-bezier(.2, 0, 0, 1)', easeDecel: 'cubic-bezier(.05, .7, .1, 1)', easeAccel: 'cubic-bezier(.3, 0, .8, .15)',
} as const;

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
interface MediaHost { matchMedia?: (query: string) => { matches: boolean } }

/** With no matchMedia (server render, tests) there is nothing to animate, so motion counts as reduced. */
export function prefersReducedMotion(host: MediaHost | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  return host?.matchMedia ? host.matchMedia(REDUCED_QUERY).matches : true;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(REDUCED_QUERY);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** 'static' renders plain visible content; 'pending' hides only until the first intersection; 'in' plays once. */
export type RevealState = 'static' | 'pending' | 'in';
export function revealState(reduced: boolean, observerAvailable: boolean, seen: boolean): RevealState {
  if (reduced || !observerAvailable) return 'static';
  return seen ? 'in' : 'pending';
}

const hasObserver = () => typeof IntersectionObserver !== 'undefined';
export const REVEAL_OPTIONS = { threshold: 0.2, rootMargin: '0px 0px -10% 0px' } as const;

/** Run-once reveal. The data-beat attribute is only set when motion is allowed, so content stays visible without JS. */
export function useRevealOnScroll<T extends Element>(): [(node: T | null) => void, RevealState] {
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || !hasObserver()) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, REVEAL_OPTIONS);
    io.observe(node);
    observer.current = io;
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, revealState(reduced, hasObserver(), seen)];
}

/** Tracks whether an element is on screen (used to pause the hero orbit off-screen). */
export function useOnScreen<T extends Element>(): [(node: T | null) => void, boolean] {
  const [visible, setVisible] = useState(true);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node || !hasObserver()) return;
    observer.current = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    observer.current.observe(node);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, visible];
}

interface Animatable { animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation }
/** Element.animate() ignores the CSS reduced-motion rule, so every WAAPI call goes through this gate. */
export function animateOnce(element: Animatable | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions, reduced: boolean): Animation | null {
  if (reduced || !element?.animate) return null;
  return element.animate(keyframes, { fill: 'none', ...options });
}

export const MOTION_STORAGE_KEY = 'conjugate-orbit';
/** Orbit pause preference; defaults to running. */
export function readOrbitPreference(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): boolean {
  try { return storage?.getItem(MOTION_STORAGE_KEY) !== 'paused'; } catch { return true; }
}

/* Graph helpers shared by the live team graph and the recorded replays. Node and edge lists come from TEAM_GRAPH. */
export interface GraphEdge { from: string; to: string; conditional: boolean }
export interface GraphStepLike { id: string; node: string; status: 'completed' | 'failed' }
export type NodeState = 'done' | 'failed' | 'active' | 'waiting' | 'skipped';
const TERMINALS = new Set(['__start__', '__end__']);

export function graphStates(nodes: readonly string[], steps: readonly GraphStepLike[], pending: boolean): Record<string, NodeState> {
  const last = steps.at(-1);
  return Object.fromEntries(nodes.map(node => {
    const reached = steps.filter(step => step.node === node);
    if (reached.some(step => step.status === 'failed')) return [node, 'failed'];
    if (reached.length) return [node, pending && last?.node === node ? 'active' : 'done'];
    return [node, pending ? 'waiting' : 'skipped'];
  }));
}

export function edgeFor(edges: readonly GraphEdge[], from: string | undefined, to: string): GraphEdge | null {
  if (!from || from === to) return null;
  return edges.find(edge => edge.from === from && edge.to === to) ?? null;
}

export const edgeKey = (edge: { from: string; to: string }) => `${edge.from}->${edge.to}`;

/** Edges walked by consecutive steps, in first-walk order. Repeated nodes (parallel workers) count as a burst, not an edge. */
export function walkedEdges(edges: readonly GraphEdge[], steps: readonly GraphStepLike[]): { key: string; stepId: string; order: number }[] {
  const walked: { key: string; stepId: string; order: number }[] = [];
  steps.forEach((step, index) => {
    const edge = edgeFor(edges, index === 0 ? '__start__' : steps[index - 1]!.node, step.node);
    if (!edge || TERMINALS.has(edge.from)) return;
    const key = edgeKey(edge);
    if (!walked.some(item => item.key === key)) walked.push({ key, stepId: step.id, order: walked.length });
  });
  return walked;
}

/** Position of each step inside a run of identical nodes (0 for the first). Drives the 90 ms decorative stagger only. */
export function burstIndex(steps: readonly GraphStepLike[], index: number): number {
  let count = 0;
  for (let i = index - 1; i >= 0 && steps[i]!.node === steps[index]!.node; i -= 1) count += 1;
  return count;
}

export interface GraphPoint { x: number; y: number }
export interface GraphLayout { width: number; height: number; nodeWidth: number; nodeHeight: number; points: Record<string, GraphPoint>; orientation: 'row' | 'column' }

export function graphLayout(nodes: readonly string[], orientation: 'row' | 'column'): GraphLayout {
  const count = Math.max(nodes.length, 1);
  if (orientation === 'row') {
    const width = 980, height = 220, pad = 70;
    const step = count > 1 ? (width - pad * 2) / (count - 1) : 0;
    const points = Object.fromEntries(nodes.map((node, index) => [node, { x: pad + index * step, y: 110 }]));
    return { width, height, nodeWidth: Math.min(124, Math.max(step - 14, 80)), nodeHeight: 50, points, orientation };
  }
  const width = 340, rowHeight = 64, top = 34;
  const points = Object.fromEntries(nodes.map((node, index) => [node, { x: 170, y: top + index * rowHeight }]));
  return { width, height: top * 2 + (count - 1) * rowHeight, nodeWidth: 172, nodeHeight: 42, points, orientation };
}

/** Straight line between neighbours; forward skips arc above (or right), back edges arc below (or left). */
export function edgePath(layout: GraphLayout, nodes: readonly string[], edge: GraphEdge): string | null {
  const a = layout.points[edge.from], b = layout.points[edge.to];
  if (!a || !b) return null;
  const span = nodes.indexOf(edge.to) - nodes.indexOf(edge.from);
  const halfW = layout.nodeWidth / 2, halfH = layout.nodeHeight / 2;
  if (layout.orientation === 'row') {
    if (span === 1) return `M${a.x + halfW} ${a.y} L${b.x - halfW} ${b.y}`;
    const lift = Math.min(18 + Math.abs(span) * 12, 80);
    const y = span > 0 ? a.y - halfH : a.y + halfH;
    const cy = span > 0 ? y - lift : y + lift;
    return `M${a.x} ${y} C${a.x} ${cy}, ${b.x} ${cy}, ${b.x} ${y}`;
  }
  if (span === 1) return `M${a.x} ${a.y + halfH} L${b.x} ${b.y - halfH}`;
  const reach = Math.min(16 + Math.abs(span) * 10, 70);
  const x = span > 0 ? a.x + halfW : a.x - halfW;
  const cx = span > 0 ? x + reach : x - reach;
  return `M${x} ${a.y} C${cx} ${a.y}, ${cx} ${b.y}, ${x} ${b.y}`;
}
