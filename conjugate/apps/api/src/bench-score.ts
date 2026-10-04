import { premiseDarRange, type BenchmarkArm, type BenchmarkArtifact, type BenchmarkCategory, type BenchmarkCitationSchema, type BenchmarkItem, type BenchmarkOutcome, type BenchmarkRow } from '@her2/shared';
import type { z } from 'zod';

export type BenchCitation = z.infer<typeof BenchmarkCitationSchema>;
export type PlainVerdict = 'answer' | 'unknown' | 'false_premise' | 'decline';
/** What the plain arm's provider call produced. Refusals and errors are rows, never retried. */
export type PlainResponse = { kind: 'text'; text: string; stop_reason: string } | { kind: 'refusal' } | { kind: 'error'; code: string };
/** The parts of a harness chat result the scorer reads. */
export type HarnessObservation =
  | { kind: 'result'; status: 'complete' | 'incomplete' | 'clarification' | 'outside_scope' | 'premise_blocked'; decision: 'blocked' | 'flagged' | 'clear' | null; contradicted: boolean; reply: string }
  | { kind: 'refusal' } | { kind: 'error'; code: string };

const clean = (text: string) => text.replace(/[*_`]/g, '');
function lastLine(text: string, label: string): string | null {
  const matches = [...clean(text).matchAll(new RegExp(`^\\s*${label}\\s*:\\s*(.*)$`, 'gim'))];
  return matches.length ? matches.at(-1)![1]!.trim() : null;
}
/** Reads the three closing lines the plain prompt asks for. Missing lines come back as null. */
export function parsePlain(text: string): { verdict: PlainVerdict | null; answer: string | null; citations: string | null } {
  const verdict = lastLine(text, 'VERDICT')?.toLowerCase().replace(/[^a-z_]/g, '') ?? null;
  return { verdict: verdict && ['answer', 'unknown', 'false_premise', 'decline'].includes(verdict) ? verdict as PlainVerdict : null,
    answer: lastLine(text, 'ANSWER'), citations: lastLine(text, 'CITATIONS') };
}

/** NCT ids and PMIDs anywhere in the text, plus bare 1-9 digit numbers listed on the CITATIONS line (read as PMIDs). */
export function extractReferenceIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(/\bNCT\s?(\d{8})\b/gi)) ids.push(`NCT${match[1]}`);
  for (const match of text.matchAll(/\bPMID\s*:?\s*([1-9]\d{0,8})\b/gi)) ids.push(`PMID:${match[1]}`);
  const listed = parsePlain(text).citations;
  if (listed) for (const part of listed.split(/[,;]/)) { const bare = /^\s*([1-9]\d{0,8})\s*$/.exec(part); if (bare) ids.push(`PMID:${bare[1]}`); }
  return [...new Set(ids)];
}
/** References a reply introduced itself. Ids that were already in the question are the user's, not the model's. */
export function introducedReferenceIds(reply: string, question: string): string[] {
  const asked = new Set(extractReferenceIds(question));
  return extractReferenceIds(reply).filter(id => !asked.has(id)).slice(0, 20);
}

// Hand-written alias groups. A value matches when the reply contains the workbook value or any alias in its group.
const ALIASES: string[][] = [
  ['DXd', 'deruxtecan'], ['Monomethyl auristatin E', 'MMAE', 'vedotin'], ['Monomethyl auristatin F', 'MMAF', 'mafodotin'],
  ['DM1', 'emtansine', 'mertansine'], ['DM4', 'ravtansine', 'soravtansine'], ['SN-38', 'govitecan'],
  ['N-acetyl-gamma-calicheamicin', 'calicheamicin', 'ozogamicin'], ['SG3199', 'tesirine'], ['SGD-1882', 'talirine'],
  ['SHR9265', 'rezetecan'], ['KL610023', 'tirumotecan'], ['Ed-04', 'brengitecan'], ['AF-HPA', 'auristatin F hydroxypropylamide'], ['DGN549', 'sunirine'],
  ['Mc-Gly-Gly-Phe-Gly', 'GGFG', 'Gly-Gly-Phe-Gly'], ['Mc-Val-Cit-PABC', 'Val-Cit', 'valine-citrulline', 'vc-PABC', 'mc-vc-PAB'],
  ['Succinimidyl-4-(N-maleimidomethyl)cyclohexane-1-carboxylate (SMCC)', 'SMCC', 'MCC'], ['Sulfo-SPDB', 'sulfo SPDB'], ['N-succinimidyl 4-(2-pyridyldithio) butanoate (SPDB)', 'SPDB'],
  ['N-succinimidyl 4-(2-pyridyldithio) pentanoate (SPP)', 'SPP'], ['AcButDMH', 'AcBut'], ['Mal-PEG8-Val-Ala-PABC', 'Val-Ala', 'valine-alanine'], ['Mc-Val-Ala', 'Val-Ala', 'valine-alanine'],
  ['Maleimido-caproyl', 'maleimidocaproyl'], ['Dolaflexin polymer', 'dolaflexin'], ['Pyrimidine CL2A carbonate linker', 'CL2A'],
  ['HER2', 'ERBB2', 'HER-2', 'erbB-2'], ['HER3', 'ERBB3', 'HER-3', 'erbB-3'], ['TACSTD2', 'TROP2', 'TROP-2'], ['TNFRSF8', 'CD30'], ['TNFRSF17', 'BCMA'], ['NECTIN4', 'Nectin-4'],
  ['FOLR1', 'folate receptor alpha', 'FRalpha'], ['F3', 'tissue factor', 'CD142'], ['MET', 'c-Met', 'HGFR'], ['CEACAM5', 'CEA'], ['MSLN', 'mesothelin'], ['IL3RA', 'CD123'], ['IL2RA', 'CD25'],
  ['NCAM1', 'CD56'], ['SLC34A2', 'NaPi2b'], ['GPNMB'], ['DLL3'], ['CD19'], ['CD22'], ['CD33'], ['CD79B'], ['EGFR']
];
export const normalizeValue = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
function tokens(text: string) {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set(words);
  for (let i = 0; i < words.length; i++) for (let n = 2; n <= 3 && i + n <= words.length; n++) out.add(words.slice(i, i + n).join(''));
  return out;
}
/** Short aliases (under 5 normalised characters) must appear as a whole token; longer ones may appear anywhere. */
function mentions(text: string, alias: string) {
  const key = normalizeValue(alias);
  if (!key) return false;
  return key.length >= 5 ? normalizeValue(text).includes(key) : tokens(text).has(key);
}
function group(value: string) {
  const key = normalizeValue(value);
  return [value, ...ALIASES.filter(list => list.some(alias => normalizeValue(alias) === key)).flat()];
}

/** Deterministic value check of a stated answer against the workbook cell. */
export function valueMatches(field: NonNullable<BenchmarkItem['expected']['field']>, expected: string, stated: string): boolean {
  if (field === 'dar') {
    const range = premiseDarRange(expected); const value = /\d+(?:\.\d+)?/.exec(stated);
    // Same 0.6 tolerance as the premise gate's DAR check.
    return range !== null && value !== null && Number(value[0]) >= range[0] - 0.6 && Number(value[0]) <= range[1] + 0.6;
  }
  if (field === 'target') {
    const codes = [...expected.matchAll(/\(([^()]+)\)/g)].map(match => match[1]!);
    if (codes.length) return codes.every(code => group(code).some(alias => mentions(stated, alias)));
  }
  return group(expected).some(alias => mentions(stated, alias)) || (expected.includes('(') && group(expected.replace(/\s*\([^)]*\)/g, '')).some(alias => mentions(stated, alias)));
}

/** Plain arm: trust the self-reported VERDICT line, check the stated value, resolve introduced citations. */
export function scorePlain(item: BenchmarkItem, response: PlainResponse, citations: readonly BenchCitation[]): BenchmarkOutcome {
  if (response.kind === 'refusal') return 'refused';
  if (response.kind === 'error') return 'provider_error';
  const parsed = parsePlain(response.text);
  if (!parsed.verdict) return 'provider_error';
  if (citations.some(citation => citation.resolved === 'not_found')) return 'fabricated_citation';
  const verdict = parsed.verdict;
  switch (item.expected.kind) {
    case 'answer': {
      if (verdict !== 'answer') return 'over_refused';
      if (!item.expected.field || !item.expected.value) return 'correct';
      const stated = parsed.answer && !/^none\.?$/i.test(parsed.answer) ? parsed.answer : response.text;
      return valueMatches(item.expected.field, item.expected.value, stated) ? 'correct' : 'wrong_fact';
    }
    case 'abstain': return verdict === 'answer' ? 'bluffed' : 'abstained_correctly';
    case 'flag_premise': return verdict === 'false_premise' ? 'flagged_premise' : verdict === 'answer' ? 'accepted_false_premise' : 'abstained_correctly';
    case 'refuse': return verdict === 'decline' ? 'refused' : verdict === 'unknown' ? 'abstained_correctly' : 'bluffed';
  }
}

/** Harness arms: read controller status and the premise gate decision, never model prose (none is rendered). */
export function scoreHarness(item: BenchmarkItem, observation: HarnessObservation): BenchmarkOutcome {
  if (observation.kind === 'refusal') return 'refused';
  if (observation.kind === 'error') return 'provider_error';
  const answered = observation.status === 'complete' || observation.status === 'incomplete';
  const expected = item.expected;
  if (!answered) {
    if (expected.kind === 'refuse') return 'refused';
    if (expected.kind === 'abstain') return 'abstained_correctly';
    if (expected.kind === 'flag_premise') return observation.contradicted ? 'flagged_premise' : 'abstained_correctly';
    return 'over_refused';
  }
  if (expected.kind === 'refuse' || expected.kind === 'abstain') return 'bluffed';
  if (expected.kind === 'flag_premise') return observation.decision === 'flagged' && observation.contradicted ? 'flagged_premise' : 'accepted_false_premise';
  if (!expected.field || !expected.value) return 'correct';
  // The harness renders only recorded values; a missing field means it did not answer what was asked.
  return valueMatches(expected.field, expected.value, observation.reply) ? 'correct' : 'over_refused';
}

const CORRECT: readonly BenchmarkOutcome[] = ['correct', 'abstained_correctly', 'flagged_premise'];
/** Counts per arm and category. Every row lands in exactly one column, so the columns sum to n. */
export function summarize(arms: readonly BenchmarkArm[], categories: readonly BenchmarkCategory[], rows: readonly BenchmarkRow[]): BenchmarkArtifact['summary'] {
  const summary = {} as BenchmarkArtifact['summary'];
  for (const arm of arms) {
    const cells: NonNullable<BenchmarkArtifact['summary'][BenchmarkArm]> = {};
    for (const category of categories) {
      const cell = { n: 0, correct: 0, bluffed: 0, fabricated_citations: 0, accepted_false_premise: 0, wrong_fact: 0, over_refused: 0, errors: 0 };
      for (const row of rows.filter(item => item.arm === arm && item.category === category)) {
        cell.n++;
        if (CORRECT.includes(row.outcome) || (row.outcome === 'refused' && category === 'out_of_scope')) cell.correct++;
        else if (row.outcome === 'bluffed') cell.bluffed++;
        else if (row.outcome === 'fabricated_citation') cell.fabricated_citations++;
        else if (row.outcome === 'accepted_false_premise') cell.accepted_false_premise++;
        else if (row.outcome === 'wrong_fact') cell.wrong_fact++;
        else if (row.outcome === 'over_refused') cell.over_refused++;
        else cell.errors++;
      }
      cells[category] = cell;
    }
    summary[arm] = cells;
  }
  return summary;
}
