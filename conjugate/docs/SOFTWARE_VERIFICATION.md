# Software verification — 2026-10-03

## Passed
- Clean `npm ci` on Node 24.19.0 / npm 10.8.3: installed the pinned lockfile, zero reported audit vulnerabilities.
- `npm run typecheck`: strict API/web/shared and HTTP-smoke-script typechecks.
- `npm run lint`: ESLint for apps, shared contracts and scripts.
- `npm test`: 32 backend Node tests and 19 frontend Vitest boundary tests, 51 total; all passed.
- `npm run build`: production React assets generated; API TypeScript checked. Backend start uses the documented TypeScript launcher, not a nonexistent transpiled bundle.
- `npm audit`: zero reported vulnerabilities in the final dependency tree. This is not a security certification.
- `npm run dev`: API and Vite listening successfully.
- `npm run smoke`: actual HTTP page, Vite proxy, health/catalog, both evidence-mode product contracts, blocked research-only gate, sources/trace and safe invalid/synthetic/no-key errors.
- `SMOKE_BASE_URL=http://127.0.0.1:3001 npm run smoke`: same checks against built-UI/static and API on the single backend port.
- Source scan found no literal Anthropic keys; no runtime `.env` file was created. Archive excludes `.env` files and dependencies.

## Independent review findings addressed
- Unified Vite version resolution; fixed previously incompatible React-plugin types.
- Root test script now explicitly runs backend Node tests and frontend Vitest tests.
- Static API-path checks normalize decoded paths, covering repeated slashes, dot segments and encoded separators; route regression tests pass.
- Laboratory units are now associated with accessible input descriptions.
- Patched dependencies and verified a clean install. npm 10's dependency-graph update crash was worked around with npm 11.6.2; the final lockfile's npm 10 clean install works.

## Explicitly not verified
- Browser rendering, screen reader, keyboard, responsive/zoom or UI end-to-end interactions. The user explicitly excluded browser automation. Preview is for manual inspection.
- Real Claude Opus 5.5 calls/account access. Provider request behavior is mocked in tests and reviewed against official documentation; a secure replacement key has not been supplied.
- Hugging Face / Google Antigravity: user-managed integrations, not connected or executed.
- Installation of the fork as a Cursor plugin.
- Semantic completeness of label paraphrases, pharmacist approval, clinical safety, calibration or clinical validation.
- Clinical benchmark or plain-LLM comparison. No clinician cases, answer keys or scoring scripts were accessed or created.

All outputs remain unapproved research drafts, `needs_human=true`, clinical-release gate blocked, eligibility not assessed and probability fields null.

## Modal addition
Modal 1.5.5 was installed in an isolated Python 3.10 environment. The separate CPU square example passed Ruff, strict mypy, dependency compatibility checks, import/app registration and `square.local(42) == 1764`. Typechecks/lint and all 51 existing app tests passed again. SDK setup started without opening a browser and awaits user authorization. The remote call has **not** run. No HER2 app or model was deployed.


## Update, 2026-10-03 later: plain copy, Claude refusal handling, evals, antibody map

### Passed
- `npm run typecheck`, `npm run lint`, `npm test` (56 backend Node tests, 43 frontend Vitest tests), `npm run build`, `npm run smoke` against the dev server, `npm audit` (0 vulnerabilities).
- `npx tsc --noEmit -p tsconfig.scripts.json` for `scripts/eval.ts` and `scripts/smoke.ts`.
- Docker image from the repository `Dockerfile` built (895 MB) and served `/api/health`, `/api/research/catalog`, a rules-only Enhertu linker-release run (contradicted, citations accepted, draft pending pharmacist) and the built UI on port 7860. Without a key it returned `CLAUDE_NOT_CONFIGURED` for a Claude request and did not fall back.
- Live `claude-opus-5-5` through `runResearch`: the eval grid below.

### Claude refusal finding
One scope (Kadcyla, linker release, workbook only) failed two of three times with `CLAUDE_INVALID_OUTPUT`. The upstream response had `stop_reason: "refusal"`, no content blocks and zero output tokens: the Anthropic API's own classifier stopped the request, not malformed model output. Fixes: the adapter now reports `CLAUDE_REFUSED` (HTTP 502, fail closed, no rules-only fallback) for that stop reason, and both system prompts were rewritten in plain language. A first rewrite of the draft prompt made Claude omit the claim on nine scopes because it read "include the claim" as "assert the claim"; the prompt now says the claim id names the question under audit and the verifier decides the verdict. The refusal classifier is outside this app's control and can still fire.

### Evals (`npm run eval`, 2026-10-03T16:48:45.812Z)
Software checks on the verifier, not a clinical benchmark. Expected claims and sources are the app's own definitions.
- Injected bad citations rejected: 48/48.
- Verdicts that changed when the label summary was withheld: 1/8 (DRG0ERKBH linker_release contradicted to insufficient).
- Scripted strategies accepted: abstain_all 0/16, cite_everything 2/16, duplicate_claim 0/16, other_product_label 0/16, invented_source 0/16, swap_product 0/16, honest_expected 16/16. Accepted non-control drafts: cite_everything on DRG0CYMEB composition workbook_only; cite_everything on DRG0ERKBH composition workbook_only. In those scopes the only retrieved source is the one expected source, so citing everything equals citing the right thing.
- Claude plan and draft, 16 scopes: completed 15, accepted by the verifier 15, failed 1 (DRG0CYMEB payload_risk_transfer all: CLAUDE_REFUSED). Median plan 2374 ms, draft 3004 ms, end to end 5322 ms.

### Antibody sequence map
`scripts/embed_antibodies.py` embedded 29 of 31 workbook antibodies from public Thera-SAbDab VH/VL sequences with `facebook/esm2_t33_650M_UR50D` (revision `08e4846e`) on CPU. Two rows unmatched (bispecific or missing chain; no exact name match). PCA explained variance 0.40 and 0.13; Spearman between cosine similarity and sequence identity 0.60. Exploratory only. Not evidence about binding, efficacy, safety or interchangeability, and not used by Check a claim.

### Still not verified
- Browser rendering and screen-reader behaviour. The user excluded browser automation.
- Hugging Face Space deployment (image built locally only), Hugging Face and Google Antigravity integrations, Modal remote execution.
- Pharmacist review, clinical validation, calibration, resistance to model strategies beyond the scripted ones.
