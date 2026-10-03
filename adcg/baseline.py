"""Plain-LLM baseline: structural validation only, no retrieval or clinical safety gates."""

from __future__ import annotations

import json

from adcg.kb import as_list
from adcg.rules import FLAG_IDS
from adcg.validation import failure_card, validate_response

BASELINE_SYSTEM = """MODE: baseline
You are a clinical pharmacology assistant. Answer the question about an antibody-drug conjugate.
For patient cases, list risk flags using ONLY this vocabulary: {vocab}.
For claims, give verdict supported / not_supported / dont_know.
Cite evidence as ADCdb IDs (ADCDB:<id>) if you know them; do not invent identifiers.
Return ONLY a JSON object: {{"answer": str, "verdict": "supported|not_supported|dont_know",
"confidence": float 0-1, "reason": str, "flags": [{{"id": str, "severity": "monitor|moderate|high", "text": str}}],
"evidence": [str], "unknowns": [str], "needs_human": bool}}"""


class Baseline:
    name = "baseline"

    def __init__(self, kb, llm):
        self.kb, self.llm = kb, llm  # kb only used by the scorer-side citation check

    def run(self, item: dict) -> dict:
        q = item.get("question") or item.get("claim") or "Prescribing-risk card."
        prompt = f"QUESTION: {q}\nADC: {item.get('adc', '')}\n"
        patient = item.get("patient_raw") or item.get("patient")
        if patient:
            prompt += f"PATIENT_JSON: {json.dumps(patient)}\n"
        try:
            out = self.llm.complete(BASELINE_SYSTEM.format(vocab=", ".join(FLAG_IDS)), prompt)
        except Exception as error:
            return failure_card(f"model_runtime_failure:{type(error).__name__}")
        try:
            validate_response(out)
        except ValueError:
            return failure_card("invalid_model_output")
        flags = [f for f in out.get("flags") or [] if isinstance(f, dict) and f.get("id") in FLAG_IDS]
        ev = as_list(out.get("evidence"))
        verdict = out.get("verdict", "dont_know")
        return {"answer": out.get("answer", ""),
                "verdict": verdict if verdict in ("supported", "not_supported", "dont_know") else "dont_know",
                "confidence": float(out.get("confidence", 0.5)), "reason": out.get("reason", ""),
                "flags": flags, "evidence": ev, "unknowns": out.get("unknowns") or [],
                "needs_human": bool(out.get("needs_human", False)),
                "fake_citations": [e for e in ev if not self.kb.citation_ok(e, item.get("patient"))]}
