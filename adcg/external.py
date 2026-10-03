"""Adapter for the team's JSON benchmark format (benchmark/test/items_public.json) and scorer.py.

Inputs only: id, query, target_adc, patient_profile. Gold fields are never read here.
"""

from __future__ import annotations

import math
import re

from adcg.kb import KB
from adcg.validation import validate_patient

BILIRUBIN_ULN_MG_DL = 1.2
AST_ALT_ULN_U_L = 40.0

CONDITION_PATTERNS = [
    (r"interstitial lung|\bild\b|pneumonitis", "ild"),
    (r"pulmonary fibrosis", "pulmonary_fibrosis"),
    (r"\bcopd\b|chronic obstructive", "copd"),
    (r"asthma", "asthma"),
    (r"(thoracic|chest|lung|mediastin).*radi|radi.*(thoracic|chest|lung|mediastin)", "thoracic_radiotherapy"),
    (r"lung metasta", "lung_metastases"),
    (r"heart failure|\bhfref\b|cardiomyopathy", "heart_failure"),
    (r"anthracycline|doxorubicin|epirubicin", "prior_anthracycline"),
    (r"cirrhosis|hepatitis|liver disease|hepatic impairment|child-pugh|liver metasta", "liver_disease"),
    (r"diabetic (peripheral )?neuropathy", "diabetic_neuropathy"),
    (r"(?<!diabetic )(peripheral )?neuropathy", "peripheral_neuropathy"),
    (r"keratitis", "keratitis"),
    (r"dry eye", "dry_eye"),
    (r"glaucoma", "glaucoma"),
    (r"pleural effusion", "pleural_effusion"),
    (r"ascites", "ascites"),
]


def _num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return float(v) if math.isfinite(v) else None
    text = str(v or "").strip()
    text = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", text)
    m = re.fullmatch(r"([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([^\d]*|(?:x|×|10)[^\n]*)", text, re.I)
    return float(m[1]) if m and math.isfinite(float(m[1])) else None


