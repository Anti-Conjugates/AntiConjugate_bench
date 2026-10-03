"""Deterministic organ-function, interaction and payload-class checks.

Every flag carries evidence strings that resolve against our own data
(ADCDB:<id> or FDA:<brand>, KB:<class>, KB:drug_lists:<list>, RULE:<name>, PATIENT:<field>).
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

FLAG_IDS = [
    "ild_risk", "neutropenia_risk", "lvef_cardiac", "embryofetal", "thrombocytopenia",
    "bleeding_risk", "hepatotoxicity", "hepatic_impairment", "renal_impairment",
    "cyp3a4_interaction", "neuropathy", "ocular", "ugt1a1_toxicity", "diarrhoea",
    "myelosuppression", "oedema_effusion", "gi_toxicity", "skin", "elderly_polypharmacy",
]

TOX_TO_FLAG = {
    "ild_pneumonitis": "ild_risk", "neutropenia": "neutropenia_risk", "lvef_decline": "lvef_cardiac",
    "embryofetal": "embryofetal", "thrombocytopenia": "thrombocytopenia",
    "hepatotoxicity": "hepatotoxicity", "peripheral_neuropathy": "neuropathy", "ocular": "ocular",
    "diarrhoea": "diarrhoea", "myelosuppression": "myelosuppression",
    "oedema_effusion": "oedema_effusion", "nausea_gi": "gi_toxicity", "skin": "skin",
}

SEVERITY_RANK = {"monitor": 0, "moderate": 1, "high": 2}

PATIENT_FIELDS = [
    "age", "sex", "egfr", "bilirubin_x_uln", "ast_alt_x_uln", "platelets", "anc", "lvef",
    "conditions", "meds", "ugt1a1", "pregnant",
]


@dataclass
class Flag:
    id: str
    severity: str
    text: str
    evidence: list[str] = field(default_factory=list)
    source: str = "rules"


@dataclass
class RuleResult:
    flags: dict[str, Flag] = field(default_factory=dict)
    unknowns: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def add(self, fid: str, severity: str, text: str, evidence: list[str]) -> None:
        cur = self.flags.get(fid)
        if cur is None:
            self.flags[fid] = Flag(fid, severity, text, list(dict.fromkeys(evidence)))
            return
        if SEVERITY_RANK[severity] > SEVERITY_RANK[cur.severity]:
            cur.severity, cur.text = severity, text
        cur.evidence = list(dict.fromkeys(cur.evidence + evidence))

    def unknown(self, what: str) -> None:
        if what not in self.unknowns:
            self.unknowns.append(what)

    def as_flags(self) -> list[dict]:
        return [asdict(f) for f in self.flags.values()]


def _meds(p: dict) -> set[str]:
    return {m.strip().lower() for m in p.get("meds") or []}


def _conds(p: dict) -> set[str]:
    return {c.strip().lower() for c in p.get("conditions") or []}


def _on(p: dict, kb, list_name: str) -> list[str]:
    return sorted(_meds(p) & set(kb.drug_lists[list_name]))


# ---- individual checks: (patient, kb, result, ev_base) -> None ---------------

def check_renal_function(p, kb, r, ev):
    t = kb.thresholds
    if p.get("egfr") is None:
        return r.unknown("renal function (eGFR)")
    if p["egfr"] < t["egfr_severe"]:
        r.add("renal_impairment", "high", f"Severe renal impairment (eGFR {p['egfr']}).", ev + ["PATIENT:egfr"])
    elif p["egfr"] < t["egfr_moderate"]:
        r.add("renal_impairment", "moderate", f"Moderate renal impairment (eGFR {p['egfr']}).", ev + ["PATIENT:egfr"])


def check_hepatic_function(p, kb, r, ev):
    t = kb.thresholds
    bili, ast = p.get("bilirubin_x_uln"), p.get("ast_alt_x_uln")
    if "liver_disease" in _conds(p):
        r.add("hepatic_impairment", "high", "Known liver disease.", ev + ["PATIENT:conditions"])
    if bili is None and ast is None:
        return r.unknown("hepatic function (bilirubin, AST/ALT)")
    if (bili or 0) > t["bilirubin_x_uln_moderate"] or (ast or 0) > t["ast_alt_x_uln_high"]:
        r.add("hepatic_impairment", "high",
              f"Hepatic impairment (bilirubin {bili}xULN, AST/ALT {ast}xULN).",
              ev + [f for f, v in (("PATIENT:bilirubin_x_uln", bili), ("PATIENT:ast_alt_x_uln", ast)) if v is not None])


def check_anticoagulant_antiplatelet(p, kb, r, ev):
    drugs = _on(p, kb, "anticoagulant") + _on(p, kb, "antiplatelet")
    if drugs:
        r.add("bleeding_risk", "high" if "thrombocytopenia" in r.flags or _low_plt(p, kb) else "moderate",
              f"On {', '.join(drugs)}: bleeding risk if platelets fall.",
              ev + ["PATIENT:meds", "KB:drug_lists:anticoagulant", "KB:drug_lists:antiplatelet"])


def _low_plt(p, kb):
    return p.get("platelets") is not None and p["platelets"] < kb.thresholds["platelets_low"]


def check_baseline_platelets(p, kb, r, ev):
    if p.get("platelets") is None:
        return r.unknown("baseline platelet count")
    if _low_plt(p, kb):
        r.add("thrombocytopenia", "high", f"Low baseline platelets ({p['platelets']}).", ev + ["PATIENT:platelets"])


def check_baseline_anc(p, kb, r, ev):
    if p.get("anc") is None:
        return r.unknown("baseline neutrophil count (ANC)")
    if p["anc"] < kb.thresholds["anc_low"]:
        r.add("neutropenia_risk", "high", f"Low baseline ANC ({p['anc']}).", ev + ["PATIENT:anc"])


def check_baseline_lvef(p, kb, r, ev):
    if "heart_failure" in _conds(p):
        r.add("lvef_cardiac", "high", "History of heart failure.", ev + ["PATIENT:conditions"])
    if p.get("lvef") is None:
        return r.unknown("baseline LVEF")
    if p["lvef"] < kb.thresholds["lvef_low"]:
        r.add("lvef_cardiac", "high", f"Reduced baseline LVEF ({p['lvef']}%).", ev + ["PATIENT:lvef"])


def check_cardiotoxic_drugs(p, kb, r, ev):
    drugs = _on(p, kb, "cardiotoxic")
    if drugs or "prior_anthracycline" in _conds(p):
        r.add("lvef_cardiac", "moderate", f"Cardiotoxic co-exposure ({', '.join(drugs) or 'prior anthracycline'}).",
              ev + ["KB:drug_lists:cardiotoxic", "PATIENT:meds" if drugs else "PATIENT:conditions"])


def check_ild_history(p, kb, r, ev):
    hit = _conds(p) & {"ild", "pneumonitis", "pulmonary_fibrosis"}
    if hit:
        r.add("ild_risk", "high", f"Pre-existing {', '.join(sorted(hit))}.", ev + ["PATIENT:conditions"])


def check_lung_disease(p, kb, r, ev):
    hit = _conds(p) & {"copd", "thoracic_radiotherapy", "asthma", "lung_metastases"}
    if hit:
        r.add("ild_risk", "moderate", f"Lung risk factor: {', '.join(sorted(hit))}.", ev + ["PATIENT:conditions"])


def check_pneumonitis_drugs(p, kb, r, ev):
    drugs = _on(p, kb, "pneumonitis_risk")
    if drugs:
        r.add("ild_risk", "moderate", f"Co-medication with pneumonitis risk: {', '.join(drugs)}.",
              ev + ["PATIENT:meds", "KB:drug_lists:pneumonitis_risk"])


def check_pregnancy(p, kb, r, ev):
    if p.get("pregnant") is True:
        r.add("embryofetal", "high", "Patient is pregnant.", ev + ["PATIENT:pregnant"])


def check_ugt1a1_status(p, kb, r, ev):
    g = (p.get("ugt1a1") or "").replace(" ", "")
    if not g:
        return r.unknown("UGT1A1 genotype")
    if g in ("*28/*28", "poor"):
        r.add("ugt1a1_toxicity", "high", "UGT1A1 poor metaboliser: higher SN-38 exposure.", ev + ["PATIENT:ugt1a1"])


def check_ugt1a1_interacting_drugs(p, kb, r, ev):
    drugs = _on(p, kb, "ugt1a1_interacting")
    if drugs:
        r.add("ugt1a1_toxicity", "moderate", f"UGT1A1 interacting drug(s): {', '.join(drugs)}.",
              ev + ["PATIENT:meds", "KB:drug_lists:ugt1a1_interacting"])


def check_cyp3a4_strong_inhibitor(p, kb, r, ev):
    drugs = _on(p, kb, "cyp3a4_strong_inhibitor")
    if drugs:
        r.add("cyp3a4_interaction", "high", f"Strong CYP3A4 inhibitor(s) {', '.join(drugs)} may raise payload exposure.",
              ev + ["PATIENT:meds", "KB:drug_lists:cyp3a4_strong_inhibitor"])


def check_cyp3a4_strong_inducer(p, kb, r, ev):
    drugs = _on(p, kb, "cyp3a4_strong_inducer")
    if drugs:
        r.add("cyp3a4_interaction", "moderate", f"Strong CYP3A4 inducer(s) {', '.join(drugs)} may lower payload exposure.",
              ev + ["PATIENT:meds", "KB:drug_lists:cyp3a4_strong_inducer"])


def check_existing_neuropathy(p, kb, r, ev):
    hit = _conds(p) & {"peripheral_neuropathy", "diabetic_neuropathy"}
    if hit:
        r.add("neuropathy", "high", f"Pre-existing {', '.join(sorted(hit))}.", ev + ["PATIENT:conditions"])


def check_neurotoxic_drugs(p, kb, r, ev):
    drugs = _on(p, kb, "neurotoxic")
    if drugs:
        r.add("neuropathy", "moderate", f"Neurotoxic co-medication: {', '.join(drugs)}.",
              ev + ["PATIENT:meds", "KB:drug_lists:neurotoxic"])


def check_ocular_disease(p, kb, r, ev):
    hit = _conds(p) & {"ocular_disease", "keratitis", "dry_eye", "glaucoma"}
    if hit:
        r.add("ocular", "high" if "ocular" in r.flags else "moderate",
              f"Pre-existing eye condition: {', '.join(sorted(hit))}.", ev + ["PATIENT:conditions"])


def check_fluid_status(p, kb, r, ev):
    hit = _conds(p) & {"heart_failure", "pleural_effusion", "ascites"}
    if hit:
        r.add("oedema_effusion", "moderate", f"Fluid-retention risk: {', '.join(sorted(hit))}.", ev + ["PATIENT:conditions"])


def check_elderly_polypharmacy(p, kb, r, ev):
    t = kb.thresholds
    age, n = p.get("age"), len(p.get("meds") or [])
    if (age is not None and age >= t["elderly_age"]) or n >= t["polypharmacy_n"]:
        r.add("elderly_polypharmacy", "moderate", f"Age {age}, {n} co-medications: reduced reserve, review interactions.",
              ev + [f for f, ok in (("PATIENT:age", age is not None), ("PATIENT:meds", n > 0)) if ok])


RULES = {name[len("check_"):]: fn for name, fn in globals().items() if name.startswith("check_")}


def run_rules(adc: dict, patient: dict, kb) -> tuple[str | None, RuleResult]:
    r = RuleResult()
    adc_ev = [kb.adc_cite(adc)]
    cls = kb.payload_class(adc.get("payload", ""))
    if cls is None:
        r.unknown(f"payload class for '{adc.get('payload', '')}' not in knowledge table")
        return None, r
    c = kb.payload_kb["classes"][cls]
    for tox in c["toxicities"]:
        if tox not in TOX_TO_FLAG:
            r.unknown(f"unmapped class toxicity '{tox}'; pharmacist review required")
        else:
            r.add(TOX_TO_FLAG[tox], "monitor", f"Class toxicity of {c['label']}: {tox}.", adc_ev + [f"KB:{cls}"])
    checks = list(c["checks"])
    for ab_key, eff in kb.payload_kb["antibody_class_effects"].items():
        if re.search(ab_key, adc.get("antigen", "") + " " + adc.get("adc_name", ""), flags=re.I):
            for tox in eff["toxicities"]:
                if tox not in TOX_TO_FLAG:
                    r.unknown(f"unmapped antibody toxicity '{tox}'; pharmacist review required")
                else:
                    r.add(TOX_TO_FLAG[tox], "monitor", eff["note"], adc_ev + [f"KB:{ab_key}"])
            checks += eff["checks"]
    checks += kb.payload_kb["always_check"] + ["elderly_polypharmacy"]
    for name in dict.fromkeys(checks):
        if name not in RULES:
            r.unknown(f"unmapped check '{name}'; pharmacist review required")
        else:
            RULES[name](patient, kb, r, [f"RULE:{name}"])
    r.notes += biophysics_notes(adc, kb)
    return cls, r


# ---- biophysics (informational; engineer to set thresholds) -----------------

_UNIT_TO_NM = {"pm": 1e-3, "nm": 1.0, "um": 1e3, "μm": 1e3, "m": 1e9}


def kd_nm(binding_affinity: str) -> float | None:
    m = re.search(r"Kd\)?\s*\|.*?\|\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(pM|nM|uM|μM|M|ng/mL)\b", binding_affinity or "", flags=re.I)
    if not m:
        return None
    val = float(m.group(1))
    unit = m.group(2).lower()
    if unit == "ng/ml":
        return val / 150.0  # IgG ~150 kDa: 1 ng/mL ~ 0.00667 nM
    return val * _UNIT_TO_NM[unit]


CLEAVABLE = r"val-cit|vc|val-ala|gly-gly-phe-gly|ggfg|cl2a|hydrazone|disulfide|spdb|spp|cleavable"
NON_CLEAVABLE = r"smcc|\bmcc\b|non-cleavable|thioether"


def biophysics_notes(adc: dict, kb) -> list[str]:
    t, notes = kb.thresholds, []
    kd = kd_nm(adc.get("binding_affinity", ""))
    if kd is not None:
        if kd < t["affinity_kd_nm_high_affinity"]:
            notes.append(f"Kd ~{kd:.3g} nM is below the affinity window: possible binding-site barrier / poor tumour penetration (UNVERIFIED threshold).")
        elif kd > t["affinity_kd_nm_low_affinity"]:
            notes.append(f"Kd ~{kd:.3g} nM is above the affinity window: weak target engagement (UNVERIFIED threshold).")
        else:
            notes.append(f"Kd ~{kd:.3g} nM is inside the affinity window (UNVERIFIED threshold).")
    linker = (adc.get("linker", "") + " " + adc.get("linker_payload_combo", "")).lower()
    if re.search(NON_CLEAVABLE, linker):
        notes.append("Non-cleavable linker: typically higher circulating stability, limited bystander effect.")
    elif re.search(CLEAVABLE, linker):
        notes.append("Cleavable linker: check circulating-stability data for premature payload release.")
    rel = re.search(r"Release\s*\|\s*([\d.]+)\s*%", adc.get("circulating_stability", ""))
    if rel:
        notes.append(f"ADCdb circulating stability: {rel.group(1)}% payload release reported.")
    return notes
