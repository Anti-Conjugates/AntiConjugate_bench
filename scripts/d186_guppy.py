#!/usr/bin/env python3
"""
Lane D186: TELESPHORUS Guppy 1.0 Module:
Compiles SFRP2 CRD Active Pocket Ansätze with 2D induced-fit particle-conserving
Givens relaxation, 2-bit mid-circuit dynamic selector, and mid-circuit parity syndrome into HUGR.

Outputs:
- s0, s1: 2-bit selector register (arm = s0 + 2*s1)
- p0: Parity syndrome check (p0 == 0 -> parity clean, p0 == 1 -> noise detected)
- m0, m1, m2, m3: 4-qubit active space measurement register
"""

from __future__ import annotations
from guppylang import guppy
from guppylang.std.quantum import qubit, x, ry, cx, h, measure, angle
from guppylang.std.builtins import output

@guppy
def guppy_d186_interleaved() -> None:
    """Interleaved 4-arm SFRP2 CRD potential well with 2D induced-fit and parity syndrome."""
    s0 = qubit(); s1 = qubit()
    h(s0); h(s1)
    r0 = measure(s0).read(); r1 = measure(s1).read()

    p = qubit()
    q0 = qubit(); q1 = qubit(); q2 = qubit(); q3 = qubit()
    x(q0); x(q1)

    if r1:
        if r0:
            # Arm 3: Steric clash (t1=0.125, t2=0.000)
            ry(q1, angle(0.125))
            cx(q1, q2); cx(q0, q3)
        else:
            # Arm 2: Bound induced-fit (t1=0.250, t2=0.150)
            ry(q1, angle(0.250))
            cx(q1, q2); cx(q0, q3)
            # Particle-conserving Givens relaxation between q2 and q3
            cx(q2, q3)
            ry(q2, angle(0.150))
            cx(q2, q3)
    else:
        if r0:
            # Arm 1: Pre-docking intermediate (t1=0.375, t2=0.050)
            ry(q1, angle(0.375))
            cx(q1, q2); cx(q0, q3)
            # Particle-conserving Givens relaxation between q2 and q3
            cx(q2, q3)
            ry(q2, angle(0.050))
            cx(q2, q3)
        else:
            # Arm 0: Apo unbound (t1=0.500, t2=0.000)
            ry(q1, angle(0.500))
            cx(q1, q2); cx(q0, q3)

    # Mid-circuit Parity Syndrome Measurement (P = Z0 Z1 Z2 Z3)
    cx(q0, p); cx(q1, p); cx(q2, p); cx(q3, p)
    rp = measure(p).read()

    output("s0", r0); output("s1", r1)
    output("p0", rp)
    output("m0", measure(q0).read()); output("m1", measure(q1).read())
    output("m2", measure(q2).read()); output("m3", measure(q3).read())

# Standalone modules for individual arm checks and local statevector verification
@guppy
def guppy_arm0_apo() -> None:
    p = qubit()
    q0 = qubit(); q1 = qubit(); q2 = qubit(); q3 = qubit()
    x(q0); x(q1); ry(q1, angle(0.500)); cx(q1, q2); cx(q0, q3)
    cx(q0, p); cx(q1, p); cx(q2, p); cx(q3, p)
    output("p0", measure(p).read())
    output("m0", measure(q0).read()); output("m1", measure(q1).read())
    output("m2", measure(q2).read()); output("m3", measure(q3).read())

@guppy
def guppy_arm1_predock() -> None:
    p = qubit()
    q0 = qubit(); q1 = qubit(); q2 = qubit(); q3 = qubit()
    x(q0); x(q1); ry(q1, angle(0.375)); cx(q1, q2); cx(q0, q3)
    cx(q2, q3); ry(q2, angle(0.050)); cx(q2, q3)
    cx(q0, p); cx(q1, p); cx(q2, p); cx(q3, p)
    output("p0", measure(p).read())
    output("m0", measure(q0).read()); output("m1", measure(q1).read())
    output("m2", measure(q2).read()); output("m3", measure(q3).read())

@guppy
def guppy_arm2_bound() -> None:
    p = qubit()
    q0 = qubit(); q1 = qubit(); q2 = qubit(); q3 = qubit()
    x(q0); x(q1); ry(q1, angle(0.250)); cx(q1, q2); cx(q0, q3)
    cx(q2, q3); ry(q2, angle(0.150)); cx(q2, q3)
    cx(q0, p); cx(q1, p); cx(q2, p); cx(q3, p)
    output("p0", measure(p).read())
    output("m0", measure(q0).read()); output("m1", measure(q1).read())
    output("m2", measure(q2).read()); output("m3", measure(q3).read())

@guppy
def guppy_arm3_clash() -> None:
    p = qubit()
    q0 = qubit(); q1 = qubit(); q2 = qubit(); q3 = qubit()
    x(q0); x(q1); ry(q1, angle(0.125)); cx(q1, q2); cx(q0, q3)
    cx(q0, p); cx(q1, p); cx(q2, p); cx(q3, p)
    output("p0", measure(p).read())
    output("m0", measure(q0).read()); output("m1", measure(q1).read())
    output("m2", measure(q2).read()); output("m3", measure(q3).read())

def compile_all():
    return {
        "interleaved": guppy_d186_interleaved.compile(),
        "arm0": guppy_arm0_apo.compile(),
        "arm1": guppy_arm1_predock.compile(),
        "arm2": guppy_arm2_bound.compile(),
        "arm3": guppy_arm3_clash.compile(),
    }

if __name__ == "__main__":
    print("Compiling D186 TELESPHORUS modules via Guppy 1.0...")
    pkgs = compile_all()
    for name, pkg in pkgs.items():
        print(f"  ✓ Compiled {name}: HUGR package valid.")
