# AntiConjugate demo (LLM: ollama:qwen2.5:7b-instruct)

> Decision support for a qualified prescriber. Clinical content is UNVERIFIED until pharmacist sign-off.

## case-dev-01: Trastuzumab emtansine

**Patient:** `{"age": 78, "sex": "F", "egfr": 45, "bilirubin_x_uln": 1.0, "ast_alt_x_uln": 1.0, "platelets": 160, "anc": 3.0, "lvef": 58, "conditions": ["atrial_fibrillation", "type2_diabetes"], "meds": ["apixaban", "metformin", "ramipril", "atorvastatin", "omeprazole", "clarithromycin"]}`

**Verdict:** supported  |  **confidence:** 0.92  |  **needs_human:** True

**Guardrail:** P(miss)=0.139 vs threshold 0.3 -> **release with flags**

**Summary:** The prescribing-risk card for Trastuzumab emtansine (Kadcyla) in cycle 1 includes several important flags.

| flag | severity | why | evidence |
|---|---|---|---|
| bleeding_risk | HIGH | On apixaban: bleeding risk if platelets fall. | RULE:anticoagulant_antiplatelet, PATIENT:meds, KB:drug_lists:anticoagulant, KB:drug_lists:antiplatelet |
| cyp3a4_interaction | HIGH | Strong CYP3A4 inhibitor(s) clarithromycin may raise payload exposure. | RULE:cyp3a4_strong_inhibitor, PATIENT:meds, KB:drug_lists:cyp3a4_strong_inhibitor |
| renal_impairment | MOD | Moderate renal impairment (eGFR 45). | RULE:renal_function, PATIENT:egfr |
| elderly_polypharmacy | MOD | Age 78, 6 co-medications: reduced reserve, review interactions. | RULE:elderly_polypharmacy, PATIENT:age, PATIENT:meds |
| thrombocytopenia | monitor | Class toxicity of Maytansinoid DM1 (emtansine), usually non-cleavable SMCC linker: thrombocytopenia. | ADCDB:DRG0CYMEB, KB:maytansinoid_dm1 |
| hepatotoxicity | monitor | Class toxicity of Maytansinoid DM1 (emtansine), usually non-cleavable SMCC linker: hepatotoxicity. | ADCDB:DRG0CYMEB, KB:maytansinoid_dm1 |
| lvef_cardiac | monitor | Class toxicity of Maytansinoid DM1 (emtansine), usually non-cleavable SMCC linker: lvef_decline. | ADCDB:DRG0CYMEB, KB:maytansinoid_dm1, KB:HER2 |
| neuropathy | monitor | Class toxicity of Maytansinoid DM1 (emtansine), usually non-cleavable SMCC linker: peripheral_neuropathy. | ADCDB:DRG0CYMEB, KB:maytansinoid_dm1 |
| embryofetal | monitor | Class toxicity of Maytansinoid DM1 (emtansine), usually non-cleavable SMCC linker: embryofetal. | ADCDB:DRG0CYMEB, KB:maytansinoid_dm1 |

**Biophysics notes:** Non-cleavable linker: typically higher circulating stability, limited bystander effect.

**Counterfactual check:** +clarithromycin +warfarin -> expected ['bleeding_risk', 'cyp3a4_interaction']: PASS

## case-dev-02: Trastuzumab deruxtecan

**Patient:** `{"age": 72, "sex": "F", "egfr": 70, "bilirubin_x_uln": 0.8, "ast_alt_x_uln": 1.1, "platelets": 210, "anc": 2.4, "lvef": 52, "conditions": ["copd", "thoracic_radiotherapy", "prior_anthracycline"], "meds": ["amiodarone", "tiotropium", "salbutamol", "bisoprolol"]}`

**Verdict:** supported  |  **confidence:** 0.72  |  **needs_human:** False

**Guardrail:** P(miss)=0.093 vs threshold 0.3 -> **release with flags**

**Summary:** The prescribing-risk card for trastuzumab deruxtecan (Enhertu) in a 72-year-old female patient with COPD, thoracic radiotherapy, and prior anthracycline exposure highlights several risks and considerations.

| flag | severity | why | evidence |
|---|---|---|---|
| ild_risk | MOD | Lung risk factor: copd, thoracic_radiotherapy. | ADCDB:DRG0ERKBH, KB:topo1_dxd, RULE:lung_disease, PATIENT:conditions, RULE:pneumonitis_drugs, PATIENT:meds, KB:drug_lists:pneumonitis_risk |
| lvef_cardiac | MOD | Cardiotoxic co-exposure (prior anthracycline). | ADCDB:DRG0ERKBH, KB:topo1_dxd, KB:HER2, RULE:cardiotoxic_drugs, KB:drug_lists:cardiotoxic, PATIENT:conditions |
| neutropenia_risk | monitor | Class toxicity of Topoisomerase-I inhibitor, deruxtecan/exatecan family: neutropenia. | ADCDB:DRG0ERKBH, KB:topo1_dxd |
| gi_toxicity | monitor | Class toxicity of Topoisomerase-I inhibitor, deruxtecan/exatecan family: nausea_gi. | ADCDB:DRG0ERKBH, KB:topo1_dxd |
| embryofetal | monitor | Class toxicity of Topoisomerase-I inhibitor, deruxtecan/exatecan family: embryofetal. | ADCDB:DRG0ERKBH, KB:topo1_dxd |

**Unknowns:** The Kd value is below the affinity window, which may indicate a binding-site barrier or poor tumor penetration. This needs further verification.; The circulating stability data should be reviewed for any premature payload release, as the linker is cleavable.

**Biophysics notes:** Kd ~0.0487 nM is below the affinity window: possible binding-site barrier / poor tumour penetration (UNVERIFIED threshold). Cleavable linker: check circulating-stability data for premature payload release. ADCdb circulating stability: 4% payload release reported.

**Counterfactual check:** +clarithromycin +warfarin -> expected ['bleeding_risk']: PASS

_Resolved model(s): ['qwen2.5:7b-instruct']_
