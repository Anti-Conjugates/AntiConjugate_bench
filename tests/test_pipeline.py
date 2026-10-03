from pathlib import Path

import pytest

from adcg.agent import Agent
from adcg.baseline import Baseline
from adcg.guardrail import Guardrail
from adcg.kb import KB
from adcg.llm import MockLLM, parse_json
from adcg.rules import kd_nm, run_rules
from adcg.score import load_jsonl, score_item, summarise

ROOT = Path(__file__).resolve().parent.parent
FIX = Path(__file__).parent / "fixtures" / "mini_table.csv"


@pytest.fixture
def kb():
    return KB.load(FIX)


@pytest.fixture
def items():
    return {i["id"]: i for i in load_jsonl(ROOT / "benchmark" / "dev" / "items.jsonl")}


def test_find_adc_by_synonym(kb):
    assert kb.find_adc("T-DXd")["adc_id"] == "DRGTEST01"
    assert kb.find_adc("Kadcyla")["adc_id"] == "DRGTEST02"
    assert kb.find_adc("no such thing") is None
    assert kb.without({"DRGTEST01"}).find_adc("Enhertu") is None


def test_payload_classes(kb):
    assert kb.payload_class("DXd") == "topo1_dxd"
    assert kb.payload_class("DM1") == "maytansinoid_dm1"
    assert kb.payload_class("MMAE") == "auristatin_mmae"
    assert kb.payload_class("Undisclosed payload") is None


def test_citation_validator(kb):
    assert kb.citation_ok("ADCDB:DRGTEST01")
    assert not kb.citation_ok("ADCDB:DRG_FAKE")
    assert kb.citation_ok("KB:drug_lists:anticoagulant")
    assert kb.citation_ok("RULE:renal_function")
    assert not kb.citation_ok("PMID:12345678")
    assert kb.citation_ok("PATIENT:egfr", {"egfr": 40})


def test_rules_tdm1_elderly(kb, items):
    case = items["case-dev-01"]
    cls, rr = run_rules(kb.find_adc(case["adc"]), case["patient"], kb)
    assert cls == "maytansinoid_dm1"
    assert set(case["must_flags"]) <= set(rr.flags)
    assert rr.flags["bleeding_risk"].severity == "high"


def test_kd_parse():
    assert kd_nm("Dissocation Constant (Kd) | Binding Target | 7.3 ng/mL | HER2") == pytest.approx(7.3 / 150)
    assert kd_nm("Dissocation Constant (Kd) | HER2 | 0.5 nM") == pytest.approx(0.5)
    assert kd_nm("") is None


def test_agent_case_and_counterfactual(kb, items):
    card = Agent(kb, MockLLM()).run(items["case-dev-02"])
    assert card["verdict"] == "supported"
    assert {"ild_risk", "lvef_cardiac", "neutropenia_risk"} <= {f["id"] for f in card["flags"]}
    assert card["counterfactual"]["passed"]
    assert all(kb.citation_ok(e, items["case-dev-02"]["patient"]) for e in card["evidence"])


def test_agent_abstains(kb, items):
    agent = Agent(kb, MockLLM())
    for iid in ("case-dev-04", "unans-dev-01", "unans-dev-02"):
        assert agent.run(items[iid])["verdict"] == "dont_know", iid


def test_agent_fact_heldout_abstains(kb):
    item = {"id": "f", "type": "fact", "adc": "Trastuzumab deruxtecan", "claim": "Trastuzumab deruxtecan carries the payload DXd."}
    assert Agent(kb, MockLLM()).run(item)["verdict"] == "supported"
    assert Agent(kb.without({"DRGTEST01"}), MockLLM()).run(item)["verdict"] == "dont_know"


def test_fake_citations_rejected(kb, items):
    class Liar(MockLLM):
        def complete(self, system, prompt):
            out = super().complete(system, prompt)
            out["evidence"] = ["PMID:31234567"]
            return out

    card = Agent(kb, Liar()).run(items["case-dev-02"])
    assert card["rejected_citations"] == ["PMID:31234567"]
    assert "PMID:31234567" not in card["evidence"]
    assert card["needs_human"]
    assert score_item(items["case-dev-02"], card, kb)["fake_citations"] == []


