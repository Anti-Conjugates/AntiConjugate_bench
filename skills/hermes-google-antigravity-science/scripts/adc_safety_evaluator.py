#!/usr/bin/env python3
"""
ADC Prescribing-Safety Guardrail for Hermes Agent
Epistemological Prescribing-Risk Card Generator for Antibody-Drug Conjugates in Oncology.
Standards Compliance: NHS DCB0129, NICE HTG10877, FDA Boxed Warnings.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional

ADC_RULES = {
    "trastuzumab deruxtecan": {
        "brand": "Enhertu",
        "target": "HER2 (ERBB2)",
        "payload": "DXd (topoisomerase I inhibitor)",
        "boxed_warnings": [
            "Interstitial Lung Disease (ILD) / Pneumonitis (potentially fatal)",
            "Embryo-Fetal Toxicity"
        ],
        "contraindications": {
            "lvef_min": 45.0,  # Halt/contraindicated if LVEF < 45% or absolute decrease > 15%
            "egfr_min": 30.0,
            "platelets_min": 50_000,
            "anc_min": 1_000,
            "ild_history": True  # History of ILD/pneumonitis requires extreme caution / contraindication
        }
    },
    "sacituzumab govitecan": {
        "brand": "Trodelvy",
        "target": "Trop-2 (TACSTD2)",
        "payload": "SN-38 (topoisomerase I inhibitor)",
        "boxed_warnings": [
            "Severe or Life-Threatening Neutropenia",
            "Severe Diarrhea"
        ],
        "contraindications": {
            "anc_min": 1_500,
            "ugt1a1_homozygous_risk": True,  # UGT1A1 *28/*28 homozygous patients have elevated risk of neutropenia
            "platelets_min": 75_000,
            "egfr_min": 30.0
        }
    },
    "enfortumab vedotin": {
        "brand": "Padcev",
        "target": "Nectin-4",
        "payload": "MMAE (microtubule disruptor)",
        "boxed_warnings": [
            "Severe Cutaneous Adverse Reactions (SCAR) / Stevens-Johnson Syndrome (SJS) / TEN",
            "Hyperglycemia and Diabetic Ketoacidosis (DKA)",
            "Peripheral Neuropathy"
        ],
        "contraindications": {
            "max_blood_glucose": 250.0,
            "max_neuropathy_grade": 1,
            "egfr_min": 30.0
        }
    },
    "trastuzumab emtansine": {
        "brand": "Kadcyla",
        "target": "HER2 (ERBB2)",
        "payload": "DM1 (microtubule inhibitor)",
        "boxed_warnings": [
            "Hepatotoxicity (liver failure, nodular regenerative hyperplasia)",
            "Cardiotoxicity (reduction in LVEF)",
            "Embryo-Fetal Toxicity"
        ],
        "contraindications": {
            "lvef_min": 45.0,
            "alt_ast_uln_max": 3.0,
            "bilirubin_uln_max": 1.5,
            "platelets_min": 100_000
        }
    }
}

def evaluate_patient(patient: Dict[str, Any], adc_name: str) -> Dict[str, Any]:
    norm_name = adc_name.lower().strip()
    matched_rule = None
    for k, v in ADC_RULES.items():
        if k in norm_name or v["brand"].lower() in norm_name:
            matched_rule = (k, v)
            break
            
    if not matched_rule:
        supported_str = ", ".join(f"{k.title()} ({v['brand']})" for k, v in ADC_RULES.items())
        return {
            "error": f"Unknown ADC '{adc_name}'. Supported: {supported_str}"
        }
        
    adc_key, rule = matched_rule
    findings: List[str] = []
    red_flags: List[str] = []
    amber_flags: List[str] = []
    green_flags: List[str] = []
    
    # 1. LVEF evaluation
    lvef = patient.get("lvef")
    if lvef is not None:
        min_lvef = rule.get("contraindications", {}).get("lvef_min")
        if min_lvef and lvef < min_lvef:
            red_flags.append(f"CRITICAL: Baseline LVEF is {lvef}% (threshold: ≥{min_lvef}%). Risk of severe cardiotoxicity/heart failure.")
        elif lvef < 50.0:
            amber_flags.append(f"WARNING: Borderline LVEF {lvef}% (normal: ≥50%). Close ECHO/MUGA surveillance required.")
        else:
            green_flags.append(f"LVEF {lvef}% is adequate (≥50%).")

    # 2. Renal function (eGFR)
    egfr = patient.get("egfr")
    if egfr is not None:
        if egfr < 30.0:
            red_flags.append(f"CRITICAL: eGFR is {egfr} mL/min/1.73m2 (severe renal impairment <30). Clearance compromised.")
        elif egfr < 60.0:
            amber_flags.append(f"MODERATE: eGFR is {egfr} mL/min/1.73m2 (mild-to-moderate impairment). Dose monitoring advised.")
        else:
            green_flags.append(f"eGFR {egfr} mL/min/1.73m2 is preserved (≥60).")

    # 3. Pulmonary / ILD symptoms (Enhertu / Dato-DXd)
    if "dxd" in rule.get("payload", "").lower():
        cough = patient.get("respiratory_symptoms", False) or patient.get("cough", False)
        dyspnea = patient.get("dyspnea", False)
        if cough or dyspnea:
            red_flags.append("CRITICAL: Patient reports new or worsening respiratory symptoms (cough/dyspnea). Rule out Interstitial Lung Disease (ILD) with high-resolution CT prior to infusion.")
        else:
            green_flags.append("No active respiratory symptoms reported.")

    # 4. Hematologic (Platelets, ANC)
    platelets = patient.get("platelets")
    if platelets is not None:
        min_plt = rule.get("contraindications", {}).get("platelets_min", 75_000)
        if platelets < min_plt:
            red_flags.append(f"CRITICAL: Platelets count {platelets:,}/mcL is below safety threshold ({min_plt:,}/mcL). Risk of severe hemorrhage.")
        elif platelets < 100_000:
            amber_flags.append(f"WARNING: Moderate thrombocytopenia ({platelets:,}/mcL).")
        else:
            green_flags.append(f"Platelet count adequate ({platelets:,}/mcL).")

    anc = patient.get("anc")
    if anc is not None:
        min_anc = rule.get("contraindications", {}).get("anc_min", 1_000)
        if anc < min_anc:
            red_flags.append(f"CRITICAL: Absolute Neutrophil Count (ANC) {anc:,}/mcL is below safety threshold ({min_anc:,}/mcL). Severe neutropenia risk.")
        elif anc < 1_500:
            amber_flags.append(f"WARNING: Mild neutropenia ANC {anc:,}/mcL.")
        else:
            green_flags.append(f"ANC adequate ({anc:,}/mcL).")

    # 5. UGT1A1 status (Trodelvy)
    if rule.get("contraindications", {}).get("ugt1a1_homozygous_risk"):
        ugt1a1 = patient.get("ugt1a1")
        if ugt1a1 and "*28/*28" in str(ugt1a1):
            red_flags.append("CRITICAL: Patient is UGT1A1 *28/*28 homozygous. Significantly increased incidence of Grade 4 neutropenia and febrile neutropenia. Dose reduction or G-CSF prophylaxis indicated.")
        elif ugt1a1 and "*28" in str(ugt1a1):
            amber_flags.append("WARNING: Patient is UGT1A1 *28 heterozygous (*1/*28). Increased risk of adverse reactions.")

    # Overall recommendation
    if red_flags:
        status = "CONTRAINDICATED / HOLD THERAPY"
        risk_level = "HIGH RISK (RED)"
        recommendation = "Withhold ADC administration immediately. Order urgent diagnostic workup for detected toxicities."
    elif amber_flags:
        status = "PROCEED WITH CAUTION / DOSE ADJUSTMENT"
        risk_level = "MODERATE RISK (AMBER)"
        recommendation = "Administer under enhanced pharmacovigilance surveillance. Consider prophylactic support and early interval reassessment."
    else:
        status = "SAFE TO PROCEED"
        risk_level = "LOW RISK (GREEN)"
        recommendation = "Patient parameters satisfy all standard prescribing criteria for this ADC."

    return {
        "adc_drug": adc_key.title(),
        "brand_name": rule["brand"],
        "target": rule["target"],
        "payload": rule["payload"],
        "status": status,
        "risk_level": risk_level,
        "recommendation": recommendation,
        "red_flags": red_flags,
        "amber_flags": amber_flags,
        "green_flags": green_flags,
        "boxed_warnings": rule["boxed_warnings"]
    }

def format_markdown_card(eval_result: Dict[str, Any], patient: Dict[str, Any]) -> str:
    if "error" in eval_result:
        return f"# Error\n\n{eval_result['error']}"

    md = []
    md.append(f"# PRESCRIBING-RISK CARD: {eval_result['adc_drug'].upper()} ({eval_result['brand_name'].upper()})")
    md.append(f"**Clinical Safety Standard:** NHS DCB0129 / NICE HTG10877 Epistemological Guardrail\n")
    md.append(f"| Parameter | Value |")
    md.append(f"|---|---|")
    md.append(f"| **ADC Drug** | {eval_result['adc_drug']} ({eval_result['brand_name']}) |")
    md.append(f"| **Target Antigen** | {eval_result['target']} |")
    md.append(f"| **Cytotoxic Payload** | {eval_result['payload']} |")
    md.append(f"| **Safety Verdict** | **{eval_result['status']}** |")
    md.append(f"| **Risk Tier** | **{eval_result['risk_level']}** |")
    md.append(f"| **Patient Age/Sex** | {patient.get('age', 'N/A')}yo {patient.get('sex', 'N/A')} |")
    md.append(f"| **ECOG Performance** | {patient.get('ecog', 'N/A')} |\n")

    md.append("## Clinical Recommendation")
    md.append(f"> **{eval_result['recommendation']}**\n")

    if eval_result['red_flags']:
        md.append("### ⛔ Absolute Contraindications & Red Flags")
        for f in eval_result['red_flags']:
            md.append(f"- **{f}**")
        md.append("")

    if eval_result['amber_flags']:
        md.append("### ⚠️ Moderate Risks & Warnings")
        for f in eval_result['amber_flags']:
            md.append(f"- {f}")
        md.append("")

    if eval_result['green_flags']:
        md.append("### ✅ Preserved Parameters")
        for f in eval_result['green_flags']:
            md.append(f"- {f}")
        md.append("")

    md.append("### 📋 FDA Boxed Warnings")
    for w in eval_result['boxed_warnings']:
        md.append(f"- {w}")
    md.append("")

    return "\n".join(md)

def main():
    parser = argparse.ArgumentParser(description="Epistemological ADC Prescribing-Safety Guardrail")
    parser.add_argument("--drug", "-d", type=str, default="Enhertu", help="ADC name or brand (Enhertu, Trodelvy, Padcev, Kadcyla)")
    parser.add_argument("--age", type=int, default=74, help="Patient age")
    parser.add_argument("--sex", type=str, default="F", help="Patient sex")
    parser.add_argument("--lvef", type=float, help="Left Ventricular Ejection Fraction (%)")
    parser.add_argument("--egfr", type=float, help="Estimated Glomerular Filtration Rate (mL/min/1.73m2)")
    parser.add_argument("--platelets", type=int, help="Platelets count (/mcL)")
    parser.add_argument("--anc", type=int, help="Absolute Neutrophil Count (/mcL)")
    parser.add_argument("--cough", action="store_true", help="Presence of non-productive cough")
    parser.add_argument("--dyspnea", action="store_true", help="Presence of exertional dyspnea")
    parser.add_argument("--ugt1a1", type=str, help="UGT1A1 genotype (e.g. *28/*28, *1/*28, *1/*1)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON instead of markdown")

    args = parser.parse_args()

    patient = {
        "age": args.age,
        "sex": args.sex,
        "lvef": args.lvef,
        "egfr": args.egfr,
        "platelets": args.platelets,
        "anc": args.anc,
        "cough": args.cough,
        "dyspnea": args.dyspnea,
        "ugt1a1": args.ugt1a1
    }

    eval_result = evaluate_patient(patient, args.drug)

    if args.json:
        print(json.dumps({"patient": patient, "evaluation": eval_result}, indent=2))
    else:
        print(format_markdown_card(eval_result, patient))

if __name__ == "__main__":
    main()
