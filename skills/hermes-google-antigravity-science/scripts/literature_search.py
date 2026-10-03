#!/usr/bin/env python3
"""
Scientific Literature Search Runner for Hermes Agent.
Covers: PubMed, Europe PMC, bioRxiv / medRxiv, arXiv, OpenAlex.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional

HTTP_HEADERS = {
    "User-Agent": "Hermes-AntigravityScience/2.0.0 (Nous Research Hermes; mailto:science@openclaw.ai)",
    "Accept": "application/json"
}

def http_get(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 30) -> bytes:
    h = dict(HTTP_HEADERS)
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()

def query_pubmed(term: str, limit: int = 5) -> List[Dict[str, Any]]:
    # 1. Search for PMIDs
    search_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term={urllib.parse.quote(term)}&retmode=json&retmax={limit}"
    data = json.loads(http_get(search_url).decode("utf-8"))
    id_list = data.get("esearchresult", {}).get("idlist", [])
    if not id_list:
        return []

    # 2. Summary for PMIDs
    sum_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id={','.join(id_list)}&retmode=json"
    sum_data = json.loads(http_get(sum_url).decode("utf-8"))
    result_dict = sum_data.get("result", {})

    articles = []
    for pmid in id_list:
        info = result_dict.get(pmid, {})
        authors = [a.get("name") for a in info.get("authors", []) if "name" in a]
        articles.append({
            "pmid": pmid,
            "title": info.get("title"),
            "source": info.get("source"),
            "pubdate": info.get("pubdate"),
            "first_author": authors[0] if authors else "Unknown",
            "doi": next((x.get("value") for x in info.get("articleids", []) if x.get("idtype") == "doi"), None),
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        })
    return articles

def query_europepmc(term: str, limit: int = 5) -> List[Dict[str, Any]]:
    url = f"https://www.ebi.ac.uk/europepmc/webservices/rest/search?query={urllib.parse.quote(term)}&format=json&pageSize={limit}"
    data = json.loads(http_get(url).decode("utf-8"))
    results = []
    for item in data.get("resultList", {}).get("result", []):
        results.append({
            "id": item.get("id"),
            "source": item.get("source"),
            "pmid": item.get("pmid"),
            "pmcid": item.get("pmcid"),
            "doi": item.get("doi"),
            "title": item.get("title"),
            "authorString": item.get("authorString"),
            "journalTitle": item.get("journalTitle"),
            "pubYear": item.get("pubYear"),
            "citedByCount": item.get("citedByCount"),
            "isOpenAccess": item.get("isOpenAccess") == "Y",
            "url": f"https://europepmc.org/article/{item.get('source')}/{item.get('id')}"
        })
    return results

def query_arxiv(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    url = f"http://export.arxiv.org/api/query?search_query=all:{urllib.parse.quote(query)}&start=0&max_results={limit}"
    xml_data = http_get(url, headers={"Accept": "application/atom+xml"})
    root = ET.fromstring(xml_data)
    
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    articles = []
    for entry in root.findall("atom:entry", ns):
        title = entry.find("atom:title", ns)
        summary = entry.find("atom:summary", ns)
        published = entry.find("atom:published", ns)
        id_elem = entry.find("atom:id", ns)
        authors = [a.find("atom:name", ns).text for a in entry.findall("atom:author", ns) if a.find("atom:name", ns) is not None]
        
        articles.append({
            "id": id_elem.text if id_elem is not None else None,
            "title": title.text.strip().replace("\n", " ") if title is not None and title.text else "",
            "published": published.text[:10] if published is not None and published.text else None,
            "authors": authors[:3],
            "abstract": summary.text.strip().replace("\n", " ")[:300] + "..." if summary is not None and summary.text else ""
        })
    return articles

def query_openalex(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    url = f"https://api.openalex.org/works?search={urllib.parse.quote(query)}&per-page={limit}"
    data = json.loads(http_get(url).decode("utf-8"))
    results = []
    for item in data.get("results", []):
        results.append({
            "id": item.get("id"),
            "doi": item.get("doi"),
            "title": item.get("title"),
            "publication_year": item.get("publication_year"),
            "cited_by_count": item.get("cited_by_count"),
            "is_oa": item.get("open_access", {}).get("is_oa"),
            "primary_location": item.get("primary_location", {}).get("source", {}).get("display_name")
        })
    return results

def main():
    parser = argparse.ArgumentParser(description="Scientific Literature Search Runner for Hermes")
    subparsers = parser.add_subparsers(dest="cmd")

    p_pm = subparsers.add_parser("pubmed", help="Query PubMed")
    p_pm.add_argument("query", type=str, help="Search term (e.g. 'endometriosis SFRP2')")
    p_pm.add_argument("--limit", type=int, default=5, help="Result count")

    p_epmc = subparsers.add_parser("europepmc", help="Query Europe PMC")
    p_epmc.add_argument("query", type=str, help="Search term")
    p_epmc.add_argument("--limit", type=int, default=5, help="Result count")

    p_ar = subparsers.add_parser("arxiv", help="Query arXiv")
    p_ar.add_argument("query", type=str, help="Search term (e.g. 'quantum chemistry trapped-ion')")
    p_ar.add_argument("--limit", type=int, default=5, help="Result count")

    p_oa = subparsers.add_parser("openalex", help="Query OpenAlex")
    p_oa.add_argument("query", type=str, help="Search term")
    p_oa.add_argument("--limit", type=int, default=5, help="Result count")

    args = parser.parse_args()
    if args.cmd == "pubmed":
        print(json.dumps(query_pubmed(args.query, args.limit), indent=2))
    elif args.cmd == "europepmc":
        print(json.dumps(query_europepmc(args.query, args.limit), indent=2))
    elif args.cmd == "arxiv":
        print(json.dumps(query_arxiv(args.query, args.limit), indent=2))
    elif args.cmd == "openalex":
        print(json.dumps(query_openalex(args.query, args.limit), indent=2))
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
