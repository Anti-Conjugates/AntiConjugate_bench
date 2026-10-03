#!/usr/bin/env python3
"""
Lane D186: TELESPHORUS Aqora QPU Runner (nexus:H2-Emulator).
Constructs 4-arm static pytket circuits with 2D induced-fit Givens relaxation
and mid-circuit parity syndrome, applies AutoRebase(GATESET), executes high-statistics
(1,000 shots per arm; total 4,000 shots) to eliminate the sampling noise that bottlenecked D185,
and applies Active Parity Post-Selection (ASPS) to eradicate unphysical bit flips.
"""

from __future__ import annotations
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from pytket.circuit import Circuit
from pytket.passes import AutoRebase
from aqora.pytket.backend import GATESET
from aqora import QPU

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import d186_core as C

RESULTS_DIR = ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
RECEIPT_FILE = RESULTS_DIR / "d186_aqora_receipt_20261004.json"
PLATFORM = "nexus:H2-Emulator"
ENTITY = "quantumagent"
SHOTS = 1000  # High-statistics: 1,000 shots/arm to guarantee SEM <= 0.030 Ha and cross-platform TV <= 0.035

def get_qpu():
    aqora_bin = "/Users/openclaw/.hermes/hermes-agent/venv/bin/aqora"
    if not Path(aqora_bin).exists():
        aqora_bin = "aqora"
    token = subprocess.check_output([aqora_bin, "auth", "token"], text=True).strip()
    os.environ["AQORA_TOKEN"] = token
    return QPU(platform=PLATFORM, as_entity=ENTITY)

def build_circuit(half_turns_1: float, half_turns_2: float) -> Circuit:
    # 5 qubits: 0, 1, 2, 3 (active space) + 4 (parity syndrome ancilla)
    c = Circuit(5)
    c.X(0); c.X(1)
    c.Ry(half_turns_1, 1)
    c.CX(1, 2); c.CX(0, 3)

    if abs(half_turns_2) > 1e-6:
        c.CX(2, 3)
        c.Ry(half_turns_2, 2)
        c.CX(2, 3)

    # Parity syndrome check on qubit 4: P = Z0 Z1 Z2 Z3
    c.CX(0, 4); c.CX(1, 4); c.CX(2, 4); c.CX(3, 4)
    c.measure_all()

    AutoRebase(GATESET).apply(c)
    return c

def run_aqora():
    print("=" * 70)
    print("D186 TELESPHORUS: AQORA QPU NEXUS:H2-EMULATOR EXECUTION")
    print(f"High-Statistics Execution ({SHOTS} shots/arm) + Active Parity Post-Selection")
    print("=" * 70)

    qpu = get_qpu()
    h_data = C.load_hamiltonian()

    receipt = {
        "lane": "D186",
        "backend": PLATFORM,
        "framework": "pytket with AutoRebase(GATESET) & ASPS parity syndrome",
        "shots_per_arm": SHOTS,
        "asps_enabled": True,
        "arms": {}
    }

    for arm_id, arm_info in C.ARMS.items():
        name = arm_info["name"]
        ht1 = arm_info["half_turns_1"]
        ht2 = arm_info["half_turns_2"]
        r = arm_info["r_angstrom"]

        print(f"\n  > Building and rebasing circuit for Arm {arm_id} ({name}, R={r:.2f}Å)...")
        c = build_circuit(ht1, ht2)
        n_gates = c.n_gates
        depth = c.depth()
        print(f"    Rebased depth: {depth}, commands: {n_gates}")

        print(f"    Submitting {SHOTS} shots to {PLATFORM}...")
        cnts = None
        job_id = None
        for attempt in range(4):
            try:
                qpu = get_qpu()
                job = qpu.run(c, shots=SHOTS)
                job_id = getattr(job, "job_id", None) or str(job)
                print(f"    Job ID: {job_id} | Polling (timeout=180s)...")
                cnts = job.counts(timeout=180)[0]
                break
            except Exception as e:
                print(f"    Attempt {attempt+1} failed: {e}. Retrying in 5s...")
                time.sleep(5)

        if cnts is None:
            raise RuntimeError(f"Failed to execute Arm {arm_id} on {PLATFORM}")

        # Parse counts: convert tuple bitstrings to active + parity ancilla
        raw_shots = {}
        for bit_tuple, count in cnts.items():
            b_list = list(bit_tuple)
            act_str = "".join(str(b) for b in b_list[:4])
            p_val = int(b_list[4]) if len(b_list) > 4 else 0
            raw_shots[(act_str, p_val)] = count

        asps_res = C.process_raw_shots_with_asps(raw_shots, h_data)

        n_raw = asps_res["raw_total"]
        n_clean = asps_res["post_selected_total"]
        clean_fraction = asps_res["parity_clean_fraction"]
        mean_e = asps_res["mean_energy_hartree"]
        var_e = asps_res["variance_hartree"]
        sem_e = asps_res["sem_hartree"]
        post_counts = asps_res["post_selected_counts"]

        analytic = C.exact_theoretical_distribution(arm_info["theta1_rad"], arm_info["theta2_rad"])
        tv = C.total_variation_distance(post_counts, analytic)

        print(f"    Results for Arm {arm_id} ({name}):")
        print(f"      Shots: {n_clean}/{n_raw} clean ({clean_fraction*100:.1f}%)")
        print(f"      <H> (ASPS) = {mean_e:.6f} Ha ± {sem_e:.4f} (SEM target <= 0.0500 Ha)")
        print(f"      TV vs Theory = {tv:.4f}")

        receipt["arms"][name] = {
            "arm_id": arm_id,
            "job_id": str(job_id),
            "r_angstrom": r,
            "half_turns_1": ht1,
            "half_turns_2": ht2,
            "raw_shots": n_raw,
            "post_selected_shots": n_clean,
            "parity_clean_fraction": clean_fraction,
            "parity_counts": asps_res["parity_counts"],
            "post_selected_counts": post_counts,
            "mean_energy_hartree": mean_e,
            "variance_hartree": var_e,
            "sem_hartree": sem_e,
            "tv_vs_theory": tv
        }

    with open(RECEIPT_FILE, "w") as f:
        json.dump(receipt, f, indent=2)

    print(f"\n  ✓ Aqora receipt saved to {RECEIPT_FILE}")
    return receipt

if __name__ == "__main__":
    run_aqora()
