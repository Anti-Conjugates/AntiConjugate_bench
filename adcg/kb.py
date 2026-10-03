"""Load the ADC table and draft knowledge base (pharmacist review required)."""

from __future__ import annotations

import json
import re
import sysconfig
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if not (ROOT / "knowledge" / "payload_classes.json").exists():
    ROOT = Path(sysconfig.get_path("data")) / "share" / "adc-guardrail"
DATA = ROOT / "data"

# Team-curated reference files (UNVERIFIED until pharmacist review), keyed by citation prefix.
SOURCE_FILES = {"fda": "fda_adcs_labels.json", "hpa": "hpa_target_expression.json",
                "sop": "payload_class_rules.json", "curated": "adcdb_curated_table.json"}
# Our payload-class ids -> keys in payload_class_rules.json
SOP_KEY = {"topo1_dxd": "DXd", "topo1_sn38": "SN-38", "maytansinoid_dm1": "DM1", "auristatin_mmae": "MMAE"}
LABEL_CHARS = 4000
POPULATION_HEADINGS = {
    "Pregnancy": "pregnancy", "Lactation": "lactation",
    "Females and Males of Reproductive Potential": "reproductive_potential",
    "Pediatric Use": "pediatric_use", "Geriatric Use": "geriatric_use",
    "Renal Impairment": "renal_impairment", "Hepatic Impairment": "hepatic_impairment",
}


def normalise_label_sections(lab: dict) -> dict:
    sections = dict(lab.get("label_sections") or {})
    legacy = sections.get("renal_impairment", [])
    if any("USE IN SPECIFIC POPULATIONS" in text.upper() for text in legacy):
        sections["use_in_specific_populations"] = sections.pop("renal_impairment")
    pattern = r"\b8\.\d+\s+(" + "|".join(POPULATION_HEADINGS) + r")\b"
    for text in sections.get("use_in_specific_populations", []):
        matches = list(re.finditer(pattern, text, re.I))
        for i, match in enumerate(matches):
            heading = next(k for k in POPULATION_HEADINGS if k.lower() == match[1].lower())
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            key = POPULATION_HEADINGS[heading]
            if key not in sections:
                sections[key] = []
            excerpt = text[match.start():end].strip()
            if excerpt not in sections[key]:
                sections[key].append(excerpt)
    return sections


def normalise_hpa(record: dict) -> dict:
    raw = record.get("hpa_summary", record)
    aliases = {
        "rna_tissue_specificity": "RNA tissue specificity",
        "rna_tissue_distribution": "RNA tissue distribution",
        "protein_tissue_distribution": "Protein tissue distribution",
        "protein_expression_summary": "Tissue expression",
        "description": "Gene description",
    }
    out = {key: raw.get(key) or raw.get(alias) for key, alias in aliases.items()}
    if record.get("biophysics_implication"):
        out["biophysics_implication"] = record["biophysics_implication"]
    out = {key: value for key, value in out.items() if value}
    if out:
        out["_status"] = "UNVERIFIED: expression observations do not establish ADC toxicity"
    return out


def as_list(ev) -> list[str]:
    """LLMs sometimes return a single citation string instead of a list."""
    if not ev:
        return []
    if isinstance(ev, str):
        return [ev]
    return [str(e) for e in ev]


def load_sources(data_dir: Path = DATA) -> dict:
    out = {}
    for key, fname in SOURCE_FILES.items():
        f = data_dir / fname
        out[key] = json.loads(f.read_text()) if f.exists() else {}
    return out


def load_thresholds(path: Path | None = None) -> dict:
    return json.loads((path or ROOT / "config" / "thresholds.json").read_text())


