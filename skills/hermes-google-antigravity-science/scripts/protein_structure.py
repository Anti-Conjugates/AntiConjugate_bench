#!/usr/bin/env python3
"""
Structural Biology and Protein Analysis Runner for Hermes Agent.
Covers: RCSB PDB, AlphaFold DB, UniProtKB, STRING DB, InterPro.
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

def query_pdb(pdb_id: str) -> Dict[str, Any]:
    pid = pdb_id.strip().upper()
    url = f"https://data.rcsb.org/rest/v1/core/entry/{pid}"
    data = http_get_json(url)
    
    struct = data.get("struct", {})
    expt = data.get("exptl", [{}])[0] if data.get("exptl") else {}
    refine = data.get("refine", [{}])[0] if data.get("refine") else {}
    rcsb_entry = data.get("rcsb_entry_info", {})
    
    return {
        "pdb_id": pid,
        "title": struct.get("title"),
        "method": expt.get("method"),
        "resolution_angstrom": refine.get("ls_d_res_high") or expt.get("resolution"),
        "deposition_date": rcsb_entry.get("initial_release_date"),
        "polymer_count": rcsb_entry.get("polymer_composition"),
        "molecular_weight_kda": rcsb_entry.get("molecular_weight"),
        "download_cif": f"https://files.rcsb.org/download/{pid}.cif",
        "download_pdb": f"https://files.rcsb.org/download/{pid}.pdb"
    }

def query_alphafold(uniprot_id: str) -> Dict[str, Any]:
    acc = uniprot_id.strip().upper()
    url = f"https://alphafold.ebi.ac.uk/api/prediction/{acc}"
    data = http_get_json(url)
    
    if not isinstance(data, list) or len(data) == 0:
        return {"error": f"No AlphaFold prediction found for UniProt accession {acc}"}
        
    pred = data[0]
    return {
        "uniprot_accession": acc,
        "gene": pred.get("gene"),
        "organism": pred.get("organismScientificName"),
        "sequence_length": pred.get("uniprotEnd"),
        "global_plddt": pred.get("globalMetricValue"),
        "plddt_tier": "Very High (>90)" if (pred.get("globalMetricValue") or 0) > 90 else (
            "High (70-90)" if (pred.get("globalMetricValue") or 0) > 70 else (
                "Low (50-70)" if (pred.get("globalMetricValue") or 0) > 50 else "Very Low (<50)"
            )
        ),
        "cif_url": pred.get("cifUrl"),
        "pdb_url": pred.get("pdbUrl"),
        "pae_image_url": pred.get("paeImageUrl")
    }

def query_uniprot(identifier: str) -> Dict[str, Any]:
    ident = identifier.strip()
    # If looks like accession (e.g. Q96HF1 or P04626)
    if len(ident) in (6, 10) and not " " in ident and not ":" in ident:
        try:
            url = f"https://rest.uniprot.org/uniprotkb/{ident}.json"
            entry = http_get_json(url)
            genes = [g.get("geneName", {}).get("value") for g in entry.get("genes", [])]
            name = entry.get("proteinDescription", {}).get("recommendedName", {}).get("fullName", {}).get("value")
            comments = entry.get("comments", [])
            function_txt = ""
            for c in comments:
                if c.get("commentType") == "FUNCTION":
                    for t in c.get("texts", []):
                        function_txt += t.get("value", "") + " "
            return {
                "accession": entry.get("primaryAccession"),
                "id": entry.get("uniProtkbId"),
                "name": name,
                "genes": genes,
                "organism": entry.get("organism", {}).get("scientificName"),
                "length": entry.get("sequence", {}).get("length"),
                "function": function_txt.strip()[:600] + ("..." if len(function_txt) > 600 else "")
            }
        except Exception:
            pass
            
    # Fallback to search
    url = f"https://rest.uniprot.org/uniprotkb/search?query={urllib.parse.quote(ident)}&format=json&size=5"
    data = http_get_json(url)
    results = []
    for entry in data.get("results", []):
        results.append({
            "accession": entry.get("primaryAccession"),
            "id": entry.get("uniProtkbId"),
            "name": entry.get("proteinDescription", {}).get("recommendedName", {}).get("fullName", {}).get("value"),
            "genes": [g.get("geneName", {}).get("value") for g in entry.get("genes", [])],
            "organism": entry.get("organism", {}).get("scientificName")
        })
    return {"query": ident, "results": results}

def query_string_ppi(protein: str, species: int = 9606) -> List[Dict[str, Any]]:
    prot = protein.strip()
    url = f"https://string-db.org/api/json/interaction_partners?identifiers={urllib.parse.quote(prot)}&species={species}&limit=10"
    data = http_get_json(url)
    partners = []
    for row in data:
        partners.append({
            "protein_a": row.get("preferredName_A"),
            "protein_b": row.get("preferredName_B"),
            "combined_score": row.get("score"),
            "experimental_score": row.get("escore"),
            "database_score": row.get("dscore")
        })
    return partners

def main():
    parser = argparse.ArgumentParser(description="Structural Biology Runner for Hermes")
    subparsers = parser.add_subparsers(dest="cmd")

    p_pdb = subparsers.add_parser("pdb", help="Query RCSB PDB structure")
    p_pdb.add_argument("pdb_id", type=str, help="4-character PDB code (e.g. 1T08)")

    p_af = subparsers.add_parser("alphafold", help="Query AlphaFold DB structure prediction")
    p_af.add_argument("uniprot_id", type=str, help="UniProt accession (e.g. Q96HF1)")

    p_uni = subparsers.add_parser("uniprot", help="Query UniProtKB protein record")
    p_uni.add_argument("query", type=str, help="Accession (e.g. P04626) or gene query (e.g. gene:SFRP2)")

    p_string = subparsers.add_parser("string", help="Query STRING PPI partners")
    p_string.add_argument("protein", type=str, help="Protein name (e.g. SFRP2 or ERBB2)")
    p_string.add_argument("--species", type=int, default=9606, help="NCBI Taxon ID (default 9606 for Human)")

    args = parser.parse_args()
    if args.cmd == "pdb":
        res = query_pdb(args.pdb_id)
        print(json.dumps(res, indent=2))
    elif args.cmd == "alphafold":
        res = query_alphafold(args.uniprot_id)
        print(json.dumps(res, indent=2))
    elif args.cmd == "uniprot":
        res = query_uniprot(args.query)
        print(json.dumps(res, indent=2))
    elif args.cmd == "string":
        res = query_string_ppi(args.protein, args.species)
        print(json.dumps(res, indent=2))
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
