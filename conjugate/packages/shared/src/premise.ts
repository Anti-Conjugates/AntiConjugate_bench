import { z } from 'zod';
import type { WorkbookDataset } from './research.js';
import { WORKBOOK_PRODUCT_IDS, WorkbookProductIdSchema } from './products.js';

export const PREMISE_ATTRIBUTION = {
  repository: 'https://github.com/Anti-Conjugates/adc-guardrail',
  commit: '5ac1c1a',
  files: ['adcg/premise.py', 'adcg/kb.py'],
  scope: 'category names and approach adapted; no code, data, thresholds or benchmark results imported'
} as const;
export const PREMISE_LIMITATION = 'Compared with the user-uploaded workbook snapshot and draft UK label paraphrases pending pharmacist review. A match or mismatch is a table comparison, not a scientific or clinical ruling.';

const PREMISE_LABELS = {
  DRG0CYMEB: { brand: 'Kadcyla', aliases: ['T-DM1', 'TDM1', 'ado-trastuzumab emtansine'], composition: 'UK-KADCYLA-SMPC',
    toxicities: { ild: 'UK-KADCYLA-SMPC-4.4-PULMONARY', liver: 'UK-KADCYLA-SMPC-4.4-LIVER', nrh: 'UK-KADCYLA-SMPC-4.4-LIVER', thrombocytopenia: 'UK-KADCYLA-SMPC-4.4-PLATELETS', bleeding: 'UK-KADCYLA-SMPC-4.4-PLATELETS', cardiac: 'UK-KADCYLA-SMPC-4.4-CARDIAC', neuropathy: 'UK-KADCYLA-SMPC-4.4-NEUROPATHY' } },
  DRG0ERKBH: { brand: 'Enhertu', aliases: ['T-DXd', 'TDXd', 'fam-trastuzumab deruxtecan', 'fam-trastuzumab deruxtecan-nxki'], composition: 'UK-ENHERTU-SMPC',
    toxicities: { ild: 'UK-ENHERTU-SMPC-4.4-ILD', neutropenia: 'UK-ENHERTU-SMPC-4.4-CBC', cardiac: 'UK-ENHERTU-SMPC-4.4-CARDIAC', liver: 'UK-ENHERTU-SMPC-4.8-LIVER-PLATELETS', thrombocytopenia: 'UK-ENHERTU-SMPC-4.8-LIVER-PLATELETS' } }
} as const;
type PremiseProductId = keyof typeof PREMISE_LABELS;
const PRODUCT_IDS = Object.keys(PREMISE_LABELS) as PremiseProductId[];
interface PremiseLabel { brand: string; aliases: readonly string[]; composition: string; toxicities: Readonly<Record<string, string>> }
const LABELS: Partial<Record<string, PremiseLabel>> = PREMISE_LABELS;
const TOXICITY_TERMS: Record<string, { label: string; pattern: RegExp }> = {
  ild: { label: 'ILD / pneumonitis', pattern: /\b(?:ILD|interstitial lung disease|pneumonitis|lung toxicity|pulmonary toxicity)\b/i },
  nrh: { label: 'nodular regenerative hyperplasia', pattern: /\b(?:NRH|nodular regenerative hyperplasia)\b/i },
  liver: { label: 'liver abnormalities', pattern: /\b(?:hepatotoxicity|hepatic toxicity|liver (?:injury|toxicity|damage|abnormalities)|transaminase (?:increases?|elevations?))\b/i },
  thrombocytopenia: { label: 'thrombocytopenia', pattern: /\bthrombocytopenia\b/i },
  bleeding: { label: 'haemorrhage', pattern: /\b(?:haemorrhage|hemorrhage|bleeding)\b/i },
  cardiac: { label: 'left ventricular dysfunction', pattern: /\b(?:cardiotoxicity|cardiac (?:toxicity|dysfunction)|heart failure|left ventricular dysfunction|LVEF decreases?)\b/i },
  neuropathy: { label: 'peripheral neuropathy', pattern: /\b(?:peripheral neuropathy|neuropathy|neurotoxicity)\b/i },
  neutropenia: { label: 'neutropenia', pattern: /\b(?:febrile neutropenia|neutropenia)\b/i }
};
export const PREMISE_EVIDENCE_IDS = [...new Set([...WORKBOOK_PRODUCT_IDS.map(id => `WORKBOOK-${id}-COMPOSITION`), ...PRODUCT_IDS.flatMap(id => [PREMISE_LABELS[id].composition, ...Object.values(PREMISE_LABELS[id].toxicities)])])].sort() as [string, ...string[]];

