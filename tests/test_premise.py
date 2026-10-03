"""Fresh fictional records exercise premise dataflow, not clinical validity."""

import copy
import json
from pathlib import Path

import pandas as pd
import pytest

from adcg.agent import Agent
from adcg.kb import KB
from adcg.llm import MockLLM
from adcg.premise import Premise

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def kb():
    base = KB.load()
    rows = [
        {"adc_id": "DRGSYNTHA", "adc_name": "Solamab deruxtecan", "brand_name": "SolarADC",
         "synonyms": "SOL-DX;Long Solar Alias", "antigen": "HER2", "payload": "DXd",
         "linker": "Cleavable GGFG", "antibody": "Solamab"},
        {"adc_id": "DRGSYNTHB", "adc_name": "Lunamab emtansine", "brand_name": "MoonADC",
         "synonyms": "MOON-DM", "antigen": "CD22", "payload": "DM1",
         "linker": "Non-cleavable SMCC", "antibody": "Lunamab"},
    ]
    sources = {
        "fda": {"SolarADC": {"meta": {"generic_name": "Solamab deruxtecan", "target": "HER2",
                                    "target_gene": "ERBB2", "payload": "DXd", "linker": "Cleavable GGFG"},
                            "label_sections": {"synthetic_section": ["Fictional test text."]}}},
        "curated": {"adcs": [{"adcdb_id": "DRGSYNTHA", "adc_name": "Solamab deruxtecan",
                              "brand": "SolarADC", "target": "HER2", "payload": "DXd"}]},
    }
    return KB(pd.DataFrame(rows), base.payload_kb, base.drug_lists, base.thresholds, sources=sources)


class NoLLM:
    def complete(self, system, prompt):
        raise AssertionError("Premise-decided cards must not call the model")


@pytest.mark.parametrize("claim", [
    "SolarADC carries DM1.",
    "SolarADC delivers the payload MMAE.",
    "Solamab deruxtecan contains SN-38.",
    "SolarADC's payload is DM1.",
    "SolarADC targets CD22.",
    "SolarADC binds CD22.",
    "SolarADC has a non-cleavable linker.",
    "SolarADC's linker is non-cleavable.",
    "MoonADC uses a cleavable linker.",
])
def test_structural_mismatches_are_withheld_without_inference(kb, claim):
    card = Agent(kb, NoLLM()).run({"type": "claim", "claim": claim})
    assert card.get("error") is None
    assert card["verdict"] == "dont_know" and card["draft_verdict"] == "not_supported"
    assert card["needs_human"] and card["delivery_status"] == "review_required"
    assert card["premise"]["contradicted"] and not card["premise"]["unverifiable"]
    assert card["evidence"] and all(kb.citation_ok(e) for e in card["evidence"])
    assert card["confidence"] == 0.0 and card["confidence_kind"] == "unestimated"


@pytest.mark.parametrize("claim", [
    "SolarADC carries DXd.",
    "Solamab deruxtecan contains the payload DXd.",
    "SolarADC targets HER2.",
    "SolarADC targets ERBB2.",
    "SolarADC has a cleavable linker.",
    "MoonADC has a non-cleavable linker.",
    "What is the payload of SolarADC?",
    "Give the PMID supporting SolarADC chemistry.",
    "SolarADC does not carry DM1.",
    "SolarADC never carries DM1.",
    "SolarADC uses DXd rather than DM1.",
    "What is the mechanism of Solamab deruxtecan?",
    "SolarADC uses DXd and has a cleavable linker.",
])
def test_true_questions_negation_and_compound_language_are_not_refuted(kb, claim):
    assert not Premise(kb).analyse(claim).decided


@pytest.mark.parametrize("reference", ["NCT01357924", "PMID:24681357", "PubMed ID 24681357",
                                      "10.12345/example.7", "https://example.org/source"])
def test_unresolved_references_are_not_claimed_fabricated(kb, reference):
    card = Agent(kb, NoLLM()).run({"type": "claim", "claim": f"SolarADC evidence: {reference}."})
    assert card.get("error") is None and card["verdict"] == "dont_know"
    assert card["premise"]["unverifiable"][0]["kind"] == "unverifiable_reference"
    assert not card["rejected_citations"]
    assert "fake" not in card["reason"] and "fictitious" not in card["reason"]


