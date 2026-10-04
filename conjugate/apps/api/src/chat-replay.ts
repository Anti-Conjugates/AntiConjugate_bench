import { ChatResultSchema, chatExecutionIsConsistent, guardReplayIsConsistent, premiseGate } from '@her2/shared';
import { PREMISE_FACTS } from './turn-guard.js';
import { chatReply } from './chat.js';
import { fingerprint, HARNESS_CODE_SHA256 } from './research-harness.js';
import { replayResearchResult } from './research-replay.js';
import { loadRuntimeSkills } from './research-skills.js';
import { runResearch } from './research.js';

export async function replayChatResult(input: unknown) {
  const result = ChatResultSchema.parse(input);
  if (!chatExecutionIsConsistent(result) || result.harness.code_sha256 !== HARNESS_CODE_SHA256 || result.reply !== chatReply(result.status, result.audits, result.selected_audit_ids, result.missing_scopes.length)) throw new Error('Chat replay execution or rendered reply mismatch.');
  if (result.guard && !guardReplayIsConsistent(result.guard, premiseGate('', PREMISE_FACTS).facts_sha256, result.status)) throw new Error('Chat replay premise guard mismatch.');
  const skills = result.harness.model_calls ? await loadRuntimeSkills('linker_release') : [];
  if (fingerprint(result.harness.skills) !== fingerprint(skills.map(({ name, version, sha256 }) => ({ name, version, sha256 })))) throw new Error('Chat replay skill fingerprint mismatch.');
  for (const audit of result.audits) {
    await replayResearchResult(audit.result);
    const fresh = await runResearch({ ...audit.scope, engine: 'evidence', integrity_drill: 'none', synthetic_confirmed: true }, { claude: { timeoutMs: audit.result.harness.limits.deadline_ms } });
    const rendering = (value: typeof fresh) => ({ ...value, id: null, created_at: null, trace: value.trace.map(step => ({ ...step, duration_ms: 0 })) });
    if (fingerprint(rendering(fresh)) !== fingerprint(rendering(audit.result))) throw new Error('Chat replay audit rendering mismatch.');
  }
  return { passed: true, kind: 'chat_audits_and_rendering_replay_not_model_rerun', audits: result.audits.length, guard: result.guard ? 'checked_without_raw_question' : 'absent_pre_premise_gate',
    limitations: 'Checks saved audits and controller reply against this code and snapshot. Does not authenticate execution, reconstruct raw intent, prove model behavior or establish scientific truth.', clinical_release: 'blocked' };
}
