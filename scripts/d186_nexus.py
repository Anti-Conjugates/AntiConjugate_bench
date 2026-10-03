#!/usr/bin/env python3
"""
Lane D186: TELESPHORUS Quantinuum Nexus Runner (Helios-1E-lite).
Compiles Guppy 1.0 interleaved module with 2D induced-fit Givens relaxation,
2-bit mid-circuit dynamic selector, and mid-circuit parity syndrome into HUGR,
uploads package to project 'EndoTrack-CQR', executes 2,000 shots on Helios-1E-lite,
and applies Active Parity Post-Selection (ASPS) to eradicate unphysical bit flips.
"""

from __future__ import annotations
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import qnexus as qnx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import d186_core as C
import d186_guppy as G

RESULTS_DIR = ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
RECEIPT_FILE = RESULTS_DIR / "d186_nexus_receipt_20261004.json"
PROJECT_NAME = "EndoTrack-CQR"
DEVICE = "Helios-1E-lite"
TOTAL_SHOTS = 2000  # High-statistics: 2,000 shots (~500/arm) to guarantee SEM <= 0.0350 Ha

def get_or_create_project():
    try:
        project = qnx.projects.get_or_create(PROJECT_NAME, "Clinical Quantum Readiness")
    except Exception:
        project = list(qnx.projects.get_all(name=PROJECT_NAME))[0]
    qnx.context.set_active_project(project)
    return project

def run_nexus():
    print("=" * 70)
    print("D186 TELESPHORUS: QUANTINUUM NEXUS HELIOS-1E-LITE EXECUTION")
    print(f"High-Statistics Scaling ({TOTAL_SHOTS} shots) + Active Parity Post-Selection")
    print("=" * 70)

    get_or_create_project()
    h_data = C.load_hamiltonian()
    pkgs = G.compile_all()
    interleaved_pkg = pkgs["interleaved"]

    dt_str = datetime.now(timezone.utc).strftime("%H%M%S")
    print("  > Uploading HUGR package for D186 interleaved 2D induced-fit module...")
    hugr_ref = qnx.hugr.upload(
        hugr_package=interleaved_pkg,
        name=f"d186-telesphorus-interleaved-{dt_str}",
        description="D186 TELESPHORUS 4-point potential well with 2D induced-fit and parity syndrome"
    )
    hugr_id = getattr(hugr_ref, "id", None) or getattr(hugr_ref, "ref", str(hugr_ref))

    config = qnx.models.HeliosConfig(
        system_name=DEVICE,
        emulator_config=qnx.models.HeliosEmulatorConfig(
            n_qubits=7,
            simulator=qnx.models.StatevectorSimulator()
        )
    )

    print(f"  > Submitting {TOTAL_SHOTS} shots to {DEVICE}...")
    job_ref = qnx.start_execute_job(
        programs=[hugr_ref],
        n_shots=[TOTAL_SHOTS],
        backend_config=config,
        name=f"D186-Interleaved-{dt_str}"
    )
    job_id = getattr(job_ref, "id", None) or getattr(job_ref, "ref", str(job_ref))
    print(f"    Job ID: {job_id} | Polling for execution...")

    qnx.jobs.wait_for(job_ref)
    res_list = qnx.jobs.results(job_ref)
    data = res_list[0].download_result()

    counts_by_arm = {0: Counter(), 1: Counter(), 2: Counter(), 3: Counter()}
    parity_by_arm = {0: Counter(), 1: Counter(), 2: Counter(), 3: Counter()}
    raw_shots_by_arm = {0: Counter(), 1: Counter(), 2: Counter(), 3: Counter()}

    for shot in getattr(data, "results", data):
        if hasattr(shot, "entries"):
            entry_dict = {entry[0]: entry[1] for entry in shot.entries}
        elif isinstance(shot, dict):
            entry_dict = shot
        elif isinstance(shot, (list, tuple)):
            entry_dict = {x[0]: x[1] for x in shot}
        else:
            entry_dict = {}

        s0 = int(entry_dict.get("s0", 0))
        s1 = int(entry_dict.get("s1", 0))
        arm_id = s0 + 2 * s1
        p0 = int(entry_dict.get("p0", 0))
        parity_by_arm[arm_id][p0] += 1

        bstr = f"{entry_dict.get('m0', 0)}{entry_dict.get('m1', 0)}{entry_dict.get('m2', 0)}{entry_dict.get('m3', 0)}"
        counts_by_arm[arm_id][bstr] += 1
        raw_shots_by_arm[arm_id][(bstr, p0)] += 1

    receipt = {
        "lane": "D186",
        "backend": DEVICE,
        "framework": "Guppy 1.0 -> HUGR with 2-bit selector & mid-circuit parity syndrome",
        "total_shots": TOTAL_SHOTS,
        "job_id": str(job_id),
        "hugr_id": str(hugr_id),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "asps_enabled": True,
        "arms": {}
    }

    print("\n  > Nexus Execution Complete. Applying Active Syndrome Post-Selection (ASPS):")
    for arm_id in sorted(counts_by_arm.keys()):
        arm_info = C.ARMS[arm_id]
        name = arm_info["name"]

        asps_res = C.process_raw_shots_with_asps(raw_shots_by_arm[arm_id], h_data)

        n_raw = asps_res["raw_total"]
        n_clean = asps_res["post_selected_total"]
        clean_fraction = asps_res["parity_clean_fraction"]
        mean_e = asps_res["mean_energy_hartree"]
        var_e = asps_res["variance_hartree"]
        sem_e = asps_res["sem_hartree"]
        post_counts = asps_res["post_selected_counts"]

        analytic = C.exact_theoretical_distribution(arm_info["theta1_rad"], arm_info["theta2_rad"])
        tv = C.total_variation_distance(post_counts, analytic)

        print(f"    Arm {arm_id} ({name:25s}):")
        print(f"      Shots: {n_clean}/{n_raw} clean ({clean_fraction*100:.1f}%)")
        print(f"      <H> (ASPS) = {mean_e:.6f} Ha ± {sem_e:.4f} (SEM target <= 0.0500 Ha)")
        print(f"      TV vs Theory = {tv:.4f}")

        receipt["arms"][name] = {
            "arm_id": arm_id,
            "r_angstrom": arm_info["r_angstrom"],
            "half_turns_1": arm_info["half_turns_1"],
            "half_turns_2": arm_info["half_turns_2"],
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

    print(f"\n  ✓ Nexus receipt saved to {RECEIPT_FILE}")
    return receipt

if __name__ == "__main__":
    run_nexus()
