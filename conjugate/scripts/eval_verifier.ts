import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { EvidencePolicySchema, ResearchQuestionSchema, type ResearchDraft, type ResearchReceipt, type ResearchRequest } from '@her2/shared';
import { auditResearchDraft } from '../apps/api/src/research.js';
import { allowedTools, DATASET_SHA256, derivedSourceId, expectedClaim, labelSourceId, readResearchTool, receiptIntegrity, workbookSourceId } from '../apps/api/src/research-evidence.js';
import { openFdaSourceId } from '../apps/api/src/research-openfda.js';
import { fingerprint, HARNESS_CODE_SHA256 } from '../apps/api/src/research-harness.js';

export const STUDY_SEEDS = [17, 29, 43] as const;
export const studyScopes: ResearchRequest[] = (['DRG0CYMEB', 'DRG0ERKBH'] as const).flatMap(product_id =>
  ResearchQuestionSchema.options.flatMap(question_id => EvidencePolicySchema.options.map(evidence_policy =>
    ({ product_id, question_id, evidence_policy, engine: 'evidence' as const, integrity_drill: 'none' as const, synthetic_confirmed: true as const }))));
export function shuffle<T>(values: T[], seed: number) {
  const copy = [...values]; let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1); [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
export function studyManifest(script: string) {
  return { code_sha256: HARNESS_CODE_SHA256, dataset_sha256: DATASET_SHA256,
    evaluation_sha256: fingerprint(readFileSync(new URL(script, import.meta.url), 'utf8')),
    design_sha256: fingerprint(readFileSync(new URL('../docs/EVALUATION_DESIGN.md', import.meta.url), 'utf8')),
    lockfile_sha256: fingerprint(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')),
    node: process.version, seeds: STUDY_SEEDS, scopes: studyScopes.length };
}
export const CHECKS = ['product_identity', 'source_allowlist', 'exact_source_claim_pairing', 'source_eligibility', 'evidence_availability', 'unique_claims', 'omitted_claim_ids', 'receipt_integrity'] as const;
const source = readFileSync(new URL('../apps/api/src/research.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('research.ts', source, ts.ScriptTarget.ES2022, true);
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && ['sameIds', 'auditResearchDraft'].includes(node.name?.text ?? ''));
if (functions.length !== 2) throw new Error('Verifier source extraction failed.');
const extracted = functions.map(node => node.getText(parsed)).join('\n');

export function compiledVerifier(disabled: readonly string[], alwaysAccept = false): typeof auditResearchDraft {
  if (new Set(disabled).size !== disabled.length) throw new Error('Mutant target did not match exactly once.');
  const file = ts.createSourceFile('verifier.ts', extracted, ts.ScriptTarget.ES2022, true);
  const hits = new Map<string, number>();
  const transform: ts.TransformerFactory<ts.SourceFile> = context => {
    const visit: ts.Visitor = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'add'
        && ts.isStringLiteral(node.arguments[0]!) && disabled.includes(node.arguments[0]!.text)) {
        const id = node.arguments[0]!.text; hits.set(id, (hits.get(id) ?? 0) + 1);
        return ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
          [node.arguments[0]!, ts.factory.createTrue(), ...node.arguments.slice(2)]);
      }
      if (alwaysAccept && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'accepted') {
        hits.set('always_accept', (hits.get('always_accept') ?? 0) + 1);
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, ts.factory.createTrue());
      }
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit) as ts.SourceFile;
  };
  const result = ts.transform(file, [transform]);
  let changed: string;
  try { changed = ts.createPrinter().printFile(result.transformed[0]!); } finally { result.dispose(); }
  if ([...disabled, ...(alwaysAccept ? ['always_accept'] : [])].some(id => hits.get(id) !== 1)) throw new Error('Mutant target did not match exactly once.');
  const js = ts.transpileModule(changed, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { auditResearchDraft?: typeof auditResearchDraft } = {};
  runInNewContext(js, { exports, expectedClaim, labelSourceId, workbookSourceId, derivedSourceId, openFdaSourceId, receiptIntegrity }, { timeout: 1000 });
  if (!exports.auditResearchDraft) throw new Error('Verifier compilation failed.');
  return exports.auditResearchDraft;
}
type Fault = { id: string; draft: ResearchDraft; receipts: ResearchReceipt[] };
export function faultCases(request: ResearchRequest, receipts: ResearchReceipt[], draft: ResearchDraft) {
  const cases: Fault[] = []; const excluded: string[] = [];
  const add = (id: string, change: (copy: Fault) => void) => { const copy = { id, draft: structuredClone(draft), receipts: structuredClone(receipts) }; change(copy); cases.push(copy); };
  add('wrong_product', copy => { copy.draft.product_id = request.product_id === 'DRG0ERKBH' ? 'DRG0CYMEB' : 'DRG0ERKBH'; });
  add('missing_claim', copy => { copy.draft.claims = []; });
  add('duplicate_claim', copy => { copy.draft.claims.push(structuredClone(copy.draft.claims[0]!)); });
  add('extra_claim', copy => { copy.draft.claims.push({ ...structuredClone(copy.draft.claims[0]!), claim_id: 'UNSUPPORTED-SOFTWARE-CLAIM' }); });
  add('invented_citation', copy => { copy.draft.claims[0]!.source_ids = ['INVENTED-SOFTWARE-SOURCE']; });
  add('cross_product_citation', copy => { copy.draft.claims[0]!.source_ids = [labelSourceId(request.product_id === 'DRG0ERKBH' ? 'DRG0CYMEB' : 'DRG0ERKBH')]; });
  add('receipt_text_edit', copy => { const target = copy.receipts.find(receipt => receipt.kind === 'derived') ?? copy.receipts[0]!; target.title += ' SYNTHETIC SOFTWARE FAULT'; });
  const derived = receipts.find(receipt => receipt.kind === 'derived');
  if (derived) add('derived_as_primary', copy => { copy.draft.claims[0]!.source_ids = [derived.id]; }); else excluded.push('derived_as_primary:no_derived_receipt');
  const first = draft.claims[0]!.source_ids[0];
  if (first) {
    add('duplicate_citation', copy => { copy.draft.claims[0]!.source_ids.push(first); });
    add('missing_primary_receipt', copy => { copy.receipts = copy.receipts.filter(receipt => receipt.id !== first); });
  } else excluded.push('duplicate_citation:no_primary_ids', 'missing_primary_receipt:no_primary_ids');
  if (request.evidence_policy === 'workbook_only') add('withheld_source', copy => { copy.receipts.push(...readResearchTool('read_label', { ...request, evidence_policy: 'all' })); });
  else excluded.push('withheld_source:policy_all');
  return { cases, excluded };
}

