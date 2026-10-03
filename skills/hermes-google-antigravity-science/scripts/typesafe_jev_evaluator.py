#!/usr/bin/env python3
"""
TypeSafe AI Jev Interface & Verification Script
Model: jev-latest (TypeSafe's flagship System One model)
Official Documentation: https://docs.typesafe.ai/
"""

import os
import sys
import json
from pathlib import Path
from typing import Dict, Any, Optional

def check_env_key() -> bool:
    """Check if TYPESAFE_API_KEY is defined in environment or ~/.env without leaking it."""
    if os.environ.get("TYPESAFE_API_KEY"):
        return True
    
    env_file = Path.home() / ".env"
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("TYPESAFE_API_KEY=") and len(line.split("=", 1)[1].strip()) > 0:
                        return True
        except Exception:
            pass
    return False

def load_env_key_if_present() -> None:
    """Load TYPESAFE_API_KEY into os.environ from ~/.env if not already set."""
    if not os.environ.get("TYPESAFE_API_KEY"):
        env_file = Path.home() / ".env"
        if env_file.exists():
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("TYPESAFE_API_KEY="):
                            val = line.split("=", 1)[1].strip().strip("\"'")
                            if val:
                                os.environ["TYPESAFE_API_KEY"] = val
                                break
            except Exception:
                pass

def status() -> int:
    """Print status of TypeSafe AI Jev installation and credentials."""
    print("=" * 80)
    print("TYPESAFE AI JEV (System One) STATUS REPORT")
    print("=" * 80)
    
    # 1. Python SDK
    try:
        import typesafe_sdk
        print(f"✓ Python SDK: typesafe-sdk is installed ({getattr(typesafe_sdk, '__version__', 'v0.6.0')})")
        print(f"  Default Model: {typesafe_sdk.constants.DEFAULT_MODEL}")
        print(f"  API Base URL:  {typesafe_sdk.constants.DEFAULT_BASE_URL}")
    except ImportError:
        print("✗ Python SDK: typesafe-sdk is NOT installed. Run `pip install typesafe-sdk`")
        
    # 2. Node SDK
    node_installed = False
    npm_pkg = Path.home() / ".npm-global/lib/node_modules/@typesafe-ai/sdk"
    if npm_pkg.exists() or Path("/usr/local/lib/node_modules/@typesafe-ai/sdk").exists():
        node_installed = True
        print("✓ JavaScript / Node SDK: @typesafe-ai/sdk is installed globally")
    else:
        print("! JavaScript / Node SDK: @typesafe-ai/sdk not found in standard paths")
        
    # 3. Agent Skill
    skill_paths = [
        Path.home() / ".agents/skills/typesafe-ai/SKILL.md",
        Path.home() / ".gemini/config/skills/typesafe-ai/SKILL.md",
        Path("skills/typesafe-ai/SKILL.md")
    ]
    installed_skills = [str(p) for p in skill_paths if p.exists()]
    if installed_skills:
        print(f"✓ Agent Skills installed at:")
        for s in installed_skills:
            print(f"  - {s}")
    else:
        print("✗ Agent Skill: typesafe-ai not installed.")
        
    # 4. Credentials Check
    has_key = check_env_key()
    if has_key:
        print("✓ API Key Status: TYPESAFE_API_KEY detected in environment / ~/.env")
    else:
        print("! API Key Status: TYPESAFE_API_KEY is NOT set in environment or ~/.env")
        print("  To set your key securely without displaying it in chat, run:")
        print("    echo 'TYPESAFE_API_KEY=\"your_api_key_here\"' >> ~/.env")
        print("    export TYPESAFE_API_KEY=\"your_api_key_here\"")
        
    print("=" * 80)
    return 0 if has_key else 1

def run_sample_query(state_text: Optional[str] = None) -> int:
    """Run a test query through TypeSafe Jev."""
    load_env_key_if_present()
    if not os.environ.get("TYPESAFE_API_KEY"):
        print("Error: TYPESAFE_API_KEY is not set.")
        print("Please configure your key using:")
        print("  echo 'TYPESAFE_API_KEY=\"your_api_key_here\"' >> ~/.env")
        print("  export TYPESAFE_API_KEY=\"your_api_key_here\"")
        return 1
        
    from typesafe_sdk import TypeSafeClient, Noul, Choice, Score
    
    if not state_text:
        state_text = (
            "Clinical Safety Alert: 76-year-old female patient with HER2+ metastatic breast cancer "
            "scheduled for Trastuzumab Deruxtecan (Enhertu). Baseline LVEF is 42%, baseline eGFR is 38 mL/min/1.73m2. "
            "Patient reports grade 2 exertional dyspnea and persistent non-productive dry cough for 5 days."
        )
        
    print("=" * 80)
    print("EVALUATING CLINICAL STATE WITH TYPESAFE JEV (jev-latest)")
    print("=" * 80)
    print(f"State:\n{state_text}\n")
    
    questions = {
        "contraindicated_for_adc": Noul(
            instructions="Does this clinical state present severe contraindications for continuing ADC therapy?"
        ),
        "primary_organ_risk": Choice(
            instructions="Which organ system presents the most immediate clinical risk?",
            criteria={
                "cardiac": "Left ventricular ejection fraction impairment or cardiotoxicity",
                "pulmonary": "Interstitial lung disease (ILD) / pneumonitis or respiratory compromise",
                "renal": "Acute kidney injury or severe renal insufficiency",
                "hematologic": "Severe neutropenia or thrombocytopenia",
                "none": "No immediate organ toxicity detected"
            }
        ),
        "urgency_score": Score(
            instructions="How urgently does this case require clinical oncology review?",
            criteria=[
                "Routine: can be reviewed at next scheduled clinic appointment",
                "Moderate: requires non-urgent clinician consultation within 48 hours",
                "High: requires urgent same-day review before any drug administration",
                "Critical: requires emergency cessation of therapy and immediate diagnostic workup"
            ]
        )
    }
    
    print("Dispatching System One questions to Jev...")
    try:
        with TypeSafeClient() as client:
            response = client.system_one(
                state=state_text,
                questions=questions,
                model="jev-latest"
            )
            
        print("\n--- RESULTS FROM JEV (jev-latest) ---")
        print(f"Model: {response.model}")
        print(f"Usage: {response.usage}")
        
        # Noul output
        noul_ans = response.nouls["contraindicated_for_adc"]
        print(f"\n1. [Noul] Contraindicated for ADC:")
        print(f"   Probability (Yes): {noul_ans.noul:.4f}")
        
        # Choice output
        choice_ans = response.choices["primary_organ_risk"]
        print(f"\n2. [Choice] Primary Organ Risk:")
        print(f"   Selection:   {choice_ans.choice}")
        print(f"   Confidence:  {choice_ans.confidence:.4f}")
        if getattr(choice_ans, "probabilities", None):
            print(f"   Probabilities: {choice_ans.probabilities}")
            
        # Score output
        score_ans = response.scores["urgency_score"]
        print(f"\n3. [Score] Urgency Score:")
        print(f"   Level (0-based): {score_ans.score:.2f}")
        print(f"   Confidence:      {score_ans.confidence:.4f}")
        if getattr(score_ans, "probabilities", None):
            print(f"   Probabilities:   {score_ans.probabilities}")
            
        print("=" * 80)
        return 0
        
    except Exception as e:
        print(f"TypeSafe API Call failed: {e}")
        return 1

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        custom_state = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else None
        sys.exit(run_sample_query(custom_state))
    else:
        sys.exit(status())

if __name__ == "__main__":
    main()
