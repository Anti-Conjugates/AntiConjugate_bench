#!/usr/bin/env python3
"""
Genomics and Regulatory Analysis Runner for Hermes Agent.
Covers: Ensembl REST API, dbSNP, ClinVar, JASPAR TF binding profiles.
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

def query_ensembl_symbol(symbol: str, species: str = "homo_sapiens") -> Dict[str, Any]:
    sym = symbol.strip().upper()
    url = f"https://rest.ensembl.org/lookup/symbol/{species}/{sym}?expand=1"
    data = http_get_json(url)
    transcripts = []
    for t in data.get("Transcript", []):
        transcripts.append({
            "id": t.get("id"),
            "display_name": t.get("display_name"),
            "biotype": t.get("biotype"),
            "length": t.get("length"),
            "is_canonical": bool(t.get("is_canonical"))
        })
    return {
        "symbol": sym,
        "id": data.get("id"),
        "species": data.get("species"),
        "biotype": data.get("biotype"),
        "chromosome": data.get("seq_region_name"),
        "start": data.get("start"),
        "end": data.get("end"),
        "strand": data.get("strand"),
        "description": data.get("description"),
        "canonical_transcript": next((t["id"] for t in transcripts if t["is_canonical"]), None),
        "transcript_count": len(transcripts),
        "transcripts": transcripts[:5]
    }

def query_ensembl_sequence(gene_or_transcript_id: str, seq_type: str = "genomic") -> Dict[str, Any]:
    ident = gene_or_transcript_id.strip()
    url = f"https://rest.ensembl.org/sequence/id/{ident}?type={seq_type}"
    data = http_get_json(url)
    seq = data.get("seq", "")
    return {
        "id": ident,
        "type": seq_type,
        "length_bp": len(seq),
        "sequence_preview": seq[:100] + "..." if len(seq) > 100 else seq,
        "gc_content_pct": round((seq.count("G") + seq.count("C")) / len(seq) * 100, 2) if seq else 0.0
    }

def query_clinvar(gene: str, limit: int = 5) -> List[Dict[str, Any]]:
    # Search ClinVar via E-utilities
    search_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term={urllib.parse.quote(gene)}[gene]&retmode=json&retmax={limit}"
    data = http_get_json(search_url)
    id_list = data.get("esearchresult", {}).get("idlist", [])
    if not id_list:
        return []

    sum_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id={','.join(id_list)}&retmode=json"
    sum_data = http_get_json(sum_url)
    result_dict = sum_data.get("result", {})

    records = []
    for cid in id_list:
        entry = result_dict.get(cid, {})
        records.append({
            "clinvar_id": cid,
            "title": entry.get("title"),
            "clinical_significance": entry.get("germline_classification", {}).get("description") or entry.get("clinical_significance", {}).get("description"),
            "variation_type": entry.get("variation_set", [{}])[0].get("variant_type") if entry.get("variation_set") else None,
            "molecular_consequence": entry.get("molecular_consequence_list", []),
            "url": f"https://www.ncbi.nlm.nih.gov/clinvar/variation/{cid}/"
        })
    return records

def query_jaspar_tf(symbol: str) -> List[Dict[str, Any]]:
    sym = symbol.strip().upper()
    url = f"https://jaspar.elixir.no/api/v1/matrix/?search={urllib.parse.quote(sym)}&format=json"
    data = http_get_json(url)
    results = []
    for item in data.get("results", []):
        results.append({
            "matrix_id": item.get("matrix_id"),
            "name": item.get("name"),
            "collection": item.get("collection"),
            "base_id": item.get("base_id"),
            "version": item.get("version"),
            "species": [s.get("name") for s in item.get("species", [])]
        })
    return results

def main():
    parser = argparse.ArgumentParser(description="Genomics and Regulatory Analysis Runner for Hermes")
    subparsers = parser.add_subparsers(dest="cmd")

    p_sym = subparsers.add_parser("lookup", help="Ensembl gene symbol lookup")
    p_sym.add_argument("symbol", type=str, help="Gene symbol (e.g. SFRP2 or ERBB2)")

    p_seq = subparsers.add_parser("sequence", help="Ensembl sequence fetch")
    p_seq.add_argument("id", type=str, help="Ensembl ID (e.g. ENSG00000145423)")
    p_seq.add_argument("--type", choices=["genomic", "cdna", "protein"], default="genomic")

    p_cv = subparsers.add_parser("clinvar", help="ClinVar pathogenicity search")
    p_cv.add_argument("gene", type=str, help="Gene symbol")
    p_cv.add_argument("--limit", type=int, default=5)

    p_tf = subparsers.add_parser("jaspar", help="JASPAR TF binding profile search")
    p_tf.add_argument("symbol", type=str, help="TF symbol (e.g. ESR1, SOX9, TP53)")

    args = parser.parse_args()
    if args.cmd == "lookup":
        print(json.dumps(query_ensembl_symbol(args.symbol), indent=2))
    elif args.cmd == "sequence":
        print(json.dumps(query_ensembl_sequence(args.id, args.type), indent=2))
    elif args.cmd == "clinvar":
        print(json.dumps(query_clinvar(args.gene, args.limit), indent=2))
    elif args.cmd == "jaspar":
        print(json.dumps(query_jaspar_tf(args.symbol), indent=2))
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
