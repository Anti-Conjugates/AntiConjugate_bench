"""Hold out ADCs by antibody group (fair split). Owner runs this once and commits splits.json."""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from adcg.kb import KB  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frac", type=float, default=0.4)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--keep", nargs="*", default=["Trastuzumab"],
                    help="antibody groups never held out (needed for clinician cases)")
    args = ap.parse_args()
    df = KB.load().adc_table
    groups = sorted(g for g in df["antibody"].unique() if g not in args.keep)
    random.Random(args.seed).shuffle(groups)
    held = groups[: max(1, int(len(groups) * args.frac))]
    ids = sorted(df[df["antibody"].isin(held)]["adc_id"])
    out = {"method": "group-by-antibody", "seed": args.seed, "heldout_antibodies": held, "heldout_adc_ids": ids}
    (ROOT / "benchmark" / "splits.json").write_text(json.dumps(out, indent=2))
    print(f"held out {len(held)} antibody groups / {len(ids)} ADCs")


if __name__ == "__main__":
    main()
