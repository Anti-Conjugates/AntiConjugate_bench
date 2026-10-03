# adc-guardrail

**AntiConjugate** (AIXScience Track 2: Originator). Given an ADC and a synthetic elderly patient, the agent returns a short
prescribing-risk card with flags, a confidence, evidence that resolves against our own data, and an explicit
"I don't know". A separate guardrail estimator blocks risky cards for pharmacist review. We compare it to a plain LLM on a
clinician-written mini benchmark.

> Decision support for a qualified prescriber only. All clinical content is a draft until the team pharmacist signs it off. No real patient data.

## Layout
| path | what |
|---|---|
| `adcg/scrape.py` | polite ADCdb scraper → `data/adcdb_her2_*.csv`, `data/adc_her2_table.csv`, `data/coverage_her2.json` |
| `knowledge/` | payload-class toxicity/check table + drug lists (**UNVERIFIED**, pharmacist to review) |
| `config/thresholds.json` | clinician-set thresholds (guardrail block threshold, organ-function cut-offs) |
| `adcg/rules.py` | deterministic organ-function / interaction / payload-class checks + biophysics notes |
| `adcg/agent.py` | agent: table lookup → rules → LLM drafting → citation validation → abstain → counterfactual check |
| `adcg/guardrail.py` | neutral estimator of P(card misses a must-flag); blocks above threshold |
| `adcg/baseline.py` | plain LLM baseline with the same output schema |
| `adcg/score.py` | reward, Brier, reliability plot, abstention, missed must-flags, fake citations, guardrail stats |
| `benchmark/dev/` | AI-drafted dev items (for debugging only) |
| `benchmark/test/items_public.json` | 30-item team benchmark, **inputs only** (`id, query, target_adc, patient_profile`); gold kept outside the repo by the test owner |
| `data/fda_adcs_labels.json`, `data/payload_class_rules.json`, `data/hpa_target_expression.json`, `data/adcdb_curated_table.json` | team-curated label / SOP / expression / ADCdb records fed to the agent as `REFERENCE_JSON` (**UNVERIFIED**) |
| `adcg/external.py`, `scripts/run_external_benchmark.py` | adapter + runner for the 30-item benchmark, scored by `scorer.py` |
| `scripts/split_benchmark.py` | split a benchmark into public inputs and private gold |
| `data/mock_illustrative/` | **mock-up only**: outputs of the removed `agent_guardrail.py` (no LLM, benchmark-specific rules); not results |

## Card format
```json
{"answer": "...", "verdict": "supported | not_supported | dont_know", "confidence": 0.0,
 "reason": "1-3 sentences", "flags": [{"id": "bleeding_risk", "severity": "high", "text": "...", "evidence": ["RULE:anticoagulant_antiplatelet", "PATIENT:meds"]}],
 "evidence": ["ADCDB:DRG0ERKBH", "KB:topo1_dxd"], "unknowns": ["baseline LVEF"], "needs_human": true}
```
Evidence must be `ADCDB:<id>`, `FDA:<brand>[:<label_section>]`, `SOP:<payload>`, `HPA:<gene>`, `KB:<class>`, `KB:drug_lists:<list>`, `RULE:<name>` or `PATIENT:<field>`; anything else is a fake citation (-3).

## Setup
```bash
uv venv -p 3.12 .venv && uv pip install -p .venv -e '.[dev]'
.venv/bin/python -m pytest -q
```
LLM (default for our results): free open model via [Ollama](https://ollama.com), CPU-only is fine (~5 GB RAM):
```bash
ollama serve &            # or the desktop app
ollama pull qwen2.5:7b-instruct
# then pass --llm ollama:qwen2.5:7b-instruct
```
Optional: Claude via Claude Code CLI (`claude setup-token`, export `CLAUDE_CODE_OAUTH_TOKEN`, `--llm claude:sonnet`).
`--llm mock` runs the whole pipeline offline (plumbing only; never report mock numbers).

## Run
```bash
.venv/bin/python -m adcg.scrape --term HER2            # cached in data/raw/
.venv/bin/python scripts/make_splits.py                 # owner: fair split by antibody group
.venv/bin/python scripts/make_fact_items.py --n 8       # dev fact items; owner uses a private seed + --out benchmark/test/...
.venv/bin/python scripts/run_benchmark.py --items benchmark/dev/items.jsonl benchmark/dev/fact_items.jsonl --llm ollama:qwen2.5:7b-instruct --split fair
.venv/bin/python scripts/run_benchmark.py --items benchmark/dev/items.jsonl benchmark/dev/fact_items.jsonl --llm ollama:qwen2.5:7b-instruct --split leaky
.venv/bin/python scripts/demo.py --llm ollama:qwen2.5:7b-instruct    # 2 patients end to end -> results/demo.md
# 30-item team benchmark (inputs only); the test owner scores with the private gold file:
.venv/bin/python scripts/run_external_benchmark.py --llm ollama:qwen2.5:7b-instruct --gold ~/adcg_private/benchmark_30_gold.json
```

## Writing clinician cases (pharmacist)
One JSON object per line in `benchmark/test/items.jsonl`, same shape as `benchmark/dev/items.jsonl`.
`must_flags` uses this vocabulary: `ild_risk, neutropenia_risk, lvef_cardiac, embryofetal, thrombocytopenia, bleeding_risk,
hepatotoxicity, hepatic_impairment, renal_impairment, cyp3a4_interaction, neuropathy, ocular, ugt1a1_toxicity, diarrhoea,
myelosuppression, oedema_effusion, gi_toxicity, skin, elderly_polypharmacy`.
Patient fields: `age, sex, egfr, bilirubin_x_uln, ast_alt_x_uln, platelets (10^9/L), anc (10^9/L), lvef (%), conditions[], meds[], ugt1a1, pregnant`.

## Honest limits
~30 items and one clinician = proof of concept. ADCdb is literature-curated (confounding, reporting bias). Knowledge tables are
drafts until reviewed. No lab or real-patient validation.
