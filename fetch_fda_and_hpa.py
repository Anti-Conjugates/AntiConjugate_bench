#!/usr/bin/env python3
"""
fetch_fda_and_hpa.py - Team AntiConjugate
Fetches ground truth data from openFDA and Human Protein Atlas (HPA)
for key Antibody-Drug Conjugates (ADCs) and their target antigens.
"""

import json
import os
import ssl
import sys
import time
import urllib.request
import urllib.parse

# Resolve macOS Python SSL certificate verification issue
SSL_CONTEXT = ssl._create_unverified_context()

OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json"
HPA_SEARCH_URL = "https://www.proteinatlas.org/api/search_download.php"

TARGET_ADCS = [
    {
        "brand_name": "Enhertu",
        "generic_name": "trastuzumab deruxtecan",
        "target": "HER2",
        "target_gene": "ERBB2",
        "payload": "DXd",
        "payload_class": "Topoisomerase I inhibitor (Exatecan derivative)",
        "linker": "Cleavable (maleimide tetrapeptide)",
        "dar": 8
    },
    {
        "brand_name": "Kadcyla",
        "generic_name": "ado-trastuzumab emtansine",
        "target": "HER2",
        "target_gene": "ERBB2",
        "payload": "DM1",
        "payload_class": "Microtubule inhibitor (Maytansinoid)",
        "linker": "Non-cleavable (MCC / thioether)",
        "dar": 3.5
    },
    {
        "brand_name": "Trodelvy",
        "generic_name": "sacituzumab govitecan",
        "target": "TROP2",
        "target_gene": "TACSTD2",
        "payload": "SN-38",
        "payload_class": "Topoisomerase I inhibitor (Camptothecin derivative)",
        "linker": "Cleavable (hydrolyzable CL2A linker)",
        "dar": 7.6
    },
    {
        "brand_name": "Adcetris",
        "generic_name": "brentuximab vedotin",
        "target": "CD30",
        "target_gene": "TNFRSF8",
        "payload": "MMAE",
        "payload_class": "Microtubule inhibitor (Monomethyl auristatin E)",
        "linker": "Cleavable (protease-cleavable val-cit)",
        "dar": 4
    },
    {
        "brand_name": "Padcev",
        "generic_name": "enfortumab vedotin",
        "target": "Nectin-4",
        "target_gene": "NECTIN4",
        "payload": "MMAE",
        "payload_class": "Microtubule inhibitor (Monomethyl auristatin E)",
        "linker": "Cleavable (protease-cleavable val-cit)",
        "dar": 3.8
    }
]

HPA_GENES = [
    {"gene": "ERBB2", "ensembl": "ENSG00000141736", "target": "HER2"},
    {"gene": "TACSTD2", "ensembl": "ENSG00000184292", "target": "TROP2"},
    {"gene": "NECTIN4", "ensembl": "ENSG00000143217", "target": "Nectin-4"},
    {"gene": "TNFRSF8", "ensembl": "ENSG00000120949", "target": "CD30"}
]


def fetch_openfda_label(drug_name):
    """Query openFDA for drug label sections."""
    query = f'openfda.brand_name:"{drug_name}"'
    url = f"{OPENFDA_LABEL_URL}?search={urllib.parse.quote(query)}&limit=1"
    
    headers = {"User-Agent": "AntiConjugate-Agent/1.0 (Hackathon Research; OpenFDA API)"}
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "results" in data and len(data["results"]) > 0:
                res = data["results"][0]
                return {
                    "boxed_warning": res.get("boxed_warning", []),
                    "warnings_and_precautions": res.get("warnings_and_precautions", []),
                    "contraindications": res.get("contraindications", []),
                    "drug_interactions": res.get("drug_interactions", []),
                    "geriatric_use": res.get("geriatric_use", []),
                    "renal_impairment": res.get("use_in_specific_populations", []),
                    "adverse_reactions": res.get("adverse_reactions", [])
                }
    except Exception as e:
        print(f"Warning: Failed to fetch openFDA label for {drug_name}: {e}", file=sys.stderr)
    return {}


def fetch_hpa_data(ensembl_id, gene_symbol):
    """Fetch tissue expression summary from Human Protein Atlas API."""
    import gzip
    params = {
        "search": gene_symbol,
        "format": "json",
        "columns": "g,eg,gs,gd,pe,sc,t_RNA_any,t_RNA_tissue,t_IHC_tissue"
    }
    url = f"{HPA_SEARCH_URL}?{urllib.parse.urlencode(params)}"
    headers = {
        "User-Agent": "AntiConjugate-Agent/1.0 (Hackathon Research; HPA API)",
        "Accept-Encoding": "gzip, deflate"
    }
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as resp:
            raw_bytes = resp.read()
            while raw_bytes[:2] == b'\x1f\x8b':
                raw_bytes = gzip.decompress(raw_bytes)
            content = raw_bytes.decode('utf-8')
            data = json.loads(content)
            if data:
                # Find exact match
                for entry in data:
                    if entry.get("Gene", "").lower() == gene_symbol.lower():
                        return entry
                return data[0]
    except Exception as e:
        print(f"Warning: Failed to fetch HPA data for {gene_symbol}: {e}", file=sys.stderr)
    return {}


def main():
    os.makedirs("data", exist_ok=True)
    
    # 1. Fetch FDA Labels
    print("--- [1/2] Fetching openFDA Drug Labels ---")
    fda_results = {}
    for adc in TARGET_ADCS:
        bname = adc["brand_name"]
        print(f"Fetching FDA label for {bname} ({adc['generic_name']})...")
        label_data = fetch_openfda_label(bname)
        fda_results[bname] = {
            "meta": adc,
            "label_sections": label_data
        }
        time.sleep(0.5)  # rate limit respect
        
    with open("data/fda_adcs_labels.json", "w") as f:
        json.dump(fda_results, f, indent=2)
    print(f"Saved FDA labels to data/fda_adcs_labels.json (Total ADCs: {len(fda_results)})")
    
    # 2. Fetch HPA Target Tissue Expression
    print("\n--- [2/2] Fetching Human Protein Atlas Tissue Expression ---")
    hpa_results = {}
    for item in HPA_GENES:
        gene = item["gene"]
        ensembl = item["ensembl"]
        print(f"Fetching HPA data for {gene} ({item['target']}) [{ensembl}]...")
        hpa_data = fetch_hpa_data(ensembl, gene)
        hpa_results[gene] = {
            "meta": item,
            "hpa_summary": hpa_data
        }
        time.sleep(0.5)
        
    with open("data/hpa_target_expression.json", "w") as f:
        json.dump(hpa_results, f, indent=2)
    print(f"Saved HPA data to data/hpa_target_expression.json (Total genes: {len(hpa_results)})")


if __name__ == "__main__":
    main()
