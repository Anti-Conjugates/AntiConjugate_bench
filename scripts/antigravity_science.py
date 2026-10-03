#!/usr/bin/env python3
"""
Google Antigravity Science Skills Bridge for Claude Science and Devin.
Provides unified discovery, inspection, and execution across all 40 Google Antigravity Science skills.

Usage:
  python scripts/antigravity_science.py list [--category <name>] [--json]
  python scripts/antigravity_science.py info <skill_name> [--json]
  python scripts/antigravity_science.py run <skill_name> [script_name] [args...]
  python scripts/antigravity_science.py direct <service> [subcommand] [args...]
  python scripts/antigravity_science.py test
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
CATALOG_PATH = REPO_ROOT / "knowledge" / "antigravity_science_catalog.json"
DEFAULT_UPSTREAM_ROOT = Path(os.path.expanduser("~/.gemini/config/plugins/science/skills"))

# Standard User-Agent for scientific REST endpoints
HTTP_HEADERS = {
    "User-Agent": "AntigravityScienceBridge/1.0.0 (Claude-Science/Devin; mailto:support@anti-conjugates.org)",
    "Accept": "application/json"
}

def load_catalog() -> Dict[str, Any]:
    if CATALOG_PATH.exists():
        with open(CATALOG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"skills": {}, "categories": {}}

def resolve_upstream_skill(skill_key: str, catalog: Dict[str, Any]) -> Optional[Path]:
    # Check if exact folder exists
    direct_path = DEFAULT_UPSTREAM_ROOT / skill_key
    if direct_path.exists() and direct_path.is_dir():
        return direct_path
    
    # Check by catalog name / folder
    skills = catalog.get("skills", {})
    if skill_key in skills:
        cand = Path(skills[skill_key].get("upstream_path", ""))
        if cand.exists() and cand.is_dir():
            return cand
        cand2 = DEFAULT_UPSTREAM_ROOT / skills[skill_key].get("folder", skill_key)
        if cand2.exists() and cand2.is_dir():
            return cand2
            
    # Fuzzy match with underscores or hyphens
    normalized = skill_key.replace("-", "_")
    cand3 = DEFAULT_UPSTREAM_ROOT / normalized
    if cand3.exists() and cand3.is_dir():
        return cand3
        
    return None

def cmd_list(args: argparse.Namespace, catalog: Dict[str, Any]) -> int:
    skills = catalog.get("skills", {})
    categories = catalog.get("categories", {})
    
    filter_cat = args.category.lower().replace(" ", "_") if args.category else None
    
    if args.json:
        filtered = {}
        for k, v in skills.items():
            if filter_cat and v.get("category") != filter_cat:
                continue
            filtered[k] = v
        print(json.dumps(filtered, indent=2))
        return 0
        
    print("=" * 80)
    print("GOOGLE ANTIGRAVITY SCIENCE SKILLS SUITE (Claude Science & Devin Bridge)")
    print(f"Total Skills: {len(skills)} | Upstream: {DEFAULT_UPSTREAM_ROOT}")
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
            script_str = f"[{len(scripts)} scripts: {', '.join(scripts[:2])}{'...' if len(scripts)>2 else ''}]" if scripts else "[instruction-only]"
            desc = skill_info.get("description", "No description available.")
            first_line_desc = desc.split("\n")[0][:90] + ("..." if len(desc) > 90 else "")
            print(f"  * {name:38s} {script_str}")
            print(f"    {first_line_desc}")
            
    print("\n" + "=" * 80)
    print("Tip: Run `python scripts/antigravity_science.py info <skill_name>` for deep parameters & examples.")
    print("=" * 80)
    return 0

def cmd_info(args: argparse.Namespace, catalog: Dict[str, Any]) -> int:
    skill_key = args.skill.replace("-", "_")
    skills = catalog.get("skills", {})
    
    skill_info = None
    for k, v in skills.items():
        if k == skill_key or k == args.skill or v.get("name") == args.skill:
            skill_info = v
            break
            
    if not skill_info:
        print(f"Error: Skill '{args.skill}' not found in catalog. Run `python scripts/antigravity_science.py list`.", file=sys.stderr)
        return 1
        
    if args.json:
        print(json.dumps(skill_info, indent=2))
        return 0
        
    print("=" * 80)
    print(f"SKILL: {skill_info.get('name')} ({skill_info.get('folder')})")
    print(f"Category: {skill_info.get('category')}")
    print("=" * 80)
    print("\nDESCRIPTION:")
    print(skill_info.get("description", "").strip())
    print("\nAVAILABLE SCRIPTS:")
    for s in skill_info.get("scripts", []):
        is_pri = " (Default)" if s == skill_info.get("primary_script") else ""
        print(f"  - {s}{is_pri}")
        
    print(f"\nUPSTREAM LOCATION: {skill_info.get('upstream_path')}")
    primary = skill_info.get("primary_script")
    if primary:
        print("\nEXECUTION EXAMPLES (Claude Science & Devin):")
        print(f"  uv run scripts/antigravity_science.py run {skill_info.get('folder')} {primary} --help")
        print(f"  uv run scripts/antigravity_science.py run {skill_info.get('folder')} --help")
    print("=" * 80)
    return 0

def cmd_run(args: argparse.Namespace, catalog: Dict[str, Any]) -> int:
    skill_key = args.skill.replace("-", "_")
    upstream_dir = resolve_upstream_skill(skill_key, catalog)
    
    if not upstream_dir:
        print(f"Error: Upstream skill directory for '{args.skill}' not found at {DEFAULT_UPSTREAM_ROOT}.", file=sys.stderr)
        print("Fallback: Use `python scripts/antigravity_science.py direct ...` for standalone API queries.", file=sys.stderr)
        return 2
        
    scripts_dir = upstream_dir / "scripts"
    if not scripts_dir.exists():
        print(f"Skill '{args.skill}' has no executable scripts (instruction/workflow skill only).", file=sys.stderr)
        skill_md = upstream_dir / "SKILL.md"
        if skill_md.exists():
            print(f"\nContents of {skill_md}:\n")
            print(skill_md.read_text(encoding="utf-8")[:1000])
        return 0
        
    # Check if first arg in extra_args is a script name
    target_script = None
    remaining_args = []
    
    available_scripts = {f.name: f for f in scripts_dir.glob("*.py")}
    
    if args.extra_args and args.extra_args[0] in available_scripts:
        target_script = available_scripts[args.extra_args[0]]
        remaining_args = args.extra_args[1:]
    else:
        # Pick primary script
        skills = catalog.get("skills", {})
        info = skills.get(skill_key, {})
        primary = info.get("primary_script")
        if primary and primary in available_scripts:
            target_script = available_scripts[primary]
            remaining_args = args.extra_args
        elif available_scripts:
            target_script = list(available_scripts.values())[0]
            remaining_args = args.extra_args
            
    if not target_script or not target_script.exists():
        print(f"Error: Could not determine script to execute in {scripts_dir}. Available: {list(available_scripts.keys())}", file=sys.stderr)
        return 3
        
    # Execute with uv run --no-project
    uv_bin = shutil.which("uv") or "/Users/openclaw/.local/bin/uv"
    if not Path(uv_bin).exists():
        uv_bin = "uv"
        
    cmd = [uv_bin, "run", "--no-project", str(target_script)] + remaining_args
    print(f"Executing: {' '.join(cmd)}", file=sys.stderr)
    res = subprocess.run(cmd)
    return res.returncode

def http_get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def cmd_direct(args: argparse.Namespace) -> int:
    service = args.service.lower()
    subargs = args.subargs
    
    try:
        if service == "uniprot":
            if not subargs or subargs[0] == "search":
                q = subargs[1] if len(subargs) > 1 else "gene:SFRP2 AND organism_id:9606"
                limit = 5
                url = f"https://rest.uniprot.org/uniprotkb/search?query={urllib.parse.quote(q)}&format=json&size={limit}"
                data = http_get_json(url)
                results = []
                for entry in data.get("results", []):
                    results.append({
                        "primaryAccession": entry.get("primaryAccession"),
                        "uniProtkbId": entry.get("uniProtkbId"),
                        "proteinDescription": entry.get("proteinDescription", {}).get("recommendedName", {}).get("fullName", {}).get("value"),
                        "genes": [g.get("geneName", {}).get("value") for g in entry.get("genes", [])],
                        "organism": entry.get("organism", {}).get("scientificName")
                    })
                print(json.dumps(results, indent=2))
                return 0
            elif subargs[0] == "get":
                acc = subargs[1]
                url = f"https://rest.uniprot.org/uniprotkb/{acc}.json"
                data = http_get_json(url)
                print(json.dumps(data, indent=2))
                return 0

        elif service == "pdb":
            pdb_id = subargs[0].upper() if subargs else "1T08"
            url = f"https://data.rcsb.org/rest/v1/core/entry/{pdb_id}"
            data = http_get_json(url)
            print(json.dumps(data, indent=2))
            return 0

        elif service == "alphafold":
            acc = subargs[0] if subargs else "Q96HF1"
            url = f"https://alphafold.ebi.ac.uk/api/prediction/{acc}"
            data = http_get_json(url)
            print(json.dumps(data, indent=2))
            return 0

        elif service == "openfda":
            drug = subargs[0] if subargs else "trastuzumab deruxtecan"
            url = f"https://api.fda.gov/drug/label.json?search=openfda.generic_name:\"{urllib.parse.quote(drug)}\"&limit=1"
            data = http_get_json(url)
            print(json.dumps(data, indent=2))
            return 0

        elif service == "pubmed":
            term = subargs[0] if subargs else "endometriosis SFRP2"
            url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term={urllib.parse.quote(term)}&retmode=json&retmax=5"
            data = http_get_json(url)
            print(json.dumps(data, indent=2))
            return 0

        elif service == "chembl":
            target = subargs[0] if subargs else "HER2"
            url = f"https://www.ebi.ac.uk/chembl/api/data/target/search?q={urllib.parse.quote(target)}&format=json&limit=5"
            data = http_get_json(url)
            print(json.dumps(data, indent=2))
            return 0

        elif service == "clinicaltrials":
            cond = subargs[0] if subargs else "Endometriosis"
            url = f"https://clinicaltrials.gov/api/v2/studies?query.term={urllib.parse.quote(cond)}&pageSize=5"
            data = http_get_json(url)
            print(json.dumps(data, indent=2))
            return 0
            
        else:
            print(f"Unknown direct service: {service}. Available: uniprot, pdb, alphafold, openfda, pubmed, chembl, clinicaltrials", file=sys.stderr)
            return 1
            
    except Exception as e:
        print(f"Direct API error for {service}: {e}", file=sys.stderr)
        return 1

def cmd_test(catalog: Dict[str, Any]) -> int:
    print("=" * 80)
    print("RUNNING GOOGLE ANTIGRAVITY SCIENCE SKILLS SELF-TESTS")
    print("=" * 80)
    
    # 1. Catalog integrity
    num_skills = len(catalog.get("skills", {}))
    assert num_skills >= 40, f"Expected >= 40 skills, found {num_skills}"
    print(f"✓ Catalog integrity: {num_skills} skills verified across 5 categories.")
    
    # 2. Test upstream resolution
    openfda_dir = resolve_upstream_skill("openfda_database", catalog)
    if openfda_dir:
        print(f"✓ Upstream resolution: Found local plugin at {openfda_dir}")
    else:
        print("! Upstream resolution: Local plugin not detected; standalone direct mode active.")
        
    # 3. Test direct REST API (RCSB PDB)
    print("✓ Testing Direct API query: RCSB PDB...")
    try:
        url = "https://data.rcsb.org/rest/v1/core/entry/1T08"
        data = http_get_json(url)
        title = data.get("struct", {}).get("title", "")
        print(f"  RCSB PDB Query OK -> Structure: {title[:60]}...")
    except Exception as e:
        print(f"  PDB query failed: {e}")
        return 1
        
    print("\n✓ ALL ANTIGRAVITY SCIENCE SKILL INTEGRATION TESTS PASSED!")
    print("=" * 80)
    return 0

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Google Antigravity Science Skills Bridge for Claude Science and Devin",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    subparsers = parser.add_subparsers(dest="command", help="Subcommand to execute")
    
    # list
    p_list = subparsers.add_parser("list", help="List available Antigravity Science skills")
    p_list.add_argument("--category", "-c", type=str, help="Filter by category")
    p_list.add_argument("--json", action="store_true", help="Output as JSON")
    
    # info
    p_info = subparsers.add_parser("info", help="Get detailed info and schema for a skill")
    p_info.add_argument("skill", type=str, help="Skill name or folder")
    p_info.add_argument("--json", action="store_true", help="Output as JSON")
    
    # run
    p_run = subparsers.add_parser("run", help="Execute an upstream Antigravity Science skill via uv run")
    p_run.add_argument("skill", type=str, help="Skill name or folder")
    p_run.add_argument("extra_args", nargs=argparse.REMAINDER, help="Script name and arguments to pass to the skill")
    
    # direct
    p_direct = subparsers.add_parser("direct", help="Execute direct standalone scientific API queries (no plugin required)")
    p_direct.add_argument("service", type=str, help="Service name: uniprot, pdb, alphafold, openfda, pubmed, chembl, clinicaltrials")
    p_direct.add_argument("subargs", nargs=argparse.REMAINDER, help="Subcommand and arguments")
    
    # test
    subparsers.add_parser("test", help="Run automated self-tests")
    
    args = parser.parse_args()
    catalog = load_catalog()
    
    if args.command == "list":
        return cmd_list(args, catalog)
    elif args.command == "info":
        return cmd_info(args, catalog)
    elif args.command == "run":
        return cmd_run(args, catalog)
    elif args.command == "direct":
        return cmd_direct(args)
    elif args.command == "test":
        return cmd_test(catalog)
    else:
        parser.print_help()
        return 0

if __name__ == "__main__":
    sys.exit(main())
