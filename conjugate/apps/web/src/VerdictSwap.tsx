import { useEffect, useState } from 'react';
import { useReducedMotion } from './motion';

interface Shown { verdict: string; label: string }

/** Verdict slot that swaps in place: the old pill leaves, the new one arrives, and the stable slot announces the change once. */
export function VerdictSwap({ verdict, label, className = '', itemClass = () => '' }: { verdict: string; label: string; className?: string; itemClass?: (verdict: string) => string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<Shown>({ verdict, label });
  const [leaving, setLeaving] = useState<Shown | null>(null);
  const [changed, setChanged] = useState(false);
  if (shown.verdict !== verdict || shown.label !== label) {
    setLeaving(reduced ? null : shown);
    setShown({ verdict, label });
    setChanged(true);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), 400);
    return () => clearTimeout(timer);
  }, [leaving]);
  return <p className={`vs-slot ${className}`} aria-live="polite" aria-atomic="true">
    {leaving && <span key={`${leaving.verdict}-out`} className={`vs-item vs-out ${itemClass(leaving.verdict)}`} aria-hidden="true" onAnimationEnd={() => setLeaving(null)}>{leaving.label}</span>}
    <span key={shown.verdict} className={`vs-item ${changed ? 'vs-in' : ''} ${itemClass(shown.verdict)}`}>{shown.label}</span>
  </p>;
}
