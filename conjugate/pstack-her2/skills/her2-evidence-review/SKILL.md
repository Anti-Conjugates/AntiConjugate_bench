---
name: her2-evidence-review
description: Review a HER2 product/source/flag change for provenance, product-specific label entailment, missingness, inference and pharmacist approval boundaries.
---

# Evidence review checklist

- Verify ADCdb ID and exact product name independently of target or payload class. Structural observations are not clinical approval.
- Use the authoritative jurisdiction-specific label, named section, revision date and observation date. State if a snapshot is not frozen. A working source URL is not proof that it entails a claim.
- Explicitly distinguish a paraphrase from a quote. Do not fabricate quotes. Distinguish label observation from inference and unresolved assay provenance.
- Keep Kadcyla liver/NRH, platelet/bleeding, neuropathy, cardiac and pulmonary checks separate from Enhertu ILD, neutropenia/CBC, cardiac and liver/platelet observations. No payload-class shortcut.
- Recognized medicine aliases are only limited context. Enhertu inhibitor-study findings do not mean no interaction risk. Medication overlap inferences remain labelled inference. Absence of a named warning never means zero risk.
- Coarse organ categories are not interchangeable with Child–Pugh, bilirubin or creatinine-clearance definitions. Limited elderly/organ data remain unknown, not invented contraindications.
- Do not derive calibrated risk, affinity windows, patient release rates or treatment ranking from DAR/linker/assay values.
- Test allowlisted flag/source pairing and omissions with software sentinels; never touch clinical benchmark material.
- Preserve `draft_pending_pharmacist`, `eligibility=not_assessed`, `needs_human=true`, blocked clinical release and null probability fields. There is no pharmacist approval switch in this prototype.
