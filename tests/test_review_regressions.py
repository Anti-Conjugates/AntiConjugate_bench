import json
import math
import ssl

import pytest

from adcg.agent import Agent
from adcg.baseline import Baseline
from adcg.external import map_patient, to_internal
from adcg.guardrail import Guardrail
from adcg.kb import KB, normalise_label_sections
from adcg.rules import kd_nm, run_rules
from adcg.score import score_item, summarise
from adcg.validation import validate_response


@pytest.fixture
def kb():
    return KB.load()


@pytest.fixture
def healthy():
    return {"age": 65, "egfr": 80, "bilirubin_x_uln": 0.7, "ast_alt_x_uln": 0.7,
            "platelets": 200, "anc": 3, "lvef": 65, "conditions": [], "meds": []}


class Stub:
    def __init__(self, **overrides):
        self.out = {"answer": "Model draft.", "reason": "Synthetic stub.", "verdict": "supported",
                    "confidence": 0.9, "evidence": [], "extra_flags": [], "flags": [], "unknowns": []} | overrides

    def complete(self, system, prompt):
        return self.out


def test_high_flags_cannot_be_released(kb, healthy):
    healthy.update(egfr=15, lvef=35, anc=0.5, platelets=40, bilirubin_x_uln=2.7, conditions=["ild"])
    case = {"type": "case", "adc": "Enhertu", "patient": healthy}
    card = Agent(kb, Stub()).run(case)
    assert sum(f["severity"] == "high" for f in card["flags"]) >= 5
    assert card["verdict"] == "dont_know" and card["needs_human"]
    assert card["delivery_status"] == "review_required"
    assert Guardrail(kb.thresholds).review(case, card)["blocked"]


@pytest.mark.parametrize("value", [-1, 1.5, math.nan, math.inf, "0.8", None, True])
def test_invalid_confidence_fails_closed(kb, healthy, value):
    case = {"type": "case", "adc": "Enhertu", "patient": healthy}
    for runner in (Agent(kb, Stub(confidence=value)), Baseline(kb, Stub(confidence=value))):
        card = runner.run(case)
        assert card["verdict"] == "dont_know" and card["error"] == "invalid_model_output"


@pytest.mark.parametrize("output", [
    {}, [], None, {"verdict": "safe", "confidence": 0.8},
    {"verdict": "supported", "confidence": 0.8, "extra_flags": ["bad"]},
    {"verdict": "supported", "confidence": 0.8, "evidence": [None]},
])
def test_malformed_model_output(kb, healthy, output):
    llm = Stub()
    llm.out = output
    card = Agent(kb, llm).run({"type": "case", "adc": "Enhertu", "patient": healthy})
    assert card["error"] == "invalid_model_output" and card["needs_human"]


def test_guardrail_zero_labs_and_required_review(kb, healthy):
    case = {"patient": healthy}
    card = {"verdict": "supported", "confidence": 0.9, "flags": [], "evidence": ["FDA:Enhertu"]}
    assert not Guardrail(kb.thresholds).review(case, card)["blocked"]
    card["needs_human"] = True
    assert Guardrail(kb.thresholds).review(case, card)["blocked"]
    healthy.update(platelets=0, anc=0, lvef=0)
    result = Guardrail(kb.thresholds).review(case, card)
    assert {"bleeding", "marrow", "cardiac"} <= set(result["uncovered_domains"])


def test_missing_medication_history_is_not_empty(kb, healthy):
    healthy.pop("meds")
    card = Agent(kb, Stub()).run({"type": "case", "adc": "Enhertu", "patient": healthy})
    assert "patient meds history unknown" in card["unknowns"]
    assert card["verdict"] == "dont_know" and card["guardrail"]["blocked"]


def test_cross_drug_citation_rejected(kb):
    card = Agent(kb, Stub(evidence=["FDA:Padcev:boxed_warning"])).run(
        {"type": "claim", "adc": "Enhertu", "claim": "Synthetic assertion."}
    )
    assert card["rejected_citations"] == ["FDA:Padcev:boxed_warning"]
    assert card["verdict"] == "dont_know"


def test_valid_response_string_citation():
    assert validate_response(Stub(evidence="FDA:Enhertu").out)["evidence"] == "FDA:Enhertu"


