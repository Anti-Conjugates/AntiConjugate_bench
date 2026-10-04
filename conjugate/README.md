---
title: Conjugate
emoji: 🔬
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Checks HER2 ADC claims against cited sources
---

# Conjugate

A research prototype for checking claims about HER2 antibody-drug conjugates against an imported ADC workbook and dated UK label summaries. It also reviews made-up patient context for Kadcyla (trastuzumab emtansine) or Enhertu (trastuzumab deruxtecan). Built with React, TypeScript, Fastify, shared Zod contracts, reviewed runtime instruction packs and the project-local pstack-her2 engineering plugin.

Research prototype. Clinical use stays blocked until a pharmacist reviews it. Every result is a draft that needs human review. It does not choose treatment, give doses, assess eligibility, triage symptoms or claim clinical validation.

## Run locally

Requires Node 22 or later (verified with Node 24.19.0). From this directory:

```sh
npm ci
npm run dev
```

Open port 5173 on your own machine. Vite forwards `/api` to the loopback API on port 3001. In Devin, use the named app preview instead of a VM localhost URL.

To serve the built UI and API together:

```sh
npm run build
npm start
```

The combined app runs on port 3001. The backend serves `apps/web/dist` when it exists. It binds to `127.0.0.1` by default. This is a local prototype, not an authenticated public deployment.

If npm 10 crashes while changing the dependency graph with `edgesOut`, use `npx --yes npm@11.6.2 install`. The committed lockfile's clean `npm ci` is the intended install path. Dependency versions are pinned and the audited tree had no known vulnerabilities at verification time. That is not a security certification.

## Connect Claude

The app works without a key. Rules only mode runs every stage deterministically and the UI says so.

To enable Claude, give `ANTHROPIC_API_KEY` to the backend process only, through your secret manager, or copy `.env.example` to `.env` and set it there. The root `.env` is loaded by the server launcher and excluded from git. Do not paste keys into chat, frontend fields, `VITE_` variables or source code. Rotate any key that has been exposed.

Restart the API after setting the key, then pick Claude in the UI and tick the synthetic confirmation again. "Configured" means a key is present, not that access has been verified. The fixed runtime model id is `claude-opus-5-5`. Claude mode sends the confirmed synthetic fields and the local evidence paraphrases to Anthropic. No real patient information is allowed.

The adapter uses Anthropic structured JSON output, adaptive thinking and id-only selection. It accepts no model-written clinical prose. Provider failures are sanitised and the run fails; it does not switch to rules only on its own. If the Anthropic API stops a request with its own refusal classifier the app reports `CLAUDE_REFUSED` and nothing else; run again or use rules only. Live `claude-opus-5-5` runs through the app have been verified in development; see the Evals view for the latest grid.

For the separate Modal remote-worker example, see `docs/MODAL_SETUP.md`. It does not deploy this app or connect a scientific model.

## Research chat

The default view is a conversation. Ask about the two ADCs, inspect checked
claims and source receipts, then ask a follow-up or withhold the label. Claude
uses a native `check_evidence` loop; it selects returned audit IDs, not scientific
prose or citations. Rules only runs the same fixed audits without a model.
Raw chat text and prior answers are not sent to Claude; the controller sends
recognized terms and scopes. This finite scope guard is not a PHI detector.

See [Research chat](docs/CHAT.md) for the three-minute demo, design, limits,
software checks and replay. The public Space still has Claude disabled.
The separate Patient context path has different inputs and is not covered by
the chat projection/privacy guarantee.

## Check a claim

Start with Enhertu, the linker release question, rules only. Run it with sources set to All, then set sources to Workbook only and run again. Compare the verdict, the sources each result rests on and the trace. The two results differ because the evidence changed, not because a confidence score was simulated.

The composition question can only establish what the workbook records. An accepted draft is not a clinically approved result. Fault tests inject a bad citation after drafting so you can watch the verifier reject it. They are software checks, not measured reward-hacking behaviour or a clinical benchmark.

The ADC table keeps the workbook's 31 records, four separate author-derived rows, 69 blank cells, sheet and cell references and the original SHA-256. The table view shows the composition columns: ADCdb id, name, brand, antibody, target, linker, payload and DAR. It is a local snapshot, not a live ADCdb fetch. Only Kadcyla and Enhertu have local label summaries, so only they can be used in Patient context. Raw toxicity and pharmacokinetic text and derived notes never produce clinical flags.

For the demo walkthrough and the research behind it, see `docs/DEMO_GUIDE.md`.

### Run record and US identity check

The fifth question checks brand, generic name and application number in a frozen
US openFDA record. Withhold that source and the result becomes “Not enough
evidence”. It is separate from the UK summaries and cannot support clinical-risk
claims. Source records show SPL identifiers, effective/fetch dates and hashes.

Every research result has a Run record with model/tool counts, shared deadline,
code/input/source/skill hashes and the zero-retry policy. The Evals page also
shows a generated harness-check table. Reproduce it with `npm run eval:harness`;
recheck an exported result with `npm run replay -- export.json`. Replay runs the
verifier, not Claude. See `docs/HARNESS.md` for the design sources and limits.

### Runtime skills

`runtime-skills/evidence-retrieval`, `counter-evidence` and `provenance-review` hold short reviewed `SKILL.md` files for the Claude planner and drafter. The app loads fixed local files, not user-supplied paths, marketplace plugins or arbitrary code. These prompt packs are separate from the pstack engineering plugin and from Anthropic-hosted Skills or code-execution containers, which are not connected.

### Workbook import