export const PremiseKindSchema = z.enum(['unverifiable_entity', 'unsupported_product', 'unverifiable_construct', 'unverifiable_reference', 'contradicted_premise', 'resolved_reference', 'internal_error']);
export const PremiseCheckSchema = z.enum(['invented_inn', 'invented_code', 'unsupported_product', 'unverifiable_construct', 'nct_reference', 'pmid_reference', 'author_year_reference',
  'contradicted_payload', 'contradicted_target', 'contradicted_linker', 'contradicted_dar', 'contradicted_no_risk', 'resolved_reference', 'internal_error']);
export const PremiseDecisionSchema = z.enum(['blocked', 'flagged', 'clear']);
export const PremiseFindingSchema = z.object({
  kind: PremiseKindSchema, check: PremiseCheckSchema, text: z.string().min(1).max(400),
  stated: z.string().max(300).nullable(), recorded: z.string().max(300).nullable(),
  product_id: WorkbookProductIdSchema.nullable(),
  evidence_ids: z.array(z.enum(PREMISE_EVIDENCE_IDS)).max(4), limitation: z.literal(PREMISE_LIMITATION)
}).strict();
export const PremiseReportSchema = z.object({
  version: z.literal('conjugate-premise-1'), decision: PremiseDecisionSchema,
  findings: z.array(PremiseFindingSchema).max(40), facts_sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export const PremiseReferenceResolutionSchema = z.object({ status: z.enum(['exists', 'not_found', 'error']), title: z.string().trim().min(1).max(300).optional() }).strict();
export const PremiseReferencesSchema = z.record(z.string().max(80), PremiseReferenceResolutionSchema);
export const PremiseFactRowSchema = z.object({
  id: z.string().regex(/^DRG0[A-Z0-9]+$/), name: z.string(), brand: z.string().nullable(), antibody: z.string().nullable(), linker_payload: z.string().nullable(),
  target: z.string(), payload: z.string(), linker: z.string(), dar: z.string()
}).strict();
export const PremiseFactsSchema = z.object({ dataset_sha256: z.string().regex(/^[a-f0-9]{64}$/), rows: z.array(PremiseFactRowSchema).min(1), allowlisted: z.array(WorkbookProductIdSchema) }).strict();

export type PremiseKind = z.infer<typeof PremiseKindSchema>;
export type PremiseCheck = z.infer<typeof PremiseCheckSchema>;
export type PremiseDecision = z.infer<typeof PremiseDecisionSchema>;
export type PremiseFinding = z.infer<typeof PremiseFindingSchema>;
export type PremiseReport = z.infer<typeof PremiseReportSchema>;
export type PremiseReferences = z.infer<typeof PremiseReferencesSchema>;
export type PremiseFacts = z.infer<typeof PremiseFactsSchema>;
export interface PremiseOptions { references?: PremiseReferences }

const BLOCKING_KINDS: readonly PremiseKind[] = ['unverifiable_entity', 'unsupported_product', 'unverifiable_construct', 'unverifiable_reference', 'internal_error'];
export function premiseFindingBlocks(finding: Pick<PremiseFinding, 'kind'>) { return BLOCKING_KINDS.includes(finding.kind); }

export function premiseFacts(dataset: Pick<WorkbookDataset, 'sha256' | 'records'>): PremiseFacts {
  const cell = (record: WorkbookDataset['records'][number], field: string) => { const value = record.cells.find(item => item.field === field)?.value?.trim(); return value && value !== 'None' ? value : null; };
  return PremiseFactsSchema.parse({
    dataset_sha256: dataset.sha256,
    rows: dataset.records.map(record => ({ id: record.id, name: record.name, brand: record.brand && record.brand !== 'None' ? record.brand : null, antibody: cell(record, 'Antibody'),
      linker_payload: cell(record, 'Linker-payload'), target: record.target, payload: record.payload ?? '', linker: record.linker ?? '', dar: record.dar ?? '' })),
    allowlisted: WORKBOOK_PRODUCT_IDS.filter(id => dataset.records.some(record => record.id === id))
  });
}

const NCT = /\bNCT\d{8}\b/gi;
const PMID = /\bPMID:?\s*\d{5,9}\b/gi;
const AUTHOR_YEAR = /\b[A-Z][a-z]+(?:\s+et\s+al\.?|\s+and\s+[A-Z][a-z]+)\s*,?\s*\(?(?:19|20)\d{2}\)?/g;
export function premiseReferenceId(raw: string) {
  const text = raw.trim();
  if (/^NCT\d{8}$/i.test(text)) return text.toUpperCase();
  const pmid = /^PMID:?\s*(\d{5,9})$/i.exec(text);
  if (pmid) return `PMID:${pmid[1]}`;
  return text.replace(/[()]/g, '').replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
export function premiseReferences(message: string) {
  return { nct: [...new Set((message.match(NCT) ?? []).map(premiseReferenceId))], pmid: [...new Set((message.match(PMID) ?? []).map(premiseReferenceId))], author_year: [...new Set((message.match(AUTHOR_YEAR) ?? []).map(premiseReferenceId))] };
}
export function maskPremiseReferences(message: string) { return message.replace(NCT, ' reference ').replace(PMID, ' reference ').replace(AUTHOR_YEAR, ' reference '); }

const PAYLOADS: Record<string, RegExp> = {
  DM1: /(?<![a-z0-9])(?:dm1|emtansine|mertansine)(?![a-z0-9])/i,
  DM4: /(?<![a-z0-9])(?:dm4|soravtansine|ravtansine)(?![a-z0-9])/i,
  DXd: /(?<![a-z0-9])(?:dxd|deruxtecan)(?![a-z0-9])/i,
  MMAE: /(?<![a-z0-9])(?:mmae|monomethyl auristatin e|vedotin)(?![a-z0-9])/i,
  MMAF: /(?<![a-z0-9])(?:mmaf|monomethyl auristatin f|mafodotin)(?![a-z0-9])/i,
  'SN-38': /(?<![a-z0-9])(?:sn-?38|govitecan)(?![a-z0-9])/i,
  calicheamicin: /(?<![a-z0-9])(?:calicheamicin|ozogamicin)(?![a-z0-9])/i,
  PBD: /(?<![a-z0-9])(?:pbd|pyrrolobenzodiazepine|sg3199|tesirine)(?![a-z0-9])/i
};
const PAYLOAD_TOKEN = 'mmae|mmaf|dm1|dm4|dxd|sn-?38|pbd|deruxtecan|emtansine|vedotin|govitecan|monomethyl auristatin [ef]|calicheamicin';
const ANTIGENS: Record<string, RegExp> = {
  HER2: /(?<![a-z0-9])(?:her2|her-2|erbb2|erbb-2|human epidermal growth factor receptor 2)(?![a-z0-9])/i,
  HER3: /(?<![a-z0-9])(?:her3|her-3|erbb3|erbb-3)(?![a-z0-9])/i,
  TROP2: /(?<![a-z0-9])(?:trop2|trop-2|tacstd2)(?![a-z0-9])/i,
  EGFR: /(?<![A-Za-z0-9])EGFR(?![A-Za-z0-9])|(?<!human )epidermal growth factor receptor(?!\s*[23])/,
  CD30: /(?<![a-z0-9])(?:cd30|tnfrsf8)(?![a-z0-9])/i, CD33: /(?<![a-z0-9])cd33(?![a-z0-9])/i, CD22: /(?<![a-z0-9])cd22(?![a-z0-9])/i,
  CD19: /(?<![a-z0-9])cd19(?![a-z0-9])/i, CD79B: /(?<![a-z0-9])cd79b(?![a-z0-9])/i, CD123: /(?<![a-z0-9])(?:cd123|il3ra)(?![a-z0-9])/i,
  CD25: /(?<![a-z0-9])(?:cd25|il2ra)(?![a-z0-9])/i, BCMA: /(?<![a-z0-9])(?:bcma|tnfrsf17)(?![a-z0-9])/i, NECTIN4: /(?<![a-z0-9])(?:nectin-?4)(?![a-z0-9])/i,
  FOLR1: /(?<![a-z0-9])(?:folr1|folate receptor alpha)(?![a-z0-9])/i, MET: /(?<![A-Za-z0-9])(?:MET|c-Met|c-MET)(?![A-Za-z0-9])/, CEACAM5: /(?<![a-z0-9])ceacam5(?![a-z0-9])/i,
  MSLN: /(?<![a-z0-9])(?:mesothelin|msln)(?![a-z0-9])/i, DLL3: /(?<![a-z0-9])dll3(?![a-z0-9])/i, SLC34A2: /(?<![a-z0-9])(?:slc34a2|napi2b)(?![a-z0-9])/i,
  GPNMB: /(?<![a-z0-9])gpnmb(?![a-z0-9])/i, NCAM1: /(?<![a-z0-9])(?:ncam1|cd56)(?![a-z0-9])/i, TISSUE_FACTOR: /(?<![a-z0-9])tissue factor(?![a-z0-9])/i
};
const NEGATION = /\b(?:not|no|never|neither|nor|without|instead of|rather than|unlike|isn't|doesn't|aren't|don't|wasn't)\b[^.?!;]{0,24}$/i;
const DRUG_NEG = /\b(?:never|does not|doesn't|do not|cannot|can't|has no|have no|carries no|carry no|no (?:risk|incidence|cases|reports?)|zero|free of|devoid of|without any risk)\b/i;
const NEG_AFTER = /^[^.?!;]{0,20}?\b(?:risk\s+)?(?:is|was)\s+(?:zero|nil|absent|non-existent|impossible)\b/i;
const CLEAVABLE_NON = /\b(?:non[- ]?cleavable|un-?cleavable|(?:not|never|isn't)\s+(?:\w+\s+)?cleavable)\b/gi;
const SUFFIX_SHAPE = /(?:dotin|tecan|ansine|amicin|irine)$/;
const STOPWORDS = new Set(['The', 'That', 'This', 'It', 'Which', 'And', 'Or', 'With', 'For', 'In', 'Is', 'Was', 'Of', 'To', 'A', 'An']);

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const stripPrefix = (stem: string) => stem.split('-').at(-1) ?? stem;
function canonicalSet(text: string, table: Record<string, RegExp>, asserted = false) {
  const out = new Set<string>();
  for (const [canonical, pattern] of Object.entries(table)) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    for (const match of text.matchAll(global)) if (!asserted || !NEGATION.test(text.slice(0, match.index))) { out.add(canonical); break; }
  }
  return out;
}
function cleavable(linker: string): boolean | null {
  if (/non[- ]?cleavable|smcc|\bmcc\b/i.test(linker)) return false;
  if (/cleavable|val-?cit|val-?ala|gly-?gly-?phe-?gly|hydrazone|disulfide|cl2a/i.test(linker)) return true;
  return null;
}
export function premiseDarRange(cell: string): [number, number] | null {
  const values = (cell.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
}
const DAR = /\b(?:DAR|drug[- ]to[- ]antibody ratio)\b([^0-9.?!;]{0,25}?)(\d+(?:\.\d+)?)/i;

interface Entry { row: PremiseFacts['rows'][number]; label: string }
interface Mention { entry: Entry; start: number; end: number }

function evaluatePremise(message: string, facts: PremiseFacts, references: PremiseReferences): PremiseReport {
  const findings: PremiseFinding[] = [];
  const add = (check: PremiseCheck, clear: boolean, finding: () => Omit<PremiseFinding, 'check' | 'limitation'>) => { if (!clear) findings.push({ ...finding(), check, limitation: PREMISE_LIMITATION }); };
  const text = message.replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  const allowlisted = new Set<string>(facts.allowlisted);
  const alias = new Map<string, Entry>(); const pairs = new Set<string>(); const partners = new Map<string, Set<string>>(); const suffixes = new Set<string>();
  for (const row of facts.rows) {
    const extra = allowlisted.has(row.id) ? (LABELS[row.id]?.aliases ?? []) : [];
    const entry: Entry = { row, label: row.brand ?? row.name };
    const names = [row.name, row.brand ?? '', ...(row.antibody && row.linker_payload ? [`${row.antibody} ${row.linker_payload}`] : []), ...extra];
    for (const name of names) {
      if (norm(name).length >= 4 && !alias.has(norm(name))) alias.set(norm(name), entry);
      const words = name.trim().split(/\s+/);
      if (words.length >= 2 && words.at(-2)!.toLowerCase().endsWith('mab')) {
        const stem = norm(stripPrefix(words.at(-2)!)); const suffix = norm(words.at(-1)!);
        pairs.add(`${stem}:${suffix}`); suffixes.add(suffix);
        partners.set(stem, (partners.get(stem) ?? new Set()).add(words.at(-1)!.toLowerCase()));
      }
    }
  }
  const tokens = [...text.matchAll(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)].map(match => ({ value: match[0].replace(/'s$/i, ''), start: match.index, end: match.index + match[0].length }));
  const mentions: Mention[] = [];
  for (let i = 0; i < tokens.length;) {
    let matched = 0;
    for (const n of [4, 3, 2, 1]) {
      const chunk = tokens.slice(i, i + n);
      if (chunk.length < n) continue;
      const hit = alias.get(norm(chunk.map(token => token.value).join(' ')));
      if (hit) { mentions.push({ entry: hit, start: chunk[0]!.start, end: chunk.at(-1)!.end }); matched = n; break; }
    }
    i += matched || 1;
  }

  const inventedSpans: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/\b((?:[a-z]+-)?[a-z]{3,}mab)\s+([a-z]{4,})\b/gi)) {
    const stem = norm(stripPrefix(match[1]!)); const suffix = norm(match[2]!);
    const known = [...(partners.get(stem) ?? [])].sort();
    const listedInn = !(suffixes.has(suffix) || SUFFIX_SHAPE.test(suffix)) || pairs.has(`${stem}:${suffix}`);
    if (!listedInn) inventedSpans.push({ start: match.index, end: match.index + match[0].length });
    add('invented_inn', listedInn, () => ({ kind: 'unverifiable_entity',
      text: `No ADC named '${match[1]} ${match[2]}' is in the workbook snapshot${known.length ? `; ${stripPrefix(match[1]!).toLowerCase()} appears there only as ${known.join(', ')}` : ''}.`,
      stated: `${match[1]} ${match[2]}`, recorded: null, product_id: null, evidence_ids: [] }));
  }
  const codes = new Set<string>();
  for (const pattern of [/\b(?:experimental|investigational|novel|unreleased|unpublished|undisclosed|hypothetical|fictional|new|candidate)\s+(?:HER2[- ](?:targeted\s+|directed\s+)?)?(?:ADC|antibody[- ]drug conjugate|conjugate)\s+(?:called\s+|named\s+)?([A-Za-z][\w-]*)/gi,
    /\b(?:ADC|antibody[- ]drug conjugate|conjugate)\s+(?:called|named|codenamed|code-named)\s+([A-Za-z][\w-]*)/gi, /\b([A-Z]{1,5}-?\d{2,6}[A-Za-z]?)\s+(?:ADC|antibody[- ]drug conjugate|conjugate)\b/g])
    for (const match of text.matchAll(pattern)) if (/^[A-Z]/.test(match[1]!) && !STOPWORDS.has(match[1]!)) codes.add(match[1]!);
  const componentNames = new Set(facts.rows.flatMap(row => [row.payload, row.linker, row.linker_payload ?? ''].flatMap(value => [norm(value), ...value.split(/[\s();]+/).map(norm)])).filter(Boolean));
  for (const code of codes) add('invented_code', alias.has(norm(code)) || componentNames.has(norm(code)) || canonicalSet(code, PAYLOADS).size > 0, () => ({ kind: 'unverifiable_entity',
    text: `'${code}' is described as an ADC but has no row in the workbook snapshot.`, stated: code, recorded: null, product_id: null, evidence_ids: [] }));
  for (const entry of new Set(mentions.map(mention => mention.entry))) add('unsupported_product', allowlisted.has(entry.row.id), () => ({ kind: 'unsupported_product',
    text: `${entry.label} is a workbook snapshot row but not one of the two products with local label paraphrases, so it is not audited here.`,
    stated: entry.label, recorded: `${entry.row.id}: ${entry.row.name}`, product_id: null, evidence_ids: [] }));
  const statedDar = DAR.exec(text);
  for (const match of text.matchAll(new RegExp(`\\b([a-z]{3,}mab)\\s*(?:[-/]\\s*|\\s+(?:linked|conjugated|coupled|attached)\\s+(?:to|with)\\s+(?:an?\\s+|the\\s+)?)(${PAYLOAD_TOKEN})(?![a-z0-9])`, 'gi'))) {
    const stem = match[1]!.toLowerCase(); const payload = [...canonicalSet(match[2]!, PAYLOADS)][0];
    const range = statedDar && !NEGATION.test(statedDar[1]!) ? Number(statedDar[2]) : null;
    const rows = facts.rows.filter(row => [row.antibody ?? '', row.name].some(name => name.toLowerCase().includes(stem))
      && payload !== undefined && canonicalSet(`${row.payload} ${row.linker_payload ?? ''}`, PAYLOADS).has(payload)
      && (range === null || ((dar = premiseDarRange(row.dar)) => dar !== null && range >= dar[0] - 0.6 && range <= dar[1] + 0.6)()));
    add('unverifiable_construct', rows.length > 0, () => ({ kind: 'unverifiable_construct',
      text: `No workbook row pairs ${stem} with ${payload ?? match[2]}${range === null ? '' : ` at DAR ${range}`}.`, stated: match[0], recorded: null, product_id: null, evidence_ids: [] }));
  }
  const resolution = (id: string) => references[id];
  const resolved = (id: string, title: string | undefined) => findings.push({ kind: 'resolved_reference', check: 'resolved_reference',
    text: `${id}: the registry returned a record. Only its existence is noted; its content is not evidence here.`, stated: id, recorded: title ?? null, product_id: null, evidence_ids: [], limitation: PREMISE_LIMITATION });
  const unresolvedText = (id: string, holder: string) => resolution(id)?.status === 'not_found' ? `${id}: the registry returned no record.`
    : resolution(id)?.status === 'error' ? `${id}: the registry lookup failed, so it stays unverified.` : `${id} cannot be checked: Conjugate holds no ${holder}.`;
  const listed = premiseReferences(text);
  for (const id of listed.nct) { if (resolution(id)?.status === 'exists') resolved(id, resolution(id)?.title); else add('nct_reference', false, () => ({ kind: 'unverifiable_reference', text: unresolvedText(id, 'trial registry'), stated: id, recorded: null, product_id: null, evidence_ids: [] })); }
  for (const id of listed.pmid) { if (resolution(id)?.status === 'exists') resolved(id, resolution(id)?.title); else add('pmid_reference', false, () => ({ kind: 'unverifiable_reference', text: unresolvedText(id, 'literature index'), stated: id, recorded: null, product_id: null, evidence_ids: [] })); }
  for (const id of listed.author_year) { if (resolution(id)?.status === 'exists') resolved(id, resolution(id)?.title); else add('author_year_reference', false, () => ({ kind: 'unverifiable_reference', text: unresolvedText(id, 'literature index'), stated: id, recorded: null, product_id: null, evidence_ids: [] })); }

  const clauses: { start: number; end: number }[] = [];
  for (const sentence of text.matchAll(/[\s\S]+?(?:[.?!;]+(?=\s|$)|$)/g)) {
    const start = sentence.index; const end = start + sentence[0].length;
    const inside = (from: number, to: number) => new Set(mentions.filter(m => m.start >= from && m.end <= to).map(m => m.entry)).size;
    if (inside(start, end) <= 1) { clauses.push({ start, end }); continue; }
    let from = start;
    for (const split of sentence[0].matchAll(/\s+(?:while|whereas|but)\s+|,\s+(?:while|whereas|but)\s+/gi)) { clauses.push({ start: from, end: start + split.index }); from = start + split.index + split[0].length; }
    clauses.push({ start: from, end });
  }
  for (const clause of clauses) {
    const inClause = mentions.filter(m => m.start >= clause.start && m.end <= clause.end);
    const entries = new Set(inClause.map(m => m.entry));
    if (entries.size !== 1) continue;
    const entry = [...entries][0]!; const id = WorkbookProductIdSchema.parse(entry.row.id);
    if (!allowlisted.has(id)) continue;
    const chars = [...text.slice(clause.start, clause.end)];
    for (const m of [...inClause, ...inventedSpans]) for (let i = Math.max(0, m.start - clause.start); i < Math.min(chars.length, m.end - clause.start); i++) chars[i] = ' ';
    const body = chars.join('');
    const label = LABELS[id]; const brand = label?.brand ?? entry.label; const evidence = [`WORKBOOK-${id}-COMPOSITION`, ...(label ? [label.composition] : [])];
    const ownPayload = canonicalSet(`${entry.row.payload} ${entry.row.linker_payload ?? ''}`, PAYLOADS); const askedPayload = canonicalSet(body, PAYLOADS, true);
    add('contradicted_payload', !askedPayload.size || !ownPayload.size || [...askedPayload].some(item => ownPayload.has(item)), () => ({ kind: 'contradicted_premise',
      text: `The workbook records ${brand} with payload ${entry.row.payload}, not ${[...askedPayload].join('/')}.`, stated: [...askedPayload].join('/'), recorded: entry.row.payload, product_id: id, evidence_ids: evidence }));
    const ownTarget = canonicalSet(entry.row.target, ANTIGENS); const askedTarget = canonicalSet(body, ANTIGENS, true);
    add('contradicted_target', !askedTarget.size || !ownTarget.size || [...askedTarget].some(item => ownTarget.has(item)), () => ({ kind: 'contradicted_premise',
      text: `The workbook records ${brand} as targeting ${[...ownTarget].join('/')}, not ${[...askedTarget].join('/')}.`, stated: [...askedTarget].join('/'), recorded: entry.row.target, product_id: id, evidence_ids: evidence }));
    const own = cleavable(entry.row.linker);
    const statedNon = CLEAVABLE_NON.test(body); CLEAVABLE_NON.lastIndex = 0;
    const statedPlain = /\bcleavable\b/i.test(body.replace(CLEAVABLE_NON, ' '));
    const linkerConflict = (own === true && statedNon && !statedPlain) || (own === false && statedPlain && !statedNon);
    add('contradicted_linker', !linkerConflict, () => ({ kind: 'contradicted_premise',
      text: `The workbook${label ? ' and label paraphrase record' : ' records'} the ${brand} linker as ${own ? 'cleavable' : 'non-cleavable'}, not ${own ? 'non-cleavable' : 'cleavable'}.`,
      stated: own ? 'non-cleavable' : 'cleavable', recorded: entry.row.linker, product_id: id, evidence_ids: evidence }));
    const dar = DAR.exec(body); const range = premiseDarRange(entry.row.dar);
    const value = dar && !NEGATION.test(dar[1]!) ? Number(dar[2]) : null;
    add('contradicted_dar', value === null || range === null || (value >= range[0] - 0.6 && value <= range[1] + 0.6), () => ({ kind: 'contradicted_premise',
      text: `The workbook records ${brand} DAR as ${entry.row.dar}; the stated ${value} is more than 0.6 outside it.`, stated: String(value), recorded: entry.row.dar, product_id: id, evidence_ids: [`WORKBOOK-${id}-COMPOSITION`] }));
    const tail = text.slice(Math.min(...inClause.map(m => m.end)), clause.end);
    for (const [key, sourceId] of Object.entries(label?.toxicities ?? {})) {
      const hit = TOXICITY_TERMS[key]!.pattern.exec(tail);
      const absolute = hit !== null && (DRUG_NEG.test(tail.slice(0, hit.index)) || NEG_AFTER.test(tail.slice(hit.index + hit[0].length)));
      add('contradicted_no_risk', !absolute, () => ({ kind: 'contradicted_premise',
        text: `The draft ${brand} UK label paraphrase reports ${TOXICITY_TERMS[key]!.label}; an absolute "no ${hit![0]}" premise conflicts with it.`,
        stated: hit![0], recorded: TOXICITY_TERMS[key]!.label, product_id: id, evidence_ids: [sourceId] }));
    }
  }
  const blocking = findings.some(premiseFindingBlocks);
  const contradicted = findings.some(finding => finding.kind === 'contradicted_premise');
  const decision: PremiseDecision = blocking ? 'blocked' : contradicted ? 'flagged' : 'clear';
  return { version: 'conjugate-premise-1', decision, findings, facts_sha256: premiseFactsSha256(facts) };
}

export function premiseGate(message: string, facts: PremiseFacts, options: PremiseOptions = {}): PremiseReport {
  let factsHash = '0'.repeat(64);
  try {
    const checked = PremiseFactsSchema.parse(facts); factsHash = premiseFactsSha256(checked);
    return PremiseReportSchema.parse(evaluatePremise(z.string().max(4000).parse(message), checked, PremiseReferencesSchema.parse(options.references ?? {})));
  } catch {
    return { version: 'conjugate-premise-1', decision: 'blocked', facts_sha256: factsHash, findings: [{ kind: 'internal_error', check: 'internal_error',
      text: 'The premise gate failed internally, so the turn is blocked.', stated: null, recorded: null, product_id: null, evidence_ids: [], limitation: PREMISE_LIMITATION }] };
  }
}

export function premiseReportIsConsistent(report: PremiseReport) {
  if (!PremiseReportSchema.safeParse(report).success) return false;
  const blocking = report.findings.some(premiseFindingBlocks);
  const contradicted = report.findings.some(finding => finding.kind === 'contradicted_premise');
  return report.decision === (blocking ? 'blocked' : contradicted ? 'flagged' : 'clear')
    && report.findings.every(finding => finding.kind === 'contradicted_premise' ? finding.product_id !== null && finding.evidence_ids.length > 0 : finding.evidence_ids.length === 0);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function premiseFactsSha256(facts: PremiseFacts) { return sha256Hex(canonicalJson(facts)); }

const K = Uint32Array.from([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input); const length = bytes.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64); padded.set(bytes); padded[length] = 0x80;
  const view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(length / 0x20000000)); view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]); const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15]!, b = w[i - 2]!; w[i] = (w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0; }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0; h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  return [...h].map(value => value.toString(16).padStart(8, '0')).join('');
}
export const premiseSha256Hex = sha256Hex;
