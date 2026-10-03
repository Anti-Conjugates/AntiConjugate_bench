"""Polite ADCdb scraper: search one target, fetch clinical-stage ADC detail pages.

ADCdb has no bulk export, so we parse the server-rendered HTML. Raw pages are
cached under data/raw/ so re-runs never re-hit the site.
"""

from __future__ import annotations

import argparse
import html as htmllib
import json
import re
import time
from pathlib import Path
from urllib.parse import quote

import pandas as pd
import requests

BASE = "https://adcdb.idrblab.net"
UA = "AntiConjugate-hackathon/0.1 (research; arun.nrasa@gmail.com)"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DELAY_S = 1.5


def fetch(url: str, cache: Path) -> str:
    if cache.exists():
        return cache.read_text()
    cache.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=90)
            r.raise_for_status()
            cache.write_text(r.text)
            time.sleep(DELAY_S)
            return r.text
        except requests.RequestException:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}")


def _text_lines(page: str) -> list[str]:
    page = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    text = htmllib.unescape(re.sub(r"<[^>]+>", "\n", page))
    return [ln.strip() for ln in text.split("\n") if ln.strip()]


def _field(block: str, label: str) -> str:
    m = re.search(rf"<b>{re.escape(label)}:?\s*</b>(?:&nbsp;)?\s*([^<]*)", block)
    return htmllib.unescape(m.group(1)).strip() if m else ""


def parse_search_page(page: str) -> list[dict]:
    rows = []
    for block in page.split('<div class="div-unit-search">')[1:]:
        m = re.search(r"ADC ID:\s*(DRG[0-9A-Z]+)", block)
        if not m:
            continue
        links = dict(
            (k, v)
            for v, k in re.findall(
                r'href="/data/(?:antibody|payload|linker)/details/([0-9A-Z]+)"[^>]*>&nbsp;(\w+) Info',
                block,
            )
        )
        rows.append(
            {
                "adc_id": m.group(1),
                "adc_name": _field(block, "ADC Name"),
                "status": _field(block, "Drug Status"),
                "indication": _field(block, "Representative Indication"),
                "antibody": _field(block, "Antibody Name"),
                "payload": _field(block, "Payload Name"),
                "linker": _field(block, "Linker Name"),
                "antibody_id": links.get("Antibody", ""),
                "payload_id": links.get("Payload", ""),
                "linker_id": links.get("Linker", ""),
            }
        )
    return rows


def search(term: str, max_pages: int = 1000) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    slug = re.sub(r"\W+", "_", term)
    for p in range(max_pages):
        url = f"{BASE}/search/result/adc?search_api_fulltext={quote(term)}&page={p}"
        rows = parse_search_page(fetch(url, RAW / "search" / f"{slug}_p{p}.html"))
        new = [r for r in rows if r["adc_id"] not in seen]
        if not new:
            break
        seen.update(r["adc_id"] for r in new)
        out.extend(new)
    return out


DETAIL_LABELS = {
    "Brand Name": "brand_name",
    "Synonyms": "synonyms",
    "Organization": "organization",
    "Drug Status": "status_detail",
    "Drug-to-Antibody Ratio": "dar",
    "Antigen Name": "antigen",
    "Payload Target": "payload_target",
    "Conjugate Type": "conjugate_type",
    "Combination Type": "linker_payload_combo",
    "Special Approval(s)": "special_approvals",
}
SECTION_HEADS = {
    "Bystander Killing Effect",
    "Binding Affinity",
    "Circulating Stability",
    "General Information of The ADMET Data Related to This ADC",
    "Toxicity",
}


def _after(lines: list[str], label: str) -> str:
    try:
        i = lines.index(label)
    except ValueError:
        return ""
    val = lines[i + 1] if i + 1 < len(lines) else ""
    return "" if val in ("Click to Show/Hide",) or val.endswith("Info") else val


