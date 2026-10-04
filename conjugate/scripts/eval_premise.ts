import * as productCatalog from '../packages/shared/src/products.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { premiseFacts, premiseGate, PremiseCheckSchema, PREMISE_ATTRIBUTION, WorkbookDatasetSchema, type PremiseDecision, type PremiseReport } from '@her2/shared';
import { fingerprint } from '../apps/api/src/research-harness.js';
import { studyManifest } from './eval_verifier.js';
import { PREMISE_CASES, PREMISE_FAMILIES, variantsOf, type PremiseCase } from './premise_fixtures.js';

const require = createRequire(import.meta.url);
export const PREMISE_EXHIBIT = 'Kadcyla has a cleavable linker, so how fast is DM1 released in blood?';
const dataset = WorkbookDatasetSchema.parse(JSON.parse(readFileSync(new URL('../apps/api/src/workbook.snapshot.json', import.meta.url), 'utf8')));
export const PREMISE_FACTS = premiseFacts(dataset);
export const PREMISE_CHECKS = PremiseCheckSchema.options.filter(check => check !== 'resolved_reference' && check !== 'internal_error');
const CONTRADICTION_CHECKS = PREMISE_CHECKS.filter(check => check.startsWith('contradicted_'));
const UNVERIFIABLE_CHECKS = PREMISE_CHECKS.filter(check => !check.startsWith('contradicted_'));
const source = readFileSync(new URL('../packages/shared/src/premise.ts', import.meta.url), 'utf8');
type Gate = typeof premiseGate;
type Special = 'always_clear' | 'precedence_inverted';

export function compiledGate(disabled: readonly string[], special?: Special): Gate {
  if (new Set(disabled).size !== disabled.length) throw new Error('Mutant target did not match exactly once.');
  const file = ts.createSourceFile('premise.ts', source, ts.ScriptTarget.ES2022, true);
  const hits = new Map<string, number>(); const f = ts.factory;
  const ternary = (test: string, yes: string, no: ts.Expression) => f.createConditionalExpression(f.createIdentifier(test), f.createToken(ts.SyntaxKind.QuestionToken), f.createStringLiteral(yes), f.createToken(ts.SyntaxKind.ColonToken), no);
  const transform: ts.TransformerFactory<ts.SourceFile> = context => {
    const visit: ts.Visitor = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'add'
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && disabled.includes(node.arguments[0].text)) {
        const id = node.arguments[0].text; hits.set(id, (hits.get(id) ?? 0) + 1);
        return f.updateCallExpression(node, node.expression, node.typeArguments, [node.arguments[0], f.createTrue(), ...node.arguments.slice(2)]);
      }
      if (special && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'decision') {
        hits.set(special, (hits.get(special) ?? 0) + 1);
        const value = special === 'always_clear' ? f.createStringLiteral('clear') : ternary('contradicted', 'flagged', ternary('blocking', 'blocked', f.createStringLiteral('clear')));
        return f.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, value);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit) as ts.SourceFile;
  };
  const result = ts.transform(file, [transform]);
  let changed: string;
  try { changed = ts.createPrinter().printFile(result.transformed[0]!); } finally { result.dispose(); }
  if ([...disabled, ...(special ? [special] : [])].some(id => hits.get(id) !== 1)) throw new Error('Mutant target did not match exactly once.');
  const js = ts.transpileModule(changed, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { premiseGate?: Gate } = {};
  const sandboxRequire = (id: string) => { if (id === 'zod') return require('zod'); if (id === './products.js') return productCatalog; throw new Error(`Unexpected import ${id}`); };
  runInNewContext(js, { exports, require: sandboxRequire, TextEncoder }, { timeout: 1000 });
  if (!exports.premiseGate) throw new Error('Premise gate compilation failed.');
  return exports.premiseGate;
}

const RANK: Record<PremiseDecision, number> = { clear: 0, flagged: 1, blocked: 2 };
const factsFor = (allowlist?: readonly string[]) => allowlist ? { ...PREMISE_FACTS, allowlisted: PREMISE_FACTS.allowlisted.filter(id => allowlist.includes(id)) } : PREMISE_FACTS;
const run = (gate: Gate, item: Pick<PremiseCase, 'message' | 'references' | 'allowlist'>) => gate(item.message, factsFor(item.allowlist), item.references ? { references: item.references } : {});
const checksOf = (report: PremiseReport) => report.findings.map(finding => finding.check).sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

