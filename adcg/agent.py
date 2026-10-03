"""The AntiConjugate agent: rules + table lookup + LLM drafting + abstention."""

from __future__ import annotations

import copy
import json

from adcg.kb import KB, as_list
from adcg.rules import FLAG_IDS, PATIENT_FIELDS, run_rules

DRAFT_SYSTEM = """MODE: draft_card
You are drafting an ADC prescribing-risk card for a qualified pharmacist. A deterministic rule
engine has already produced flags with evidence. Your job: write a short, plain-English summary
and decide whether anything important is missing.
Rules:
- Only cite evidence strings of the forms ADCDB:<id>, FDA:<brand>[:<section>], SOP:<payload>, HPA:<gene>,
  KB:<class>, KB:drug_lists:<list>, RULE:<name>, PATIENT:<field>, and only ones that appear in the inputs
  (REFERENCE_JSON keys are citable). Never cite PMIDs, NCT numbers, DOIs or URLs.
- Give a verdict on the QUESTION as asked: "supported" if what it proposes or claims is right (a plain
  request for a risk card counts as supported), "not_supported" if the proposal is unsafe as stated or the
  question rests on a false premise, "dont_know" if the inputs cannot settle it.
- You may propose extra flags ONLY from this vocabulary: {vocab}. Each extra flag needs evidence
  from the inputs; otherwise put your concern in "unknowns" instead.
- If you are unsure, lower your confidence. Saying you don't know is better than guessing.
Return ONLY a JSON object: {{"answer": str, "verdict": "supported|not_supported|dont_know",
"reason": str (1-3 sentences), "confidence": float 0-1,
"extra_flags": [{{"id": str, "severity": "monitor|moderate|high", "text": str, "evidence": [str]}}],
"unknowns": [str], "evidence": [str]}}"""

JUDGE_SYSTEM = """MODE: judge_claim
You check a claim or question about an antibody-drug conjugate against ONE database record (ADCdb or
FDA label metadata) plus REFERENCE_JSON (label sections, payload-class SOP notes, target expression).
- Use only these inputs. If the record is null or the inputs do not contain what is needed, answer dont_know.
- If the claim contains a false premise, answer not_supported and say which part is false.
- Never cite PMIDs, NCT numbers, DOIs or URLs. Valid citations are the record's ADCDB:<adc_id> (or
  FDA:<brand>) and the keys of REFERENCE_JSON.
Return ONLY a JSON object: {"verdict": "supported|not_supported|dont_know", "confidence": float 0-1,
"answer": str, "reason": str (1-3 sentences), "evidence": [str]}"""

ROW_FIELDS = ["adc_id", "adc_name", "brand_name", "status", "antigen", "antibody", "payload",
              "payload_target", "linker", "linker_payload_combo", "conjugate_type", "dar",
              "bystander", "binding_affinity", "circulating_stability", "indication"]


def _row_view(row: dict | None) -> dict | None:
    if row is None:
        return None
    return {k: str(row.get(k, ""))[:400] for k in ROW_FIELDS if row.get(k)}


