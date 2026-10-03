# Devin Playbook: Google Antigravity Science Skills Suite

## Purpose
Enables Devin to access, query, and orchestrate all 40 scientific agent skills developed for **Google Antigravity**. Covers genomics, protein structural biology, cheminformatics, pharmacology, oncology regulatory data, literature retrieval, and translational quantum chemistry.

## Trigger Conditions
Use this skill whenever:
- Looking up biological sequence or structure data (UniProt, PDB, AlphaFold DB, NCBI).
- Evaluating genetic variants, expression levels, or regulatory motifs (AlphaGenome, ClinVar, dbSNP, gnomAD, GTEx, JASPAR).
- Extracting drug pharmacology, targets, bioactivities, or IC50 values (ChEMBL, PubChem, Open Targets).
- Checking FDA adverse events, drug labels, boxed warnings, or clinical trials (openFDA, ClinicalTrials.gov).
- Searching scientific literature for clinical evidence (PubMed, Europe PMC, OpenAlex, arXiv, bioRxiv).
- Running oncology ADC prescribing safety guardrails or clinical quantum algorithms.

## Execution Patterns for Devin

### Step 1: Discover & Inspect Tools
Devin should inspect available tools before running unknown scripts:
```bash
# List all 40 skills by scientific category
python scripts/antigravity_science.py list

# Get exact parameters and examples for a skill
python scripts/antigravity_science.py info openfda-database
python scripts/antigravity_science.py info uniprot-database
python scripts/antigravity_science.py info chembl-database
```

### Step 2: Querying Biological & Pharmacological Ground Truth
Devin should use `direct` mode for deterministic, zero-dependency REST queries:
```bash
# 1. RCSB PDB Structure
python scripts/antigravity_science.py direct pdb 1T08

# 2. UniProt Protein Search / Get
python scripts/antigravity_science.py direct uniprot search "gene:ERBB2 AND organism_id:9606"
python scripts/antigravity_science.py direct uniprot get P04626

# 3. AlphaFold Structure Prediction
python scripts/antigravity_science.py direct alphafold P04626

# 4. openFDA Drug Label & Boxed Warnings
python scripts/antigravity_science.py direct openfda "trastuzumab deruxtecan"

# 5. ChEMBL Target Bioactivity Search
python scripts/antigravity_science.py direct chembl "HER2"

# 6. PubMed Clinical Literature Search
python scripts/antigravity_science.py direct pubmed "enhertu interstitial lung disease elderly"

# 7. ClinicalTrials.gov Search
python scripts/antigravity_science.py direct clinicaltrials "Trastuzumab Deruxtecan"
```

### Step 3: Upstream Antigravity Plugin Execution (Local Environment)
If Devin is running in an environment with the local Antigravity plugin installed:
```bash
# Query openFDA with full rate-limiting and pagination
python scripts/antigravity_science.py run openfda_database search --category drug --endpoint label --search "openfda.generic_name:\"trastuzumab deruxtecan\"" --output results/enhertu_label.json

# Fetch AlphaFold structures (.cif and PAE matrix)
python scripts/antigravity_science.py run alphafold_database_fetch_and_analyze fetch_structure.py P04626 -o results/structures/
```

## Devin Verification Checklist
- [ ] Run `python scripts/antigravity_science.py test` to verify catalog and network connectivity.
- [ ] Ensure all returned biomedical entities cite canonical database keys (`PDB:<id>`, `UniProt:<acc>`, `openFDA:<id>`, `PMID:<id>`).
- [ ] Record output JSON in `results/` for provenance and reproducibility.