@pytest.mark.parametrize(("value", "expected"), [
    ("500 /uL", 0.5), ("500 cells/uL", 0.5), (500, 0.5), (90000, 90),
    ("90 x10^9/L", 90), ({"value": 90, "unit": "10^9/L"}, 90),
    ("90,000 /uL", 90), ("1.2 10^3/uL", 1.2),
])
def test_explicit_count_units(kb, value, expected):
    patient, _ = map_patient({"labs": {"platelets": value, "ANC": value}}, kb)
    assert patient["platelets"] == pytest.approx(expected)
    assert patient["anc"] == pytest.approx(expected)


def test_bilirubin_units_and_reference_range(kb):
    patient, _ = map_patient({"labs": {"total_bilirubin": "20 umol/L"}}, kb)
    assert patient["bilirubin_x_uln"] == pytest.approx(round(20 / 17.1 / 1.2, 2))
    patient, _ = map_patient({"labs": {"total_bilirubin": {"value": 20, "unit": "umol/L", "uln": 20}}}, kb)
    assert patient["bilirubin_x_uln"] == 1
    patient, _ = map_patient({"labs": {"total_bilirubin": "2 xULN"}}, kb)
    assert patient["bilirubin_x_uln"] == 2


@pytest.mark.parametrize("value", [None, "unknown", "below 20", "20 mg/L", "20-30 mg/dL", math.nan])
def test_ambiguous_bilirubin_is_unknown(kb, value):
    patient, context = map_patient({"age": "unknown", "labs": {"total_bilirubin": value}}, kb)
    assert "bilirubin_x_uln" not in patient and "age" not in patient
    assert len(context["normalization_unknowns"]) == 2


def test_negated_mixed_conditions_require_review(kb):
    patient, context = map_patient({"comorbidities": ["No history of interstitial lung disease", "COPD"]}, kb)
    assert patient["conditions"] == ["copd"]
    assert context["normalization_unknowns"]


def test_missing_vs_explicit_empty_history(kb):
    missing, _ = map_patient({}, kb)
    empty, _ = map_patient({"medications": [], "comorbidities": []}, kb)
    assert missing["meds"] is None and missing["conditions"] is None
    assert empty["meds"] == [] and empty["conditions"] == []
    assert to_internal({"id": "synth", "query": "Risk?", "patient_profile": {}}, kb)["type"] == "case"


def test_bad_adapter_item_does_not_abort_next(kb):
    from scripts.run_external_benchmark import generate_response

    runner, guard = Agent(kb, Stub()), Guardrail(kb.thresholds)
    bad = {"id": "synthetic-bad", "query": "Risk?", "target_adc": "Enhertu", "patient_profile": {"medications": 123}}
    good = {"id": "synthetic-good", "query": "Fact?", "target_adc": "Enhertu"}
    results = [generate_response(item, runner, kb, guard) for item in (bad, good)]
    assert results[0]["error"] == "invalid_patient_profile"
    assert results[1]["error"] is None and results[1]["verdict"] == "supported"


def test_local_citations_resolve_existing_records(kb, healthy):
    from scorer import check_citations

    evidence = ["ADCDB:NOT_REAL", "FDA:NOT_A_DRUG", "rule:made_up", "HPA:missing", "SOP:missing"]
    assert check_citations(evidence, kb, healthy) == ([], [f"UNRESOLVED:{c}" for c in evidence])
    refs = ["FDA:Enhertu:renal_impairment", "SOP:DXd", "HPA:ERBB2", "RULE:renal_function",
            "PATIENT:egfr", "KB:topo1_dxd"]
    assert check_citations(refs, kb, healthy) == (refs, [])
    assert not kb.without({"DRG0ERKBH"}).citation_ok("ADCDB:DRG0ERKBH")


def test_keywords_use_boundaries_and_negation():
    from scorer import check_must_flags

    risks = ["Interstitial lung disease risk", "Severe cutaneous reactions"]
    assert check_must_flags("No ILD risk. The patient is attentive.", [], risks) == ([], risks)
    assert check_must_flags("ILD risk requires monitoring; watch for SJS.", [], risks) == (risks, [])
    assert check_must_flags("ILD is absent.", [], risks[:1]) == ([], risks[:1])