def _section(lines: list[str], head: str, stop: set[str], max_len: int = 40) -> list[str]:
    """Lines of a functional-property / ADMET section, minus UI chrome."""
    idxs = [i for i, ln in enumerate(lines) if ln == head]
    for i in idxs:
        if i + 2 < len(lines) and lines[i + 1] == "Click To Hide/Show":
            body = []
            for ln in lines[i + 2 : i + 2 + max_len]:
                if ln == head or re.match(r"^\d+ .*Data$", ln):
                    continue
                if ln in stop or ln == "2027 Update" or ln.startswith("General Information of"):
                    break
                if ln in ("[", "]", "Click to Show/Hide", "Reference", "Description") or ln.isdigit():
                    continue
                body.append(ln)
            return body
    return []


def parse_detail(page: str) -> dict:
    lines = _text_lines(page)
    d: dict = {v: _after(lines, k) for k, v in DETAIL_LABELS.items()}
    stop = SECTION_HEADS | {"Absorption", "Distribution", "Metabolism", "Excretion"}
    for head, key in [
        ("Bystander Killing Effect", "bystander"),
        ("Binding Affinity", "binding_affinity"),
        ("Circulating Stability", "circulating_stability"),
        ("Toxicity", "toxicity"),
    ]:
        body = _section(lines, head, stop)
        d[key] = " | ".join(b for b in body if not re.match(r"^\d+ .*Data$", b))[:1500]
    nct = re.findall(r"\bNCT\d{8}\b", page)
    d["nct_ids"] = ";".join(sorted(set(nct)))
    d["n_clinical_trials"] = len(set(nct))
    return d


def is_clinical(status: str) -> bool:
    s = status.lower()
    return "approved" in s or "phase" in s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--term", default="HER2")
    ap.add_argument("--antigen-regex", default=r"HER2|erbB-2|ERBB2")
    ap.add_argument("--extra-terms", nargs="*", default=[
        "Trastuzumab emtansine", "Trastuzumab deruxtecan", "Disitamab vedotin", "Trastuzumab duocarmazine",
        "Trastuzumab rezetecan", "ARX788", "Zanidatamab zovodotin", "Trastuzumab botidotin"])
    ap.add_argument("--out", default=str(ROOT / "data"))
    args = ap.parse_args()

    rows = search(args.term)
    for t in args.extra_terms:
        rows += search(t, max_pages=3)
    allp = pd.DataFrame(rows).drop_duplicates("adc_id")
    out = Path(args.out)
    allp.to_csv(out / f"adcdb_{args.term.lower()}_search.csv", index=False)
    print(f"search rows: {len(allp)}")

    clin = allp[allp["status"].map(is_clinical)].copy()
    details = []
    for adc_id in clin["adc_id"]:
        page = fetch(f"{BASE}/data/adc/details/{adc_id}", RAW / "adc" / f"{adc_id}.html")
        details.append({"adc_id": adc_id, **parse_detail(page)})
    det = clin.merge(pd.DataFrame(details), on="adc_id", how="left")
    det["targets_antigen"] = det["antigen"].str.contains(args.antigen_regex, case=False, na=False)
    det.to_csv(out / f"adcdb_{args.term.lower()}_clinical.csv", index=False)

    tgt = det[det["targets_antigen"]]
    tgt.to_csv(out / f"adc_{args.term.lower()}_table.csv", index=False)
    cov = {
        "search_rows": int(len(allp)),
        "clinical_stage_rows": int(len(det)),
        "clinical_stage_targeting_antigen": int(len(tgt)),
        "approved_targeting_antigen": int(tgt["status"].str.contains("Approved", case=False).sum()),
        "filled_fields_among_targeting": {
            c: int((tgt[c].fillna("").str.len() > 0).sum())
            for c in ["dar", "linker", "payload", "conjugate_type", "bystander",
                      "binding_affinity", "circulating_stability", "toxicity"]
        },
    }
    (out / f"coverage_{args.term.lower()}.json").write_text(json.dumps(cov, indent=2))
    print(json.dumps(cov, indent=2))


if __name__ == "__main__":
    main()
