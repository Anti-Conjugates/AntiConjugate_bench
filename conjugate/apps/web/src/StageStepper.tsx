import type { ResearchTrace } from '@her2/shared';
import { actorLabels, stageStates, stageStatusLabels } from './auditSummary';

export function StageStepper({ trace, busy }: { trace: ResearchTrace[]; busy: boolean }) {
  if (!busy && !trace.length) return null;
  return <ol className="stepper" aria-label="Run stages">
    {stageStates(trace, busy).map((state, index) => <li key={state.stage} className={'stepper-stage stepper-' + state.status} aria-current={state.status === 'running' ? 'step' : undefined}>
      <span className="stepper-name">{index + 1}. {state.stage}</span>
      <span className="stepper-meta">{stageStatusLabels[state.status]}{state.actors.length > 0 && ', ' + state.actors.map((actor) => actorLabels[actor]).join(' and ')}</span>
      {state.tools.length > 0 && <span className="stepper-meta"><code>{state.tools.join(' ')}</code></span>}
    </li>)}
  </ol>;
}
