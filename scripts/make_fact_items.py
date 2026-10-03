"""Generate ADCdb fact claims (true + perturbed-false) from the table.

The benchmark owner runs this with a private seed and --out benchmark/test/... ; agents only
ever see the dev file. Each claim is about exactly one ADC record.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from adcg.kb import KB  # noqa: E402

TEMPLATES = {
    "payload": "{name} carries the payload {val}.",
    "linker": "{name} uses the linker {val}.",
    "antibody": "The antibody component of {name} is {val}.",
    "dar": "The drug-to-antibody ratio of {name} is {val}.",
    "conjugate_type": "{name} is conjugated via {val}.",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default=str(ROOT / "benchmark" / "dev" / "fact_items.jsonl"))
    args = ap.parse_args()
    rng = random.Random(args.seed)
    df = KB.load().adc_table
    splits = json.loads((ROOT / "benchmark" / "splits.json").read_text())
    held = set(splits["heldout_adc_ids"])
    items = []
    rows = df.sample(frac=1, random_state=args.seed).to_dict("records")
    quota = {"heldout": args.n // 2, "seen": args.n - args.n // 2}
    for row in rows:
        split = "heldout" if row["adc_id"] in held else "seen"
        if quota[split] == 0:
            continue
        fields = [f for f in TEMPLATES if row.get(f) and row[f].lower() not in ("undisclosed", "")]
        if not fields:
            continue
        f = rng.choice(fields)
        true = rng.random() < 0.5
        val = row[f]
        if not true:
            others = [v for v in df[f].unique() if v and v != val and v.lower() != "undisclosed"]
            if not others:
                continue
            val = rng.choice(others)
        items.append({
            "id": f"fact-{row['adc_id']}-{f}", "type": "fact", "category": "adcdb_fact",
            "adc": row["adc_name"], "claim": TEMPLATES[f].format(name=row["adc_name"], val=val),
            "gold_verdict": "supported" if true else "not_supported",
            "gold_evidence": [f"ADCDB:{row['adc_id']}"],
            "split": split,
        })
        quota[split] -= 1
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text("".join(json.dumps(i) + "\n" for i in items))
    print(f"wrote {len(items)} items to {args.out}")


if __name__ == "__main__":
    main()