export function runVerifierStudy() {
  const variants = [{ name: 'unmodified_compiled', disabled: [] as string[], always: false },
    ...CHECKS.map(id => ({ name: id, disabled: [id], always: false })),
    { name: 'citation_defenses_removed', disabled: ['source_allowlist', 'exact_source_claim_pairing', 'source_eligibility', 'evidence_availability'], always: false },
    { name: 'always_accept', disabled: [], always: true }];
  const auditors = variants.map(variant => ({ ...variant, audit: compiledVerifier(variant.disabled, variant.always) }));
  const rows: { scope: string; case_id: string; kind: 'control' | 'fault'; healthy_accepted: boolean; accepted_by: string[]; caught_by: string[] }[] = [];
  const exclusions: { scope: string; reason: string }[] = [];
  let compiledAgrees = true; let controlSemanticsHold = true;
  for (const request of studyScopes) {
    const scope = `${request.product_id}/${request.question_id}/${request.evidence_policy}`;
    const receipts = allowedTools(request).flatMap(tool => readResearchTool(tool, request));
    const expected = expectedClaim(request, receipts);
    const draft: ResearchDraft = { product_id: request.product_id, claims: [{ claim_id: request.question_id, source_ids: expected.source_ids }] };
    const baseline = auditResearchDraft(request, draft, receipts);
    const semantics = (audit: typeof baseline) => fingerprint({ accepted: audit.accepted, verdict: audit.expected.verdict,
      source_ids: [...audit.expected.source_ids].sort(), omitted: [...audit.omitted_claim_ids].sort() });
    const controls = [{ id: 'exact_control', draft, receipts }, ...STUDY_SEEDS.map(seed => ({ id: `harmless_order_${seed}`,
      draft: { ...draft, claims: draft.claims.map(claim => ({ ...claim, source_ids: shuffle(claim.source_ids, seed) })) },
      receipts: shuffle(receipts, seed).map(receipt => Object.fromEntries(Object.entries(receipt).reverse()) as ResearchReceipt) }))];
    const faults = faultCases(request, receipts, draft);
    exclusions.push(...faults.excluded.map(reason => ({ scope, reason })));
    for (const [kind, cases] of [['control', controls], ['fault', faults.cases]] as const) for (const input of cases) {
      const healthy = auditResearchDraft(request, input.draft, input.receipts);
      const decisions = auditors.map(variant => ({ name: variant.name, accepted: variant.audit(request, input.draft, input.receipts).accepted }));
      if (fingerprint(auditors[0]!.audit(request, input.draft, input.receipts)) !== fingerprint(healthy)) compiledAgrees = false;
      if (kind === 'control' && semantics(healthy) !== semantics(baseline)) controlSemanticsHold = false;
      rows.push({ scope, case_id: input.id, kind, healthy_accepted: healthy.accepted,
        accepted_by: decisions.filter(item => item.accepted).map(item => item.name), caught_by: healthy.challenges.filter(check => check.outcome === 'caught').map(check => check.code) });
    }
  }
  const controls = rows.filter(row => row.kind === 'control'); const faults = rows.filter(row => row.kind === 'fault');
  const mutants = variants.slice(1).map(variant => {
    const escapes = faults.filter(row => !row.healthy_accepted && row.accepted_by.includes(variant.name));
    return { name: variant.name, disabled_checks: variant.disabled, detected: escapes.length > 0, escaped_faults: escapes.length,
      faults: faults.length, controls_accepted: controls.filter(row => row.accepted_by.includes(variant.name)).length, controls: controls.length,
      examples: escapes.slice(0, 3).map(row => ({ scope: row.scope, case_id: row.case_id })) };
  });
  const required = ['product_identity', 'exact_source_claim_pairing', 'unique_claims', 'omitted_claim_ids', 'receipt_integrity', 'citation_defenses_removed', 'always_accept'];
  const passed = compiledAgrees && controlSemanticsHold && controls.every(row => row.healthy_accepted) && faults.every(row => !row.healthy_accepted)
    && mutants.every(row => row.controls_accepted === row.controls) && required.every(name => mutants.some(row => row.name === name && row.detected));
  return { kind: 'developer_authored_verifier_sensitivity_not_clinical', generated_at: new Date().toISOString(), manifest: studyManifest('./eval_verifier.ts'),
    verifier_function_sha256: fingerprint(extracted), passed, compiled_agrees: compiledAgrees, control_semantics_hold: controlSemanticsHold, scope_count: studyScopes.length,
    controls_accepted: controls.filter(row => row.healthy_accepted).length, control_count: controls.length,
    faults_rejected: faults.filter(row => !row.healthy_accepted).length, fault_count: faults.length,
    mutants_detected: mutants.filter(row => row.detected).length, mutant_count: mutants.length, mutants, exclusions, rows,
    limits: ['Mutants change the real verifier function in memory only, never the app.', 'Overlapping checks can leave individual mutants surviving; survivors are shown.', 'Known fixtures, not an unseen clinical holdout.', 'No model calls; counts are finite software coverage, not a probability of safety.'] };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const out = runVerifierStudy();
  writeFileSync(new URL('../evals/verifier-study.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ passed: out.passed, mutants_detected: out.mutants_detected, mutants: out.mutant_count,
    controls: `${out.controls_accepted}/${out.control_count}`, faults: `${out.faults_rejected}/${out.fault_count}` }));
  if (!out.passed) process.exitCode = 1;
}
