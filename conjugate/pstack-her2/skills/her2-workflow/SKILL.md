---
name: her2-workflow
description: Build or change this synthetic HER2 ADC research app using pstack boundary-first design, evidence provenance, pharmacist approval and independent guardrails.
---

# HER2 research engineering workflow

Read root `AGENTS.md`, `docs/ARCHITECTURE.md` and `packages/shared/src/index.ts` before editing. Use upstream architect and Model the Domain principles, but these domain restrictions override all upstream autonomy/shipping defaults.

1. State the exact ADC, jurisdiction, evidence date and task scope. Kadcyla and Enhertu are not interchangeable. HER2 is only a target, never eligibility.
2. Model shared contracts before logic. Assign evidence/source IDs, flag IDs, unknowns, draft status, deterministic gate and human-review fields. Calibration/omission probabilities remain null. Do not add a confidence slider or call model self-reported confidence correctness.
3. Assign disjoint files: coordinator owns shared/config; evidence and API owner owns `apps/api/src`; UI owner owns `apps/web/src`; read-only integration reviewer consumes both outputs after writers finish. Agent prompts never contain secrets. Shared VM requires local-only state/no remote, not convenience.
4. Keep retrieval allowlisted. No arbitrary model-generated citations, ADCdb bulk scraping or unsupported assay-to-patient extrapolation. Clinical summaries are explicitly labelled draft paraphrases until pharmacist approved. Changes require the evidence-review skill.
5. Claude selects identifiers only. Server validates exact product, flags and source pairs, then renders trusted templates. No model-authored doses, contraindications, treatment substitutions or patient eligibility. Failed Claude runs remain failures; do not relabel a deterministic draft as Claude.
6. Independently derive required checks; expose omitted checks rather than silently repairing the model draft. External gate checks do not establish semantic truth or calibrated omission probability. All cards stay research drafts, human-required and blocked for clinical release.
7. Synthetic confirmation at both UI and API boundary; no identifiers/persistence/request logging. Med strings are untrusted data. Unknown input remains unknown; no auto example clinical cases.
8. Run `npm run check` and `npm audit`. Software safety/contract tests are not clinical evaluations. Never read/create/alter independent clinician cases, answer keys, scoring scripts or hidden tests. Browser testing needs host/user approval; pharmacist approval cannot be inferred from tests.
9. Deliver runnable source, exact checks and explicit gaps. No public deployment or clinical release without new authorization. Do not claim a plain-LLM benchmark or target-held-out result that was not independently run.
