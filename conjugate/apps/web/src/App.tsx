import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BookOpen, FileCheck2, FlaskConical, Home, ListChecks, MessageSquare, Table2, UserRound, Workflow } from 'lucide-react';
import type { Catalog, ResearchCatalog } from '@her2/shared';
import { describeFailure, fetchCatalog } from './boundaries';
import { fetchResearchCatalog } from './researchBoundaries';
import { SourceLibrary } from './EvidenceViews';
import { EvidenceAudit } from './EvidenceAudit';
import { ResearchChat } from './ResearchChat';
import { AdcAtlas } from './AdcAtlas';
import { ContextReview } from './ContextReview';
import { HowItWorks } from './HowItWorks';
import { Landing } from './Landing';
import { viewFromHash, type ViewId } from './navigation';
const Evals = lazy(() => import('./Evals').then(module => ({ default: module.Evals })));
const ModelLab = lazy(() => import('./ModelLab').then(module => ({ default: module.ModelLab })));

const views = [
  { id: 'home', label: 'Overview', icon: Home },
  { id: 'chat', label: 'Research chat', icon: MessageSquare },
  { id: 'audit', label: 'Check a claim', icon: FileCheck2 },
  { id: 'context', label: 'Patient context', icon: UserRound },
  { id: 'atlas', label: 'ADC table', icon: Table2 },
  { id: 'models', label: 'Linker lab', icon: FlaskConical },
  { id: 'how', label: 'How it works', icon: Workflow },
  { id: 'evals', label: 'Evals', icon: ListChecks },
  { id: 'sources', label: 'Sources', icon: BookOpen },
] as const satisfies readonly { id: ViewId; label: string; icon: unknown }[];
type View = ViewId;

function useLocalCatalog<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<ReturnType<typeof describeFailure> | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setFailure(null);
    void load(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])).then((catalog) => {
      if (!controller.signal.aborted) setData(catalog);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setData(null); setFailure(describeFailure(cause)); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, version]);
  return { data, failure, loading, retry: () => setVersion((current) => current + 1) };
}

type CatalogLoad = { failure: ReturnType<typeof describeFailure> | null; loading: boolean; retry: () => void };
function CatalogState({ state, name }: { state: CatalogLoad; name: string }) {
  if (state.failure) {
    return <div className="error-alert" role="alert">
      <strong>Couldn't load the {name}.</strong>
      <p>{state.failure.code === 'CONNECTION_UNAVAILABLE' ? 'Check the API is running on :3001.' : state.failure.message}</p>
      <code>{state.failure.code}</code>
      <button className="button button-secondary" type="button" onClick={state.retry} disabled={state.loading}>Retry</button>
    </div>;
  }
  return <section className="catalog-loading" role="status"><h1>Loading</h1><p>Waiting for the {name} from the API.</p></section>;
}

export default function App() {
  const [view, setView] = useState<View>(() => typeof window === 'undefined' ? 'home' : viewFromHash(window.location.hash) ?? 'home');
  useEffect(() => {
    const onHash = () => { const next = viewFromHash(window.location.hash); if (next) setView(next); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (id: View) => { setMenuOpen(false); setView(id); if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`); };
  const [menuOpen, setMenuOpen] = useState(false);
  const research = useLocalCatalog<ResearchCatalog>(fetchResearchCatalog);
  const clinical = useLocalCatalog<Catalog>(fetchCatalog);
  const main = useRef<HTMLElement>(null);
  const current = views.find((item) => item.id === view) ?? views[0];
  useEffect(() => { document.title = current.id === 'home' ? 'Conjugate - trust less, check more' : `${current.label} - Conjugate`; main.current?.focus({ preventScroll: current.id === 'home' }); if (current.id !== 'home') window.scrollTo(0, 0); }, [current]);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar" aria-label="Navigation">
      <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); navigate('home'); }}><FlaskConical size={24} strokeWidth={1.3} aria-hidden="true" /><div><span className="brand-name">Conjugate</span><span className="brand-subtitle">HER2 ADC evidence audit</span></div></a>
      <button className="mobile-menu" type="button" aria-expanded={menuOpen} aria-controls="view-navigation" onClick={() => setMenuOpen(open => !open)}>Menu · {current.label}</button>
      <nav id="view-navigation" className={menuOpen ? 'menu-open' : ''} aria-label="Main navigation">{views.map(({ id, label, icon: Icon }) => <a className={`nav-item ${view === id ? 'active' : ''}`} key={id} href={`#${id}`} aria-current={view === id ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(id); }}><Icon size={16} strokeWidth={1.6} aria-hidden="true" /><span>{label}</span></a>)}</nav>
      <div className="sidebar-footer">
        <p>{research.data ? `${research.data.dataset.records.length} ADCs from ADCdb, ${research.data.dataset.derived_records.length} derived notes.` : 'Catalog not loaded.'}</p>
        <p>This app saves no chat history. Leaving a view clears its inputs and result.</p>
      </div>
    </aside>
    <div className="workspace-shell">
      <div className="boundary-banner" role="note">Research prototype. Clinical use stays blocked until a pharmacist reviews it.</div>
      <main id="main-content" className={`main-content ${view === 'home' ? 'main-home' : ''}`} tabIndex={-1} ref={main}>
        {view === 'home' && <Landing onNavigate={navigate} />}
        {view === 'chat' && (research.data ? <ResearchChat catalog={research.data} /> : <CatalogState state={research} name="research catalog" />)}
        {view === 'audit' && (research.data ? <EvidenceAudit catalog={research.data} /> : <CatalogState state={research} name="research catalog" />)}
        {view === 'atlas' && (research.data ? <AdcAtlas catalog={research.data} /> : <CatalogState state={research} name="ADC table" />)}
        {view === 'models' && <Suspense fallback={<p role="status">Loading model observations...</p>}><ModelLab /></Suspense>}
        {view === 'context' && (clinical.data ? <ContextReview catalog={clinical.data} /> : <CatalogState state={clinical} name="label catalog" />)}
        {view === 'how' && <HowItWorks />}
        {view === 'evals' && <Suspense fallback={<p role="status">Loading evals...</p>}><Evals catalog={research.data} /></Suspense>}
        {view === 'sources' && <>{clinical.failure && <CatalogState state={clinical} name="source list" />}<SourceLibrary catalog={clinical.data} /></>}
      </main>
    </div>
  </div>;
}
