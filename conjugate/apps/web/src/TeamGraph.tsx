import { useId, type CSSProperties } from 'react';
import { TEAM_GRAPH, type TeamStep } from '@her2/shared';
import { burstIndex, edgeKey, edgePath, graphLayout, graphStates, walkedEdges, type GraphEdge, type NodeState } from './motion';

/** Any TeamStep works; recorded replays only need these fields. */
export type GraphStep = Pick<TeamStep, 'id' | 'status' | 'actor' | 'code'> & { node: string };

const NODE_LABELS: Record<string, string> = {
  scope_gate: 'Scope gate', premise_gate: 'Premise gate', lead_plan: 'Lead plans', evidence_worker: 'Workers check', verifier: 'Verifier',
  lead_select: 'Lead selects', omission_gate: 'Omission gate', answer: 'Answer',
};
const ACTOR_LABELS: Record<TeamStep['actor'], string> = { controller: 'code', lead_agent: 'Claude lead', worker_agent: 'Claude worker', deterministic_verifier: 'verifier code' };
export const nodeLabel = (node: string) => NODE_LABELS[node] ?? node.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const STATE_TEXT: Record<NodeState, string> = { done: 'done', failed: 'failed', active: 'latest event', waiting: 'waiting', skipped: 'not reached' };

/** Parses recorded eval traces of the form "node:actor" or "node:actor:CODE". */
export function stepsFromTrace(trace: readonly string[]): GraphStep[] {
  return trace.map((entry, index) => {
    const [node = '', actor = 'controller', code = null] = entry.split(':');
    return { id: `step-${index + 1}`, node, actor: actor as TeamStep['actor'], status: code ? 'failed' : 'completed', code };
  });
}

function nodeNote(node: string, steps: readonly GraphStep[], state: NodeState) {
  const reached = steps.filter(step => step.node === node);
  if (!reached.length) return STATE_TEXT[state];
  const failed = reached.find(step => step.status === 'failed');
  if (failed) return failed.code ?? 'failed';
  const actor = ACTOR_LABELS[reached[0]!.actor] ?? reached[0]!.actor;
  return `${reached.length > 1 ? `${reached.length} × ` : ''}${actor}`;
}

function GraphSvg({ orientation, steps, pending, sequence, labelId }: { orientation: 'row' | 'column'; steps: readonly GraphStep[]; pending: boolean; sequence: boolean; labelId: string }) {
  const nodes = TEAM_GRAPH.nodes as readonly string[];
  const edges = TEAM_GRAPH.edges as readonly GraphEdge[];
  const layout = graphLayout(nodes, orientation);
  const states = graphStates(nodes, steps, pending);
  const walked = walkedEdges(edges, steps);
  const firstReach = (node: string) => steps.findIndex(step => step.node === node);
  const delay = (node: string) => {
    const index = firstReach(node);
    if (index < 0) return 0;
    return sequence ? walked.findIndex(item => item.key.endsWith(`->${node}`)) + 1 : burstIndex(steps, index);
  };
  const { nodeWidth: w, nodeHeight: h } = layout;
  return <svg className={`tg-svg tg-${orientation}`} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-labelledby={labelId} role="img" preserveAspectRatio="xMidYMid meet">
    <g className="tg-edges" aria-hidden="true">
      {edges.map(edge => { const d = edgePath(layout, nodes, edge); return d && <path key={edgeKey(edge)} d={d} className="tg-edge" data-conditional={edge.conditional || undefined} />; })}
      {walked.map(item => { const edge = edges.find(candidate => edgeKey(candidate) === item.key)!; const d = edgePath(layout, nodes, edge); return d && <path key={item.key} d={d} pathLength={1} className="tg-walk" style={{ '--tg-i': sequence ? item.order : 0 } as CSSProperties} />; })}
    </g>
    <g className="tg-nodes" aria-hidden="true">
      {nodes.map(node => { const point = layout.points[node]!; const state = states[node]!; return <g key={node} className="tg-node" data-state={state} data-node={node} transform={`translate(${point.x - w / 2} ${point.y - h / 2})`} style={{ '--tg-i': delay(node) } as CSSProperties}>
        <g className="tg-node-body">
          <rect width={w} height={h} rx="8" />
          <text x={w / 2} y={orientation === 'row' ? 21 : 18} textAnchor="middle" className="tg-label">{nodeLabel(node)}</text>
          <text x={w / 2} y={orientation === 'row' ? 38 : 33} textAnchor="middle" className="tg-note">{nodeNote(node, steps, state)}</text>
        </g>
      </g>; })}
    </g>
  </svg>;
}

/** SVG view of the LangGraph agent team. Nodes and edges come from TEAM_GRAPH; state comes only from received steps. */
export function TeamGraph({ steps, pending = false, sequence = false, caption }: { steps: readonly GraphStep[]; pending?: boolean; sequence?: boolean; caption?: string }) {
  const id = useId();
  const nodes = TEAM_GRAPH.nodes as readonly string[];
  const states = graphStates(nodes, steps, pending);
  const summary = nodes.map(node => `${nodeLabel(node)}: ${nodeNote(node, steps, states[node]!)}`).join('; ');
  return <figure className="tg" data-pending={pending || undefined}>
    <span id={id} className="sr-only">Agent team graph. {summary}.</span>
    <GraphSvg orientation="row" steps={steps} pending={pending} sequence={sequence} labelId={id} />
    <GraphSvg orientation="column" steps={steps} pending={pending} sequence={sequence} labelId={id} />
    {caption && <figcaption>{caption}</figcaption>}
  </figure>;
}
