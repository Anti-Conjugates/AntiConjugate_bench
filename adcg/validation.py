"""Structural validation shared by the agent, baseline and benchmark runner."""

from __future__ import annotations

import math

VERDICTS = {"supported", "not_supported", "dont_know"}
SEVERITIES = {"monitor", "moderate", "high"}


def confidence(value) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError("confidence must be a number")
    try:
        result = float(value)
    except OverflowError as error:
        raise ValueError("confidence is outside its supported range") from error
    if not math.isfinite(result) or not 0 <= result <= 1:
        raise ValueError("confidence must be finite and between zero and one")
    return result


def validate_response(out: dict, flag_key: str = "flags") -> dict:
    if not isinstance(out, dict) or not isinstance(out.get("verdict"), str) or out["verdict"] not in VERDICTS:
        raise ValueError("model response must contain a valid verdict")
    confidence(out.get("confidence"))
    for key in ("answer", "reason"):
        if key in out and not isinstance(out[key], str):
            raise ValueError(f"{key} must be text")
    for key in ("unknowns", flag_key):
        if not isinstance(out.get(key, []), list):
            raise ValueError(f"{key} must be a list")
    if any(not isinstance(u, str) for u in out.get("unknowns", [])):
        raise ValueError("unknowns must contain text")
    ev = out.get("evidence", [])
    if not isinstance(ev, str | list) or isinstance(ev, list) and any(not isinstance(e, str) for e in ev):
        raise ValueError("evidence must contain citation strings")
    for flag in out.get(flag_key, []):
        if not isinstance(flag, dict) or not isinstance(flag.get("id"), str):
            raise ValueError("flags must contain objects with string ids")
        if not isinstance(flag.get("severity"), str) or flag["severity"] not in SEVERITIES or not isinstance(flag.get("text"), str):
            raise ValueError("flags must contain valid severity and text")
        evidence = flag.get("evidence", [])
        if not isinstance(evidence, list | str) or isinstance(evidence, list) and any(
            not isinstance(e, str) for e in evidence
        ):
            raise ValueError("flag evidence must contain citation strings")
    if "needs_human" in out and not isinstance(out["needs_human"], bool):
        raise ValueError("needs_human must be a boolean")
    return out


def validate_patient(patient: dict) -> None:
    if not isinstance(patient, dict):
        raise ValueError("patient must be an object")
    for field in ("age", "egfr", "bilirubin_x_uln", "ast_alt_x_uln", "platelets", "anc", "lvef"):
        value = patient.get(field)
        if value is None:
            continue
        try:
            finite = isinstance(value, int | float) and math.isfinite(value)
        except OverflowError:
            finite = False
        if isinstance(value, bool) or not finite or value < 0:
            raise ValueError(f"{field} must be a finite nonnegative number")
        if field == "lvef" and value > 100 or field == "age" and value > 130:
            raise ValueError(f"{field} is outside its supported range")
    for field in ("conditions", "meds"):
        values = patient.get(field)
        if values is not None and (not isinstance(values, list) or any(not isinstance(v, str) for v in values)):
            raise ValueError(f"{field} must be a list of strings or unknown")
    if patient.get("pregnant") is not None and not isinstance(patient["pregnant"], bool):
        raise ValueError("pregnant must be a boolean or unknown")


def failure_card(error_type: str) -> dict:
    return {
        "answer": "Recommendation withheld: the input or model response could not be validated.",
        "reason": "Route to a pharmacist; this is a processing failure, not a model abstention.",
        "verdict": "dont_know", "confidence": 0.0, "flags": [], "evidence": [], "unknowns": [],
        "needs_human": True, "delivery_status": "review_required", "error": error_type,
    }
