#!/usr/bin/env python3
"""Replay reviewed Massachusetts accounts from redacted public-page receipts."""

import argparse
import hashlib
import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlsplit

WORK = Path(__file__).resolve().parent
ROOT = WORK.parents[2]
CHECKED_AT = "2026-11-12"
MONTHS = {month: f"{i:02}" for i, month in enumerate(
    "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}
NOTES = [
    "Selected public accounts are unverified personal reports, not representative prevalence or clinical evidence.",
    "MyLivingChoice republishes Google accounts. Syndication does not create an independent source family.",
    "Reported ratings and acquired individual articles are different populations.",
    "Brief editorial paraphrases omit author names and medical narratives. Original text is not redistributed.",
    "These accounts do not change scores, aggregates or family-experience ordering.",
]


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def canonical_review(url):
    parsed = urlsplit(url)
    assert parsed.scheme == "https" and parsed.hostname == "www.google.com"
    match = re.search(r"!1s((?:Ci|Ch)[^!?#]+)", unquote(url))
    assert match, "Missing underlying Google review ID"
    return "google:" + match[1]


def normalized(value):
    aliases = {"street": "st", "avenue": "ave", "road": "rd", "mount": "mt",
               "suite": "ste"}
    return " ".join(aliases.get(word, word) for word in
                    re.findall(r"[a-z0-9]+", value.lower()))


def parse_receipt(raw, target):
    url = "https://www.mylivingchoice.com/property/" + target["slug"]
    assert raw["metadata"]["statusCode"] == 200
    assert raw["effectiveUrl"] == url, "Unexpected redirect"
    text = raw["markdown"]
    assert len(text.encode()) < 2_000_000
    header = text.split("\n## ", 1)[0]
    heading = re.search(r"^# ([^\n]+)", header)[1]
    address = re.search(r"\n(?:\[)?([^\n\[]+, Massachusetts)(?:\]|\n)", header)[1]
    care = re.search(r"^## Types of Care[^\n]*\n(.*?)(?=^## |\Z)", text, re.M | re.S)[1].strip()
    match = re.search(r"^## Reviews[^\n]*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    assert match, "Review section unavailable"
    section = match[1]
    count = re.search(r"[\d.]+\s*★\s*on Google\s*\(([\d,]+)\)", section)
    pattern = re.compile(
        r"(?P<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(?P<year>\d{4})"
        r"\s+\[via Google[^\]]*\]\((?P<url>https://www\.google\.com/[^\s]+?)\)"
        r"\s*·\s*\[Report\]\(https://www\.mylivingchoice\.com/reviews/report/external/(?P<id>\d+)\)"
        r"(?P<body>.*?)(?=\n!\[|\Z)", re.S)
    rows = []
    for m in pattern.finditer(section):
        body = m["body"].strip()
        rows.append({
            "nativeId": "mlc-external-" + m["id"],
            "originalReviewKey": canonical_review(m["url"]),
            "url": m["url"],
            "date": m["year"] + "-" + MONTHS[m["month"]],
            "datePrecision": "month",
            "bodySha256": digest(body),
            "hasText": bool(body),
        })
    assert len(rows) == len(re.findall(r"/reviews/report/external/\d+", section)), "Unparsed review article"
    links = [{"label": label, "url": href} for label, href in
             re.findall(r"\[([^\]]+)\]\(([^)\s]+)\)", section)
             if re.fullmatch(r"\s*(?:next(?: page)?|older(?: reviews)?|load more|show more|[›»→]|\d+)\s*", label, re.I)]
    return {
        "url": url, "checkedAt": CHECKED_AT, "status": 200,
        "transport": "FetchUrl", "heading": heading, "address": address,
        "careTypes": care, "pageSha256": digest(text),
        "reviewSectionSha256": digest(section),
        "reportedCount": int(count[1].replace(",", "")) if count else None,
        "nextLinks": links, "rows": rows,
    }


def validate_identity(target, receipt, providers):
    if target.get("withholdReason"):
        return
    provider = providers[target["providerId"]]
    assert target["identity"] == {key: provider[key] for key in ("name", "address", "city", "category")}
    street = normalized(provider["address"].split(",")[0])
    assert street in normalized(receipt["address"]), "Street-address mismatch"
    city = normalized(provider["city"])
    assert city in normalized(receipt["address"]) or (
        city == "west newton" and ", Newton, Massachusetts" in receipt["address"])
    care = {"nursing-home": "Skilled Nursing", "assisted-living": "Assisted Living",
            "home-health": "Home Health", "home-care": "At-Home Care"}
    assert care[provider["category"]] in receipt["careTypes"], "Care-type mismatch"
    expected = normalized(provider["name"]).replace(" & ", " ")
    actual = normalized(receipt["heading"]).replace(" & ", " ")
    assert expected in actual or actual in expected or target["slug"] in {
        "skilled-nursing-facility-at-north-hill-the",
        "meadow-green-nursing-and-rehabilitation-center",
        "benchmark-senior-living-at-waltham-crossings",
    }, "Name mismatch requires explicit reviewed alias"


def build():
    targets = read(WORK / "targets.json")
    receipts = {r["url"]: r for r in read(WORK / "receipts.json")}
    browser = {r["url"]: r for r in read(WORK / "browser-pagination.json")}
    reviewed = read(WORK / "reviewed.json")
    aliases = read(WORK / "retained-aliases.json")
    assert reviewed["receiptsSha256"] == digest((WORK / "receipts.json").read_text()), "Editorial review is stale"
    providers = {p["id"]: p for p in read(ROOT / "src/data/providers.json")}
    released = read(ROOT / "src/data/location-research.json")
    output, coverage, used = {}, [], set()
    for target in targets:
        url = "https://www.mylivingchoice.com/property/" + target["slug"]
        receipt = receipts[url]
        dom = browser[url]
        assert set(dom["reviewIds"]) == {r["nativeId"].removeprefix("mlc-external-") for r in receipt["rows"]}
        assert not dom["buttons"] and not dom["paginationLinks"] and not receipt["nextLinks"], "Visible pagination must be acquired"
        validate_identity(target, receipt, providers)
        excluded, accounts = [], []
        pid = target["providerId"]
        source_id = "mlc-" + target["slug"]
        old_keys = set()
        old_native_ids = {a["nativeId"] for a in aliases if a["providerId"] == pid}
        if pid:
            for row in released.get(pid, {}).get("reviews", []):
                if urlsplit(row["url"]).hostname == "www.google.com":
                    old_keys.add(canonical_review(row["url"]))
        for row in receipt["rows"]:
            decision = reviewed["accounts"][row["nativeId"]]
            used.add(row["nativeId"])
            if target.get("withholdReason") or decision.get("exclude"):
                excluded.append({"nativeId": row["nativeId"], "reason": target.get("withholdReason") or decision["exclude"]})
                continue
            assert decision["relationship"] in {"resident", "family", "visitor", "unknown"}
            summary = decision.get("summary")
            assert summary is None or (0 < len(summary) <= 300 and len(summary.split()) <= 45)
            assert not summary or not re.search(r"https?://|@|\b\d{2,}\b", summary)
            value = row["date"]
            date.fromisoformat(value + "-01")
            accounts.append({
                "id": "google-" + digest(pid + "|" + row["originalReviewKey"])[:24],
                "sourceId": source_id, "sourceFamily": "google", "url": row["url"],
                "date": value, "datePrecision": row["datePrecision"],
                "relationship": decision["relationship"], "excerpt": None,
                "summary": summary, "representation": "reviewed-excerpt" if summary else "link-only",
                "provenance": "new-public-page",
                "nativeReviewId": row["nativeId"],
            })
        reason = "Rendered review section and FetchUrl show no next, older or load-more control. All visible articles checked; the larger Google rating population is not exposed."
        if not receipt["rows"]:
            reason = "Page reports ratings but exposes no individual articles. Rendered review section has no pagination controls."
        if target.get("withholdReason"):
            reason = target["withholdReason"] + " All visible articles logged but none published."
        source = {
            "id": source_id, "publisher": "MyLivingChoice", "sourceFamily": "google",
            "url": url, "reportedCount": receipt["reportedCount"], "retainedCount": len(accounts),
            "previouslyUnseenCount": sum(
                row["originalReviewKey"] not in old_keys and row["nativeId"] not in old_native_ids
                for row in receipt["rows"]
                if not target.get("withholdReason") and not reviewed["accounts"][row["nativeId"]].get("exclude")),
            "pagesChecked": 1,
            "coverage": "blocked" if target.get("withholdReason") else "exhausted-visible-pages",
            "stopReason": reason,
        }
        if target.get("scopeNote"):
            source["scopeNote"] = target["scopeNote"]
        coverage.append({
            "providerId": pid, **source, "visibleArticles": len(receipt["rows"]),
            "excluded": excluded, "scopeNote": target.get("scopeNote"),
            "identityDecision": "withheld" if target.get("withholdReason") else "exact-location-and-care-type",
        })
        if pid:
            notes = NOTES + ([target["scopeNote"]] if target.get("scopeNote") else [])
            output[pid] = {
                "providerId": pid, "checkedAt": CHECKED_AT,
                "accounts": sorted(accounts, key=lambda a: (a["date"], a["id"]), reverse=True),
                "sources": [source], "notes": notes,
            }
    assert used == set(reviewed["accounts"]), "Orphaned editorial decision"
    keys = [(pid, canonical_review(a["url"])) for pid, record in output.items() for a in record["accounts"]]
    assert len(keys) == len(set(keys)), "Duplicate underlying account"
    return dict(sorted(output.items())), coverage


def merge_examples(catalog):
    released = read(ROOT / "src/data/location-research.json")
    aliases = read(WORK / "retained-aliases.json")
    examples = []
    for pid in ("ma-alr-sunrise-of-newton", "ma-alr-the-falls-at-cordingly-dam",
                "ma-alr-adelaide-of-newton-centre", "ma-alr-goddard-house"):
        old = released[pid]["reviews"]
        new = catalog[pid]["accounts"]
        matched = {a["retainedReviewId"] for a in aliases if a["providerId"] == pid}
        ids = [a["id"] for a in new] + ["retained:" + a["id"] for a in old if a["id"] not in matched]
        assert len(ids) > 5 and len(ids) == len(set(ids))
        examples.append({
            "providerId": pid, "retainedAccounts": len(old),
            "acquiredAccounts": len(new), "matchedRetainedAccounts": len(matched),
            "distinctMergedAccounts": len(ids), "accountIds": ids,
            "sourceUrls": sorted({s["url"] for s in released[pid]["sources"]
                                  if any(a["sourceId"] == s["id"] for a in old)}
                                 | {s["url"] for s in catalog[pid]["sources"]}),
            "meaning": "More than five accounts across sources, not more than five acquired from one MyLivingChoice page. Existing restricted-source accounts were reused, not refetched.",
        })
    return examples


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["ingest", "build", "check", "verify-originals"])
    parser.add_argument("--input-dir", type=Path)
    args = parser.parse_args()
    if args.action in {"ingest", "verify-originals"}:
        assert args.input_dir and args.input_dir.is_absolute()
        receipts = [parse_receipt(read(args.input_dir / ("harbor-ma-" + t["slug"] + ".json")), t)
                    for t in read(WORK / "targets.json")]
        if args.action == "ingest":
            write(WORK / "receipts.json", receipts)
        else:
            assert receipts == read(WORK / "receipts.json"), "Original receipts differ"
            decisions = read(WORK / "reviewed.json")["accounts"]
            checked, longest = 0, 0
            for receipt in receipts:
                slug = receipt["url"].rsplit("/", 1)[1]
                text = read(args.input_dir / ("harbor-ma-" + slug + ".json"))["markdown"]
                for row in receipt["rows"]:
                    summary = decisions[row["nativeId"]].get("summary")
                    if not summary:
                        continue
                    native = row["nativeId"].removeprefix("mlc-external-")
                    body = text.split("/reviews/report/external/" + native + ")", 1)[1].split("\n![", 1)[0]
                    words = re.findall(r"\w+", summary.lower())
                    original = " ".join(re.findall(r"\w+", body.lower()))
                    overlap = max((n for n in range(1, len(words) + 1)
                                   if any(" ".join(words[i:i+n]) in original
                                          for i in range(len(words) - n + 1))), default=0)
                    assert overlap <= 7, "Editorial paraphrase copies a long source phrase"
                    longest = max(longest, overlap)
                    checked += 1
            print(json.dumps({"paraphrasesCheckedAgainstOriginalArticles": checked,
                              "maximumConsecutiveSourceWords": longest}))
            for alias in read(WORK / "retained-aliases.json"):
                receipt = next(r for r in receipts if any(row["nativeId"] == alias["nativeId"] for row in r["rows"]))
                slug = receipt["url"].rsplit("/", 1)[1]
                text = read(args.input_dir / ("harbor-ma-" + slug + ".json"))["markdown"]
                native = alias["nativeId"].removeprefix("mlc-external-")
                body = text.split("/reviews/report/external/" + native + ")", 1)[1].split("\n![", 1)[0]
                assert alias["matchExcerpt"].lower() in body.lower(), "Retained alias not supported by original article"
        print(json.dumps({"action": args.action, "pages": len(receipts),
                          "articles": sum(len(r["rows"]) for r in receipts)}))
        return
    catalog, coverage = build()
    for filename, value in [("catalog.json", catalog), ("coverage.json", coverage),
                            ("merge-examples.json", merge_examples(catalog))]:
        if args.action == "check":
            assert read(WORK / filename) == value, filename + " differs from replay"
        else:
            write(WORK / filename, value)
    print(json.dumps({"action": args.action, "providers": len(catalog),
                      "accounts": sum(len(r["accounts"]) for r in catalog.values()),
                      "withSummary": sum(bool(a["summary"]) for r in catalog.values() for a in r["accounts"]),
                      "previouslyUnseen": sum(s["previouslyUnseenCount"] for s in coverage),
                      "pages": len(coverage),
                      "excluded": sum(len(s["excluded"]) for s in coverage)}))


if __name__ == "__main__":
    main()
