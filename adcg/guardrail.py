"""Neutral guardrail estimator (LawZero-style generator + estimator).

Computes a heuristic risk score from the case and the card only. It never sees
gold labels at inference and is never rewarded for the generator's success. Above the
clinician-set threshold the card is blocked and routed to a human.

Its risk-domain triggers are deliberately patient-centric and payload-agnostic, so they are a
partly independent check on the generator (rules or LLM) rather than a copy of it.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

BLEED = {"warfarin", "apixaban", "rivaroxaban", "edoxaban", "dabigatran", "enoxaparin", "heparin",
         "aspirin", "clopidogrel", "ticagrelor", "prasugrel"}
CYP = {"clarithromycin", "itraconazole", "ketoconazole", "posaconazole", "voriconazole", "ritonavir",
       "cobicistat", "rifampicin", "rifampin", "carbamazepine", "phenytoin", "atazanavir"}

DOMAINS = {
    # domain: (patient trigger, flag ids that count as "addressed")
    "renal": (lambda p, t: p.get("egfr") is not None and p["egfr"] < t["egfr_moderate"], {"renal_impairment"}),
    "hepatic": (lambda p, t: (p.get("bilirubin_x_uln") or 0) > t["bilirubin_x_uln_moderate"]
                or (p.get("ast_alt_x_uln") or 0) > t["ast_alt_x_uln_high"]
                or "liver_disease" in _c(p), {"hepatic_impairment"}),
    "bleeding": (lambda p, t: bool(_m(p) & BLEED) or _below(p, "platelets", t["platelets_low"]),
                 {"bleeding_risk", "thrombocytopenia"}),
    "lung": (lambda p, t: bool(_c(p) & {"ild", "pneumonitis", "pulmonary_fibrosis", "copd", "thoracic_radiotherapy"}),
             {"ild_risk"}),
    "cardiac": (lambda p, t: _below(p, "lvef", t["lvef_low"]) or "heart_failure" in _c(p)
                or "prior_anthracycline" in _c(p), {"lvef_cardiac"}),
    "nerve": (lambda p, t: bool(_c(p) & {"peripheral_neuropathy", "diabetic_neuropathy"}), {"neuropathy"}),
    "eye": (lambda p, t: bool(_c(p) & {"ocular_disease", "keratitis", "dry_eye", "glaucoma"}), {"ocular"}),
    "marrow": (lambda p, t: _below(p, "anc", t["anc_low"]), {"neutropenia_risk", "myelosuppression"}),
    "interaction": (lambda p, t: bool(_m(p) & CYP), {"cyp3a4_interaction", "ugt1a1_toxicity"}),
    "pregnancy": (lambda p, t: p.get("pregnant") is True, {"embryofetal"}),
}

# Hand-set prior weights (log-odds). Can be refit on the DEV set only with fit().
WEIGHTS = {"bias": -2.6, "uncovered_domains": 1.8, "missing_core_labs": 0.35, "n_meds": 0.08,
           "elderly": 0.3, "fake_citations": 2.0, "llm_only_flags": 0.4, "counterfactual_failed": 1.5,
           "no_evidence": 1.5, "unresolved_adc": 2.5}
CORE_LABS = ["egfr", "bilirubin_x_uln", "platelets", "anc", "lvef"]


def _c(p):
    return {x.lower() for x in p.get("conditions") or []}


def _m(p):
    return {x.lower() for x in p.get("meds") or []}


def _below(patient: dict, field: str, threshold: float) -> bool:
    return patient.get(field) is not None and patient[field] < threshold


def features(case: dict, card: dict, t: dict) -> dict:
    p = case.get("patient") or {}
    flag_ids = {f.get("id") for f in card.get("flags") or []}
    uncovered = [d for d, (trig, ok) in DOMAINS.items() if trig(p, t) and not (flag_ids & ok)]
    return {
        "uncovered_domains": len(uncovered),
        "missing_core_labs": sum(p.get(k) is None for k in CORE_LABS),
        "n_meds": len(p.get("meds") or []),
        "elderly": float((p.get("age") or 0) >= t["elderly_age"]),
        "fake_citations": float(bool(card.get("fake_citations") or card.get("rejected_citations"))),
        "llm_only_flags": sum(f.get("source") == "llm" for f in card.get("flags") or []),
        "counterfactual_failed": float((card.get("counterfactual") or {}).get("passed") is False),
        "no_evidence": float(not card.get("evidence")),
        "unresolved_adc": float(any("not found" in u for u in card.get("unknowns") or [])),
        "_uncovered": uncovered,
    }


class Guardrail:
    def __init__(self, thresholds: dict, weights: dict | None = None):
        self.t = thresholds
        self.w = dict(weights or WEIGHTS)

    def p_miss(self, case: dict, card: dict) -> tuple[float, dict]:
        f = features(case, card, self.t)
        z = self.w["bias"] + sum(self.w[k] * v for k, v in f.items() if not k.startswith("_"))
        return 1 / (1 + math.exp(-z)), f

    def review(self, case: dict, card: dict) -> dict:
        from adcg.validation import confidence, validate_patient, validate_response

        try:
            validate_patient(case.get("patient") or {})
            validate_response(card)
        except ValueError:
            return {"p_miss": None, "blocked": True, "threshold": self.t["guardrail_block_threshold"],
                    "uncovered_domains": [], "action": "BLOCK: route to pharmacist",
                    "block_reasons": ["invalid_input_or_confidence"], "score_kind": "uncalibrated_heuristic"}
        p, f = self.p_miss(case, card)
        reasons = []
        if p > self.t["guardrail_block_threshold"]:
            reasons.append("risk_score")
        if card.get("needs_human"):
            reasons.append("required_human_review")
        if card.get("verdict") == "dont_know":
            reasons.append("unresolved_verdict")
        if confidence(card["confidence"]) < self.t["agent_min_confidence"]:
            reasons.append("low_confidence")
        if card.get("unknowns"):
            reasons.append("unresolved_inputs")
        if not card.get("evidence"):
            reasons.append("missing_evidence")
        if any(flag.get("severity") == "high" for flag in card.get("flags") or []):
            reasons.append("high_severity_flag")
        if card.get("error") or card.get("rejected_citations") or card.get("fake_citations"):
            reasons.append("processing_or_evidence_failure")
        if (card.get("counterfactual") or {}).get("passed") is False:
            reasons.append("counterfactual_failed")
        blocked = bool(reasons)
        return {"p_miss": round(p, 3), "blocked": blocked, "threshold": self.t["guardrail_block_threshold"],
                "uncovered_domains": f["_uncovered"],
                "block_reasons": reasons, "score_kind": "uncalibrated_heuristic",
                "action": "BLOCK: route to pharmacist" if blocked else "release with flags"}

    def fit(self, cases: list[dict], cards: list[dict], missed: list[bool]) -> None:
        """Refit weights by logistic regression on DEV cases only (never the test set)."""
        from sklearn.linear_model import LogisticRegression

        keys = [k for k in WEIGHTS if k != "bias"]
        X = [[features(c, k, self.t)[n] for n in keys] for c, k in zip(cases, cards, strict=True)]
        if len(set(missed)) < 2:
            return
        lr = LogisticRegression(C=1.0).fit(X, missed)
        self.w = {"bias": float(lr.intercept_[0]), **{k: float(v) for k, v in zip(keys, lr.coef_[0], strict=True)}}

    def save(self, path: Path) -> None:
        path.write_text(json.dumps(self.w, indent=2))
