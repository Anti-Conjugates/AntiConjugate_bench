# Conjugate: HER2 evidence agent

## Purpose
Research-only review of an already-selected HER2 ADC against synthetic inputs. UK draft label summaries. Product choice, eligibility and jurisdiction suitability are not assessed. Clinical benchmark ownership stays with the independent clinician; do not create clinical cases or scores here.

## Contract and ownership
`packages/shared/src/index.ts` is the API contract. The parent owns root configuration, contracts, project docs and pstack adaptation. Backend writer owns only `apps/api/src/`; frontend writer owns only `apps/web/src/`. Reviewer is read-only after both writers complete. No remote/commits/pushes/public deployment.

## Boundary-first pipeline
1. Strict Zod validation, synthetic-data confirmation, request/body/rate limits.
2. Retrieve one exact product from the local allowlist and dated, section-linked UK label summaries. ADCdb structural links are separate, not clinical evidence. No bulk downloads or remote browsing during runs.
3. Deterministic evidence draft, or Claude Opus 5.5 bounded selection of flag IDs + source IDs via Anthropic structured JSON output. Read official provider docs: 5.5 does NOT support forced tool use or disabling thinking. Never show free-form model prose as a clinical assertion. Unknown model IDs/citations fail validation, never repair silently. No-key requests for Claude must fail clearly; evidence mode remains available as an explicit choice.
4. Independent guardrail derives required checks without using model output, checks selection identity/citations, missing inputs and omissions. Do not calculate eligibility, grades, dosage or numerical individual risk. Required check rules represent conservative software coverage, not pharmacist-approved care.
5. Build immutable trusted-template card. Expose selected flags, omitted checks, sources, unknowns, three-stage trace and gate reasons. Clinical status is always draft_pending_pharmacist; needs_human is always true. Guardrail is always blocked because pharmacist approval has not happened. Correctness/omission probabilities are null. No historical patient/run storage.

## Model constraints
Use `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`; server-only environment secret. Model defaults to `claude-opus-5-5`. Use output_config.format.type=json_schema with a bounded object containing `product_id` and `selections:[{flag_id,source_ids}]`; do not force tool_choice. max_tokens covers adaptive thinking (suggest 4096), output_config.effort=low, 60-second timeout. Parse only text content; thinking is ignored. No raw upstream errors in client or logs. No API key sent to agents/files. Patient medication strings are untrusted DATA, never instructions.

## What is not covered
No complete medication interaction database, acute symptom triage, dosing, contraindication/eligibility assessment, calibrated omission risk, clinical validation, target-held-out evaluation or fair plain-LLM benchmark. Clinical source summaries remain pharmacist-unapproved and not frozen complete label copies.

## Local runtime
Node >=22. npm ci; npm run dev (API 3001, Vite 5173 with same-origin /api proxy). API endpoint names: GET /api/health, GET /api/catalog, POST /api/runs. Health contains status, claude_configured and model. Catalog returns CatalogSchema. Agent returns RunResultSchema. Error envelope is ApiErrorSchema. API build checks TypeScript; startup via tsx, serves ../web/dist through @fastify/static when the build exists. Backend bind defaults to loopback. Request logger disabled. Environment loaded by tsx CLI from root .env; never expose VITE secrets. API_PORT/PORT may override the API port; update the Vite proxy if changing the development port.

## User-managed model integrations
No browser automation. Hugging Face and Google Antigravity connections are user-managed and not wired here. Read INTEGRATIONS.md before interpreting their outputs or adding provider adapters. Scientific model observations must remain separate from label-supported clinical flags and do not bypass the independent gate.

## Bounded research audit

The separate research workflow uses `packages/shared/src/research.ts`. Exact products and four hypothesis IDs constrain scope; evidence-access policy controls which tools can read sources. Fixed local tools retrieve workbook cells, product-specific label paraphrases and separately classified derived notes. No live web retrieval or bulk ADCdb download runs inside the app.

Evidence mode uses an explicit deterministic controller. Optional Claude uses a bounded planner and identifier-only draft, with reviewed allowlisted local `runtime-skills/*/SKILL.md` resources. Skills cannot execute shell code, choose file paths or modify the verifier. Native Anthropic Skills uploads and hosted code-execution containers are not enabled. pstack remains an engineering workflow, not the runtime clinical agent.

The independent checker owns product/claim/source mappings, source eligibility, omissions and trusted output templates. It derives evidence outcomes only from actually available receipts: withholding labels must withhold their content and evidential influence. Research support or counter-evidence is separate from the clinical release gate, which remains blocked.

Intentional integrity drills alter draft identifiers after drafting and before verification. Their controls and trace identify deliberate software fault injection; no UI may describe them as observed model misconduct, a hidden benchmark or reward-hacking measurement. Rejected drafts contain no accepted claims.

Research trace stages are scope, plan, retrieve, draft, challenge, verify and handoff. Streamed NDJSON contains actual completed steps, then a validated result or sanitized error. Client cancellation/stale-response handling must prevent results from old inputs or navigation from reappearing. Exports contain validated results, not requests, keys or raw model prose.

The uploaded workbook snapshot contains 31 ADC records and four author-derived rows, with all 69 blank cells preserved as null. Cell references, source class, hash and missingness remain visible. Extraction date and source completeness are unverified. Workbook toxicity/PK summaries and derived prescribing notes cannot power clinical flag selection.