export function runPremiseStudy() {
  const variants = [{ name: 'unmodified_compiled', disabled: [] as string[], special: undefined as Special | undefined },
    ...PREMISE_CHECKS.map(check => ({ name: check, disabled: [check] as string[], special: undefined })),
    { name: 'contradiction_checks_removed', disabled: CONTRADICTION_CHECKS, special: undefined },
    { name: 'unverifiable_checks_removed', disabled: UNVERIFIABLE_CHECKS, special: undefined },
    { name: 'precedence_inverted', disabled: [], special: 'precedence_inverted' as const },
    { name: 'always_clear', disabled: [], special: 'always_clear' as const }];
  const gates = variants.map(variant => ({ ...variant, gate: compiledGate(variant.disabled, variant.special) }));
  let compiledAgrees = true;
  const rows = PREMISE_CASES.map(item => {
    const healthy = run(premiseGate, item);
    const decisions = gates.map(variant => ({ name: variant.name, report: run(variant.gate, item) }));
    if (fingerprint(decisions[0]!.report) !== fingerprint(healthy)) compiledAgrees = false;
    const variantRows = variantsOf(item.message).map(variant => {
      const report = run(premiseGate, { message: variant.message, ...(item.references ? { references: item.references } : {}), ...(item.allowlist ? { allowlist: item.allowlist } : {}) });
      return { variant: variant.id, message: variant.message, decision: report.decision, agrees: report.decision === healthy.decision && same(checksOf(report), checksOf(healthy)) };
    });
    return { case_id: item.id, family: item.family, kind: item.family === 'control' ? 'control' as const : 'fault' as const, message: item.message,
      expected_decision: item.expect.decision, decision: healthy.decision, expected_checks: [...item.expect.checks].sort(), checks: checksOf(healthy),
      as_expected: healthy.decision === item.expect.decision && same(checksOf(healthy), [...item.expect.checks].sort()),
      weakened_by: decisions.slice(1).filter(entry => RANK[entry.report.decision] < RANK[healthy.decision]).map(entry => entry.name),
      variants: variantRows };
  });
  const controls = rows.filter(row => row.kind === 'control'); const faults = rows.filter(row => row.kind === 'fault');
  const gatedFaults = faults.filter(row => row.decision !== 'clear');
  const mutants = variants.slice(1).map(variant => {
    const escapes = gatedFaults.filter(row => row.weakened_by.includes(variant.name));
    const controlsCleared = controls.filter(row => run(gates.find(entry => entry.name === variant.name)!.gate, PREMISE_CASES.find(item => item.id === row.case_id)!).decision === 'clear').length;
    return { name: variant.name, disabled_checks: variant.disabled, detected: escapes.length > 0, escaped_faults: escapes.length, faults: gatedFaults.length,
      controls_cleared: controlsCleared, controls: controls.length, examples: escapes.slice(0, 3).map(row => row.case_id) };
  });
  const allVariants = rows.flatMap(row => row.variants);
  const byFamily = PREMISE_FAMILIES.map(family => {
    const inFamily = rows.filter(row => row.family === family);
    return { family, cases: inFamily.length, as_expected: inFamily.filter(row => row.as_expected).length,
      variants: inFamily.flatMap(row => row.variants).length, variants_agree: inFamily.flatMap(row => row.variants).filter(row => row.agrees).length };
  });
  const passed = compiledAgrees && rows.every(row => row.as_expected) && controls.every(row => row.decision === 'clear')
    && allVariants.every(row => row.agrees) && mutants.every(row => row.controls_cleared === row.controls) && mutants.every(row => row.detected);
  return { kind: 'developer_authored_premise_gate_sensitivity_not_clinical', generated_at: new Date().toISOString(), manifest: studyManifest('./eval_premise.ts'),
    gate_function_sha256: fingerprint(source), facts_sha256: premiseGate('', PREMISE_FACTS).facts_sha256, attribution: PREMISE_ATTRIBUTION, provider_requests: 0,
    passed, compiled_agrees: compiledAgrees, exhibit: { question: PREMISE_EXHIBIT, report: premiseGate(PREMISE_EXHIBIT, PREMISE_FACTS) },
    controls_cleared: controls.filter(row => row.decision === 'clear').length, control_count: controls.length,
    faults_as_expected: faults.filter(row => row.as_expected).length, fault_count: faults.length,
    variants_agree: allVariants.filter(row => row.agrees).length, variant_count: allVariants.length,
    mutants_detected: mutants.filter(row => row.detected).length, mutant_count: mutants.length, by_family: byFamily, mutants, rows,
    limits: ['Developer-written fixtures checked against the frozen workbook snapshot table, not a clinical benchmark and not an unseen holdout.',
      'A flagged or blocked premise is a table mismatch, not a scientific or clinical ruling.',
      'Mutants change the premise gate in memory only, never the app; overlapping checks can leave mutants surviving and survivors are shown.',
      'References are unresolved here; existence of a resolved reference is never treated as evidence.',
      'No model or network calls; counts are finite software coverage, not a probability of anything.'] };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const out = runPremiseStudy();
  writeFileSync(new URL('../evals/premise-study.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ passed: out.passed, controls: `${out.controls_cleared}/${out.control_count}`, faults: `${out.faults_as_expected}/${out.fault_count}`,
    variants: `${out.variants_agree}/${out.variant_count}`, mutants: `${out.mutants_detected}/${out.mutant_count}` }));
  if (!out.passed) process.exitCode = 1;
}
