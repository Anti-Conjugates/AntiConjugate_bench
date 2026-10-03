---
name: google-antigravity-science
description: >
  Comprehensive suite of 40 scientific skills from Google Antigravity spanning genomics,
  protein structures, cheminformatics, pharmacology, oncology regulatory data, scientific literature,
  and translational quantum chemistry. Use whenever querying biomedical databases (UniProt, PDB,
  AlphaFold, AlphaGenome, ChEMBL, openFDA, PubMed, ClinicalTrials.gov, ClinVar, dbSNP, GTEx, JASPAR,
  STRING, Reactome, OpenAlex), predicting variant effects, analyzing drug-target interactions, checking
  FDA adverse events, or validating therapeutic targets.
---

# Google Antigravity Science Skills Suite

A unified, production-grade interface to the 40 scientific agent skills developed for **Google Antigravity**, engineered for seamless execution across **Claude Science**, **Devin**, and **Google Antigravity**.

## Prerequisites

1. **`uv` Package Manager**:
   All upstream skill scripts utilize PEP 723 inline script metadata. Ensure `uv` is installed:
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
2. **Unified Science Bridge**:
   The suite is driven via `scripts/antigravity_science.py`, providing local upstream execution and direct REST API fallbacks.

---

## Architecture & Skill Domains

The 40 skills are structured into five core scientific pillars:

```
┌────────────────────────────────────────────────────────────────────────┐
│               GOOGLE ANTIGRAVITY SCIENCE SKILLS SUITE                  │
├────────────────────┬─────────────────────┬─────────────────────────────┤
│ 1. GENOMICS &      │ 2. PROTEINS &       │ 3. CHEMINFORMATICS &        │
│    REGULATORY      │    STRUCTURES       │    PHARMACOLOGY             │
│  - AlphaGenome     │  - AlphaFold DB     │  - ChEMBL                   │
│  - ClinVar         │  - Foldseek         │  - ClinicalTrials.gov       │
│  - dbSNP           │  - HPA Expression   │  - openFDA (28 endpoints)   │
│  - ENCODE cCREs    │  - InterPro Domains │  - Open Targets             │
│  - Ensembl REST    │  - NCBI Sequences   │  - PubChem                  │
│  - gnomAD          │  - RCSB PDB         │  - QuickGO                  │
│  - GTEx eQTL       │  - Clustal Omega    │  - EMBL-EBI OLS             │
│  - JASPAR TFs      │  - MMseqs2 / BLAST  │                             │
│  - UCSC TFBS       │  - PyMOL            │                             │
│  - UniBind         │  - Reactome / STRING│                             │
│                    │  - UniProtKB        │                             │
├────────────────────┴─────────────────────┴─────────────────────────────┤
│ 4. SCIENTIFIC LITERATURE                 │ 5. TRANSLATIONAL ONCOLOGY   │
│  - PubMed / PMC BioC                     │  - ADC Prescribing Guardrail│
│  - Europe PMC Open Access                │  - Quantinuum Nexus / Aqora │
│  - OpenAlex Scholarly Taxonomies         │    (Clinical Quantum DCB0129)│
│  - arXiv / bioRxiv / medRxiv             │                             │
└──────────────────────────────────────────┴─────────────────────────────┘
```

---

## Universal Execution Commands (Claude Science & Devin)

### 1. Catalog Discovery & Inspection

```bash
# List all 40 skills categorized
python scripts/antigravity_science.py list

# Filter by scientific pillar
python scripts/antigravity_science.py list --category proteins_structural_biology
python scripts/antigravity_science.py list --category cheminformatics_pharmacology
python scripts/antigravity_science.py list --category genomics_regulatory

# Inspect exact script schema, arguments, and examples
python scripts/antigravity_science.py info openfda-database
python scripts/antigravity_science.py info uniprot-database
python scripts/antigravity_science.py info alphafold-database-fetch-and-analyze
```

### 2. Upstream Execution via Bridge

When operating in an environment with the Antigravity plugin installed (`~/.gemini/config/plugins/science/skills/`), invoke skills via `run`:

