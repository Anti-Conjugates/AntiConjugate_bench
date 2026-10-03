"""Conservative structural premise checks; not clinical eligibility or calibration."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

from adcg.kb import KB

REFERENCES = re.compile(
    r"\bNCT\d{8}\b|\b(?:PMID|PubMed(?:\s+ID)?)\s*[:#]?\s*\d+\b"
    r"|\b10\.\d{4,9}/[^\s]+|https?://[^\s]+",
    re.I,
)
CONSTRUCT = re.compile(r"\b[a-z][a-z-]*mab\s+[a-z][a-z-]+\b", re.I)
ENTITY = re.compile(
    r"\b(?:experimental|investigational|novel)\s+(?:ADC|antibody[- ]drug conjugate)\s+([a-z][\w-]*)",
    re.I,
)
NEGATION = re.compile(r"\b(?:not|never|no|without|neither|nor|except|rather|instead)\b", re.I)
COMPOUND = re.compile(r"\b(?:and|or|versus|vs|unlike)\b", re.I)


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _cleavable(value: str) -> bool | None:
    if re.search(r"\bnon[- ]?cleavable\b", value, re.I):
        return False
    if re.search(r"\bcleavable\b", value, re.I):
        return True
    return None


@dataclass
class Finding:
    kind: str
    text: str
    evidence: list[str] = field(default_factory=list)


@dataclass
class Result:
    rows: list[dict] = field(default_factory=list)
    unverifiable: list[Finding] = field(default_factory=list)
    contradicted: list[Finding] = field(default_factory=list)

    @property
    def decided(self) -> bool:
        return bool(self.unverifiable or self.contradicted)

    def summary(self, kb: KB) -> dict:
        return {
            "resolved": [{"name": r.get("brand_name") or r.get("adc_name"), "evidence": [kb.adc_cite(r)]}
                         for r in self.rows],
            "unverifiable": [asdict(f) for f in self.unverifiable],
            "contradicted": [asdict(f) for f in self.contradicted],
        }


class Premise:
    def __init__(self, kb: KB):
        self.kb = kb

    def analyse(self, text: str, adc: str = "") -> Result:
        result = Result()
        mentions = self.kb.adc_mentions(text)
        rows = {self.kb.adc_cite(m["row"]): m["row"] for m in mentions}
        declared = self.kb.find_adc(adc) if adc else None
        if adc and declared is None:
            result.unverifiable.append(Finding(
                "unverifiable_entity", "Requested ADC is not resolved in the current retrieval view."
            ))
        if declared:
            rows[self.kb.adc_cite(declared)] = declared
            rows.update({self.kb.adc_cite(m["row"]): m["row"] for m in self.kb.adc_mentions(adc)})
        result.rows = list(rows.values())
        if len(rows) > 1:
            result.unverifiable.append(Finding(
                "ambiguous_entity", "Multiple ADCs or a disagreement with the requested ADC require review."
            ))
        if not rows and not result.unverifiable:
            result.unverifiable.append(Finding(
                "unverifiable_entity", "No ADC is resolved in the current retrieval view."
            ))
        if self.kb.excluded_adc_mentioned(text):
            result.unverifiable.append(Finding(
                "unverifiable_entity", "The input mentions an ADC unavailable in the current retrieval view."
            ))
        for match in REFERENCES.finditer(text):
            result.unverifiable.append(Finding(
                "unverifiable_reference",
                f"Reference '{match.group()}' is not resolved by our loaded citation context; existence is not established.",
            ))
        for match in CONSTRUCT.finditer(text):
            candidate = match.group()
            if self.kb.payload_class(candidate.split()[-1]) and self.kb.find_adc(candidate) is None:
                result.unverifiable.append(Finding(
                    "unverifiable_construct", f"Construct '{candidate}' is not resolved in the current retrieval view."
                ))
        for match in ENTITY.finditer(text):
            name = match[1]
            if self.kb.find_adc(name) is None:
                result.unverifiable.append(Finding(
                    "unverifiable_entity", f"Named ADC '{name}' is not resolved in the current retrieval view."
                ))
        if len(rows) == 1:
            row = result.rows[0]
            names = [m["name"] for m in mentions]
            if declared:
                names += [adc, declared.get("adc_name", ""), declared.get("brand_name", "")]
            subject = "|".join(re.escape(n) for n in sorted(set(names), key=len, reverse=True) if n)
            subject = rf"(?<![\w-])(?:{subject}|(?:this|the)\s+ADC)(?![\w-])"
            for sentence in re.split(r"(?<=[.!?;])\s+|\n+", text):
                if NEGATION.search(sentence) or COMPOUND.search(sentence):
                    continue
                self._attributes(sentence, subject, row, result)
        return result

    def _attributes(self, text: str, subject: str, row: dict, result: Result) -> None:
        patterns = {
            "payload": [
                rf"{subject}\s+(?:carries|contains|delivers|uses)\s+(?:the\s+|a\s+)?(?:payload\s+)?([^,;.!?]+)",
                rf"{subject}(?:['’]s)?\s+(?:has\s+(?:the\s+|a\s+)?)?payload\s+(?:is\s+|of\s+)?([^,;.!?]+)",
            ],
            "antigen": [rf"{subject}\s+(?:targets|binds)\s+(?:the\s+)?([a-z0-9-]+)"],
            "linker": [
                rf"{subject}\s+(?:has|uses|contains)\s+(?:a\s+|the\s+)?((?:non[- ]?)?cleavable)\s+linker",
                rf"{subject}(?:['’]s)?\s+linker\s+is\s+((?:non[- ]?)?cleavable)",
            ],
        }
        for attribute, expressions in patterns.items():
            for expression in expressions:
                for match in re.finditer(expression, text, re.I):
                    stated = match[1].strip()
                    actual = str(row.get(attribute) or "")
                    expected: str | bool | None
                    asserted: str | bool | None
                    if attribute == "payload":
                        expected, asserted = self.kb.payload_class(actual), self.kb.payload_class(stated)
                        if asserted is None and not re.search(r"\bpayload\b", match.group(), re.I):
                            continue
                    elif attribute == "linker":
                        expected, asserted = _cleavable(actual), _cleavable(stated)
                    else:
                        expected = _norm(actual) if re.fullmatch(r"[a-z0-9-]+", actual, re.I) else None
                        asserted = _norm(stated) or None
                        # Gene aliases must come from this resolved product's metadata.
                        hit = self.kb.fda_label(row)
                        gene = (hit[1].get("meta") or {}).get("target_gene", "") if hit else ""
                        if gene and asserted == _norm(gene):
                            asserted = expected
                    if expected is None or asserted is None:
                        result.unverifiable.append(Finding(
                            "unverifiable_attribute", f"The stated {attribute} cannot be compared with this record.",
                        ))
                    elif expected != asserted:
                        result.contradicted.append(Finding(
                            "contradicted_premise",
                            f"Stated {attribute} '{stated}' conflicts with the loaded record's '{actual}'. "
                            "This is a source-record mismatch, not clinical sign-off.",
                            [self.kb.adc_cite(row)],
                        ))


def review_card(result: Result, kb: KB) -> dict:
    findings = result.unverifiable or result.contradicted
    evidence = list(dict.fromkeys(
        e for finding in result.contradicted for e in finding.evidence if kb.citation_ok(e)
    ))
    card = {
        "answer": "Recommendation withheld pending pharmacist review of the input premise.",
        "verdict": "dont_know", "confidence": 0.0, "reason": findings[0].text,
        "flags": [], "evidence": evidence,
        "unknowns": [f.text for f in result.unverifiable],
        "needs_human": True, "delivery_status": "review_required",
        "rejected_citations": [], "premise": result.summary(kb),
        "decision_source": "premise", "confidence_kind": "unestimated",
    }
    if not result.unverifiable:
        card["draft_verdict"] = "not_supported"
    return card