def test_population_subsections_not_truncated(kb):
    reference = kb.reference(kb.find_adc("Enhertu"))
    renal = reference["FDA:Enhertu:renal_impairment"]
    assert "8.6 Renal Impairment" in renal[0]
    assert "severe renal impairment" in renal[0]
    assert all("8.7 Hepatic" not in section for section in renal)
    assert "FDA:Enhertu:adverse_reactions" not in reference
    assert "FDA:Enhertu:adverse_reactions" in kb.reference_omissions(kb.find_adc("Enhertu"))
    assert len(reference["FDA:Enhertu:boxed_warning"][0]) > 700


def test_missing_renal_subsection_is_not_entire_population(kb):
    reference = kb.reference(kb.find_adc("Trodelvy"))
    assert "FDA:Trodelvy:renal_impairment" not in reference
    assert "FDA:Trodelvy:hepatic_impairment" in reference
    sections = normalise_label_sections({"label_sections": {"use_in_specific_populations": [
        "8.1 Pregnancy " + "x" * 800 + " 8.6 Renal Impairment All renal content. 8.7 Hepatic Impairment Other content."
    ]}})
    assert sections["renal_impairment"] == ["8.6 Renal Impairment All renal content."]


def test_hpa_refresh_shape_is_consumable(kb):
    kb.sources["hpa"] = {"ERBB2": {"hpa_summary": {"RNA tissue specificity": "Low tissue specificity",
                                               "Protein tissue distribution": "Detected in many"}}}
    ref = kb.reference(kb.find_adc("Enhertu"))["HPA:ERBB2"]
    assert ref["rna_tissue_specificity"] == "Low tissue specificity"
    assert ref["protein_tissue_distribution"] == "Detected in many"
    assert "do not establish ADC toxicity" in ref["_status"]


def test_tls_requires_valid_certificate():
    import fetch_fda_and_hpa
    import scorer

    for context in (fetch_fda_and_hpa.SSL_CONTEXT, scorer.SSL_CTX):
        assert context.check_hostname
        assert context.verify_mode == ssl.CERT_REQUIRED


def test_failed_refresh_preserves_snapshots(monkeypatch, tmp_path):
    import fetch_fda_and_hpa as fetcher

    for name in ("fda_adcs_labels.json", "hpa_target_expression.json"):
        (tmp_path / name).write_text('{"sentinel": true}')
    monkeypatch.setattr(fetcher, "fetch_openfda_label", lambda _: {})
    monkeypatch.setattr(fetcher, "fetch_hpa_data", lambda *_: {})
    monkeypatch.setattr(fetcher.time, "sleep", lambda _: None)
    with pytest.raises(RuntimeError, match="left untouched"):
        fetcher.main(tmp_path)
    for name in ("fda_adcs_labels.json", "hpa_target_expression.json"):
        assert json.loads((tmp_path / name).read_text()) == {"sentinel": True}


def test_successful_refresh_roundtrips(monkeypatch, tmp_path, kb):
    import fetch_fda_and_hpa as fetcher

    monkeypatch.setattr(fetcher, "fetch_openfda_label", lambda _: {
        "boxed_warning": ["Complete synthetic warning."],
        "use_in_specific_populations": ["8.6 Renal Impairment Synthetic renal section."]
    })
    monkeypatch.setattr(fetcher, "fetch_hpa_data", lambda *_: {
        "RNA tissue specificity": "Low tissue specificity", "Protein tissue distribution": "Detected in many"
    })
    monkeypatch.setattr(fetcher.time, "sleep", lambda _: None)
    fetcher.main(tmp_path)
    kb.sources["fda"] = json.loads((tmp_path / "fda_adcs_labels.json").read_text())
    kb.sources["hpa"] = json.loads((tmp_path / "hpa_target_expression.json").read_text())
    reference = kb.reference(kb.find_adc("Enhertu"))
    assert reference["FDA:Enhertu:renal_impairment"] == ["8.6 Renal Impairment Synthetic renal section."]
    assert reference["HPA:ERBB2"]["rna_tissue_specificity"] == "Low tissue specificity"


@pytest.mark.parametrize("affinity", [
    "Dissociation Constant (Kd) | HER2 | 7.50-11 nM",
    "Dissociation Constant (Kd) | HER2 | <0.1 nM",
    "Dissociation Constant (Kd) | HER2 | >0.1 nM",
])
def test_non_scalar_affinity_does_not_crash_or_invent_midpoint(affinity):
    assert kd_nm(affinity) is None