def test_unresolved_reference_outranks_mismatch(kb):
    card = Agent(kb, NoLLM()).run(
        {"type": "claim", "claim": "SolarADC carries DM1. Prove it with PMID:24681357."}
    )
    assert card["premise"]["contradicted"] and card["premise"]["unverifiable"]
    assert "draft_verdict" not in card


@pytest.mark.parametrize("claim", [
    "Dose the investigational ADC ZX-472 with SolarADC.",
    "Lunamab deruxtecan carries DXd.",
    "Explain the experimental ADC Xenolith with SolarADC.",
])
def test_unresolved_entities_and_constructs_do_not_assert_nonexistence(kb, claim):
    card = Agent(kb, NoLLM()).run({"type": "claim", "claim": claim})
    assert card.get("error") is None and card["verdict"] == "dont_know"
    assert card["premise"]["unverifiable"] and card["needs_human"] is True
    assert "does not exist" not in card["reason"]


def test_unrecognised_adc_and_no_entity_do_not_call_model(kb):
    for item in [
        {"type": "claim", "adc": "ZX-472", "claim": "What is its linker?"},
        {"type": "claim", "claim": "Tell me about an ADC outside our catalogue."},
    ]:
        assert Agent(kb, NoLLM()).run(item)["premise"]["unverifiable"]


@pytest.mark.parametrize("claim", [
    "SolarADC and MoonADC carry DM1.",
    "Compare SolarADC with MoonADC.",
    "SolarADC carries DXd. MoonADC carries DM1.",
])
def test_multiple_entities_are_ambiguous_not_confidently_refuted(kb, claim):
    card = Agent(kb, NoLLM()).run({"type": "claim", "claim": claim})
    assert card["premise"]["unverifiable"][0]["kind"] == "ambiguous_entity"
    assert not card["premise"]["contradicted"] and "draft_verdict" not in card
    assert kb.find_adc_in_text(claim) is None


def test_declared_adc_disagreement_requires_review(kb):
    card = Agent(kb, NoLLM()).run({"type": "claim", "adc": "SolarADC", "claim": "MoonADC carries DM1."})
    assert card["premise"]["unverifiable"][0]["kind"] == "ambiguous_entity"


def test_alias_collision_is_ambiguous(kb):
    kb.adc_table["synonyms"] = "Shared Alias"
    assert kb.find_adc_in_text("Shared Alias carries DXd.") is None
    assert Premise(kb).analyse("What is its payload?", "Shared Alias").unverifiable


@pytest.mark.parametrize("name", ["SolarADC", "Solamab deruxtecan", "SOL-DX", "Long Solar Alias"])
def test_holdouts_cannot_reappear_through_sources_or_aliases(kb, name):
    view = kb.without({"DRGSYNTHA"})
    assert view.find_adc(name) is None
    assert not view.adc_mentions(f"{name} carries DM1.")
    card = Agent(view, NoLLM()).run({"type": "claim", "adc": name, "claim": f"{name} carries DM1."})
    assert not card["premise"]["resolved"] and not card["premise"]["contradicted"]
    assert not card["evidence"]
    assert all("DXd" not in f["text"] for f in card["premise"]["unverifiable"])


def test_hidden_long_alias_does_not_mask_visible_entity(kb):
    view = kb.without({"DRGSYNTHA"})
    assert view.find_adc_in_text("Long Solar Alias alongside MoonADC.")["adc_id"] == "DRGSYNTHB"
    card = Agent(view, NoLLM()).run(
        {"type": "claim", "claim": "Long Solar Alias alongside MoonADC.", "adc": "MoonADC"}
    )
    assert card.get("error") is None and card["verdict"] == "dont_know"
    assert card["premise"]["unverifiable"] and not card["premise"]["contradicted"]
    assert "DRGSYNTHA" not in json.dumps(card) and "DXd" not in json.dumps(card)


def test_repeated_sentences_and_name_boundaries(kb):
    result = Premise(kb).analyse("SolarADC carries DM1. SolarADC carries DM1.")
    assert len(result.contradicted) == 2
    assert not kb.adc_mentions("prefixSolarADCsuffix")
    assert not Premise(kb).analyse("What is its payload?", "MoonADC").decided