@dataclass
class KB:
    adc_table: pd.DataFrame
    payload_kb: dict
    drug_lists: dict
    thresholds: dict
    excluded_ids: set[str] = field(default_factory=set)
    sources: dict = field(default_factory=dict)

    @classmethod
    def load(cls, table_csv: Path | None = None) -> KB:
        table_csv = table_csv or ROOT / "data" / "adc_her2_table.csv"
        df = pd.read_csv(table_csv, dtype=str).fillna("")
        return cls(
            adc_table=df,
            payload_kb=json.loads((ROOT / "knowledge" / "payload_classes.json").read_text()),
            drug_lists=json.loads((ROOT / "knowledge" / "drug_lists.json").read_text()),
            thresholds=load_thresholds(),
            sources=load_sources(),
        )

    def without(self, adc_ids: set[str]) -> KB:
        """Retrieval view with held-out ADCs removed (fair split)."""
        return KB(self.adc_table, self.payload_kb, self.drug_lists, self.thresholds,
                  self.excluded_ids | set(adc_ids), self.sources)

    @property
    def visible(self) -> pd.DataFrame:
        return self.adc_table[~self.adc_table["adc_id"].isin(self.excluded_ids)]

    @cached_property
    def all_ids(self) -> set[str]:
        curated = {r["adcdb_id"] for r in (self.sources.get("curated") or {}).get("adcs", []) if r.get("adcdb_id")}
        return set(self.adc_table["adc_id"]) | curated

    @staticmethod
    def _row_names(row) -> set[str]:
        names = [row.get("adc_id", ""), row.get("adc_name", ""), row.get("brand_name", "")]
        names += row.get("synonyms", "").split(";")
        return {_norm(n) for n in names if _norm(n)}

    @cached_property
    def _excluded_names(self) -> set[str]:
        rows = self.adc_table[self.adc_table["adc_id"].isin(self.excluded_ids)]
        return set().union(*(self._row_names(r) for _, r in rows.iterrows())) if len(rows) else set()

    @cached_property
    def extra_rows(self) -> list[dict]:
        """Approved ADCs from the FDA-label file (joined to the curated ADCdb table) that are not in the
        scraped HER2 table, e.g. TROP2 / Nectin-4 / CD30 ADCs."""
        table_names = set().union(*(self._row_names(r) for _, r in self.adc_table.iterrows()))
        curated = {_norm(_generic(r["adc_name"])): r for r in (self.sources.get("curated") or {}).get("adcs", [])}
        rows = []
        for brand, lab in (self.sources.get("fda") or {}).items():
            m = lab.get("meta", {})
            cur = curated.get(_norm(_generic(m.get("generic_name", ""))), {})
            row = {"adc_id": cur.get("adcdb_id", ""), "adc_name": m.get("generic_name", ""), "brand_name": brand,
                   "status": "Approved (FDA label)", "antigen": m.get("target", ""), "antibody": cur.get("antibody", ""),
                   "payload": m.get("payload", ""), "payload_target": m.get("payload_class", ""),
                   "linker": m.get("linker", ""), "dar": str(m.get("dar", "")), "synonyms": _generic(m.get("generic_name", ""))}
            if not (self._row_names(row) & table_names):
                rows.append(row)
        seen = table_names.union(*(self._row_names(r) for r in rows)) if rows else table_names
        for r in curated.values():
            row = {"adc_id": r.get("adcdb_id", ""), "adc_name": r.get("adc_name", ""), "brand_name": r.get("brand", ""),
                   "status": "Curated ADCdb record", "antigen": r.get("target", ""), "antibody": r.get("antibody", ""),
                   "payload": r.get("payload", ""), "payload_target": r.get("payload_target", ""),
                   "linker": r.get("linker", ""), "synonyms": ""}
            if row["adc_id"] and not (self._row_names(row) & seen):
                rows.append(row)
        return rows

    def find_adc(self, name: str) -> dict | None:
        key = _norm(name)
        if not key:
            return None
        for _, row in self.adc_table.iterrows():
            if key in self._row_names(row):
                return None if row["adc_id"] in self.excluded_ids else row.to_dict()
        for row in self.extra_rows:
            if (key in self._row_names(row) and row.get("adc_id") not in self.excluded_ids
                    and not (self._row_names(row) & self._excluded_names)):
                return dict(row)
        return None

    def adc_mentions(self, text: str) -> list[dict]:
        """Resolve non-overlapping aliases from the current retrieval view only."""
        rows = [r.to_dict() for _, r in self.visible.iterrows()] + [
            r for r in self.extra_rows if r.get("adc_id") not in self.excluded_ids
            and not (self._row_names(r) & self._excluded_names)
        ]
        matches = []
        for row in rows:
            names = [row.get("adc_name", ""), row.get("brand_name", "")] + row.get("synonyms", "").split(";")
            for n in names:
                n = n.strip()
                if len(n) >= 4:
                    for match in re.finditer(rf"(?<![\w-]){re.escape(n)}(?![\w-])", text, re.I):
                        matches.append({"start": match.start(), "end": match.end(), "name": n, "row": row})
        selected: list[dict] = []
        for candidate in sorted(matches, key=lambda m: (-(m["end"] - m["start"]), m["start"])):
            if not any(
                candidate["start"] < m["end"] and m["start"] < candidate["end"] and not (
                    (candidate["start"], candidate["end"]) == (m["start"], m["end"])
                    and self.adc_cite(candidate["row"]) != self.adc_cite(m["row"])
                ) for m in selected
            ):
                selected.append(candidate)
        return sorted(selected, key=lambda m: m["start"])

    def excluded_adc_mentioned(self, text: str) -> bool:
        """A holdout rejection filter, never a source of facts for an answer."""
        rows = [r.to_dict() for _, r in self.adc_table.iterrows() if r["adc_id"] in self.excluded_ids]
        rows += [r for r in self.extra_rows if r.get("adc_id") in self.excluded_ids
                 or self._row_names(r) & self._excluded_names]
        for row in rows:
            names = [row.get("adc_name", ""), row.get("brand_name", "")] + row.get("synonyms", "").split(";")
            if any(len(n.strip()) >= 4 and re.search(
                rf"(?<![\w-]){re.escape(n.strip())}(?![\w-])", text, re.I
            ) for n in names):
                return True
        return False

    def find_adc_in_text(self, text: str) -> dict | None:
        """Only resolve unambiguous single-ADC text, respecting the retrieval split."""
        rows = {self.adc_cite(m["row"]): m["row"] for m in self.adc_mentions(text)}
        return next(iter(rows.values())) if len(rows) == 1 else None

    @staticmethod
    def adc_cite(adc: dict) -> str:
        return f"ADCDB:{adc['adc_id']}" if adc.get("adc_id") else f"FDA:{adc.get('brand_name', '')}"

    def fda_label(self, adc: dict) -> tuple[str, dict] | None:
        keys = {_norm(adc.get("brand_name", "")), _norm(_generic(adc.get("adc_name", "")))} - {""}
        for brand, lab in (self.sources.get("fda") or {}).items():
            if keys & {_norm(brand), _norm(_generic(lab.get("meta", {}).get("generic_name", "")))}:
                return brand, lab
        return None

    def reference(self, adc: dict) -> dict:
        """Label, SOP and expression context for one ADC, keyed by the citation string to use."""
        out = {}
        hit = self.fda_label(adc)
        gene = ""
        if hit:
            brand, lab = hit
            gene = lab.get("meta", {}).get("target_gene", "")
            for sec, texts in normalise_label_sections(lab).items():
                if texts and sum(len(t) for t in texts) <= LABEL_CHARS:
                    out[f"FDA:{brand}:{sec}"] = texts
        sop_key = SOP_KEY.get(self.payload_class(adc.get("payload", "")) or "")
        sop = (self.sources.get("sop") or {}).get("payload_classes", {})
        if sop_key in sop:
            out[f"SOP:{sop_key}"] = sop[sop_key]
        hpa = self.sources.get("hpa") or {}
        if not gene and "her2" in adc.get("antigen", "").lower():
            gene = "ERBB2"
        if gene in hpa:
            h = normalise_hpa(hpa[gene])
            if h:
                out[f"HPA:{gene}"] = h
        return out

    def reference_omissions(self, adc: dict) -> list[str]:
        hit = self.fda_label(adc)
        if not hit:
            return []
        brand, lab = hit
        return [f"FDA:{brand}:{sec}" for sec, texts in normalise_label_sections(lab).items()
                if texts and sum(len(t) for t in texts) > LABEL_CHARS]

    def payload_class(self, payload: str) -> str | None:
        hits = [
            cid for cid, c in self.payload_kb["classes"].items()
            if re.search(c["payload_regex"], payload or "", flags=re.I)
        ]
        return hits[0] if len(hits) == 1 else None

    def citation_ok(self, cite: str, patient: dict | None = None) -> bool:
        from adcg.rules import RULES

        kind, _, ref = cite.partition(":")
        kind = kind.strip().upper()
        ref = ref.strip()
        if kind == "ADCDB":
            return ref in self.all_ids and ref not in self.excluded_ids
        if kind == "KB":
            head, _, sub = ref.partition(":")
            if head == "drug_lists":
                return sub in self.drug_lists
            return head in self.payload_kb["classes"] or head in self.payload_kb["antibody_class_effects"]
        if kind == "RULE":
            return ref in RULES
        if kind == "PATIENT":
            return patient is not None and ref in patient
        if kind == "FDA":
            brand, _, sec = ref.partition(":")
            lab = (self.sources.get("fda") or {}).get(brand)
            return lab is not None and (not sec or bool(normalise_label_sections(lab).get(sec)))
        if kind == "SOP":
            sop = self.sources.get("sop") or {}
            return ref in sop.get("payload_classes", {}) or ref in sop.get("general_prescribing_rules", {})
        if kind == "HPA":
            record = (self.sources.get("hpa") or {}).get(ref)
            return record is not None and bool(normalise_hpa(record))
        return False


def _generic(name: str) -> str:
    return re.sub(r"^ado-", "", (name or "").strip(), flags=re.I)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())
