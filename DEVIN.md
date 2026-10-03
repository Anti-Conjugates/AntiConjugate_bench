# DEVIN.md - AntiConjugate Devin Operating Guide

## Project Overview
**AntiConjugate** provides an oncology prescribing safety guardrail for Antibody-Drug Conjugates (ADCs) in elderly cancer patients. It performs multi-parameter organ-function, drug-drug interaction, and payload-class checks to generate a calibrated Prescribing-Risk Card under NHS DCB0129 clinical safety rules.

## Google Antigravity Science Skills Integration
This repository is equipped with the **Google Antigravity Science Skills Suite** (40 production agent skills across genomics, structural biology, cheminformatics, pharmacology, literature, and clinical quantum readiness).

### Operational Bridge for Devin
Devin executes these skills via `scripts/antigravity_science.py`:

```bash
# Verify installation & connectivity
python scripts/antigravity_science.py test

# List skills by category
python scripts/antigravity_science.py list

# Direct REST queries (safe for cloud environments)
python scripts/antigravity_science.py direct pdb 1T08
python scripts/antigravity_science.py direct uniprot get P04626
python scripts/antigravity_science.py direct openfda "trastuzumab deruxtecan"
python scripts/antigravity_science.py direct chembl "HER2"
python scripts/antigravity_science.py direct clinicaltrials "Trastuzumab Deruxtecan"
```

## Devin Core Behavioral Rules
1. **Clinical Rigor**: Adhere to Level 5 Evidence discipline. Never fabricate drug safety metrics or pharmacology data.
2. **Provenance**: Cite canonical identifiers (`ADCDB:<id>`, `KB:<class>`, `RULE:<name>`, `PDB:<id>`, `openFDA:<id>`).
3. **Idempotence**: Save all API query outputs as structured JSON under `results/` or `data/` to prevent redundant network calls.
