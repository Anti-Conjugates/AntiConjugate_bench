"""Run with an installed wheel's Python in isolated mode, outside the checkout."""

from __future__ import annotations

import sys
import sysconfig
import tempfile
from pathlib import Path

import fetch_fda_and_hpa
import scorer
from adcg.agent import Agent
from adcg.kb import KB, ROOT, SOURCE_FILES
from adcg.llm import CACHE, MockLLM


def main() -> None:
    assert sys.flags.isolated, "Run with python -I so the checkout cannot satisfy imports."
    assert ROOT == Path(sysconfig.get_path("data")) / "share" / "adc-guardrail", "KB loaded from the checkout."
    kb = KB.load()
    assert not kb.adc_table.empty
    assert kb.payload_kb and kb.drug_lists and kb.thresholds
    assert set(kb.sources) == set(SOURCE_FILES)
    assert all(kb.sources.values()), "A packaged source snapshot is missing or empty."
    assert scorer.SSL_CTX.check_hostname and fetch_fda_and_hpa.SSL_CONTEXT.check_hostname

    assert CACHE == Path.home() / ".cache" / "adc-guardrail"
    CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryFile(mode="w+t", dir=CACHE) as probe:
        probe.write("wheel-smoke")
        probe.seek(0)
        assert probe.read() == "wheel-smoke"

    card = Agent(kb, MockLLM()).run({
        "type": "case", "adc": "Enhertu",
        "patient": {"age": 65, "egfr": 20, "lvef": 35, "conditions": [], "meds": []},
    })
    assert not card.get("error"), "The smoke case failed instead of running the safety rules."
    assert {"renal_impairment", "lvef_cardiac"} <= {flag["id"] for flag in card["flags"]}
    assert card["verdict"] == "dont_know"
    assert card["needs_human"] is True
    assert card["delivery_status"] == "review_required"
    assert card["guardrail"]["blocked"] is True

    class NoLLM:
        def complete(self, system, prompt):
            raise AssertionError("Premise checks must precede inference in the installed wheel.")

    enhertu = kb.find_adc("Enhertu")
    assert enhertu is not None
    view = kb.without({enhertu["adc_id"]})
    heldout = Agent(view, NoLLM()).run({"type": "claim", "adc": "Enhertu", "claim": "What is its payload?"})
    mismatch = Agent(kb, NoLLM()).run({"type": "claim", "adc": "Enhertu", "claim": "Enhertu carries MMAE."})
    assert not heldout.get("error") and heldout["verdict"] == "dont_know" and not heldout["evidence"]
    assert not mismatch.get("error") and mismatch["draft_verdict"] == "not_supported"
    assert mismatch["verdict"] == "dont_know" and mismatch["needs_human"]
    print("Installed wheel: KB resources, cache, helpers, high-risk withholding and premise holdouts passed.")


if __name__ == "__main__":
    main()