def _measurement(raw, default_unit: str, declared_unit: str | None = None) -> tuple[float | None, str]:
    if isinstance(raw, dict):
        declared_unit = raw.get("unit", declared_unit)
        raw = raw.get("value")
    value = _num(raw)
    if isinstance(raw, str):
        text = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", raw.strip())
        unit = re.sub(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*", "", text, flags=re.I)
    else:
        unit = ""
    unit = unit or declared_unit or default_unit
    return value, str(unit).lower().replace(" ", "").replace("µ", "u").replace("μ", "u").replace("×", "x")


def _lab_value(raw, kind: str, declared_unit: str | None = None, uln=None) -> float | None:
    defaults = {"count": "cells/uL", "bilirubin": "mg/dL", "enzyme": "U/L", "renal": "mL/min"}
    value, unit = _measurement(raw, defaults[kind], declared_unit)
    if value is None or value < 0:
        return None
    if kind == "count":
        if unit in ("cells/ul", "/ul", "cells/mm3", "/mm3"):
            return value / 1000
        if unit in ("10^9/l", "x10^9/l", "10⁹/l", "x10⁹/l", "k/ul", "10^3/ul", "x10^3/ul"):
            return value
    elif kind == "renal":
        if unit in ("ml/min", "ml/min/1.73m2", "ml/min/1.73m²"):
            return value
    elif unit in ("xuln", "uln"):
        return value
    elif kind == "bilirubin":
        reference = _num(uln) if uln is not None else BILIRUBIN_ULN_MG_DL
        if unit == "umol/l":
            value /= 17.1
            if uln is not None and reference is not None:
                reference /= 17.1
        elif unit != "mg/dl":
            return None
        return round(value / reference, 2) if reference and reference > 0 else None
    elif kind == "enzyme" and unit in ("u/l", "iu/l"):
        reference = _num(uln) if uln is not None else AST_ALT_ULN_U_L
        return round(value / reference, 2) if reference and reference > 0 else None
    return None


def _med_names(meds: list[str], kb: KB) -> list[str]:
    known = sorted({d for lst in kb.drug_lists.values() if isinstance(lst, list) for d in lst}, key=len, reverse=True)
    out = []
    for m in meds:
        low = m.lower()
        if low.strip() in ("", "none", "nil", "no regular medications"):
            continue
        hits = [d for d in known if re.search(rf"\b{re.escape(d)}\b", low)]
        if hits:
            out += hits[:1]
        else:
            tok = re.match(r"[a-z][a-z\-']+", low.strip())
            if tok:
                out.append(tok.group())
    return list(dict.fromkeys(out))


def map_patient(pp: dict, kb: KB) -> tuple[dict, dict]:
    """Map a free-form patient_profile onto rule-engine fields; anything unmapped goes to `other`."""
    if not isinstance(pp, dict):
        raise ValueError("patient_profile must be an object")
    p: dict = {}
    other: dict = {}
    unknowns = []
    if pp.get("age") is not None:
        age = _num(pp["age"])
        if age is not None and 0 <= age <= 130 and age.is_integer():
            p["age"] = int(age)
        else:
            unknowns.append("age could not be validated")
    g = str(pp.get("gender") or pp.get("sex") or "").lower()
    if g:
        p["sex"] = "F" if g.startswith("f") else "M" if g.startswith("m") else g
    if pp.get("baseline_lvef") is not None:
        value, unit = _measurement(pp["baseline_lvef"], "%")
        if value is not None and 0 <= value <= 100 and unit == "%":
            p["lvef"] = value
        else:
            unknowns.append("baseline LVEF could not be validated")
    labs = dict(pp.get("labs") or {})
    low = {k.lower(): k for k in labs}
    units = {k.lower(): v for k, v in (pp.get("lab_units") or {}).items()}
    ulns = {k.lower(): v for k, v in (pp.get("lab_uln") or {}).items()}

    def lab(key, field, kind):
        raw = labs.pop(low[key])
        ref = raw.get("uln", ulns.get(key)) if isinstance(raw, dict) else ulns.get(key)
        value = _lab_value(raw, kind, units.get(key), ref)
        if value is None:
            unknowns.append(f"{key} value, unit or reference range could not be validated")
            return
        p[field] = value

    renal = "egfr" if "egfr" in low else "crcl" if "crcl" in low else None
    if renal:
        lab(renal, "egfr", "renal")
    if renal == "crcl":
        other["renal_note"] = "eGFR not given; CrCl used as the renal estimate"
        unknowns.append("CrCl supplied instead of eGFR; renal estimate requires review")
    for key in ("platelets", "anc"):
        if key in low:
            lab(key, key, "count")
    if "total_bilirubin" in low:
        lab("total_bilirubin", "bilirubin_x_uln", "bilirubin")
    tx = []
    for key in ("ast", "alt"):
        if key in low:
            lab(key, "ast_alt_x_uln", "enzyme")
            if "ast_alt_x_uln" in p:
                tx.append(p.pop("ast_alt_x_uln"))
    if tx:
        p["ast_alt_x_uln"] = max(tx)
    if labs:
        other["labs"] = labs
    meds = pp.get("medications")
    conds = pp.get("comorbidities")
    for name, values in (("medications", meds), ("comorbidities", conds)):
        if values is not None and (not isinstance(values, list) or any(not isinstance(v, str) for v in values)):
            raise ValueError(f"{name} must be a list of strings or unknown")
    p["meds"] = _med_names(meds, kb) if meds is not None else None
    positive = []
    for condition in conds or []:
        if re.search(r"\b(no|not|denies|without|negative|ruled out)\b", condition, re.I):
            unknowns.append("negated or mixed condition text requires structured review")
        else:
            positive.append(condition)
    text = " ; ".join(positive).lower()
    found = [c for pat, c in CONDITION_PATTERNS if re.search(pat, text)]
    if {"diabetic_neuropathy", "peripheral_neuropathy"} <= set(found) and not re.search(r"(?<!diabetic )(?<!diabetic peripheral )neuropathy", text):
        found.remove("peripheral_neuropathy")
    p["conditions"] = found if conds is not None else None
    if re.search(r"pregnan", text):
        p["pregnant"] = True
    gen = pp.get("genetics")
    if gen:
        gs = str(gen)
        m = re.search(r"\*\d+\s*/\s*\*\d+", gs)
        if "ugt1a1" in gs.lower() and m:
            p["ugt1a1"] = m.group().replace(" ", "")
        elif "ugt1a1" in gs.lower() and "poor" in gs.lower():
            p["ugt1a1"] = "poor"
        other["genetics"] = gen
    other.update({"medications_as_written": meds, "comorbidities_as_written": conds})
    for k in ("indication", "imaging"):
        if pp.get(k):
            other[k] = pp[k]
    for k, v in pp.items():
        if k not in ("age", "gender", "sex", "baseline_lvef", "labs", "medications", "comorbidities",
                     "genetics", "indication", "imaging", "lab_units", "lab_uln"):
            other[k] = v
    other["normalization_unknowns"] = unknowns
    validate_patient(p)
    return p, other


def to_internal(item: dict, kb: KB) -> dict:
    q = item.get("query", "")
    if item.get("patient_profile") is not None:
        patient, other = map_patient(item["patient_profile"], kb)
        return {"id": item["id"], "type": "case", "adc": item.get("target_adc", ""), "question": q,
                "patient": patient, "patient_raw": item["patient_profile"], "context": other}
    adc = item.get("target_adc") or ""
    if not adc:
        row = kb.find_adc_in_text(q)
        adc = (row or {}).get("brand_name") or (row or {}).get("adc_name") or ""
    return {"id": item["id"], "type": "claim", "adc": adc, "claim": q}


def to_scorer(item_id: str, card: dict, guard: dict | None = None) -> dict:
    """scorer.py expects flags as strings and every citation in `evidence`."""
    from adcg.score import card_citations

    flags = [f"{f.get('id')} ({f.get('severity', '')}): {f.get('text', '')}" for f in card.get("flags") or []
             if isinstance(f, dict)]
    return {"item_id": item_id, "answer": card.get("answer", ""), "verdict": card.get("verdict", "dont_know"),
            "confidence": float(card.get("confidence", 0.0)), "reason": card.get("reason", ""), "flags": flags,
            "evidence": card_citations(card), "unknowns": card.get("unknowns") or [],
            "needs_human": bool(card.get("needs_human")) or bool(guard and guard.get("blocked")),
            "delivery_status": card.get("delivery_status", "research_only"),
            "guardrail": guard, "error": card.get("error")}
