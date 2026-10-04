import { ResearchRequestSchema, ResearchResultSchema, researchExecutionIsConsistent } from '@her2/shared';
import { auditResearchDraft } from './research.js';
import { fingerprint, HARNESS_CODE_SHA256 } from './research-harness.js';
import { loadRuntimeSkills } from './research-skills.js';
import { allowedTools, readResearchTool } from './research-evidence.js';

export async function replayResearchResult(data: unknown) {
  const result = ResearchResultSchema.parse(data);
  const request = ResearchRequestSchema.parse({ product_id: result.product_id, question_id: result.question_id,
    evidence_policy: result.evidence_policy, integrity_drill: result.integrity_drill, engine: result.engine, synthetic_confirmed: true });
  const manifest = result.harness;
  if (manifest.code_sha256 !== HARNESS_CODE_SHA256 || manifest.request_sha256 !== fingerprint(request)) throw new Error('Replay code or request fingerprint mismatch.');
  if (manifest.sources.length !== result.receipts.length || new Set(manifest.sources.map(source => source.id)).size !== manifest.sources.length
    || manifest.sources.some(source => !result.receipts.some(receipt => receipt.id === source.id && fingerprint(receipt) === source.sha256))) {
    throw new Error('Replay source fingerprint mismatch.');
  }
  const skills = request.engine === 'claude' ? await loadRuntimeSkills(request.question_id) : [];
  if (JSON.stringify(manifest.skills) !== JSON.stringify(skills.map(({ name, version, sha256 }) => ({ name, version, sha256 })))) throw new Error('Replay prompt fingerprint mismatch.');
  const executed = result.trace.filter(step => step.stage === 'retrieve' && step.status === 'completed' && step.tool !== null);
  if (manifest.model_calls !== (request.engine === 'claude' ? 2 : 0) || !researchExecutionIsConsistent(result)
    || executed.length === 0 || (request.engine === 'evidence' && executed.length !== allowedTools(request).length)
    || executed.some(step => {
      const sources = readResearchTool(step.tool!, request);
      return sources.length !== step.source_ids.length || sources.some(source => !step.source_ids.includes(source.id));
    })) throw new Error('Replay call-count or tool/source execution mismatch.');
  const audit = auditResearchDraft(request, result.draft, result.receipts);
  if ((result.draft_integrity === 'accepted') !== audit.accepted || fingerprint(result.claims) !== fingerprint(audit.claims)
    || fingerprint(result.omitted_claim_ids) !== fingerprint(audit.omitted_claim_ids)
    || fingerprint(result.challenges) !== fingerprint(audit.challenges)) throw new Error('Replay verifier outcome mismatch.');
  return { passed: true, kind: 'verifier_replay_not_model_rerun', code_sha256: HARNESS_CODE_SHA256,
    draft_integrity: result.draft_integrity, clinical_release: 'blocked' };
}
