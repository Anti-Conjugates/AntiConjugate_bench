---
name: google-antigravity-science
version: 2.0.0
author: Google DeepMind Antigravity + Nous Research Hermes
description: "Comprehensive suite of 40 scientific skills spanning genomics, protein structures, cheminformatics, pharmacology, oncology prescribing safety, scientific literature, and translational quantum chemistry. Includes master CLI runner, standalone REST bridges, and Level 5 evidence discipline."
tags: [science, genomics, alphafold, chembl, pdb, uniprot, pubmed, clinical-trials, openfda, opentargets, pubchem, hermes, adc-guardrail, quantinuum]
---

# Google Antigravity Science Skills Suite for Hermes Agent

This skill equips the **Nous Research Hermes Agent** with the full suite of **40 Google Antigravity Science skills**, enabling state-of-the-art computational biology, structural analysis, cheminformatics, clinical trial matching, scientific literature retrieval, and oncology prescribing safety.

---

## 1. Quick Slash Command & Execution

In Hermes Agent, this skill is automatically registered as a slash command:
```bash
/google-antigravity-science
/science
```

### Execution via Hermes Terminal Tool
Hermes can run any scientific command directly using its Python virtual environment:
```bash
/Users/openclaw/.hermes/hermes-agent/venv/bin/python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py <subcommand> [args...]
```

---

## 2. Five Scientific Domains & 40 Integrated Skills

```
                      GOOGLE ANTIGRAVITY SCIENCE SUITE (40 SKILLS)
                                            │
   ┌────────────────────┬───────────────────┼────────────────────┬─────────────────────┐
   ▼                    ▼                   ▼                    ▼                     ▼
GENOMICS (12)      PROTEINS (13)     PHARMACOLOGY (7)     LITERATURE (5)         SAFETY (3)
• Ensembl           • AlphaFold DB      • ChEMBL             • PubMed              • ADC Guardrail
• ClinVar           • RCSB PDB          • PubChem            • Europe PMC          • Antigravity Quantinuum
• dbSNP             • UniProtKB         • openFDA            • bioRxiv / medRxiv   • TypeSafe AI Jev
• gnomAD            • STRING PPI        • ClinicalTrials.gov • arXiv
• GTEx              • InterPro          • Open Targets       • OpenAlex
• JASPAR            • PyMOL             • QuickGO
• ENCODE cCREs      • Foldseek          • EMBL-EBI OLS
• UCSC TFBS         • MMseqs2 / BLAST
• UniBind           • Clustal Omega
• AlphaGenome       • Human Protein
  Atlas Links         Atlas
• AlphaGenome       • NCBI Sequence
  Single Variant    • Predicting The Past
• AlphaGenome AVI
```

---

## 3. High-Priority CLI Subcommands

### 🧬 Structural Biology & Protein Analysis
- **RCSB PDB Structure Details:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py pdb 1T08
  ```
  Returns resolution, experimental method, deposition date, molecular weight, polymer chains, and CIF/PDB download links.

- **AlphaFold DB 3D Model & pLDDT Confidence:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py alphafold Q96HF1
  ```
  Returns global pLDDT score (Very High >90, High 70-90, Low 50-70, Very Low <50), CIF/PDB download links, and PAE matrix image URL.

- **UniProtKB Functional Annotation:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py uniprot Q96HF1
  ```
  Returns protein full name, gene symbols, organism, sequence length, and functional descriptions.

- **STRING Protein Interaction Network:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py string SFRP2
  ```
  Returns top interacting protein partners with combined, experimental, and database confidence scores.

---

### 🔬 Genomics & Regulatory Elements
- **Ensembl Gene & Transcript Lookup:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py ensembl lookup SFRP2
  ```
  Returns Ensembl gene ID (`ENSG00000145423`), chromosomal locus (chr4:153,780,544-153,791,620), canonical transcript, and transcript list.

- **Ensembl Sequence Fetch:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py ensembl sequence ENSG00000145423 --type genomic
  ```
  Retrieves sequence, calculates GC content percentage, and returns sequence preview.

- **ClinVar Clinical Pathogenicity:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py clinvar ERBB2 --limit 5
  ```
  Returns clinical significance (Pathogenic, Benign, VUS), molecular consequence, and ClinVar variation URLs.

- **JASPAR Transcription Factor Binding Profiles:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py jaspar ESR1
  ```
  Returns JASPAR matrix IDs (`MA0112.1`, `MA0112.4`, etc.) and profile collections.

---

### 💊 Cheminformatics & Pharmacology
- **PubChem Chemical Properties:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py pubchem Tamoxifen
  ```
  Returns PubChem CID (2733526), molecular formula ($C_{26}H_{29}NO$), molecular weight, IUPAC name, and PubChem URL.

- **ChEMBL Bioactivities & Targets:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py chembl target HER2
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py chembl molecule Trastuzumab
  ```
  Retrieves target ChEMBL IDs, maximum phase of development, and molecule classifications.

