"""Run baseline and/or agent on a benchmark file and score them.

  python scripts/run_benchmark.py --items benchmark/dev/items.jsonl benchmark/dev/fact_items.jsonl --llm mock
  python scripts/run_benchmark.py --items benchmark/test/items.jsonl --llm claude:sonnet --split fair
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
from adcg.guardrail import Guardrail  # noqa: E402
from adcg.kb import KB  # noqa: E402
from adcg.llm import get_llm  # noqa: E402
from adcg.score import load_jsonl, reliability_plot, score_item, summarise  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", nargs="+", required=True)
    ap.add_argument("--llm", default="mock", help="mock | ollama:<model> | claude:<model>")
    ap.add_argument("--systems", nargs="+", default=["baseline", "agent"])
    ap.add_argument("--split", choices=["fair", "leaky"], default="fair",
                    help="fair: held-out ADCs are removed from the agent's table for fact items")
    ap.add_argument("--splits-file", default=str(ROOT / "benchmark" / "splits.json"))
    ap.add_argument("--out", default=str(ROOT / "results" / "runs"))
    args = ap.parse_args()

    items = [it for f in args.items for it in load_jsonl(Path(f))]
    kb = KB.load()
    heldout = set()
    if args.split == "fair" and Path(args.splits_file).exists():
        heldout = set(json.loads(Path(args.splits_file).read_text())["heldout_adc_ids"])
    llm = get_llm(args.llm)
    guard = Guardrail(kb.thresholds)
    tag = f"{Path(args.items[0]).parent.name}_{args.llm.replace(':', '-')}_{args.split}_{time.strftime('%Y%m%d-%H%M%S')}"
    out = Path(args.out) / tag
    out.mkdir(parents=True, exist_ok=True)

    all_rows, summaries = {}, {}
    for sysname in args.systems:
        rows, guards = [], []
        with (out / f"{sysname}_cards.jsonl").open("w") as fh:
            for it in items:
                view = kb.without(heldout) if (it["type"] != "case") else kb
                runner = Agent(view, llm) if sysname == "agent" else Baseline(kb, llm)
                try:
                    card = runner.run(it)
                except Exception as e:  # a crash counts as an abstention, and is logged
                    card = {"verdict": "dont_know", "confidence": 0.0, "flags": [], "evidence": [],
                            "fake_citations": [], "error": str(e)[:300]}
                gr = guard.review(it, card) if it["type"] == "case" else None
                row = score_item(it, card, kb)
                rows.append(row)
                guards.append(gr)
                fh.write(json.dumps({"item_id": it["id"], "card": card, "guardrail": gr, "score": row}) + "\n")
        summaries[sysname] = summarise(rows, guards)
        all_rows[sysname] = rows
    meta = {"llm": llm.name, "resolved_models": sorted(getattr(llm, "resolved_models", [])),
            "split": args.split, "n_heldout_adcs": len(heldout), "items": args.items}
    (out / "summary.json").write_text(json.dumps({"meta": meta, **summaries}, indent=2))
    reliability_plot(all_rows, out / "calibration.png")
    print(json.dumps({"meta": meta, **{k: {kk: v[kk] for kk in (
        "total_points", "accuracy_answered", "coverage", "brier_answered", "abstention_on_unanswerables",
        "confident_wrong", "missed_must_flags_total", "items_with_fake_citations", "items_with_rejected_citations")} for k, v in summaries.items()}}, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
