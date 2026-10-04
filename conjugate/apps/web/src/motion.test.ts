import { describe, expect, it, vi } from 'vitest';
import { TEAM_GRAPH } from '@her2/shared';
import { animateOnce, burstIndex, edgeFor, edgePath, graphLayout, graphStates, prefersReducedMotion, readOrbitPreference, revealState, walkedEdges, type GraphEdge, type GraphStepLike } from './motion';
import { stepsFromTrace } from './TeamGraph';

const nodes = TEAM_GRAPH.nodes as readonly string[];
const edges = TEAM_GRAPH.edges as readonly GraphEdge[];
const step = (id: number, node: string, status: GraphStepLike['status'] = 'completed'): GraphStepLike => ({ id: `step-${id}`, node, status });

describe('graphStates', () => {
  it('marks reached, failed, latest and unreached nodes from received steps only', () => {
    const steps = [step(1, 'scope_gate'), step(2, 'lead_plan'), step(3, 'evidence_worker', 'failed')];
    const pending = graphStates(nodes, steps, true);
    expect(pending.scope_gate).toBe('done');
    expect(pending.evidence_worker).toBe('failed');
    expect(pending.verifier).toBe('waiting');
    const settled = graphStates(nodes, steps.slice(0, 2), true);
    expect(settled.lead_plan).toBe('active');
    expect(graphStates(nodes, steps.slice(0, 2), false).lead_plan).toBe('done');
    expect(graphStates(nodes, steps, false).answer).toBe('skipped');
  });
  it('covers every TEAM_GRAPH node with no hard-coded list', () => {
    expect(Object.keys(graphStates(nodes, [], false))).toEqual([...nodes]);
  });
});

describe('edgeFor and walkedEdges', () => {
  it('finds only edges that exist in TEAM_GRAPH', () => {
    expect(edgeFor(edges, 'scope_gate', 'premise_gate')).toMatchObject({ from: 'scope_gate', to: 'premise_gate' });
    expect(edgeFor(edges, 'premise_gate', 'lead_plan')).toMatchObject({ from: 'premise_gate', to: 'lead_plan' });
    expect(edgeFor(edges, 'scope_gate', 'lead_plan')).toBeNull();
    expect(edgeFor(edges, 'scope_gate', 'verifier')).toBeNull();
    expect(edgeFor(edges, undefined, 'scope_gate')).toBeNull();
    expect(edgeFor(edges, 'evidence_worker', 'evidence_worker')).toBeNull();
  });
  it('walks a recorded trace once per edge and treats repeated nodes as a burst', () => {
    const steps = stepsFromTrace(['scope_gate:controller', 'premise_gate:controller', 'lead_plan:lead_agent', 'evidence_worker:worker_agent', 'evidence_worker:worker_agent:CLAUDE_REFUSED', 'verifier:deterministic_verifier']);
    expect(steps[4]).toMatchObject({ status: 'failed', code: 'CLAUDE_REFUSED' });
    expect(walkedEdges(edges, steps).map(item => item.key)).toEqual(['scope_gate->premise_gate', 'premise_gate->lead_plan', 'lead_plan->evidence_worker', 'evidence_worker->verifier']);
    expect(burstIndex(steps, 3)).toBe(0);
    expect(burstIndex(steps, 4)).toBe(1);
  });
  it('supports a premise_gate controller node between scope_gate and lead_plan', () => {
    const withPremise = ['scope_gate', 'premise_gate', ...nodes.filter(node => node !== 'scope_gate')];
    const premiseEdges: GraphEdge[] = [{ from: 'scope_gate', to: 'premise_gate', conditional: true }, { from: 'premise_gate', to: 'lead_plan', conditional: true }, ...edges];
    const steps = [step(1, 'scope_gate'), step(2, 'premise_gate'), step(3, 'lead_plan')];
    expect(walkedEdges(premiseEdges, steps).map(item => item.key)).toEqual(['scope_gate->premise_gate', 'premise_gate->lead_plan']);
    expect(graphStates(withPremise, steps, false).premise_gate).toBe('done');
    const layout = graphLayout(withPremise, 'row');
    expect(layout.points.premise_gate!.x).toBeGreaterThan(layout.points.scope_gate!.x);
    expect(layout.points.premise_gate!.x).toBeLessThan(layout.points.lead_plan!.x);
  });
});

describe('graphLayout and edgePath', () => {
  it('draws neighbours straight and skips as arcs inside the view box', () => {
    for (const orientation of ['row', 'column'] as const) {
      const layout = graphLayout(nodes, orientation);
      expect(Object.keys(layout.points)).toEqual([...nodes]);
      for (const edge of edges.filter(item => nodes.includes(item.from) && nodes.includes(item.to))) {
        const d = edgePath(layout, nodes, edge)!;
        expect(d).toMatch(/^M/);
        for (const value of d.match(/-?\d+(\.\d+)?/g)!.map(Number)) expect(value).toBeGreaterThanOrEqual(0);
      }
    }
    expect(edgePath(graphLayout(nodes, 'row'), nodes, { from: '__start__', to: 'scope_gate', conditional: false })).toBeNull();
  });
});

describe('reveal gating and reduced motion', () => {
  it('only hides content when motion is allowed and an observer exists', () => {
    expect(revealState(true, true, false)).toBe('static');
    expect(revealState(false, false, false)).toBe('static');
    expect(revealState(false, true, false)).toBe('pending');
    expect(revealState(false, true, true)).toBe('in');
  });
  it('treats a missing matchMedia as reduced and respects the media query', () => {
    expect(prefersReducedMotion(undefined)).toBe(true);
    expect(prefersReducedMotion({})).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });
  it('never calls Element.animate under reduced motion', () => {
    const animate = vi.fn(() => ({}) as Animation);
    expect(animateOnce({ animate }, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 }, true)).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    animateOnce({ animate }, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 }, false);
    expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], { fill: 'none', duration: 300 });
    expect(animateOnce(null, [], {}, false)).toBeNull();
  });
  it('remembers a paused orbit and defaults to running', () => {
    expect(readOrbitPreference({ getItem: () => 'paused' })).toBe(false);
    expect(readOrbitPreference({ getItem: () => null })).toBe(true);
    expect(readOrbitPreference({ getItem: () => { throw new Error('blocked'); } })).toBe(true);
    expect(readOrbitPreference(undefined)).toBe(true);
  });
});