def test_unknown_source_attribute_abstains_instead_of_refuting(kb):
    kb.adc_table.loc[0, "payload"] = ""
    result = Premise(kb).analyse("SolarADC carries DM1.")
    assert result.unverifiable and not result.contradicted


def test_case_retains_safety_flags_counterfactual_and_unknowns(kb):
    patient = {"age": 65, "egfr": 20, "lvef": 35, "conditions": [], "meds": []}
    card = Agent(kb, NoLLM()).run(
        {"type": "case", "adc": "SolarADC", "patient": patient, "question": "SolarADC carries DM1."}
    )
    assert card.get("error") is None
    assert {"renal_impairment", "lvef_cardiac"} <= {f["id"] for f in card["flags"]}
    assert card["unknowns"] and card["counterfactual"]["passed"]
    assert card["guardrail"]["blocked"] and "high_severity_flag" in card["guardrail"]["block_reasons"]
    assert all(kb.citation_ok(e, patient) for e in card["evidence"])


def test_ordinary_fact_without_adc_uses_only_resolved_context(kb):
    class Spy(MockLLM):
        def complete(self, system, prompt):
            self.prompt = prompt
            return super().complete(system, prompt)

    spy = Spy()
    card = Agent(kb, spy).run({"type": "claim", "claim": "SolarADC carries DXd."})
    assert card.get("error") is None and card["verdict"] == "supported"
    assert json.loads(spy.prompt.split("ADC_ROW_JSON: ")[1].split("\n")[0])["adc_id"] == "DRGSYNTHA"
    assert "DRGSYNTHB" not in spy.prompt


def test_analysis_does_not_modify_kb_or_clinical_parameters(kb):
    before = copy.deepcopy((kb.payload_kb, kb.drug_lists, kb.thresholds, kb.sources))
    Premise(kb).analyse("SolarADC carries DM1.")
    assert before == (kb.payload_kb, kb.drug_lists, kb.thresholds, kb.sources)


def test_chained_views_cannot_restore_earlier_holdouts(kb):
    view = kb.without({"DRGSYNTHA"}).without({"DRGSYNTHB"})
    assert not view.adc_mentions("SolarADC compared with MoonADC.")
    assert view.find_adc("SolarADC") is None and view.find_adc("MoonADC") is None


def test_curated_only_record_respects_holdout(kb):
    kb.sources["curated"]["adcs"].append({
        "adcdb_id": "DRGSYNTHC", "adc_name": "Stellamab vedotin", "brand": "StarADC",
        "target": "CD22", "payload": "MMAE", "linker": "Cleavable",
    })
    assert kb.find_adc("StarADC") is not None
    view = kb.without({"DRGSYNTHC"})
    assert view.find_adc("StarADC") is None
    assert not view.adc_mentions("StarADC carries DM1.")
    card = Agent(view, NoLLM()).run({"type": "claim", "adc": "StarADC", "claim": "StarADC carries DM1."})
    assert card.get("error") is None and not card["evidence"] and not card["premise"]["contradicted"]


@pytest.mark.parametrize(("attribute", "value", "claim"), [
    ("linker", "SMCC", "MoonADC has a cleavable linker."),
    ("antigen", "HER2 / CD22", "SolarADC targets HER2."),
    ("payload", "Undisclosed", "SolarADC carries DXd."),
])
def test_uninterpretable_source_values_do_not_become_refutations(kb, attribute, value, claim):
    index = 1 if "MoonADC" in claim else 0
    kb.adc_table.loc[index, attribute] = value
    result = Premise(kb).analyse(claim)
    assert result.unverifiable and not result.contradicted


def test_external_adapter_keeps_premise_audit_metadata(kb):
    from adcg.external import to_scorer

    card = Agent(kb, NoLLM()).run({"type": "claim", "claim": "SolarADC carries DM1."})
    output = to_scorer("synthetic-input", card)
    assert output["premise"] == card["premise"]
    assert output["decision_source"] == "premise" and output["confidence_kind"] == "unestimated"
