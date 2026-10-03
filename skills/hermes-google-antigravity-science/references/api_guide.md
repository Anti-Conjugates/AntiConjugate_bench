# Google Antigravity Science Skills API Reference Guide

This guide details all 40 scientific skills accessible via the Hermes Agent integration suite.

## Master CLI Quick Reference

The primary dispatcher is located at:
`~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py`

You can execute it using Hermes's python virtualenv:
`/Users/openclaw/.hermes/hermes-agent/venv/bin/python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py <subcommand> [args...]`

---

## 1. Genomics & Epigenomics

### `ensembl-database`
- **Lookup Symbol:**
  `python scripts/genomics_bridge.py lookup SFRP2`
  Returns Ensembl Gene ID (`ENSG00000145423`), genomic coordinates (chr4:153,780,544-153,791,620), strand, description, canonical transcript.
- **Sequence Fetch:**
  `python scripts/genomics_bridge.py sequence ENSG00000145423 --type genomic`
  Retrieves fasta sequence and calculates GC content.

### `clinvar-database`
- **Pathogenicity Query:**
  `python scripts/genomics_bridge.py clinvar ERBB2 --limit 5`
  Returns ClinVar variation IDs, clinical classifications (Pathogenic, Benign, VUS), and molecular consequences.

### `jaspar-database`
- **Transcription Factor Motifs:**
  `python scripts/genomics_bridge.py jaspar ESR1`
  Retrieves JASPAR matrix IDs (`MA0112.1`, `MA0112.2`, etc.) and profile metadata.

---

## 2. Proteins & Structural Biology

### `pdb-database`
- **RCSB PDB Structure:**
  `python scripts/protein_structure.py pdb 1T08`
  Retrieves title, X-ray / Cryo-EM resolution, molecular weight, polymer count, and direct CIF/PDB download links.

### `alphafold-database-fetch-and-analyze`
- **AlphaFold Structure & Confidence:**
  `python scripts/protein_structure.py alphafold Q96HF1`
  Returns global pLDDT score (e.g. 82.12 = High), sequence length, CIF URL, PDB URL, and PAE matrix image URL.

### `uniprot-database`
- **UniProtKB Functional Details:**
  `python scripts/protein_structure.py uniprot Q96HF1`
  Returns recommended name, gene symbols, organism, sequence length, and functional annotations.

### `string-database`
- **Protein-Protein Interaction Networks:**
  `python scripts/protein_structure.py string SFRP2 --species 9606`
  Returns top interacting protein partners with combined, experimental, and database confidence scores.

---

## 3. Cheminformatics & Pharmacology

### `pubchem-database`
- **Compound Structure & Properties:**
  `python scripts/cheminformatics_pharmacology.py pubchem Tamoxifen`
  Returns CID (2733526), molecular formula ($C_{26}H_{29}NO$), molecular weight (371.5), IUPAC name, and PubChem link.

### `chembl-database`
- **Target & Molecule Search:**
  `python scripts/cheminformatics_pharmacology.py chembl target HER2`
  `python scripts/cheminformatics_pharmacology.py chembl molecule Trastuzumab`
  Returns ChEMBL IDs, max clinical phase, target type, organism, and molecular weights.

### `openfda-database`
- **Drug Labels & Boxed Warnings:**
  `python scripts/cheminformatics_pharmacology.py openfda label "trastuzumab deruxtecan"`
  Extracts verbatim FDA Boxed Warnings, Warnings and Precautions, Indications and Usage.
- **Adverse Event Counts:**
  `python scripts/cheminformatics_pharmacology.py openfda adverse "ENHERTU" --limit 5`
  Queries FAERS for top reported adverse events and patient counts.

### `clinical-trials-database`
- **ClinicalTrials.gov API v2:**
  `python scripts/cheminformatics_pharmacology.py clinicaltrials "Endometriosis" --limit 5`
  Returns NCT IDs, brief titles, overall recruitment status, phase, and clinicaltrials.gov study links.

---

## 4. Scientific Literature

### `pubmed-database`
- **PubMed Queries:**
  `python scripts/literature_search.py pubmed "endometriosis SFRP2" --limit 5`
  Returns PMIDs, title, journal, publication date, first author, DOI, and URL.

### `literature-search-arxiv`
- **arXiv Preprints:**
  `python scripts/literature_search.py arxiv "quantum computing chemistry" --limit 5`
  Retrieves arXiv IDs, titles, publication dates, authors, and abstract snippets.

### `literature-search-europepmc`
- **Europe PMC Open Access:**
  `python scripts/literature_search.py europepmc "SFRP2 Wnt signaling" --limit 5`
  Retrieves PMCID, open access status, citation counts, and direct links.

### `literature-search-openalex`
- **OpenAlex Scholarly Graph:**
  `python scripts/literature_search.py openalex "antibody drug conjugate safety" --limit 5`
  Retrieves DOI, publication year, citation counts, and primary journal source.

---

## 5. Prescribing Safety & System One Intelligence

### `adc-prescribing-guardrail`
- **Prescribing Safety Evaluation:**
  `python scripts/adc_safety_evaluator.py --drug Enhertu --age 76 --lvef 42 --egfr 38 --cough`
  Evaluates contraindications, LVEF cutoffs, ILD risk, cytopenias, and generates an NHS DCB0129 / NICE HTG10877 compliant Prescribing-Risk Card.

### `typesafe-ai`
- **TypeSafe AI Jev (System One):**
  `python scripts/typesafe_jev_evaluator.py status`
  Verifies Python SDK installation and API credentials status without exposing keys.
