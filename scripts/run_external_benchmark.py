"""Run the real baseline and agent on the team's JSON benchmark (inputs only), score with scorer.py.

  python scripts/run_external_benchmark.py --llm ollama:qwen2.5:7b-instruct
  python scripts/run_external_benchmark.py --llm ollama:qwen2.5:7b-instruct --gold ~/adcg_private/benchmark_30_gold.json

The gold file is optional and lives outside the repo (test-set owner). Without it, only responses are written;
score later with:  python scorer.py <gold.json> <run>/agent_responses.json --output <run>/agent_score.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from adcg.agent import Agent  # noqa: E402
from adcg.baseline import Baseline  # noqa: E402
from adcg.external import to_internal, to_scorer  # noqa: E402
from adcg.guardrail import Guardrail  # noqa: E402
from adcg.kb import KB  # noqa: E402
from adcg.llm import get_llm  # noqa: E402

SUMMARY_KEYS = ("num_items", "total_score", "mean_score", "accuracy", "brier_score", "abstention_rate",
                "total_missed_must_flags", "total_fake_citations")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", default=str(ROOT / "benchmark" / "test" / "items_public.json"))
    ap.add_argument("--llm", default="mock")
    ap.add_argument("--systems", nargs="+", default=["baseline", "agent"])
    ap.add_argument("--gold", default=None, help="private gold file (test-set owner); enables scoring")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out", default=str(ROOT / "results" / "runs"))
    args = ap.parse_args()

    items = json.loads(Path(args.items).read_text())[: args.limit]
    kb, llm = KB.load(), get_llm(args.llm)
    guard = Guardrail(kb.thresholds)
    out = Path(args.out) / f"30item_{args.llm.replace(':', '-')}_{time.strftime('%Y%m%d-%H%M%S')}"
    out.mkdir(parents=True, exist_ok=True)
    meta = {"llm": llm.name, "items": args.items, "n": len(items)}
    report = {"meta": meta}
    for sysname in args.systems:
        responses = []
        for i, it in enumerate(items, 1):
            internal = to_internal(it, kb)
            runner = Agent(kb, llm) if sysname == "agent" else Baseline(kb, llm)
            t0 = time.time()
            try:
                card = runner.run(internal)
            except Exception as e:  # a crash counts as an abstention, and is logged
                card = {"verdict": "dont_know", "confidence": 0.0, "flags": [], "evidence": [], "error": str(e)[:300]}
            gr = guard.review(internal, card) if internal["type"] == "case" else None
            responses.append(to_scorer(it["id"], card, gr))
            print(f"[{sysname} {i}/{len(items)}] {it['id']} -> {card.get('verdict')} ({time.time() - t0:.0f}s)", flush=True)
        (out / f"{sysname}_responses.json").write_text(json.dumps(responses, indent=2))
        if args.gold:
            from scorer import evaluate_run

            gold = json.loads(Path(args.gold).expanduser().read_text())
            ids = {it["id"] for it in items}
            sc = evaluate_run([g for g in gold if g["id"] in ids], responses)
            sc["guardrail_blocked"] = sum(bool(r["guardrail"] and r["guardrail"]["blocked"]) for r in responses)
            (out / f"{sysname}_score.json").write_text(json.dumps(sc, indent=2))
            report[sysname] = {k: sc[k] for k in SUMMARY_KEYS} | {"guardrail_blocked": sc["guardrail_blocked"]}
    meta["resolved_models"] = sorted(getattr(llm, "resolved_models", []))
    (out / "summary.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
