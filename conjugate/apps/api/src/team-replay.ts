import { TeamResultSchema, guardReplayIsConsistent, premiseGate, renderChatReply, teamExecutionIsConsistent } from '@her2/shared';
import { PREMISE_FACTS } from './turn-guard.js';
import { fingerprint, HARNESS_CODE_SHA256 } from './research-harness.js';
import { replayResearchResult } from './research-replay.js';
import { runResearch } from './research.js';

/** Replays the deterministic parts of an agent-team turn. Model behaviour is not rerun; only its accepted identifiers are checked. */
export async function replayTeamResult(input: unknown) {
  const result = TeamResultSchema.parse(input);
  if (!teamExecutionIsConsistent(result) || result.harness.code_sha256 !== HARNESS_CODE_SHA256 || result.reply !== renderChatReply(result.status, result.audits, result.selected_audit_ids, result.missing_scopes.length)) throw new Error('Team replay execution or rendered reply mismatch.');
  for (const audit of result.audits) {
    await replayResearchResult(audit.result);
    const fresh = await runResearch({ ...audit.scope, engine: 'evidence', integrity_drill: 'none', synthetic_confirmed: true }, { claude: { timeoutMs: audit.result.harness.limits.deadline_ms } });
    const rendering = (value: typeof fresh) => ({ ...value, id: null, created_at: null, trace: value.trace.map(step => ({ ...step, duration_ms: 0 })) });
    if (fingerprint(rendering(fresh)) !== fingerprint(rendering(audit.result))) throw new Error('Team replay audit rendering mismatch.');
  }
  if (result.guard && !guardReplayIsConsistent(result.guard, premiseGate('', PREMISE_FACTS).facts_sha256, result.status)) throw new Error('Team replay premise guard mismatch.');
  return { passed: true, kind: 'team_audits_and_rendering_replay_not_model_rerun', audits: result.audits.length, guard: result.guard ? 'checked_without_raw_question' : 'absent_pre_premise_gate', workers: result.workers.length,
    limitations: 'Checks saved audits, worker bookkeeping and controller reply against this code and snapshot. Does not rerun the lead or worker models, authenticate execution or establish scientific truth.', clinical_release: 'blocked' };
}
