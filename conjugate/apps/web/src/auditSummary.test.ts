import { describe, expect, it } from 'vitest';
import { ResearchRequestSchema } from '@her2/shared';
import { compareResults, lastEvalOutcome, outcomeOf, presets, stageStates } from './auditSummary';

// Software sentinels only. No scientific answer, clinical case or benchmark score.
const claim = (verdict: 'supported' | 'contradicted' | 'insufficient', source_ids = ['WORKBOOK-DRG0ERKBH-COMPOSITION']) => ({ verdict, source_ids });
const step = (stage: 'scope' | 'plan' | 'retrieve' | 'draft' | 'challenge' | 'verify' | 'handoff', status: 'completed' | 'blocked' | 'skipped', actor: 'controller' | 'local_tool' | 'claude' | 'deterministic_verifier' = 'controller', tool: 'read_workbook' | 'read_label' | 'read_derived' | null = null) => ({ stage, status, actor, tool });

describe('outcomeOf', () => {
  it('names a rejected draft as rejected, not as missing evidence', () => {
    expect(outcomeOf({ draft_integrity: 'rejected', claims: [] })).toBe('rejected');
    expect(outcomeOf({ draft_integrity: 'accepted', claims: [] })).toBe('insufficient');
  });
  it('lets one contradiction outrank support', () => {
    expect(outcomeOf({ draft_integrity: 'accepted', claims: [claim('supported'), claim('contradicted')] })).toBe('contradicted');
    expect(outcomeOf({ draft_integrity: 'accepted', claims: [claim('supported'), claim('insufficient')] })).toBe('insufficient');
    expect(outcomeOf({ draft_integrity: 'accepted', claims: [claim('supported')] })).toBe('supported');
  });
});

describe('stageStates', () => {
  it('marks the first stage running before any event arrives', () => {
    const states = stageStates([], true);
    expect(states.map((state) => state.status)).toEqual(['running', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
    expect(stageStates([], false).every((state) => state.status === 'pending')).toBe(true);
  });
  it('collapses retrieve events and keeps blocked over completed', () => {
    const states = stageStates([
      step('scope', 'completed'), step('plan', 'completed', 'claude'),
      step('retrieve', 'completed', 'local_tool', 'read_workbook'), step('retrieve', 'skipped', 'controller', 'read_label'), step('retrieve', 'completed', 'local_tool', 'read_derived'),
    ], true);
    expect(states[1]).toMatchObject({ stage: 'plan', status: 'completed', actors: ['claude'] });
    expect(states[2]).toMatchObject({ stage: 'retrieve', status: 'completed', tools: ['read_workbook', 'read_label', 'read_derived'] });
    expect(states[3]).toMatchObject({ stage: 'draft', status: 'running' });
    const skipped = stageStates([step('retrieve', 'skipped'), step('retrieve', 'skipped'), step('retrieve', 'skipped')], false);
    expect(skipped[2]?.status).toBe('skipped');
    const blocked = stageStates([step('challenge', 'blocked', 'deterministic_verifier'), step('challenge', 'completed', 'deterministic_verifier')], false);
    expect(blocked[4]?.status).toBe('blocked');
  });
});

describe('compareResults', () => {
  const base = {
    evidence_policy: 'all' as const, integrity_drill: 'none' as const, draft_integrity: 'accepted' as const,
    receipts: [{ id: 'WORKBOOK-DRG0ERKBH-COMPOSITION' }, { id: 'UK-ENHERTU-SMPC' }],
    claims: [claim('contradicted', ['UK-ENHERTU-SMPC'])],
    challenges: [{ code: 'source_allowlist', outcome: 'passed' as const }],
    unknowns: ['one'], guardrail: { status: 'blocked' as const, reasons: [] },
  };
  it('flags only the fields that differ', () => {
    const rows = compareResults(base, { ...base, evidence_policy: 'workbook_only', receipts: [base.receipts[0]!], claims: [claim('insufficient', ['WORKBOOK-DRG0ERKBH-COMPOSITION'])] });
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
    expect(byLabel['Sources allowed']).toMatchObject({ a: 'All sources', b: 'Workbook only', differs: true });
    expect(byLabel['Outcome']).toMatchObject({ a: 'Contradicted', b: 'Not enough evidence', differs: true });
    expect(byLabel['Clinical release']).toMatchObject({ a: 'blocked', b: 'blocked', differs: false });
    expect(byLabel['Fault injected']?.differs).toBe(false);
  });
  it('reports a rejected second run with the checks that caught it', () => {
    const rows = compareResults(base, { ...base, integrity_drill: 'invented_source', draft_integrity: 'rejected', claims: [], challenges: [{ code: 'source_allowlist', outcome: 'caught' }, { code: 'evidence_availability', outcome: 'caught' }] });
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
    expect(byLabel['Outcome']?.b).toBe('Rejected by verifier');
    expect(byLabel['Checks that caught something']).toMatchObject({ a: 'none', b: 'source_allowlist, evidence_availability' });
    expect(byLabel['Sources cited']?.b).toBe('none');
  });
});

describe('presets', () => {
  it('are valid rules-only requests for allowlisted products with a recorded eval outcome', () => {
    expect(new Set(presets.map((item) => item.id)).size).toBe(presets.length);
    for (const item of presets) {
      const parsed = ResearchRequestSchema.parse(item.request);
      expect(parsed.engine).toBe('evidence');
      expect(parsed.synthetic_confirmed).toBe(true);
      expect(['DRG0CYMEB', 'DRG0ERKBH']).toContain(parsed.product_id);
      expect(item.last_eval).toEqual(expect.any(String));
    }
  });
  it('reads eval outcomes from results.json and returns null outside the grid', () => {
    expect(lastEvalOutcome({ product_id: 'DRG0ERKBH', question_id: 'composition', evidence_policy: 'all', integrity_drill: 'invented_source' })).toBe('Rejected by verifier');
    expect(lastEvalOutcome({ product_id: 'DRG0CYMEB', question_id: 'composition', evidence_policy: 'workbook_only', integrity_drill: 'none' })).toBe('Supported');
    expect(lastEvalOutcome({ product_id: 'DRG0ERKBH', question_id: 'linker_release', evidence_policy: 'workbook_only', integrity_drill: 'none' })).toBe('Not enough evidence');
  });
});
