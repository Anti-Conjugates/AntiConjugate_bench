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
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from adcg.kb import normalise_hpa, normalise_label_sections

SSL_CONTEXT = ssl.create_default_context()

OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json"
HPA_URL = "https://www.proteinatlas.org"

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
                    "warnings_and_precautions": res.get("warnings_and_cautions", res.get("warnings", [])),
                    "contraindications": res.get("contraindications", []),
                    "drug_interactions": res.get("drug_interactions", []),
                    "geriatric_use": res.get("geriatric_use", []),
                    "use_in_specific_populations": res.get("use_in_specific_populations", []),
                    "renal_impairment": res.get("renal_impairment", []),
                    "hepatic_impairment": res.get("hepatic_impairment", []),
                    "adverse_reactions": res.get("adverse_reactions", [])
                }
    except Exception as e:
        print(f"Warning: Failed to fetch openFDA label for {drug_name}: {e}", file=sys.stderr)
    return {}


def fetch_hpa_data(ensembl_id, gene_symbol):
    """Fetch tissue expression summary from Human Protein Atlas API."""
    import gzip
    url = f"{HPA_URL}/{ensembl_id}.json"
    headers = {
        "User-Agent": "AntiConjugate-Agent/1.0 (Hackathon Research; HPA API)",
        "Accept-Encoding": "gzip"
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
                entries = data if isinstance(data, list) else [data]
                # Find exact match
                for entry in entries:
                    if entry.get("Gene", "").lower() == gene_symbol.lower() and entry.get("Ensembl") == ensembl_id:
                        return entry
    except Exception as e:
        print(f"Warning: Failed to fetch HPA data for {gene_symbol}: {e}", file=sys.stderr)
    return {}


def write_snapshot(path: Path, data: dict) -> None:
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            json.dump(data, handle, indent=2)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main(data_dir: Path | None = None):
    data_dir = data_dir or Path(__file__).resolve().parent / "data"
    failures = []
    fetched_at = datetime.now(UTC).isoformat()
    
    # 1. Fetch FDA Labels
    print("--- [1/2] Fetching openFDA Drug Labels ---")
    fda_results = {}
    for adc in TARGET_ADCS:
        bname = adc["brand_name"]
        print(f"Fetching FDA label for {bname} ({adc['generic_name']})...")
        label_data = fetch_openfda_label(bname)
        if not any(label_data.values()):
            failures.append(f"FDA:{bname}")
        fda_results[bname] = {
            "meta": adc,
            "label_sections": normalise_label_sections({"label_sections": label_data}),
            "provenance": {"source": OPENFDA_LABEL_URL, "fetched_at": fetched_at,
                           "schema_version": 1, "reviewed_by": None}
        }
        time.sleep(0.5)  # rate limit respect
        
    
    # 2. Fetch HPA Target Tissue Expression
    print("\n--- [2/2] Fetching Human Protein Atlas Tissue Expression ---")
    hpa_results = {}
    for item in HPA_GENES:
        gene = item["gene"]
        ensembl = item["ensembl"]
        print(f"Fetching HPA data for {gene} ({item['target']}) [{ensembl}]...")
        hpa_data = fetch_hpa_data(ensembl, gene)
        normalized = normalise_hpa(hpa_data)
        if not normalized:
            failures.append(f"HPA:{gene}")
        hpa_results[gene] = normalized | {
            "meta": item,
            "hpa_summary": hpa_data,
            "provenance": {"source": f"{HPA_URL}/{ensembl}.json", "fetched_at": fetched_at,
                           "schema_version": 1, "reviewed_by": None}
        }
        time.sleep(0.5)
        
    if failures:
        raise RuntimeError(f"Refresh failed; existing snapshots left untouched: {', '.join(failures)}")
    data_dir.mkdir(parents=True, exist_ok=True)
    write_snapshot(data_dir / "fda_adcs_labels.json", fda_results)
    write_snapshot(data_dir / "hpa_target_expression.json", hpa_results)
    print(f"Saved HPA data to data/hpa_target_expression.json (Total genes: {len(hpa_results)})")


if __name__ == "__main__":
    main()