- **openFDA Drug Labels & Boxed Warnings:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py openfda label "trastuzumab deruxtecan"
  ```
  Extracts verbatim FDA Boxed Warnings (e.g. Interstitial Lung Disease / ILD and embryo-fetal toxicity).

- **openFDA Adverse Event Counts (FAERS):**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py openfda adverse "ENHERTU" --limit 5
  ```
  Counts patient-reported adverse reactions from the FDA FAERS database.

- **ClinicalTrials.gov Protocol Search:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py clinicaltrials "Endometriosis" --limit 5
  ```
  Queries ClinicalTrials.gov API v2 for NCT IDs, study titles, recruitment status, and phases.

---

### 📚 Scientific Literature Search
- **PubMed & MEDLINE:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py pubmed "endometriosis SFRP2" --limit 5
  ```
  Retrieves PMIDs, titles, journals, publication dates, first authors, and DOIs.

- **arXiv Preprints:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py arxiv "quantum computing chemistry" --limit 5
  ```
  Retrieves preprint IDs, titles, dates, authors, and abstract snippets.

- **Europe PMC Open-Access Papers:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py europepmc "SFRP2 Wnt signaling" --limit 5
  ```
  Retrieves PMCID, open-access status, citations count, and direct links.

- **OpenAlex Scholarly Graph:**
  ```bash
  python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py openalex "antibody drug conjugate safety" --limit 5
  ```
  Retrieves DOI, publication year, citation counts, and primary journal source.

---

### 🛡️ Oncology Prescribing Safety Guardrail (DCB0129 / NICE HTG10877)
Evaluates elderly and complex cancer patient profiles before initiating Antibody-Drug Conjugates (ADCs):
- **Trastuzumab Deruxtecan (Enhertu)**: LVEF < 45%, ILD / pneumonitis symptoms, renal impairment
- **Sacituzumab Govitecan (Trodelvy)**: UGT1A1*28 homozygous genotype, severe neutropenia (ANC < 1500)
- **Enfortumab Vedotin (Padcev)**: Severe cutaneous reactions (SCAR/SJS), hyperglycemia, peripheral neuropathy
- **Trastuzumab Emtansine (Kadcyla)**: Hepatotoxicity (ALT/AST > 3x ULN), thrombocytopenia (< 100k), LVEF

```bash
python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py adc-guardrail \
  --drug Enhertu \
  --age 76 \
  --lvef 42 \
  --egfr 38 \
  --cough
```

Output: Formats a standard **Prescribing-Risk Card**:
```markdown
# PRESCRIBING-RISK CARD: TRASTUZUMAB DERUXTECAN (ENHERTU)
**Clinical Safety Standard:** NHS DCB0129 / NICE HTG10877 Epistemological Guardrail

| Parameter | Value |
|---|---|
| **ADC Drug** | Trastuzumab Deruxtecan (Enhertu) |
| **Safety Verdict** | **CONTRAINDICATED / HOLD THERAPY** |
| **Risk Tier** | **HIGH RISK (RED)** |

## Clinical Recommendation
> **Withhold ADC administration immediately. Order urgent diagnostic workup for detected toxicities.**

### ⛔ Absolute Contraindications & Red Flags
- CRITICAL: Baseline LVEF is 42.0% (threshold: ≥45.0%). Risk of severe cardiotoxicity/heart failure.
- CRITICAL: Patient reports new or worsening respiratory symptoms (cough/dyspnea). Rule out Interstitial Lung Disease (ILD) with high-resolution CT prior to infusion.
```

---

## 4. Scientific Evidence Discipline (Level 5 Primary Keys)

When presenting scientific findings in Hermes responses, adhere strictly to Level 5 evidence discipline:
1. **Never fabricate biological identifiers.**
2. **Every entity assertion must cite verified primary database keys:**
   - Protein structures: `PDB:1T08`
   - Protein sequences: `UniProt:Q96HF1`
   - Genes: `Ensembl:ENSG00000145423`
   - Small molecules: `PubChem:2733526`, `ChEMBL:CHEMBL28`
   - Clinical trials: `NCT04567890`
   - Literature citations: `PMID:36991319`, `PMID:29462326`
   - Regulatory warnings: Verbatim FDA Boxed Warnings from openFDA.

---

## 5. Automated Verification & Testing

To test the entire scientific toolchain within Hermes:
```bash
python ~/.hermes/skills/google-antigravity-science/scripts/antigravity_science.py test
```
Verifies catalog integrity, RCSB PDB REST API, AlphaFold DB API, Ensembl Genomics API, and ADC Prescribing Safety Evaluator in a single command.
