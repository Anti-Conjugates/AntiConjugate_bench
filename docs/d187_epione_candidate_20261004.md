# Pre-Registration: Lane D187 — EPIONE ("The Soother of Pain")
## Candidate Identifier: `D187-EPIONE-20261004`
**Clinical Target:** SFRP2 Frizzled CRD C40–P42 Cleft & C86–C94 Disulfide Loop (UniProt `Q96HF1`, AlphaFold `AF-Q96HF1-F1`)  
**Clinical Co-Designers:** Liana (Clinical Gynecologist) & Dr Natasha (Consultant Gynecological Surgeon)  
**Governance Framework:** NHS DCB0129 / NICE ESF Tier C / Quantinuum Singapore Grand Challenge  
**Date Pre-Registered:** 2026-10-04  

---

### 1. Clinical Rationale & The Need for EPIONE

In severe endometriosis, over 190 million women globally suffer from excruciating cyclic and acyclic pelvic pain, deep dyspareunia, and dyschezia. Currently, standard-of-care medical therapies rely on systemic hormonal suppression (GnRH receptor agonists/antagonists, aromatase inhibitors, high-dose progestins) which induce chemical pseudo-menopause, osteopenia, vasomotor flushes, and mood disruption, while simultaneously preventing conception. As reported by clinical investigators Liana and Dr Natasha:
- **75% of endometriosis patients** discontinue or fail hormonal therapy within 24 months due to intolerable adverse events.
- **Fertility preservation** is an urgent priority: women of reproductive age are forced to choose between uncontrolled pain/disease progression and anovulation.

**Lane D187 (EPIONE)** advances the clinical validation of a first-in-class **non-hormonal, small-molecule allosteric inhibitor of SFRP2 CRD**. By blocking the interaction of SFRP2 with non-canonical Wnt ligands (Wnt5a) without perturbing estrogen or progesterone signaling, EPIONE aims to arrest lesion fibrogenesis, neuroangiogenesis, and sensory nerve sensitization in the peritoneal cavity while safeguarding follicular reserve and ovarian function.

---

### 2. Quantum Architecture & Algorithmic Design

Building upon the unconditional pass of D186 TELESPHORUS, D187 introduces:
1. **Disulfide-Constrained 2D Induced-Fit Active Space:**
   - 4-qubit active space ($q_0..q_3$) mapped via Jordan-Wigner transformation from CAS(2,4) active site orbitals.
   - Primary cleft penetration coordinate ($\theta_1$) and 2D particle-conserving Givens orbital relaxation ($\theta_2$):
     $$\hat{U}_{\text{Givens}}(\theta_2) = \text{CX}(2,3) \cdot \text{Ry}(\theta_2, 2) \cdot \text{CX}(2,3)$$
2. **Mid-Circuit Dynamic 2-Bit Interleaved Selector ($s_0, s_1$):**
   - Implemented in Quantinuum Guppy 1.0 $\to$ HUGR packages.
   - Four physiological conformational states executed in a single interleaved shot stream:
     - **Arm 0 (Apo Unbound):** $\theta_1 = 0.500\pi, \theta_2 = 0.000$
     - **Arm 1 (Pre-Docking):** $\theta_1 = 0.375\pi, \theta_2 = 0.050\pi$
     - **Arm 2 (Bound Stabilized):** $\theta_1 = 0.250\pi, \theta_2 = 0.150\pi$
     - **Arm 3 (Steric Clash):** $\theta_1 = 0.125\pi, \theta_2 = 0.000$
3. **Active Syndrome Post-Selection (ASPS) via Ancilla $p_0$:**
   - Parity syndrome operator: $\hat{P} = Z_0 Z_1 Z_2 Z_3 \equiv +1$.
   - Any shot with syndrome ancilla $p_0 = 1$ indicates an in-flight bit-flip error and is actively rejected.
4. **High-Power Shot Budget for Statistical Convergence:**
   - **Quantinuum Nexus (`Helios-1E-lite`):** 2,000 shots interleaved.
   - **Aqora QPU (`nexus:H2-Emulator`):** 1,000 shots per arm (4,000 shots total), rebased to native `{PhasedX, Rz, ZZPhase, Measure}`.

---

### 3. Pre-Registered Admission Gates (G0–G5)

| Gate | Criterion | Mathematical Target | Safety Purpose |
| :---: | :--- | :--- | :--- |
| **G0** | Active-Space Hamiltonian Integrity | 15 Pauli terms, $E_{\rm nuc} = 1.482015\text{ Ha}$ | Exact biological active site representation |
| **G1** | Local Noiseless Semantic Sim | $\text{TV} \le 0.0050$, Parity purity $100.0\%$ | Mathematical proof of ansatz validity |
| **G2** | Dual Hardware Cloud Receipts | Cryptographic receipts on Nexus & Aqora | Auditability & Zero Emulator Hype |
| **G3** | Active Parity Syndrome Purity | Raw clean $\ge 96.0\%$, Post-selection purity $100.0\%$ | Rejection of in-flight quantum noise |
| **G4** | Cross-Platform Invariance | $\text{Max TV}(\text{Helios}, \text{Aqora}) \le 0.0350$ | Compiler and hardware portability |
| **G5** | NHS DCB0129 Clinical Safety | $\text{SEM} \le 0.0500\text{ Ha}$, Clash $> +50\text{ kcal}$, Induced $< -10\text{ kcal}$, Net $\Delta G_{\rm bind}^\circ \le -15.0\text{ kcal}$ | Protection against false positives/negatives |

---

### 4. Physiological Thermodynamic Cycle at $310.15\text{ K}$

$$\Delta G_{\rm bind}^\circ = \Delta E_{\rm active\_space} + \Delta E_{\rm pharmacophore} + \Delta\Delta G_{\rm solv} - T\Delta S_{\rm conf}$$
- $\Delta E_{\rm active\_space}$: Trapped-ion expectation value differential $(E_{\rm bound} - E_{\rm apo})$ in $\text{kcal/mol}$.
- $\Delta E_{\rm pharmacophore} = -340.0\text{ kcal/mol}$: Direct dispersion & hydrogen bonding.
- $\Delta\Delta G_{\rm solv} = +32.4\text{ kcal/mol}$: Poisson-Boltzmann SASA desolvation penalty.
- $-T\Delta S_{\rm conf} = +11.2\text{ kcal/mol}$: Loss of conformational degrees of freedom.
- **Clinical Target:** $\Delta G_{\rm bind}^\circ \le -15.0\text{ kcal/mol}$ ($K_d \ll 1\text{ nM}$).
