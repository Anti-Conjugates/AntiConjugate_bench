"""Adapter for the team's JSON benchmark format (benchmark/test/items_public.json) and scorer.py.

Inputs only: id, query, target_adc, patient_profile. Gold fields are never read here.
"""

from __future__ import annotations

import re

from adcg.kb import KB

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
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:\.\d+)?", str(v or ""))
    return float(m.group()) if m else None


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
    p, other = {}, {}
    if pp.get("age") is not None:
        p["age"] = int(_num(pp["age"]))
    g = str(pp.get("gender") or pp.get("sex") or "").lower()
    if g:
        p["sex"] = "F" if g.startswith("f") else "M" if g.startswith("m") else g
    if pp.get("baseline_lvef") is not None and _num(pp["baseline_lvef"]) is not None:
        p["lvef"] = _num(pp["baseline_lvef"])
    labs = dict(pp.get("labs") or {})
    low = {k.lower(): k for k in labs}
    if "egfr" in low:
        p["egfr"] = _num(labs.pop(low["egfr"]))
    elif "crcl" in low:
        p["egfr"] = _num(labs[low["crcl"]])
        other["renal_note"] = "eGFR not given; CrCl used as the renal estimate"
    if "platelets" in low:
        v = _num(labs.pop(low["platelets"]))
        p["platelets"] = v / 1000 if v and v > 1000 else v
    if "anc" in low:
        v = _num(labs.pop(low["anc"]))
        p["anc"] = v / 1000 if v and v > 50 else v
    if "total_bilirubin" in low:
        p["bilirubin_x_uln"] = round(_num(labs.pop(low["total_bilirubin"])) / BILIRUBIN_ULN_MG_DL, 2)
    tx = [_num(labs.pop(low[k])) for k in ("ast", "alt") if k in low]
    tx = [v for v in tx if v is not None]
    if tx:
        p["ast_alt_x_uln"] = round(max(tx) / AST_ALT_ULN_U_L, 2)
    if labs:
        other["labs"] = labs
    meds = list(pp.get("medications") or [])
    p["meds"] = _med_names(meds, kb)
    conds = list(pp.get("comorbidities") or [])
    text = " ; ".join(conds).lower()
    found = [c for pat, c in CONDITION_PATTERNS if re.search(pat, text)]
    if {"diabetic_neuropathy", "peripheral_neuropathy"} <= set(found) and not re.search(r"(?<!diabetic )(?<!diabetic peripheral )neuropathy", text):
        found.remove("peripheral_neuropathy")
    p["conditions"] = found
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
                     "genetics", "indication", "imaging"):
            other[k] = v
    return p, other


def to_internal(item: dict, kb: KB) -> dict:
    q = item.get("query", "")
    if item.get("patient_profile"):
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
            "guardrail": guard, "error": card.get("error")}
