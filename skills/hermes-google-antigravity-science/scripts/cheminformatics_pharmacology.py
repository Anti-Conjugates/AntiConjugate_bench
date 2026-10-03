#!/usr/bin/env python3
"""
Cheminformatics and Pharmacology Runner for Hermes Agent.
Covers: ChEMBL, PubChem, openFDA, ClinicalTrials.gov API v2.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

HTTP_HEADERS = {
    "User-Agent": "Hermes-AntigravityScience/2.0.0 (Nous Research Hermes; mailto:science@openclaw.ai)",
    "Accept": "application/json"
}

def http_get_json(url: str, timeout: int = 30) -> Any:
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def query_chembl_target(term: str) -> List[Dict[str, Any]]:
    url = f"https://www.ebi.ac.uk/chembl/api/data/target/search?q={urllib.parse.quote(term)}&format=json&limit=5"
    data = http_get_json(url)
    targets = []
    for t in data.get("targets", []):
        targets.append({
            "target_chembl_id": t.get("target_chembl_id"),
            "pref_name": t.get("pref_name"),
            "target_type": t.get("target_type"),
            "organism": t.get("organism")
        })
    return targets

def query_chembl_molecule(term: str) -> List[Dict[str, Any]]:
    url = f"https://www.ebi.ac.uk/chembl/api/data/molecule/search?q={urllib.parse.quote(term)}&format=json&limit=5"
    data = http_get_json(url)
    molecules = []
    for m in data.get("molecules", []):
        props = m.get("molecule_properties") or {}
        molecules.append({
            "molecule_chembl_id": m.get("molecule_chembl_id"),
            "pref_name": m.get("pref_name"),
            "molecule_type": m.get("molecule_type"),
            "max_phase": m.get("max_phase"),
            "full_mwt": props.get("full_mwt"),
            "alogp": props.get("alogp"),
            "smiles": m.get("molecule_structures", {}).get("canonical_smiles") if m.get("molecule_structures") else None
        })
    return molecules

def query_pubchem(compound_name: str) -> Dict[str, Any]:
    name = compound_name.strip()
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{urllib.parse.quote(name)}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON"
    data = http_get_json(url)
    props = data.get("PropertyTable", {}).get("Properties", [{}])[0]
    return {
        "compound_name": name,
        "cid": props.get("CID"),
        "formula": props.get("MolecularFormula"),
        "molecular_weight": props.get("MolecularWeight"),
        "canonical_smiles": props.get("CanonicalSMILES"),
        "iupac_name": props.get("IUPACName"),
        "pubchem_url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{props.get('CID')}" if props.get("CID") else None
    }

def query_openfda_label(drug_name: str) -> Dict[str, Any]:
    url = f"https://api.fda.gov/drug/label.json?search=openfda.generic_name:\"{urllib.parse.quote(drug_name)}\"+openfda.brand_name:\"{urllib.parse.quote(drug_name)}\"&limit=1"
    try:
        data = http_get_json(url)
    except Exception:
        # Fallback to broad search
        url = f"https://api.fda.gov/drug/label.json?search=\"{urllib.parse.quote(drug_name)}\"&limit=1"
        data = http_get_json(url)
        
    res = data.get("results", [{}])[0]
    openfda = res.get("openfda", {})
    return {
        "drug_query": drug_name,
        "brand_name": openfda.get("brand_name", []),
        "generic_name": openfda.get("generic_name", []),
        "boxed_warning": res.get("boxed_warning", ["None listed"])[0][:800] if res.get("boxed_warning") else None,
        "warnings_and_cautions": res.get("warnings_and_precautions", ["None listed"])[0][:800] if res.get("warnings_and_precautions") else None,
        "indications_and_usage": res.get("indications_and_usage", ["None listed"])[0][:600] if res.get("indications_and_usage") else None
    }

def query_openfda_adverse(drug_name: str, limit: int = 5) -> List[Dict[str, Any]]:
    url = f"https://api.fda.gov/drug/event.json?search=patient.drug.medicinalproduct:\"{urllib.parse.quote(drug_name)}\"&count=patient.reaction.reactionmeddrapt.exact&limit={limit}"
    data = http_get_json(url)
    results = []
    for item in data.get("results", []):
        results.append({
            "reaction": item.get("term"),
            "reported_cases": item.get("count")
        })
    return results

def query_clinical_trials(term: str, page_size: int = 5) -> List[Dict[str, Any]]:
    url = f"https://clinicaltrials.gov/api/v2/studies?query.term={urllib.parse.quote(term)}&pageSize={page_size}"
    data = http_get_json(url)
    studies = []
    for item in data.get("studies", []):
        protocol = item.get("protocolSection", {})
        id_module = protocol.get("identificationModule", {})
        status_module = protocol.get("statusModule", {})
        design_module = protocol.get("designModule", {})
        conditions_module = protocol.get("conditionsModule", {})
        
        phases = design_module.get("phases", [])
        studies.append({
            "nct_id": id_module.get("nctId"),
            "title": id_module.get("briefTitle"),
            "status": status_module.get("overallStatus"),
            "phases": phases,
            "conditions": conditions_module.get("conditions", []),
            "url": f"https://clinicaltrials.gov/study/{id_module.get('nctId')}"
        })
    return studies

def main():
    parser = argparse.ArgumentParser(description="Cheminformatics and Pharmacology Runner for Hermes")
    subparsers = parser.add_subparsers(dest="cmd")

    p_chembl = subparsers.add_parser("chembl", help="Query ChEMBL database")
    p_chembl.add_argument("type", choices=["target", "molecule"], help="Entity type to query")
    p_chembl.add_argument("term", type=str, help="Search query (e.g. HER2 or Trastuzumab)")

    p_pubchem = subparsers.add_parser("pubchem", help="Query PubChem compound properties")
    p_pubchem.add_argument("name", type=str, help="Compound name (e.g. Tamoxifen, Aspirin)")

    p_fda = subparsers.add_parser("openfda", help="Query openFDA drug labels and adverse events")
    p_fda.add_argument("type", choices=["label", "adverse"], help="Type of FDA data")
    p_fda.add_argument("drug", type=str, help="Drug generic or brand name")
    p_fda.add_argument("--limit", type=int, default=5, help="Result limit")

    p_trials = subparsers.add_parser("clinicaltrials", help="Query ClinicalTrials.gov")
    p_trials.add_argument("term", type=str, help="Condition, drug, or intervention name")
    p_trials.add_argument("--limit", type=int, default=5, help="Number of studies to retrieve")

    args = parser.parse_args()
    if args.cmd == "chembl":
        if args.type == "target":
            print(json.dumps(query_chembl_target(args.term), indent=2))
        else:
            print(json.dumps(query_chembl_molecule(args.term), indent=2))
    elif args.cmd == "pubchem":
        print(json.dumps(query_pubchem(args.name), indent=2))
    elif args.cmd == "openfda":
        if args.type == "label":
            print(json.dumps(query_openfda_label(args.drug), indent=2))
        else:
            print(json.dumps(query_openfda_adverse(args.drug, args.limit), indent=2))
    elif args.cmd == "clinicaltrials":
        print(json.dumps(query_clinical_trials(args.term, args.limit), indent=2))
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
