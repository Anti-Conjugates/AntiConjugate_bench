# NOTES (metrics fixed before any test run)

## Scope
- Target: **HER2**, indication focus **breast cancer**. Data: ADCdb (https://adcdb.idrblab.net/), scraped politely (1.5 s delay, cached) because there is no bulk export.
- Table = clinical-stage ADCs (approved / any phase / NDA) whose antigen is HER2 (`data/adc_her2_table.csv`). Coverage counts in `data/coverage_her2.json`.

## Metrics (decided up front; do not change after seeing test results)
- Reward per item: correct +1, `dont_know` 0, wrong -1 (-2 if confidence >= 0.8), each missed must-flag -0.5 (when not abstaining), any fake/unresolvable citation -3.
- Unanswerable items: correct answer is `dont_know` (+1).
- Report: total points, accuracy on answered, coverage, Brier on answered, reliability plot, abstention rate on unanswerables, confident-wrong count, missed must-flags, items with fake citations.
- Guardrail: blocked count, missed-flag cases blocked vs released, false blocks. Threshold set by pharmacist in `config/thresholds.json` before the run.
- Leakage trap: run fact items with `--split leaky` (held-out ADCs visible to retrieval) and `--split fair` (held out by antibody group). Report the gap. Baseline is also reported by `split` column (seen/heldout) because approved ADCs are likely memorised by the LLM.

## Ownership (handover section 9)
- Single owner of `benchmark/test/`, `benchmark/splits.json`, `adcg/score.py`: **TBD (team to name)**.
- Agents (AI) never read `benchmark/test/`. Dev items in `benchmark/dev/` are AI-drafted and UNVERIFIED.

## Assumptions / log
- Knowledge tables (`knowledge/*.json`) are UNVERIFIED drafts until pharmacist sign-off.
- Kd in ng/mL converted to nM assuming IgG ~150 kDa. Affinity-window thresholds are placeholders for the biophysics engineer.
- LLM: no paid model available, so agent AND baseline both use the same free open model, `qwen2.5:7b-instruct` via Ollama on CPU, temperature 0, seed 0. Exact model id recorded in each run's `summary.json` (`resolved_models`). A 7B model is much weaker than frontier models; the claim is agent-vs-baseline with the same model, not absolute accuracy.

## 30-item team benchmark (added later)
- `benchmark/test/items_public.json` holds the inputs only (`id, query, target_adc, patient_profile`). The gold file (category, trap and unanswerable labels, expected verdicts, must-flags, evidence) is kept outside the repo by the test owner and passed to `scorer.py`. The original `data/benchmark_30_items.json` is still in git history from commit f117a8d.
- Scored with the team's `scorer.py`, not with `adcg/score.py`. The rules differ: a missed must-flag costs -1.0 per flag (not -0.5), overconfidence means conf > 0.70 (not >= 0.8), accuracy counts every item, and must-flags are matched by keywords in `reason` + flag text, not by flag id. `scorer.py` only checks NCT and PMID citations against live APIs; other citation prefixes are never counted as fake.
- `agent_guardrail.py` and `data/mock_illustrative/` are a mock-up: no LLM, and rules written with the benchmark questions in view. They are not results.
- Adapter (`adcg/external.py`) was written from the input schema only: unit conversions (platelets /µL to 10^9/L, bilirubin mg/dL to xULN with ULN 1.2, AST/ALT U/L to xULN with ULN 40), keyword mapping of comorbidities onto rule conditions, and drug-name extraction against `knowledge/drug_lists.json`. Unmapped fields go to the LLM as `OTHER_PATIENT_INFO`.
- The 30 inputs were seen by the developer agent (the trap phrases were also visible in `agent_guardrail.py`), so this is not a hidden test. No rule or prompt was written for a specific item.
