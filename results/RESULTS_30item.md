# 30-item benchmark: real LLM results (development only, not clinically validated)

Run: `scripts/run_external_benchmark.py --llm ollama:qwen2.5:7b-instruct --gold <private gold>`, 2026-10-03.
Both systems call the same local model (`qwen2.5:7b-instruct`, Ollama, CPU, temperature 0, seed 0).
Inputs: `benchmark/test/items_public.json` (id, query, target_adc, patient_profile only).
Scored by the team's `scorer.py` against the gold file held outside the repo.
Raw responses: `results/30item_qwen7b/`. Per-item scores are not committed, because they contain the gold labels.

| metric (scorer.py) | plain-LLM baseline | AntiConjugate agent |
|---|---|---|
| total score | **-22.0** | **+1.0** |
| accuracy (all 30 items) | 53.3% | 73.3% |
| Brier score (lower is better) | 0.314 | 0.208 |
| abstention rate | 10.0% | 16.7% |
| missed must-flags | 15 | 5 |
| fake citations (NCT/PMID checked live) | 0 | 0 |
| guardrail blocked | 11 | 6 |

By item group (correct / n, score, missed must-flags, confidently wrong):

| group | baseline | agent |
|---|---|---|
| clinician cases (12) | 5/12, -14.0, 9 missed, 5 conf-wrong | 6/12, -9.0, 3 missed, 6 conf-wrong |
| fact questions (8) | 7/8, +5.0, 0, 1 | 7/8, +5.0, 0, 1 |
| unanswerable (5) | 1/5, -6.0, 0, 3 | 5/5, +5.0, 0, 0 |
| traps (5) | 3/5, -7.0, 6, 2 | 4/5, 0.0, 2, 1 |

## What this does and does not show
- Most of the gap comes from abstention: the agent said `dont_know` on all 5 unanswerable items, where the baseline answered 4 of them. The agent also missed fewer must-flags (5 vs 15), because the deterministic rules put flags on the card whatever the model says.
- Clinician cases are still weak for both systems. The agent answered "supported" with confidence above 0.7 on 6 of the 10 cases whose expected answer was "not supported". It flags the risks but still says the drug can be given. The next thing to fix is the step from flags to verdict.
- **Baseline generation failures:** on CASE-04 and CASE-08, Ollama stopped the baseline with `prediction aborted, token repeat limit reached` (greedy decoding fell into a repetition loop). It failed the same way on every retry, so both items are scored as `dont_know` with confidence 0. Even if both had been fully correct with no missed flags, the baseline would score -15.0, still below the agent's +1.0.
- `scorer.py` checks only NCT and PMID citations against live APIs. Invented `ADCDB:` / `FDA:` strings are not penalised by it (the agent rejects unknown citations itself, the baseline does not). Its must-flag check matches keywords as substrings (e.g. `ast`, `ten`), which is lenient for both systems.
- **Not a hidden test.** The 30 items were written by the team and were visible to the developer (the gold file is still in git history at f117a8d). No rule or prompt was written for a specific item, but the result is development evidence only. The payload-class table and thresholds are still UNVERIFIED by a pharmacist.
- n = 30 on a 7B CPU model: the differences are directional, not statistically tested.
