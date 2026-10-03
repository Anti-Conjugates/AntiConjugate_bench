# Clinical & Translational Oncology Recipes for Hermes Agent

This document provides multi-step scientific workflows combining genomics, structural biology, cheminformatics, literature, and oncology prescribing safety.

---

## Recipe 1: Endometriosis Target De-Orphaning (SFRP2 Case Study)

1. **Gene Identification & Locus Inspection:**
   ```bash
   python scripts/antigravity_science.py ensembl lookup SFRP2
   ```
   - Confirms Ensembl ID `ENSG00000145423` on Chromosome 4 (153,780,544 - 153,791,620 bp, minus strand).
   - Identifies canonical transcript `ENST00000274063`.

2. **Structural Evaluation:**
   ```bash
   python scripts/antigravity_science.py alphafold Q96HF1
   ```
   - Global pLDDT = 82.12 (High confidence).
   - Reveals Cysteine-Rich Domain (CRD) homologous to Frizzled receptors that binds Wnt ligands.

3. **Mechanism of Action & Literature Validation:**
   ```bash
   python scripts/antigravity_science.py pubmed "endometriosis SFRP2" --limit 3
   ```
   - PMID 36991319: SFRP2 dictates endometriosis progression via Wnt/β-catenin activation.
   - PMID 29462326: SFRP2 expression promotes lesion proliferation in extraovarian endometriosis.

4. **Protein Interaction Mapping:**
   ```bash
   python scripts/antigravity_science.py string SFRP2
   ```
   - Maps interactions with WNT3A, WNT5A, CTNNB1 (β-catenin), and FZD receptors.

---

## Recipe 2: ADC Prescribing Safety & Toxicities Guardrail

1. **Check Drug Label & Black-Box Warnings:**
   ```bash
   python scripts/antigravity_science.py openfda label "trastuzumab deruxtecan"
   ```
   - Highlights Interstitial Lung Disease (ILD) / pneumonitis and embryo-fetal toxicity.

2. **Evaluate Patient Safety Card:**
   ```bash
   python scripts/antigravity_science.py adc-guardrail --drug Enhertu --age 76 --lvef 44 --egfr 35 --cough
   ```
   - Triggers `CONTRAINDICATED / HOLD THERAPY` due to LVEF < 45% and persistent respiratory symptoms.
   - Emits structured markdown Prescribing-Risk Card formatted according to NHS DCB0129 / NICE HTG10877.

3. **Check Real-World Pharmacovigilance (FAERS):**
   ```bash
   python scripts/antigravity_science.py openfda adverse "ENHERTU" --limit 5
   ```
   - Retrieves frequency counts of top reported adverse reactions from FDA FAERS database.