The JSON snapshot is included; you do not need the original workbook to run the app. To reproduce the import:

```sh
python3 scripts/import_workbook.py /path/to/adc_table_adcdb.xlsx
```

The importer uses Python's standard library, rejects formulas, bounds file sizes, keeps missing cells as null and never evaluates workbook code. Updating the snapshot is a deliberate development change, not a runtime upload endpoint. The imported timestamp is not the ADCdb extraction date, which is unknown.

## Patient context

1. Choose the product. The two products are not interchangeable.
2. Enter made-up context. Fields start blank, and blank means unknown. Medication matching covers a small alias list, not all interactions.
3. Tick the synthetic confirmation and choose rules only or Claude.
4. Read the review flags, citations, unknowns, omitted checks and the trace the server returned.
5. Export the result as JSON if you need it. Changing any input, product or drafting option clears the previous result and cancels any run in flight.

There is no patient database or run history. Exported files can contain coarse context and unknown statements derived from the inputs, although the full request is not exported. They remain unapproved drafts.

## Architecture

- `packages/shared`: API schemas and types shared by client and server.
- `packages/shared/src/research.ts`: claim-check, workbook provenance, source receipt and streamed-event contracts.
- `apps/api/src`: product and source allowlists, deterministic rules, Claude adapter, the verifier and API tests.
- `apps/api/src/workbook.snapshot.json`: the imported workbook, labelled by provenance and kept apart from clinical rules.
- `apps/web/src`: the six views: Check a claim, Patient context, ADC table, How it works, Evals and Sources.
- `runtime-skills`: fixed, reviewed instruction files used by the optional Claude workflow.
- `pstack-her2`: MIT-preserving upstream fork with HER2 workflow and evidence skills, agent and clinical boundary rules. Read `pstack-her2/HER2_ADAPTATION.md`.
- `docs/ARCHITECTURE.md`: boundaries and contracts.
- `docs/INTEGRATIONS.md`: planned Hugging Face and Google Antigravity connections and the evidence boundary they must respect.

Context endpoints: `GET /api/health`, `GET /api/catalog`, `POST /api/runs`. Claim endpoints: `GET /api/research/catalog`, `POST /api/research/runs`, `POST /api/research/runs/stream` (NDJSON trace, result and error events). Every run requires `synthetic_confirmed: true`. The API limits body size and request rate, disables request logging and stores nothing. Unknown products, invented citations, cross-product pairs and invalid model selections fail closed.

## Evals

```sh
npm run eval
```

`scripts/eval.ts` runs the real pipeline in process and writes `evals/results.json`, which the Evals view imports at build time. It covers the all-sources against workbook-only verdict grid, 48 injected bad citations, seven scripted drafting strategies and, when `ANTHROPIC_API_KEY` is set, Claude plan and draft on all 16 scopes with timings. Expected claims and sources are the app's own server-side definitions, so these measure contract enforcement, not scientific truth. They are not the independent clinical benchmark and do not touch it.

## Antibody sequence map

```sh
python3 -m venv .venv-embed && .venv-embed/bin/pip install torch transformers scikit-learn
.venv-embed/bin/python scripts/embed_antibodies.py
```

Downloads the public Thera-SAbDab sequence table, matches workbook antibodies by name, embeds VH and VL with `facebook/esm2_t33_650M_UR50D` (mean pooled, concatenated) and writes `data/antibody_embeddings.json` with the model revision, source hash, matched and unmatched rows, PCA coordinates and cosine and sequence-identity matrices. The committed file is from a CPU run. The map is exploratory structure data only.

## Verify

```sh
npm run check
npm audit
```

With the dev server running, `npm run smoke` checks the real HTTP page, Vite proxy, API and both product contracts without a browser or model. For the built combined app use `SMOKE_BASE_URL=http://127.0.0.1:3001 npm run smoke` (POSIX shell syntax).

`check` runs strict workspace typechecks, ESLint, Node backend tests, Vitest frontend boundary tests and the production build. These are software tests, not clinician benchmark cases. Browser automation was excluded by the user. No clinical benchmark, answer key or scoring script was accessed or created.

## Limits

- UK label paraphrases are dated and linked but are not complete frozen labels. Pharmacist approval is pending.
- ADCdb links are structure references, not clinical evidence or risk predictions.
- Deterministic required-check coverage is not semantic validation of every label claim or a calibrated omission estimator.
- `needs_human` is always true. Correctness and omission probabilities are always null. Eligibility is not assessed. The context result's overall verdict stays `dont_know`. Claim results report supported, contradicted or not enough evidence without changing the clinical gate.
- No plain-LLM comparison, target-held-out evaluation or clinical benchmark has been run. The Evals view shows software checks on the verifier from `evals/results.json`; passing them does not make the app safe, calibrated or resistant to every way a model could game it.
- The antibody sequence map in ADC table is exploratory. ESM-2 embeddings of public Thera-SAbDab sequences say nothing about binding, efficacy, safety or interchangeability, and they do not feed Check a claim.
- Hugging Face and Google Antigravity are not connected. Engineering skills do not create runtime provider integrations.
- Passing software checks does not imply a live model call, a Cursor plugin install, screen-reader or browser testing, or clinical verification.

## Attribution

The pstack fork keeps its original MIT license and copyright. Upstream source: https://github.com/cursor/plugins/tree/main/pstack, inspected commit `23e4138daa01c42d4969f7a5465f82704e64f798`, plugin version `0.15.6`. Applied principles: Model the Domain (shared contracts and exact registries first) and Prove It Works (actual software checks, with untested boundaries listed separately).
