# Evaluation design: verifier sensitivity and citation selection

Specified before results on 3 October 2026. This is a developer-authored software
study on the app's frozen records, not an independent clinical benchmark.

## H1: the suite notices a weakened verifier

Primary outcome: mutants detected, where a mutant is detected only when it accepts
at least one fault that the unchanged production verifier rejects. A failing or
uncompilable mutant is an infrastructure error, not a detection. Every mutant must
retain acceptance of valid controls. Report survivors and overlapping protections.

Use the actual production `auditResearchDraft` and `sameIds` source, parsed with
TypeScript and compiled in a separate in-memory context. Change only the boolean
argument of a named check; never edit the production source or expose switches in
the app. Eight single-check mutants, one combined citation-defenses mutant, and
one always-accept mutant. Prediction: identity, duplicate, omission, pairing and
provenance mutants and the two combined controls are detected. Some citation
checks may survive because other guards still reject the same input. Survival is
reported, not renamed a pass or used to remove cases.

Two products × five questions × two source settings. Controls: the exact valid
selection, plus three deterministic harmless presentations (seeds 17, 29, 43)
changing receipt/citation/property order. Fault families: wrong product, missing
claim, duplicate claim, extra claim, invented/cross-product citations, ineligible
derived citations, receipt text edits, duplicate citation, missing primary source,
and withheld sources. Cases requiring sources are excluded only when that source
is absent; denominators and excluded scopes are explicit. No learned model calls.

Gate: all healthy controls accepted, all applicable faults rejected, unmodified
compiled verifier agrees with the live function, mutants preserve healthy
controls, and the seven pre-specified nonredundant/combined mutants are detected.
No confidence intervals or claim of universal attack resistance.

## H2: giving the expected mapping changes citation selection

Primary outcome: paired difference in accepted identifier drafts between mapped
and unmapped conditions. This is descriptive, not a clinical-accuracy estimate.

All 20 scopes, three paired observations per scope using the same seeds for
receipt presentation. Both arms receive identical fixed retrieved records,
eligibility metadata, reviewed prompt packs, question wording, output schema,
model and generation parameters. Only `trusted_claim_mapping` is removed in the
unmapped arm. The expected verdict and source selection never enter that arm,
including schema descriptions. No planner: this isolates drafting, not full-agent
retrieval. The supplied candidate IDs, eligibility fields and skill instructions
still constrain the task; do not call it open-ended discovery.

Counterbalance arm order by scope/repetition. One model call per arm, two per pair,
one shared 60-second pair deadline; 120 requests maximum, zero retries. Same
`claude-opus-5-5` adapter and parameters as the app. The provider does not offer a
seed here: seeds control presentation, not model randomness. Three observations
are repeated measurements on 20 fixtures, not 60 independent science questions.

Score every draft with the unchanged production verifier. Record selected IDs,
omissions, check failures, provider errors, latency, prompt/context hashes and
actual provider-call count. Refusals/timeouts/malformed output count as failures
in the all-attempts denominator, not discarded outliers. No repairing, rerunning
failures, LLM judge, significance test, prompt search or interim condition tuning.
Preserve negative results. Without a key write a clearly skipped artifact.

Secondary outcomes (exploratory): mismatch type, order sensitivity, per-scope
repeat consistency, provider failure count and latency. Stop after the fixed grid.
Changing cases/prompts/conditions after results requires a dated amendment and
new full artifact; never edit reported numbers.

## Reproducibility and scope

Environment: Node 24.19.0, npm 10.8.3, CPU only; package versions in the committed
lockfile. Base app commit `56744ac` (organization mirror `4dff7ec`). Runtime source,
workbook, evaluation script, prompt, design and request fingerprints are recorded
by each command. Outputs: `evals/verifier-study.json`, `evals/selection-study.json`.
There is no training set or unseen holdout: these are developer-known fixtures.
Original clinical benchmark/cases/keys/scoring files are never accessed.

Checklist complete before execution: hypothesis, one primary outcome per study,
falsification and gates, fixed cases/exclusions, baseline/ablations/seeds,
environment/lockfile, comparison method, stop rules, error/outlier treatment,
fingerprints/output locations and negative-result reporting are specified above.
Author: Conjugate engineering workflow. Amendments recorded below.

## Amendment 1, before H2 execution

The independent reviewer found that the visible eligibility flag reproduces the
entire expected set in 20/20 scopes without a model. H2 now removes
`eligible_for_claim` from receipts in **both** arms; all other inputs remain
paired. Include the no-model eligible-only baseline on the original annotated
records to expose the shortcut, and a kind-only baseline on unannotated records.
This remains supplied-record selection, not independent scientific discovery.
No extra model arms or additional calls are added: 120 remains the hard cap.

H1's first run found 20/80 controls accepted: receipt key order caused false
rejection. Keep `evals/verifier-before-fix.json` unchanged. Fix production equality
to ignore object key order while preserving array order/contents, then rerun the
same cases. Cases, mutant targets and primary outcomes are not changed.

The generic experiment skill is adapted to Node software checks: this design
note replaces a protocol page; lockfile/hash artifacts replace Python/CUDA locks.
Image attacks and external coding benchmarks do not measure this app. Pharmacist
review, calibrated uncertainty and scientific correctness remain unassessed.
