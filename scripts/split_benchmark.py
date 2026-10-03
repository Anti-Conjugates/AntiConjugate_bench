"""Split a benchmark file into agent-visible inputs (committed) and gold answers (kept private).

  python scripts/split_benchmark.py data/benchmark_30_items.json \
      --public benchmark/test/items_public.json --gold ~/adcg_private/benchmark_30_gold.json

The public file only carries what a system may see at inference time: id, query, target_adc and
patient_profile. Category, trap/unanswerable labels, expected verdicts, must-flags and evidence stay
in the gold file, which the test-set owner keeps outside the repo and passes to scorer.py.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

PUBLIC_KEYS = ("id", "query", "target_adc", "patient_profile")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--public", required=True)
    ap.add_argument("--gold", required=True)
    args = ap.parse_args()
    items = json.loads(Path(args.src).read_text())
    public = [{k: it[k] for k in PUBLIC_KEYS if it.get(k) is not None} for it in items]
    Path(args.public).parent.mkdir(parents=True, exist_ok=True)
    Path(args.public).write_text(json.dumps(public, indent=2) + "\n")
    gold = Path(args.gold).expanduser()
    gold.parent.mkdir(parents=True, exist_ok=True)
    gold.write_text(json.dumps(items, indent=2) + "\n")
    print(f"{len(public)} items -> {args.public} (inputs only); gold -> {gold}")


if __name__ == "__main__":
    main()
