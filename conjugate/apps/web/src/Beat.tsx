import type { CSSProperties, ReactNode } from 'react';
import { useRevealOnScroll } from './motion';

/** Stagger index for children that rise in when their beat is revealed. */
export const rise = (index: number) => ({ className: 'rise', style: { '--i': index } as CSSProperties });

/** One scroll-story beat. Reveals once on first intersection; without JS or with reduced motion it renders static. */
export function Beat({ id, number, kicker, heading, lede, exhibit, children, tone = 'a' }: { id: string; number: string; kicker: string; heading: ReactNode; lede: ReactNode; exhibit: ReactNode; children?: ReactNode; tone?: 'a' | 'b' }) {
  const [ref, state] = useRevealOnScroll<HTMLElement>();
  return <section id={id} ref={ref} className={`beat beat-${tone}`} data-beat={state === 'static' ? undefined : state} aria-labelledby={`${id}-heading`}>
    <div className="beat-copy">
      <p {...rise(0)}><span className="beat-num">{number}</span><span className="beat-kicker">{kicker}</span></p>
      <h2 id={`${id}-heading`} {...rise(1)}>{heading}</h2>
      <p className="beat-lede rise" style={{ '--i': 2 } as CSSProperties}>{lede}</p>
      {children && <div className="beat-more rise" style={{ '--i': 3 } as CSSProperties}>{children}</div>}
    </div>
    <div className="beat-exhibit rise" style={{ '--i': 2 } as CSSProperties}>{exhibit}</div>
  </section>;
}