def test_scientific_affinity():
    assert kd_nm("Dissociation Constant (Kd) | HER2 | 7.5e-11 M") == pytest.approx(0.075)


def test_all_current_adc_records_can_run_rules(kb, healthy):
    for adc in [row.to_dict() for _, row in kb.adc_table.iterrows()] + kb.extra_rows:
        run_rules(adc, healthy, kb)


def test_unmapped_toxicity_is_unknown_not_omitted(kb, healthy):
    adc = {"adc_id": "synthetic", "payload": "duocarmycin"}
    _, result = run_rules(adc, healthy, kb)
    assert any("fatigue" in unknown for unknown in result.unknowns)


def test_runtime_failures_never_reward_abstention():
    from scorer import evaluate_run

    gold = [{"id": "synthetic-a", "expected_verdict": "dont_know", "is_unanswerable": True},
            {"id": "synthetic-b", "expected_verdict": "dont_know", "is_unanswerable": True}]
    replies = [{"item_id": "synthetic-a", "verdict": "dont_know", "confidence": 0.3},
               {"item_id": "synthetic-b", "verdict": "dont_know", "confidence": 0.0, "error": "timeout"}]
    result = evaluate_run(gold, replies)
    assert result["total_score"] == 1 and result["runtime_failures"] == 1
    assert not result["evaluation_complete"] and result["completed_items"] == 1 and result["num_items"] == 2
    assert result["item_details"][1]["score"] is None
    missing = evaluate_run(gold, replies[:1])
    assert missing["runtime_failures"] == 1 and missing["total_score"] == 1
    with pytest.raises(ValueError, match="duplicate"):
        evaluate_run(gold, replies + replies[:1])


def test_development_runtime_failures_are_separate():
    item = {"id": "synthetic", "type": "claim", "gold_verdict": "dont_know"}
    row = score_item(item, {"error": "timeout"})
    result = summarise([row], [None])
    assert result["runtime_failures"] == 1 and result["total_points"] == 0
    assert result["n_items"] == 0 and not result["evaluation_complete"]


@pytest.mark.parametrize("output", [
    {"verdict": [], "confidence": 0.9},
    {"verdict": "supported", "confidence": 10 ** 400},
    {"verdict": "supported", "confidence": 0.9, "extra_flags": [{"id": "ild_risk", "severity": [], "text": "Risk"}]},
    {"verdict": "supported", "confidence": 0.9, "needs_human": "false"},
])
def test_unhashable_and_overflowing_model_values_fail_closed(kb, healthy, output):
    llm = Stub()
    llm.out = output
    card = Agent(kb, llm).run({"type": "case", "adc": "Enhertu", "patient": healthy})
    assert card["verdict"] == "dont_know" and card["error"] == "invalid_model_output"


@pytest.mark.parametrize("updates", [{"unknowns": ["Missing evidence"]}, {"needs_human": True}])
def test_claim_review_requests_cannot_be_released(kb, updates):
    card = Agent(kb, Stub(**updates)).run({"type": "claim", "adc": "Enhertu", "claim": "Synthetic assertion"})
    assert card["verdict"] == "dont_know" and card["needs_human"]
    assert card["delivery_status"] == "review_required"


def test_case_model_review_request_cannot_be_released(kb, healthy):
    card = Agent(kb, Stub(needs_human=True)).run({"type": "case", "adc": "Enhertu", "patient": healthy})
    assert card["verdict"] == "dont_know" and card["needs_human"]
    assert card["delivery_status"] == "review_required"


def test_model_high_flag_does_not_disappear_when_rule_already_monitors_it(kb, healthy):
    high = {"id": "ild_risk", "severity": "high", "text": "Review required", "evidence": ["FDA:Enhertu"]}
    card = Agent(kb, Stub(extra_flags=[high])).run({"type": "case", "adc": "Enhertu", "patient": healthy})
    assert card["verdict"] == "dont_know" and card["needs_human"]


def test_direct_runners_fail_closed_on_model_runtime_failure(kb, healthy):
    class Broken:
        def complete(self, system, prompt):
            raise ValueError("do not expose raw model output")

    item = {"type": "case", "adc": "Enhertu", "patient": healthy}
    for runner in (Agent(kb, Broken()), Baseline(kb, Broken())):
        card = runner.run(item)
        assert card["error"] and card["verdict"] == "dont_know" and card["needs_human"]
        assert "do not expose" not in json.dumps(card)