```bash
# Query openFDA for drug labeling or adverse events
python scripts/antigravity_science.py run openfda_database search --category drug --endpoint label --search "openfda.generic_name:\"trastuzumab deruxtecan\"" --output results/enhertu_fda.json

# Fetch AlphaFold predicted structure and PAE matrix
python scripts/antigravity_science.py run alphafold_database_fetch_and_analyze fetch_structure.py P04626 -o results/structures/

# Query ChEMBL for target bioactivity
python scripts/antigravity_science.py run chembl_database target search "HER2"

# Query ClinicalTrials.gov for recruiting trials
python scripts/antigravity_science.py run clinical_trials_database search --condition "Endometriosis" --status RECRUITING
```

### 3. Portable Direct API Mode (Zero-Plugin Fallback)

If running in a remote cloud container or CI sandbox without the local Antigravity plugin directory, use `direct`:

```bash
# RCSB PDB structure query
python scripts/antigravity_science.py direct pdb 1T08

# UniProt search or entry lookup
python scripts/antigravity_science.py direct uniprot search "gene:SFRP2 AND organism_id:9606"
python scripts/antigravity_science.py direct uniprot get Q96HF1

# AlphaFold DB prediction metadata
python scripts/antigravity_science.py direct alphafold Q96HF1

# openFDA drug label lookup
python scripts/antigravity_science.py direct openfda "trastuzumab deruxtecan"

# PubMed biomedical literature search
python scripts/antigravity_science.py direct pubmed "endometriosis SFRP2 CRD"

# ClinicalTrials.gov study search
python scripts/antigravity_science.py direct clinicaltrials "Endometriosis"
```

---

## End-to-End Scientific Workflows

### Workflow 1: Target Validation & Structural Assessment
1. **Resolve Identifier**: Query `uniprot_database` for canonical accession and sequence:
   ```bash
   python scripts/antigravity_science.py direct uniprot search "gene:SFRP2 AND organism_id:9606"
   ```
2. **Retrieve 3D Structure**: Query `alphafold_database_fetch_and_analyze` or `pdb_database`:
   ```bash
   python scripts/antigravity_science.py direct alphafold Q96HF1
   python scripts/antigravity_science.py direct pdb 1T08
   ```
3. **Analyze Domains & Interactions**: Query `interpro_database` and `string_database` for functional partners.

### Workflow 2: Oncology Pharmacovigilance & Prescribing Safety (AntiConjugate)
1. **FDA Adverse Events & Label Warnings**:
   ```bash
   python scripts/antigravity_science.py direct openfda "trastuzumab deruxtecan"
   ```
2. **Bioactivity & Target Selectivity**:
   ```bash
   python scripts/antigravity_science.py direct chembl "ERBB2"
   ```
3. **Run Prescribing Guardrail**: Run ADC clinical decision guardrail under NHS DCB0129 standards:
   ```bash
   python scripts/run_guardrail.py --patient patient_elderly_her2.json --adc enhertu
   ```

### Workflow 3: Clinical Quantum Readiness (CQRL 1–7)
1. Pre-register computational active space Hamiltonian (Jordan-Wigner 15-term).
2. Execute dual-cloud independent verification on **Quantinuum Nexus (`Helios-1E-lite`)** and **Aqora QPU (`nexus:H2-Emulator`)**.
3. Apply Active Syndrome Post-Selection (ASPS) to reject unphysical bit-flip states ($p=1$).
4. Compute clash barrier and induced-fit relaxation energy with dielectric desolvation corrections.

---

## Operational Guardrails & Ground Truth Rules

1. **Zero Hallucination Citations**:
   - Every scientific assertion must cite primary database keys: `PDB:<id>`, `UniProt:<acc>`, `NCT:<id>`, `PMID:<id>`, `ChEMBL:<id>`, or `openFDA:<id>`.
2. **Level 5 Evidence Discipline**:
   - Emulators execute on classical hardware; state clearly that emulator runs benchmark *Clinical Quantum Readiness*, not quantum supremacy.
   - Enforce automated conditional halts whenever finite-shot sampling variance exceeds tolerance ($\text{SEM} > 0.050\text{ Ha}$).
