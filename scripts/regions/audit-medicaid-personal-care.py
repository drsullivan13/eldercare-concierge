"""Report the latest published personal-care billing month for matched organizations."""

import argparse
import hashlib
import json
import re
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq


SOURCE_PAGE = "https://opendata.hhs.gov/datasets/medicaid-provider-spending/"
SOURCE_FILE = (
    "https://stopendataprod.blob.core.windows.net/datasets/medicaid-provider-spending/"
    "2026-02-09/dataset/medicaid-provider-spending.parquet"
)
SOURCE_SHA256 = "f646d426126638dd0177cb14a86bfe7d7e9ed6b081a3e1c270bfe5070fb3fb94"
COLUMNS = ["BILLING_PROVIDER_NPI_NUM", "SERVICING_PROVIDER_NPI_NUM", "HCPCS_CODE", "CLAIM_FROM_MONTH"]
EXPECTED_SCHEMA = pa.schema(
    [(name, pa.string()) for name in COLUMNS]
    + [("TOTAL_PATIENTS", pa.int64()), ("TOTAL_CLAIM_LINES", pa.int64()), ("TOTAL_PAID", pa.float64())]
)


def audit(parquet_path, registry_path):
    with parquet_path.open("rb") as file:
        if hashlib.file_digest(file, "sha256").hexdigest() != SOURCE_SHA256:
            raise ValueError("Parquet checksum differs from the pinned HHS release")
    source = pq.ParquetFile(parquet_path)
    if not source.schema_arrow.equals(EXPECTED_SCHEMA, check_metadata=False):
        raise ValueError("Unexpected HHS columns or types")

    registry_bytes = registry_path.read_bytes()
    organizations = {}
    for provider_id, office in json.loads(registry_bytes).items():
        npi = office["npi"]
        if not (
            re.fullmatch(r"[0-9]{10}", npi)
            and office["provider_id"] == provider_id
            and office["nppes_status"] == "A"
            and office["basis"] == "exact_organization_practice_address_unit_and_phone"
        ):
            raise ValueError(f"Unexpected NPPES identity for {provider_id}")
        identity = organizations.setdefault(npi, {"operator": office["legal_name"], "providerIds": []})
        if identity["operator"] != office["legal_name"]:
            raise ValueError(f"Conflicting organization names for {npi}")
        identity["providerIds"].append(provider_id)

    npi_set = pa.array(sorted(organizations), type=pa.string())
    codes = pa.array(["T1019", "T1020"])
    latest = {}
    for batch in source.iter_batches(columns=COLUMNS, batch_size=131072):
        billing, servicing, hcpcs, months = batch.columns
        selected = pc.and_(pc.is_in(hcpcs, value_set=codes), pc.is_in(billing, value_set=npi_set))
        selected = pc.and_(selected, pc.equal(billing, servicing))
        matches = batch.filter(selected)
        for npi, code, month in zip(*(matches.column(i).to_pylist() for i in (0, 2, 3))):
            if not month or not re.fullmatch(r"(201[89]|202[0-4])-(0[1-9]|1[0-2])", month):
                raise ValueError(f"Unexpected claim month for {npi}")
            if npi not in latest or month > latest[npi][0]:
                latest[npi] = (month, {code})
            elif month == latest[npi][0]:
                latest[npi][1].add(code)

    return {
        "source": {"release": "2026-02-09", "url": SOURCE_PAGE, "fileUrl": SOURCE_FILE,
                   "sha256": SOURCE_SHA256, "period": ["2018-01", "2024-12"]},
        "nppesSha256": hashlib.sha256(registry_bytes).hexdigest(),
        "matchedInputOrganizations": len(organizations),
        "scope": "Published aggregate cells with the same organization NPI for billing and servicing. "
                 "Practice addresses identify the organization. The place of service is unknown.",
        "organizations": [
            {"npi": npi, "operator": organizations[npi]["operator"],
             "providerIds": sorted(organizations[npi]["providerIds"]),
             "latestMonth": latest[npi][0], "hcpcsCodes": sorted(latest[npi][1])}
            for npi in sorted(latest)
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("parquet", "nppes", "output"):
        parser.add_argument("--" + flag, type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() in {args.parquet.resolve(), args.nppes.resolve()}:
        parser.error("Output must differ from both inputs")
    result = audit(args.parquet, args.nppes)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
