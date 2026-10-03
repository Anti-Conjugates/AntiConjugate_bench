"""End-to-end demo: two synthetic patients -> agent risk card -> guardrail decision.

  python scripts/demo.py --llm claude:sonnet      # writes results/demo.md
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from adcg.agent import Agent  # noqa: E402
from adcg.guardrail import Guardrail  # noqa: E402
from adcg.kb import KB  # noqa: E402
from adcg.llm import get_llm  # noqa: E402
from adcg.score import load_jsonl  # noqa: E402


def render(case: dict, card: dict, gr: dict) -> str:
    sev = {"high": "HIGH", "moderate": "MOD", "monitor": "monitor"}
    lines = [f"## {case['id']}: {case['adc']}", "",
             f"**Patient:** `{json.dumps(case['patient'])}`", "",
             f"**Verdict:** {card['verdict']}  |  **confidence:** {card['confidence']}  |  "
             f"**needs_human:** {card['needs_human']}", "",
             f"**Guardrail:** P(miss)={gr['p_miss']} vs threshold {gr['threshold']} -> **{gr['action']}**"
             + (f" (uncovered: {', '.join(gr['uncovered_domains'])})" if gr["uncovered_domains"] else ""), "",
             f"**Summary:** {card['answer']}", "", "| flag | severity | why | evidence |", "|---|---|---|---|"]
    order = {"high": 0, "moderate": 1, "monitor": 2}
    for f in sorted(card["flags"], key=lambda f: order.get(f["severity"], 3)):
        lines.append(f"| {f['id']} | {sev.get(f['severity'], f['severity'])} | {f['text']} | {', '.join(f['evidence'])} |")
    if card["unknowns"]:
        lines += ["", "**Unknowns:** " + "; ".join(card["unknowns"])]
    if card.get("notes"):
        lines += ["", "**Biophysics notes:** " + " ".join(card["notes"])]
    if card.get("counterfactual"):
        cf = card["counterfactual"]
        lines += ["", f"**Counterfactual check:** {cf['perturbation']} -> expected {cf['expected_new_flags']}: "
                      f"{'PASS' if cf['passed'] else 'FAIL'}"]
    if card.get("rejected_citations"):
        lines += ["", f"**Citations rejected by validator (not shown to user):** {card['rejected_citations']}"]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", default="mock")
    ap.add_argument("--items", default=str(ROOT / "benchmark" / "dev" / "items.jsonl"))
    ap.add_argument("--ids", nargs="+", default=["case-dev-01", "case-dev-02"])
    ap.add_argument("--out", default=str(ROOT / "results" / "demo.md"))
    args = ap.parse_args()
    kb, llm = KB.load(), get_llm(args.llm)
    agent, guard = Agent(kb, llm), Guardrail(kb.thresholds)
    items = {i["id"]: i for i in load_jsonl(Path(args.items))}
    md = [f"# AntiConjugate demo (LLM: {llm.name})", "",
          "> Decision support for a qualified prescriber. Clinical content is UNVERIFIED until pharmacist sign-off.", ""]
    for iid in args.ids:
        case = items[iid]
        card = agent.run(case)
        md.append(render(case, card, guard.review(case, card)))
    md.append(f"_Resolved model(s): {sorted(getattr(llm, 'resolved_models', []))}_\n")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text("\n".join(md))
    print("\n".join(md))


if __name__ == "__main__":
    main()
