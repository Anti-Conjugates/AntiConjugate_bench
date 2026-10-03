#!/usr/bin/env python3
"""
Google Antigravity Science Skills Master CLI for Hermes Agent
Unified CLI dispatcher across all 40 scientific skills in genomics, structural biology,
cheminformatics, pharmacology, oncology safety, scientific literature, and quantum chemistry.

Supported subcommands:
  list, info, run, pdb, alphafold, uniprot, string, chembl, pubchem, openfda,
  clinicaltrials, pubmed, arxiv, europepmc, openalex, ensembl, clinvar, jaspar,
  adc-guardrail, typesafe-jev, test
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
REFERENCES_DIR = SKILL_ROOT / "references"
CATALOG_PATH = REFERENCES_DIR / "catalog.json"
UPSTREAM_ROOT = Path(os.path.expanduser("~/.gemini/config/plugins/science/skills"))

def load_catalog() -> Dict[str, Any]:
    if CATALOG_PATH.exists():
        with open(CATALOG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"skills": {}, "categories": {}}

def cmd_list(args: argparse.Namespace, catalog: Dict[str, Any]) -> int:
    skills = catalog.get("skills", {})
    categories = catalog.get("categories", {})
    filter_cat = args.category.lower().replace(" ", "_") if args.category else None

    if args.json:
        filtered = {k: v for k, v in skills.items() if not filter_cat or v.get("category") == filter_cat}
        print(json.dumps(filtered, indent=2))
        return 0

    print("=" * 80)
    print("GOOGLE ANTIGRAVITY SCIENCE SKILLS SUITE (Nous Hermes Agent Bridge)")
    print(f"Total Skills: {len(skills)} across {len(categories)} categories")
    print("=" * 80)

    for cat_key, cat_data in categories.items():
        if filter_cat and cat_key != filter_cat:
            continue
        print(f"\n📂 CATEGORY: {cat_data.get('title', cat_key).upper()}")
        print("-" * 80)
        for skill_folder in cat_data.get("skills", []):
            skill_info = skills.get(skill_folder, {})
            name = skill_info.get("name", skill_folder)
            scripts = skill_info.get("scripts", [])
            script_str = f"[{len(scripts)} scripts]" if scripts else "[core-runner]"
            desc = skill_info.get("description", "").split("\n")[0][:80]
            print(f"  * {name:38s} {script_str} - {desc}")
    print("\n" + "=" * 80)
    return 0

def cmd_info(args: argparse.Namespace, catalog: Dict[str, Any]) -> int:
    skills = catalog.get("skills", {})
    query = args.skill.lower().replace("_", "-")
    
    matched_key = None
    for k in skills:
        if k.lower() == query or k.lower().replace("_", "-") == query or skills[k].get("name", "").lower() == query:
            matched_key = k
            break

    if not matched_key:
        print(f"Skill '{args.skill}' not found in catalog. Run 'antigravity_science.py list' to inspect available skills.", file=sys.stderr)
        return 1

    info = skills[matched_key]
    if args.json:
        print(json.dumps(info, indent=2))
        return 0

    print("=" * 80)
    print(f"SKILL: {info.get('name', matched_key).upper()} ({matched_key})")
    print("=" * 80)
    print(f"Category:     {info.get('category')}")
    print(f"Description:  {info.get('description')}")
    print(f"Upstream Dir: {info.get('upstream_path')}")
    print(f"Scripts:      {', '.join(info.get('scripts', [])) or 'None (Instruction/Direct API)'}")
    print("=" * 80)
    return 0

def run_python_script(script_name: str, script_args: List[str]) -> int:
    script_file = SCRIPT_DIR / script_name
    if not script_file.exists():
        print(f"Error: Script {script_file} not found.", file=sys.stderr)
        return 1
    cmd = [sys.executable, str(script_file)] + script_args
    return subprocess.run(cmd).returncode

def main() -> int:
    catalog = load_catalog()

    parser = argparse.ArgumentParser(
        description="Google Antigravity Science Skills Master CLI for Hermes Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    subparsers = parser.add_subparsers(dest="subcommand", help="Subcommand to execute")

    # list
    p_list = subparsers.add_parser("list", help="List all 40 Antigravity Science skills")
    p_list.add_argument("--category", "-c", type=str, help="Filter by category")
    p_list.add_argument("--json", action="store_true", help="Output JSON")

    # info
    p_info = subparsers.add_parser("info", help="Get detailed info and schema for a skill")
    p_info.add_argument("skill", type=str, help="Skill name or key")
    p_info.add_argument("--json", action="store_true", help="Output JSON")

    # run (upstream runner)
    p_run = subparsers.add_parser("run", help="Execute an upstream skill script via uv run")
    p_run.add_argument("skill", type=str, help="Skill name or folder")
    p_run.add_argument("args", nargs=argparse.REMAINDER, help="Script name and args")

    # pdb
    p_pdb = subparsers.add_parser("pdb", help="Query RCSB PDB structure")
    p_pdb.add_argument("pdb_id", type=str, help="PDB ID (e.g. 1T08)")

    # alphafold
    p_af = subparsers.add_parser("alphafold", help="Query AlphaFold DB structure prediction")
    p_af.add_argument("uniprot_id", type=str, help="UniProt accession (e.g. Q96HF1)")

    # uniprot
    p_uni = subparsers.add_parser("uniprot", help="Query UniProtKB protein record")
    p_uni.add_argument("query", type=str, help="Accession or query (e.g. Q96HF1 or gene:SFRP2)")

    # string
    p_str = subparsers.add_parser("string", help="Query STRING PPI partners")
    p_str.add_argument("protein", type=str, help="Protein name (e.g. SFRP2)")

    # chembl
    p_chembl = subparsers.add_parser("chembl", help="Query ChEMBL database")
    p_chembl.add_argument("type", choices=["target", "molecule"], help="Entity type")
    p_chembl.add_argument("term", type=str, help="Search term")

    # pubchem
    p_pc = subparsers.add_parser("pubchem", help="Query PubChem compound")
    p_pc.add_argument("name", type=str, help="Compound name")

    # openfda
    p_fda = subparsers.add_parser("openfda", help="Query openFDA drug label or adverse events")
    p_fda.add_argument("type", choices=["label", "adverse"], help="Type of FDA data")
    p_fda.add_argument("drug", type=str, help="Drug generic or brand name")
    p_fda.add_argument("--limit", type=int, default=5)

    # clinicaltrials
    p_ct = subparsers.add_parser("clinicaltrials", help="Query ClinicalTrials.gov")
    p_ct.add_argument("term", type=str, help="Condition or intervention")
    p_ct.add_argument("--limit", type=int, default=5)

    # pubmed
    p_pm = subparsers.add_parser("pubmed", help="Query PubMed")
    p_pm.add_argument("query", type=str, help="Search term")
    p_pm.add_argument("--limit", type=int, default=5)

    # arxiv
    p_ar = subparsers.add_parser("arxiv", help="Query arXiv")
    p_ar.add_argument("query", type=str, help="Search query")
    p_ar.add_argument("--limit", type=int, default=5)

    # europepmc
    p_epmc = subparsers.add_parser("europepmc", help="Query Europe PMC")
    p_epmc.add_argument("query", type=str, help="Search term")
    p_epmc.add_argument("--limit", type=int, default=5)

    # openalex
    p_oa = subparsers.add_parser("openalex", help="Query OpenAlex")
    p_oa.add_argument("query", type=str, help="Search term")
    p_oa.add_argument("--limit", type=int, default=5)

    # ensembl
    p_ens = subparsers.add_parser("ensembl", help="Query Ensembl REST API")
    p_ens.add_argument("cmd", choices=["lookup", "sequence"], help="Ensembl operation")
    p_ens.add_argument("identifier", type=str, help="Gene symbol or Ensembl ID")
    p_ens.add_argument("--type", choices=["genomic", "cdna", "protein"], default="genomic")

    # clinvar
    p_cv = subparsers.add_parser("clinvar", help="Query ClinVar pathogenicity")
    p_cv.add_argument("gene", type=str, help="Gene symbol")
    p_cv.add_argument("--limit", type=int, default=5)

    # jaspar
    p_jp = subparsers.add_parser("jaspar", help="Query JASPAR TF binding profiles")
    p_jp.add_argument("symbol", type=str, help="TF symbol")

    # adc-guardrail
    p_adc = subparsers.add_parser("adc-guardrail", help="Evaluate oncology ADC prescribing safety")
    p_adc.add_argument("--drug", "-d", type=str, default="Enhertu", help="ADC name")
    p_adc.add_argument("--age", type=int, default=70)
    p_adc.add_argument("--sex", type=str, default="F")
    p_adc.add_argument("--lvef", type=float)
    p_adc.add_argument("--egfr", type=float)
    p_adc.add_argument("--platelets", type=int)
    p_adc.add_argument("--anc", type=int)
    p_adc.add_argument("--cough", action="store_true")
    p_adc.add_argument("--dyspnea", action="store_true")
    p_adc.add_argument("--ugt1a1", type=str)
    p_adc.add_argument("--json", action="store_true")

    # typesafe-jev
    p_jev = subparsers.add_parser("typesafe-jev", help="TypeSafe AI Jev System One evaluator")
    p_jev.add_argument("action", choices=["status", "triage", "verify", "run"], default="status", nargs="?")

    # test
    subparsers.add_parser("test", help="Run automated self-tests across scientific services")

    args = parser.parse_args()

    if args.subcommand == "list":
        return cmd_list(args, catalog)
    elif args.subcommand == "info":
        return cmd_info(args, catalog)
    elif args.subcommand == "pdb":
        return run_python_script("protein_structure.py", ["pdb", args.pdb_id])
    elif args.subcommand == "alphafold":
        return run_python_script("protein_structure.py", ["alphafold", args.uniprot_id])
    elif args.subcommand == "uniprot":
        return run_python_script("protein_structure.py", ["uniprot", args.query])
    elif args.subcommand == "string":
        return run_python_script("protein_structure.py", ["string", args.protein])
    elif args.subcommand == "chembl":
        return run_python_script("cheminformatics_pharmacology.py", ["chembl", args.type, args.term])
    elif args.subcommand == "pubchem":
        return run_python_script("cheminformatics_pharmacology.py", ["pubchem", args.name])
    elif args.subcommand == "openfda":
        return run_python_script("cheminformatics_pharmacology.py", ["openfda", args.type, args.drug, "--limit", str(args.limit)])
    elif args.subcommand == "clinicaltrials":
        return run_python_script("cheminformatics_pharmacology.py", ["clinicaltrials", args.term, "--limit", str(args.limit)])
    elif args.subcommand == "pubmed":
        return run_python_script("literature_search.py", ["pubmed", args.query, "--limit", str(args.limit)])
    elif args.subcommand == "arxiv":
        return run_python_script("literature_search.py", ["arxiv", args.query, "--limit", str(args.limit)])
    elif args.subcommand == "europepmc":
        return run_python_script("literature_search.py", ["europepmc", args.query, "--limit", str(args.limit)])
    elif args.subcommand == "openalex":
        return run_python_script("literature_search.py", ["openalex", args.query, "--limit", str(args.limit)])
    elif args.subcommand == "ensembl":
        ens_args = [args.cmd, args.identifier]
        if args.cmd == "sequence":
            ens_args += ["--type", args.type]
        return run_python_script("genomics_bridge.py", ens_args)
    elif args.subcommand == "clinvar":
        return run_python_script("genomics_bridge.py", ["clinvar", args.gene, "--limit", str(args.limit)])
    elif args.subcommand == "jaspar":
        return run_python_script("genomics_bridge.py", ["jaspar", args.symbol])
    elif args.subcommand == "adc-guardrail":
        adc_args = ["--drug", args.drug, "--age", str(args.age), "--sex", args.sex]
        if args.lvef is not None:
            adc_args += ["--lvef", str(args.lvef)]
        if args.egfr is not None:
            adc_args += ["--egfr", str(args.egfr)]
        if args.platelets is not None:
            adc_args += ["--platelets", str(args.platelets)]
        if args.anc is not None:
            adc_args += ["--anc", str(args.anc)]
        if args.cough:
            adc_args.append("--cough")
        if args.dyspnea:
            adc_args.append("--dyspnea")
        if args.ugt1a1:
            adc_args += ["--ugt1a1", args.ugt1a1]
        if args.json:
            adc_args.append("--json")
        return run_python_script("adc_safety_evaluator.py", adc_args)
    elif args.subcommand == "typesafe-jev":
        action = args.action or "status"
        return run_python_script("typesafe_jev_evaluator.py", [action])
    elif args.subcommand == "test":
        print("=" * 80)
        print("HERMES GOOGLE ANTIGRAVITY SCIENCE INTEGRATION SUITE TEST")
        print("=" * 80)
        print("1. Testing Catalog...")
        assert len(catalog.get("skills", {})) >= 40
        print(f"   ✓ Catalog verified with {len(catalog.get('skills', {}))} skills.")
        print("2. Testing RCSB PDB Structure API...")
        ret = run_python_script("protein_structure.py", ["pdb", "1T08"])
        assert ret == 0, "PDB test failed"
        print("3. Testing AlphaFold DB Prediction API...")
        ret = run_python_script("protein_structure.py", ["alphafold", "Q96HF1"])
        assert ret == 0, "AlphaFold test failed"
        print("4. Testing Ensembl Genomics API...")
        ret = run_python_script("genomics_bridge.py", ["lookup", "SFRP2"])
        assert ret == 0, "Ensembl test failed"
        print("5. Testing ADC Prescribing Safety Evaluator...")
        ret = run_python_script("adc_safety_evaluator.py", ["--drug", "Enhertu", "--lvef", "40", "--cough"])
        assert ret == 0, "ADC guardrail test failed"
        print("\n✓ ALL HERMES SCIENTIFIC ENGINE TESTS COMPLETED SUCCESSFULLY!")
        print("=" * 80)
        return 0
    else:
        parser.print_help()
        return 0

if __name__ == "__main__":
    sys.exit(main())
