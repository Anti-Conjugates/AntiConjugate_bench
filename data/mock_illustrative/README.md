# Illustrative mock-up: NOT model results

These four files were produced by `agent_guardrail.py` (removed here; still in Anti-Conjugates/adc-guardrail), which does not call any language model:

- `results_baseline.json` comes from `BaselinePlainLLM`. It is a simulator that returns hand-written answers chosen by item ID or by phrases in the question, and some of those answers contain deliberately invented citations.
- `results_anticonjugate.json` comes from `AntiConjugateAgent`. It is hand-written rules, and some of them match exact phrases from the 30 benchmark questions. It was written with the benchmark in view.
- The `score_*.json` files are those outputs scored by `scorer.py`.

So the +18 vs -93 comparison only shows the intended *shape* of the result. It is not evidence of how either system performs, and it must not be presented as results.

For real numbers, see `results/RESULTS_30item.md`. Those come from `scripts/run_external_benchmark.py`, where Qwen2.5-7B (the same model for both systems) answers from the inputs-only file `benchmark/test/items_public.json`.