class Agent:
    name = "agent"

    def __init__(self, kb: KB, llm):
        self.kb, self.llm = kb, llm

    # ---------------- prescribing-risk cards ----------------
    def assess_case(self, case: dict, counterfactual: bool = True) -> dict:
        patient = case.get("patient") or {}
        adc = self.kb.find_adc(case.get("adc", ""))
        card = {"answer": "", "verdict": "dont_know", "confidence": 0.2, "reason": "", "flags": [],
                "evidence": [], "unknowns": [], "notes": [], "needs_human": True,
                "rejected_citations": [], "counterfactual": None}
        unknown_fields = [k for k in patient if k not in PATIENT_FIELDS]
        if adc is None:
            card.update(answer="I don't know: this ADC is not in our ADCdb table.",
                        reason="Cannot assess an ADC we have no verified record for.",
                        unknowns=[f"ADC '{case.get('adc')}' not found"])
            return card
        cls, rr = run_rules(adc, patient, self.kb)
        card["flags"] = rr.as_flags()
        card["unknowns"] = rr.unknowns + [f"patient field '{k}' is not something we record or reason about" for k in unknown_fields]
        card["notes"] = rr.notes
        card["evidence"] = [self.kb.adc_cite(adc)]
        if cls is None:
            card.update(answer="I don't know: payload class not in the knowledge table.",
                        reason=rr.unknowns[0])
            return card

        prompt = (
            f"QUESTION: {case.get('question', 'Prescribing-risk card for this ADC and patient.')}\n"
            f"ADC_ROW_JSON: {json.dumps(_row_view(adc))}\n"
            f"PAYLOAD_CLASS: KB:{cls}\n"
            f"PATIENT_JSON: {json.dumps(patient)}\n"
            f"OTHER_PATIENT_INFO: {json.dumps(case.get('context') or {})}\n"
            f"REFERENCE_JSON: {json.dumps(self.kb.reference(adc))}\n"
            f"RULE_FLAGS_JSON: {json.dumps(card['flags'])}\n"
            f"UNKNOWNS_JSON: {json.dumps(card['unknowns'])}\n"
            f"BIOPHYSICS_NOTES: {json.dumps(rr.notes)}\n"
        )
        draft = self.llm.complete(DRAFT_SYSTEM.format(vocab=", ".join(FLAG_IDS)), prompt)
        have = {f["id"] for f in card["flags"]}
        for ef in draft.get("extra_flags") or []:
            ev = as_list(ef.get("evidence"))
            bad = [e for e in ev if not self.kb.citation_ok(e, patient)]
            card["rejected_citations"] += bad
            if ef.get("id") in FLAG_IDS and ef["id"] not in have and ev and not bad:
                card["flags"].append({**ef, "source": "llm"})
                have.add(ef["id"])
        for e in as_list(draft.get("evidence")):
            (card["evidence"] if self.kb.citation_ok(e, patient) else card["rejected_citations"]).append(e)
        card["unknowns"] += [u for u in draft.get("unknowns") or [] if u not in card["unknowns"]]

        rule_conf = max(0.05, 0.92 - 0.1 * len(card["unknowns"]))
        conf = min(rule_conf, float(draft.get("confidence", rule_conf)))
        card["confidence"] = round(conf, 3)
        card["answer"] = draft.get("answer", "")
        card["reason"] = draft.get("reason", "")
        abstain = conf < self.kb.thresholds["agent_min_confidence"] or bool(unknown_fields)
        dv = draft.get("verdict")
        card["verdict"] = "dont_know" if abstain else (dv if dv in ("supported", "not_supported", "dont_know") else "supported")
        card["needs_human"] = abstain or bool(card["rejected_citations"]) or any(
            f["severity"] == "high" for f in card["flags"])
        if counterfactual:
            card["counterfactual"] = self.counterfactual(adc, patient, cls)
        card["evidence"] = list(dict.fromkeys(card["evidence"] + [e for f in card["flags"] for e in f["evidence"]]))
        return card

    def counterfactual(self, adc: dict, patient: dict, cls: str) -> dict:
        """Add a strong CYP3A4 inhibitor + anticoagulant; the expected flags must appear."""
        p2 = copy.deepcopy(patient)
        p2["meds"] = list(p2.get("meds") or []) + ["clarithromycin", "warfarin"]
        _, r2 = run_rules(adc, p2, self.kb)
        checks = self.kb.payload_kb["classes"][cls]["checks"] + self.kb.payload_kb["always_check"]
        expected = {"bleeding_risk"} | ({"cyp3a4_interaction"} if "cyp3a4_strong_inhibitor" in checks else set())
        got = set(r2.flags)
        return {"perturbation": "+clarithromycin +warfarin", "expected_new_flags": sorted(expected),
                "passed": expected <= got}

    # ---------------- factual claims ----------------
    def judge_claim(self, item: dict) -> dict:
        row = self.kb.find_adc(item.get("adc", "")) if item.get("adc") else None
        prompt = (f"CLAIM: {item['claim']}\nADC_ROW_JSON: {json.dumps(_row_view(row))}\n"
                  f"REFERENCE_JSON: {json.dumps(self.kb.reference(row) if row else None)}\n")
        out = self.llm.complete(JUDGE_SYSTEM, prompt)
        verdict = out.get("verdict", "dont_know")
        if verdict not in ("supported", "not_supported", "dont_know"):
            verdict = "dont_know"
        ev = as_list(out.get("evidence"))
        fake = [e for e in ev if not self.kb.citation_ok(e)]
        good = [e for e in ev if self.kb.citation_ok(e)]
        conf = float(out.get("confidence", 0.5))
        if row is None and verdict != "dont_know":
            verdict, conf = "dont_know", min(conf, 0.3)  # no verified record -> may not assert
        if row is not None and verdict != "dont_know":
            good = list(dict.fromkeys(good + [self.kb.adc_cite(row)]))
        if verdict != "dont_know" and conf < self.kb.thresholds["agent_min_confidence"]:
            verdict = "dont_know"
        return {"answer": out.get("answer", ""), "verdict": verdict, "confidence": round(conf, 3),
                "reason": out.get("reason", ""), "flags": [], "evidence": good, "unknowns": [],
                "needs_human": verdict == "dont_know" or bool(fake), "rejected_citations": fake}

    def run(self, item: dict) -> dict:
        return self.assess_case(item) if item["type"] == "case" or item.get("patient") else self.judge_claim(item)