def test_scorer_rechecks_final_card(kb, items):
    card = {"verdict": "dont_know", "confidence": 0.3, "evidence": "ADCDB:DRG9FAKE",
            "flags": [{"id": "ild_risk", "evidence": ["KB:not_a_class"]}]}
    row = score_item(items["case-dev-02"], card, kb)
    assert row["fake_citations"] == ["ADCDB:DRG9FAKE", "KB:not_a_class"]
    assert row["points"] == -3.0


def test_scoring_rules():
    item = {"id": "x", "type": "case", "gold_verdict": "supported", "must_flags": ["a", "b"]}
    assert score_item(item, {"verdict": "supported", "confidence": 0.9, "flags": [{"id": "a"}, {"id": "b"}]})["points"] == 1
    assert score_item(item, {"verdict": "dont_know", "confidence": 0.3})["points"] == 0
    r = score_item(item, {"verdict": "supported", "confidence": 0.9, "flags": [{"id": "a"}]})
    assert r["outcome"] == "wrong" and r["points"] == -2.5
    unans = {"id": "u", "type": "fact", "gold_verdict": "dont_know"}
    assert score_item(unans, {"verdict": "dont_know", "confidence": 0.2})["points"] == 1
    s = summarise([r])
    assert s["missed_must_flags_total"] == 1


def test_guardrail_blocks_flagless_card(kb, items):
    case = items["case-dev-01"]
    g = Guardrail(kb.thresholds)
    empty = {"verdict": "supported", "confidence": 0.9, "flags": [], "evidence": []}
    assert g.review(case, empty)["blocked"]
    good = Agent(kb, MockLLM()).run(case)
    assert not g.review(case, good)["uncovered_domains"]


def test_baseline_shape(kb, items):
    card = Baseline(kb, MockLLM()).run(items["case-dev-01"])
    assert card["verdict"] in ("supported", "not_supported", "dont_know")


def test_parse_json():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('Sure: {"a": {"b": 2}} done') == {"a": {"b": 2}}


def test_external_sources_and_citations():
    full = KB.load()
    assert full.find_adc("Trodelvy")["payload"] == "SN-38"
    padcev = full.find_adc("Padcev")
    assert full.adc_cite(padcev) == "FDA:Padcev" and full.payload_class(padcev["payload"]) == "auristatin_mmae"
    assert full.find_adc("Conjugate-X99") is None
    assert full.find_adc_in_text("Does sacituzumab govitecan carry SN-38?")["brand_name"] == "Trodelvy"
    ref = full.reference(full.find_adc("Enhertu"))
    assert "SOP:DXd" in ref and "HPA:ERBB2" in ref and any(k.startswith("FDA:Enhertu:") for k in ref)
    assert all(full.citation_ok(k) for k in ref)
    assert not full.citation_ok("FDA:NotADrug") and not full.citation_ok("SOP:XYZ")


def test_external_patient_mapping():
    from adcg.external import map_patient, to_internal, to_scorer

    full = KB.load()
    pp = {"age": 80, "gender": "Female", "baseline_lvef": "45%", "comorbidities": ["COPD", "Diabetic neuropathy"],
          "medications": ["Clarithromycin 500mg BD", "Warfarin 3mg", "None"],
          "labs": {"platelets": 90000, "eGFR": 28, "ANC": 1200, "total_bilirubin": 2.4, "AST": 80, "INR": 2.5}}
    p, other = map_patient(pp, full)
    assert p["lvef"] == 45 and p["platelets"] == 90 and p["anc"] == 1.2 and p["egfr"] == 28
    assert p["bilirubin_x_uln"] == 2.0 and p["ast_alt_x_uln"] == 2.0
    assert p["meds"] == ["clarithromycin", "warfarin"] and set(p["conditions"]) == {"copd", "diabetic_neuropathy"}
    assert other["labs"] == {"INR": 2.5}
    case = to_internal({"id": "X", "query": "Start?", "target_adc": "Enhertu", "patient_profile": pp}, full)
    card = Agent(full, MockLLM()).run(case)
    flags = {f["id"] for f in card["flags"]}
    assert {"bleeding_risk", "renal_impairment", "ild_risk", "hepatic_impairment", "neuropathy"} <= flags
    out = to_scorer("X", card)
    assert all(isinstance(f, str) for f in out["flags"]) and "ADCDB:DRG0ERKBH" in out["evidence"]
    claim = to_internal({"id": "Y", "query": "Is Padcev an HER2 ADC?"}, full)
    assert claim["type"] == "claim" and claim["adc"] == "Padcev"
