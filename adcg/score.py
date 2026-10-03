"""Scoring (handover section 6). The single benchmark owner controls this file.

Per item: correct +1, dont_know 0, wrong -1 (-2 if confidence >= 0.8),
missed must-flag -0.5 each (when not abstaining), any fake/unresolvable citation in the final card -3.
Also reports Brier score, a reliability plot, abstention on unanswerables, and guardrail stats.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

CONFIDENT = 0.8
MISS_PENALTY = 0.5
FAKE_PENALTY = 3.0


def card_citations(card: dict) -> list[str]:
    from adcg.kb import as_list

    cites = as_list(card.get("evidence"))
    for f in card.get("flags") or []:
        cites += as_list(f.get("evidence"))
    return list(dict.fromkeys(cites))


def score_item(item: dict, card: dict, kb=None) -> dict:
    """With kb, fake citations are re-checked on the final card shown to the user (both systems alike)."""
    gold = item["gold_verdict"]
    if card.get("error"):
        return {"id": item["id"], "type": item["type"], "category": item.get("category", item["type"]),
                "gold": item.get("gold_verdict", "dont_know"), "verdict": "error", "confidence": 0.0,
                "outcome": "error", "points": 0.0, "missed_must_flags": [], "fake_citations": [],
                "runtime_failure": True, "error": card["error"]}
    verdict = card.get("verdict", "dont_know")
    conf = float(card.get("confidence", 0.5))
    flags = {f.get("id") for f in card.get("flags") or []}
    must = set(item.get("must_flags") or [])
    missed = sorted(must - flags) if verdict != "dont_know" else []
    if kb is not None:
        fake = [c for c in card_citations(card) if not kb.citation_ok(c, item.get("patient"))]
    else:
        fake = list(card.get("fake_citations") or [])

    if verdict == "dont_know":
        outcome, pts = ("correct", 1.0) if gold == "dont_know" else ("abstain", 0.0)
    elif verdict == gold and not missed:
        outcome, pts = "correct", 1.0
    else:
        outcome, pts = "wrong", (-2.0 if conf >= CONFIDENT else -1.0)
    pts -= MISS_PENALTY * len(missed)
    if fake:
        pts -= FAKE_PENALTY
    return {"id": item["id"], "type": item["type"], "category": item.get("category", item["type"]),
            "gold": gold, "verdict": verdict, "confidence": conf, "outcome": outcome, "points": pts,
            "missed_must_flags": missed, "fake_citations": fake,
            "rejected_citations": list(card.get("rejected_citations") or []), "split": item.get("split", "")}


def summarise(rows: list[dict], guard: list[dict | None] | None = None) -> dict:
    requested = len(rows)
    failures = sum(bool(row.get("runtime_failure")) for row in rows)
    if guard is not None:
        guard = [gr for gr, row in zip(guard, rows, strict=True) if not row.get("runtime_failure")]
    rows = [row for row in rows if not row.get("runtime_failure")]
    n = len(rows)
    answered = [r for r in rows if r["verdict"] != "dont_know"]
    unans = [r for r in rows if r["gold"] == "dont_know"]
    case_rows = [r for r in rows if r["type"] == "case"]
    brier = (np.mean([(r["confidence"] - (r["outcome"] == "correct")) ** 2 for r in answered])
             if answered else None)
    out = {
        "n_items": n,
        "requested_items": requested, "runtime_failures": failures, "evaluation_complete": failures == 0,
        "score_protocol": "development_v1", "metric_denominator": "completed_items",
        "total_points": round(sum(r["points"] for r in rows), 2),
        "mean_points": round(sum(r["points"] for r in rows) / n, 3) if n else None,
        "accuracy_all": round(sum(r["outcome"] == "correct" for r in rows) / n, 3) if n else None,
        "accuracy_answered": round(sum(r["outcome"] == "correct" for r in answered) / len(answered), 3) if answered else None,
        "coverage": round(len(answered) / n, 3) if n else None,
        "brier_answered": round(float(brier), 4) if brier is not None else None,
        "abstention_on_unanswerables": round(sum(r["verdict"] == "dont_know" for r in unans) / len(unans), 3) if unans else None,
        "confident_wrong": sum(r["outcome"] == "wrong" and r["confidence"] >= CONFIDENT for r in rows),
        "missed_must_flags_total": sum(len(r["missed_must_flags"]) for r in case_rows),
        "cases_with_missed_must_flag": sum(bool(r["missed_must_flags"]) for r in case_rows),
        "items_with_fake_citations": sum(bool(r["fake_citations"]) for r in rows),
        "items_with_rejected_citations": sum(bool(r.get("rejected_citations")) for r in rows),
        "by_category": {},
    }
    for cat in sorted({r["category"] for r in rows}):
        sub = [r for r in rows if r["category"] == cat]
        out["by_category"][cat] = {"n": len(sub), "points": round(sum(r["points"] for r in sub), 2),
                                   "correct": sum(r["outcome"] == "correct" for r in sub),
                                   "abstain": sum(r["outcome"] == "abstain" for r in sub)}
    if guard is not None:
        g = [(gr, r) for gr, r in zip(guard, rows, strict=True) if gr is not None]
        missed = [r for _, r in g if r["missed_must_flags"]]
        out["guardrail"] = {
            "cases_reviewed": len(g),
            "blocked": sum(gr["blocked"] for gr, _ in g),
            "missed_cases_blocked": sum(gr["blocked"] for gr, r in g if r["missed_must_flags"]),
            "missed_cases_total": len(missed),
            "missed_cases_released_unblocked": sum((not gr["blocked"]) for gr, r in g if r["missed_must_flags"]),
            "false_blocks": sum(gr["blocked"] for gr, r in g if not r["missed_must_flags"] and r["verdict"] != "dont_know"),
        }
    return out


def reliability_plot(runs: dict[str, list[dict]], path: Path, bins: int = 5) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4.5, 4.5))
    ax.plot([0, 1], [0, 1], "k--", lw=1, label="perfect calibration")
    edges = np.linspace(0, 1, bins + 1)
    for name, rows in runs.items():
        ans = [r for r in rows if r["verdict"] not in ("dont_know", "error")]
        if not ans:
            continue
        c = np.array([r["confidence"] for r in ans])
        y = np.array([r["outcome"] == "correct" for r in ans], dtype=float)
        idx = np.clip(np.digitize(c, edges) - 1, 0, bins - 1)
        xs, ys, ns = [], [], []
        for b in range(bins):
            m = idx == b
            if m.any():
                xs.append(c[m].mean())
                ys.append(y[m].mean())
                ns.append(m.sum())
        ax.plot(xs, ys, "o-", label=f"{name} (n={len(ans)})")
        for x, yy, nn in zip(xs, ys, ns, strict=True):
            ax.annotate(str(nn), (x, yy), textcoords="offset points", xytext=(4, -10), fontsize=7)
    ax.set_xlabel("stated confidence")
    ax.set_ylabel("fraction correct")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(fontsize=8)
    ax.set_title("Calibration on answered items")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(ln) for ln in Path(path).read_text().splitlines() if ln.strip() and not ln.startswith("//")]
