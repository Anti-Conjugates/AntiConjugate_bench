"""Import the supplied ADC workbook without evaluating formulas or inferring blanks."""

import argparse
import datetime
import hashlib
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
HEADERS = [
    "ADCdb_ID", "ADC name", "Brand", "Antibody", "Target", "Linker", "Payload",
    "Indication", "Status", "Organization", "DAR", "Conjugate type", "Linker-payload",
    "Payload target", "Toxicity (verbatim)", "Absorption", "Distribution", "Metabolism",
]
LIMITATIONS = [
    "User-uploaded snapshot, not a live ADCdb query; the original extraction date and primary assay provenance are unverified.",
    "Missing cells are unknown, never zero risk. Workbook status and pharmacology summaries are not current regulatory approvals or clinical guidance.",
    "Repeated text lengths suggest possible truncation; full source completeness has not been established.",
    "Derived_NOT_ADCdb is author-derived material, not an ADCdb row or an approved prescribing source. Bystander entries are only reported as ADCdb fields in the workbook.",
    "Only Kadcyla and Enhertu have local UK label paraphrases. All clinical content remains pending pharmacist approval.",
]


def import_workbook(path: Path, imported_at: str) -> dict:
    if path.name != "adc_table_adcdb.xlsx" or path.stat().st_size > 10_000_000:
        raise ValueError("Expected the bounded adc_table_adcdb.xlsx attachment")
    raw = path.read_bytes()
    with zipfile.ZipFile(path) as archive:
        if sum(info.file_size for info in archive.infolist()) > 20_000_000:
            raise ValueError("Workbook uncompressed size exceeds the import limit")
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(node.itertext()) for node in
                       ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)]

        def rows(sheet: str) -> dict:
            result = {}
            root = ET.fromstring(archive.read(sheet))
            for row in root.findall("s:sheetData/s:row", NS):
                cells = {}
                for cell in row.findall("s:c", NS):
                    if cell.find("s:f", NS) is not None:
                        raise ValueError("Formula cells are unsupported; never evaluate cached formula results")
                    value = cell.find("s:v", NS)
                    inline = cell.find("s:is", NS)
                    text = value.text if value is not None else "".join(inline.itertext()) if inline is not None else None
                    if cell.get("t") == "s" and text is not None:
                        text = strings[int(text)]
                    cells[cell.attrib["r"]] = text if text else None
                result[int(row.attrib["r"])] = cells
            return result

        data = rows("xl/worksheets/sheet1.xml")
        derived = rows("xl/worksheets/sheet2.xml")
        if [data[1].get(f"{chr(65 + i)}1") for i in range(18)] != HEADERS:
            raise ValueError("Unexpected workbook columns")
        records = []
        for row, cells in sorted(data.items()):
            if row == 1:
                continue
            values = [cells.get(f"{chr(65 + i)}{row}") for i in range(18)]
            if not values[0] or not re.fullmatch(r"DRG0[A-Z0-9]+", values[0]):
                raise ValueError("Invalid ADCdb identifier")
            records.append({
                "id": values[0], "name": values[1], "brand": values[2], "target": values[4],
                "payload": values[6], "linker": values[5], "dar": values[10],
                "clinical_enabled": values[0] in ("DRG0CYMEB", "DRG0ERKBH"), "row": row,
                "cells": [{"field": header, "cell": f"{chr(65 + i)}{row}", "value": values[i]}
                          for i, header in enumerate(HEADERS)],
                "missing_fields": [header for i, header in enumerate(HEADERS) if values[i] is None],
            })
        if len({record["id"] for record in records}) != len(records):
            raise ValueError("Duplicate ADCdb identifiers")
        derived_headers = [derived[2][f"{chr(65 + i)}2"] for i in range(8)]
        derived_records = [
            {"id": cells[f"A{row}"], "row": row,
             "cells": [{"field": header, "cell": f"{chr(65 + i)}{row}",
                        "value": cells.get(f"{chr(65 + i)}{row}")}
                       for i, header in enumerate(derived_headers)]}
            for row, cells in sorted(derived.items()) if row > 2
        ]
    return {
        "filename": path.name, "sha256": hashlib.sha256(raw).hexdigest(), "imported_at": imported_at,
        "record_count": len(records), "derived_record_count": len(derived_records),
        "provenance": "user_uploaded_unverified", "limitations": LIMITATIONS,
        "derived_notice": derived[1]["A1"], "records": records, "derived_records": derived_records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "apps/api/src/workbook.snapshot.json")
    parser.add_argument("--imported-at", default=datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"))
    args = parser.parse_args()
    dataset = import_workbook(args.input, args.imported_at)
    if not args.output.parent.is_dir():
        raise ValueError("Output parent directory does not exist")
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n")
    print(f"Imported {dataset['record_count']} records and {dataset['derived_record_count']} derived rows; SHA256 {dataset['sha256']}")


if __name__ == "__main__":
    main()
