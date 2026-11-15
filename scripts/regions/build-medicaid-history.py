"""Compile historical Medicaid enrollment and personal-care billing for verified NJ organizations."""
import argparse
import csv
from datetime import date
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile


ENROLLMENT_HASH = "b70930a9a017d258cc3292ee74e2941b809487c966d9a3792548550030b9c59c"
ENROLLMENT_URL = "https://opendata.hhs.gov/datasets/medicaid-provider-enrollment-segments/"
FIRST_DAY = date(2018, 1, 1)
LAST_DAY = date(2024, 12, 31)


def enrollment_offices(archive, by_npi):
    with archive.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != ENROLLMENT_HASH:
            raise ValueError("Unexpected enrollment release")
    latest = {}
    prefixes = {npi.encode() + b",NJ," for npi in by_npi}
    with ZipFile(archive) as data, data.open("medicaid-provider-enrollment-segments.csv") as lines:
        fields = next(csv.reader([next(lines).decode()]))
        if fields[:2] != ["NPI", "STATE_CD"]:
            raise ValueError("Unexpected enrollment CSV layout")
        for line in lines:
            if line[:14] not in prefixes:
                continue
            row = dict(zip(fields, next(csv.reader([line.decode()]))))
            if (row["ENRL_PLAN_CD"], row["ENRL_STATUS_CD"], row["PRVDR_TYPE"]) != ("1", "03", "02"):
                continue
            if not row["ENRL_START_DT"]:
                continue
            start = max(date.fromisoformat(row["ENRL_START_DT"]), FIRST_DAY)
            end = min(date.fromisoformat(row["ENRL_END_DT"]), LAST_DAY) if row["ENRL_END_DT"] else LAST_DAY
            if start <= end:
                npi = row["NPI"]
                latest[npi] = max(end, latest.get(npi, end))
    return [{"providerId": by_npi[npi], "npi": npi, "month": end.strftime("%Y-%m")}
            for npi, end in sorted(latest.items())]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("enrollment", "claims", "nppes", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--checked-at", required=True, type=date.fromisoformat)
    args = parser.parse_args()
    claims = json.loads(args.claims.read_text())
    registry = args.nppes.read_bytes()
    if claims["nppesSha256"] != hashlib.sha256(registry).hexdigest():
        raise ValueError("Claims and enrollment must use the same office crosswalk")
    identities = json.loads(registry)
    by_npi = {r["npi"]: pid for pid, r in identities.items()}
    if len(by_npi) != len(identities):
        raise ValueError("An organization identifier maps to multiple offices")
    def billed_offices(rows):
        return [{"providerId": pid, "npi": r["npi"], "month": r["latestMonth"], "codes": r["hcpcsCodes"]}
                for r in rows for pid in r["providerIds"]]

    publisher = "U.S. Department of Health and Human Services"
    result = {"checkedAt": args.checked_at.isoformat(), "nppesSha256": claims["nppesSha256"], "datasets": [
        {"key": "hhs-nj-enrollment", "title": "New Jersey Medicaid enrollment history",
         "publisher": publisher, "sourceUrl": ENROLLMENT_URL, "sha256": ENROLLMENT_HASH,
         "publishedAt": "2026-07-24", "offices": enrollment_offices(args.enrollment, by_npi)},
        {"key": "hhs-personal-care-claims", "title": "Medicaid personal care claims history",
         "publisher": publisher, "sourceUrl": claims["source"]["url"], "sha256": claims["source"]["sha256"],
         "publishedAt": claims["source"]["release"], "offices": billed_offices(claims["organizations"])},
    ]}
    for service, rows in claims.get("additionalServices", {}).items():
        title = {"nursing": "Medicaid nursing claims history", "respite": "Medicaid respite claims history"}[service]
        result["datasets"].append({"key": f"hhs-{service}-claims", "title": title, "publisher": publisher,
                                   "sourceUrl": claims["source"]["url"], "sha256": claims["source"]["sha256"],
                                   "publishedAt": claims["source"]["release"], "offices": billed_offices(rows)})
    args.output.write_text(json.dumps(result, indent=2) + "\n")
