import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
BASE = ROOT / "research/north-jersey"
SPEC = importlib.util.spec_from_file_location("review_release", ROOT / "scripts/regions/release-reviews.py")
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_text())


def reference(path):
    path = path.resolve()
    require(path.is_relative_to(BASE.resolve()), "Evidence path escapes North Jersey research")
    return {"path": str(path.relative_to(ROOT)), "sha256": sha(path.read_bytes())}


def publication_text(text):
    require(isinstance(text, str) and text.strip() == text and text.startswith(
        ("A ", "An ", "The ", "In ")), "Missing attributed editorial paraphrase")
    require(len(text) <= 240 and len(text.split()) <= 40, "Paraphrase exceeds publication caps")
    require(not re.search(
        r"https?://|@|\b\d{2,}\b|\b(?:diagnos\w*|medicat\w*|prescri\w*|surgery|cancer|"
        r"diabetes|alzheimer\w*|dementia|dialysis|patient id|medical record)\b", text, re.I),
        "Paraphrase privacy screening failed")
    require(not re.search(r"\b[A-Z][a-z]+\s+[A-Z][a-z]+\b", text), "Possible personal name in paraphrase")
    require("<" not in text and ">" not in text, "Markup in paraphrase")


def build(decisions=None):
    decisions = load(HERE / "decisions.json") if decisions is None else decisions
    require(decisions["schemaVersion"] == 1, "Unsupported editorial schema")
    require(decisions["assessmentDate"] == "2026-11-12", "Assessment date changed")
    providers_path = BASE / "runtime/providers.json"
    crosswalk_path = BASE / "runtime/crosswalk.json"
    policy_path = BASE / "reviews/source-access.json"
    prior_path = BASE / "review-excerpts/observations.json"
    held_path = BASE / "review-release/withheld-checks.json"
    listing_held_path = BASE / "listing-index/release/held.json"
    providers = {p["id"]: p for p in load(providers_path)}
    crosswalk = load(crosswalk_path)
    policies = load(policy_path)["sources"]
    require(any(p["source"] == "MyLivingChoice" and p["access_decision"] == "permitted_low_volume"
                for p in policies), "Source policy no longer permits this source")
    prior = load(prior_path)["pages"]
    prior_urls = {p["url"] for p in prior}
    blocked_ids = {row["id"] for page in prior for row in page["rows"] if row["exclusionReasons"]}
    blocked_keys = {row["reviewUrl"] for page in prior for row in page["rows"]
                    if row["exclusionReasons"] and row.get("reviewUrl")}
    prior_keys = {row["reviewUrl"] for page in prior for row in page["rows"] if row.get("reviewUrl")}
    held_urls = {row["url"] for row in load(held_path) + load(listing_held_path)}
    cache = {}
    for path in sorted((BASE / "listing-index/cache").glob("*.json")):
        receipt = load(path)
        cache.setdefault(receipt.get("url"), []).append((path, receipt))
    pages, review_keys, counts = [], set(), {"reviewedRows": 0, "releasedRows": 0, "withheldRows": 0}
    counties, sentiments = {}, {}
    for slug, decisions_by_id in sorted(decisions["pages"].items()):
        require(re.fullmatch(r"[a-z0-9-]+", slug), "Invalid property slug")
        url = "https://www.mylivingchoice.com/property/" + slug
        require(url not in prior_urls, "Overlay must not replace the existing 41 reviewed pages")
        require(url not in held_urls, "Previously held provider page cannot be released")
        matches = cache.get(url, [])
        require(len(matches) == 1, "Missing or ambiguous cached page receipt")
        receipt_path, receipt = matches[0]
        require(receipt.get("httpStatus") == 200 and receipt.get("status") != "access_restricted"
                and receipt.get("source") == "MyLivingChoice", "Unusable cached source")
        raw_path = BASE / "listing-index/raw" / receipt["sha256"]
        raw = raw_path.read_bytes()
        require(sha(raw) == receipt["sha256"] and len(raw) == receipt["bytes"], "Original HTML hash mismatch")
        parser = RELEASE.PublicReviewHTML()
        parser.feed(raw.decode("utf-8"))
        parser.close()
        articles = parser.reviews()
        discovery_path = BASE / "listing-index/discovery/pages" / (slug + ".json")
        discovery = load(discovery_path)
        require(discovery.get("effectiveUrl") == url and discovery.get("metadata", {}).get("statusCode") == 200,
                "Discovery receipt identity mismatch")
        require(discovery.get("materializedFrom", {}).get("rawSha256") == receipt["sha256"],
                "Discovery identity not derived from this HTML")
        markdown = discovery["markdown"]
        header = re.search(r"^# (.+)\n+\[([^\]]+)\]", markdown, re.M)
        care = re.search(r"^## Types of Care[^\n]*\n+(.+?)(?:\n\n##|\n##)", markdown, re.S | re.M)
        require(header is not None and care is not None, "Missing location identity")
        address = header[2].split(", ")
        require(len(address) == 3, "Ambiguous published address")
        identity = dict(name=header[1], address=address[0], city=address[1], state=address[2],
                        zip=None, careUnit=care[1].strip())
        require("Independent Living" not in identity["careUnit"]
                and not ("Assisted Living" in identity["careUnit"] and "Skilled Nursing" in identity["careUnit"]),
                "Mixed care population must remain withheld")
        body = RELEASE.words(" ".join(parser.parts)).replace("new jersey", "nj")
        require(parser.headings == [identity["name"]], "Original HTML heading mismatch")
        for key in ("address", "city", "state", "careUnit"):
            require(RELEASE.token(RELEASE.words(identity[key]).replace("new jersey", "nj"))
                    in RELEASE.token(body),
                    "Original HTML does not corroborate published identity for " + slug + " / " + key)
        candidates = []
        for row in crosswalk:
            if row.get("status") != "included" or row.get("providerId") not in providers:
                continue
            approval = dict(providerId=row["providerId"], officialId=row["officialId"], identity=identity)
            try:
                RELEASE.validate_identity(approval, approval, providers, crosswalk)
            except RELEASE.ReleaseError:
                continue
            candidates.append(row)
        require(len(candidates) == 1, "No unique exact official provider and care unit")
        official = candidates[0]
        provider = providers[official["providerId"]]
        require(provider["category"] in {"assisted-living", "nursing-home"}, "Unreviewed care category")
        require(set(decisions_by_id) == {a["sourceReviewId"] for a in articles.values()},
                "Editorial decisions must cover the complete displayed article population")
        places = {match[1] for article in articles.values()
                  if (match := re.search(r"!1s(0x[0-9a-f]+:0x[0-9a-f]+)", article["reviewUrl"] or ""))}
        require(len(places) <= 1, "Displayed accounts point to competing Google places")
        rows = []
        for article_id, article in articles.items():
            native = article["sourceReviewId"]
            decision = decisions_by_id[native]
            native_key = "mlc-external-" + native
            require(native_key not in blocked_ids, "Previously excluded sensitive or ineligible row")
            original_key = article["reviewUrl"]
            require(original_key not in blocked_keys, "Previously excluded original review permalink")
            require(original_key not in prior_keys, "Original account already exists in the baseline")
            parsed = urlsplit(original_key or "")
            require(parsed.scheme == "https" and parsed.hostname in
                    {"www.google.com", "google.com", "maps.google.com"}
                    and parsed.path.startswith("/maps/reviews/") and not parsed.username
                    and not parsed.password, "Missing safe original review link")
            require(original_key not in review_keys, "Duplicate original account")
            review_keys.add(original_key)
            require(re.fullmatch(r"\d{4}-\d{2}", article["publishedAt"] or ""), "Missing source month")
            require(article["publishedAt"] <= decisions["assessmentDate"][:7], "Future publication month")
            row = dict(id=native_key, originalReviewKey=original_key, articleId=article_id,
                       sourceReviewId=native, bodySha256=sha(article["text"].encode()),
                       publishedAt=article["publishedAt"], datePrecision="month")
            counts["reviewedRows"] += 1
            if decision[0] == "withheld":
                require(len(decision) == 2 and decision[1], "Withheld decision must contain only a reason")
                row.update(publication="withheld", exclusionReasons=[decision[1]])
                counts["withheldRows"] += 1
            else:
                require(len(decision) == 4 and decision[0] in {"positive", "mixed", "critical"},
                        "Invalid publication decision")
                sentiment, role, stage, paraphrase = decision
                require(role in {"family", "resident", "visitor", "unknown"}, "Unsupported relationship")
                require(stage in {"current-resident", "former-resident", "tour", "visit", "unknown"},
                        "Unsupported experience stage")
                publication_text(paraphrase)
                row.update(publication="released", representation="editorial-paraphrase", sentiment=sentiment,
                           role=role, experienceStage=stage, paraphrase=paraphrase,
                           privacyReview="no-personal-names-private-details-or-diagnoses-in-release")
                counts["releasedRows"] += 1
                sentiments[sentiment] = sentiments.get(sentiment, 0) + 1
            rows.append(row)
        counties[official["county"]] = counties.get(official["county"], 0) + 1
        pages.append(dict(providerId=provider["id"], officialId=official["officialId"],
                          sourceId="mlc-" + slug, source="MyLivingChoice", sourceFamily="google",
                          url=url, checkedAt=receipt["observedAt"][:10], identity=identity,
                          officialIdentity=dict(name=provider["name"], address=provider["address"],
                                                category=provider["category"], county=official["county"]),
                          identityBasis="exact-listed-name-street-city-state-and-unique-included-official-care-unit",
                          retainedPage=reference(raw_path), receipt=reference(receipt_path),
                          discovery=reference(discovery_path), completeVisiblePopulation=True, rows=rows))
    counts.update(additionalPages=len(pages), additionalProviders=len({p["providerId"] for p in pages}),
                  baselinePages=len(prior), combinedPages=len(prior) + len(pages),
                  counties=counties, sentiments=sentiments)
    require(all(any(r["publication"] == "released" for r in p["rows"]) for p in pages),
            "A reviewed page has no readable account")
    inputs = [providers_path, crosswalk_path, policy_path, prior_path, held_path,
              listing_held_path, HERE / "decisions.json", Path(__file__)]
    return dict(schemaVersion=1, assessmentDate=decisions["assessmentDate"],
                reviewMethod="agent-editor-whole-original-article-assessment-not-human-verification",
                publicationLabel="Editorial paraphrase of one public review. Account not independently verified.",
                limitations=["Selected visible accounts, not a representative sample or prevalence estimate.",
                             "Google reviews republished by MyLivingChoice remain one source family.",
                             "No aggregate, numeric score, or existing publication decision changes.",
                             "No full original bodies or author identities are included."],
                inputs=[reference(p) for p in inputs],
                releaseValidatorSha256=sha((ROOT / "scripts/regions/release-reviews.py").read_bytes()),
                counts=counts, pages=pages)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def source_receipts(release):
    page_fields = ("providerId", "officialId", "sourceId", "source", "sourceFamily", "url",
                   "checkedAt", "identity", "officialIdentity", "identityBasis",
                   "retainedPage", "receipt", "discovery", "completeVisiblePopulation")
    row_fields = ("id", "originalReviewKey", "articleId", "sourceReviewId", "bodySha256",
                  "publishedAt", "datePrecision")
    return dict(schemaVersion=1, kind="privacy-safe-derived-article-and-identity-receipts",
                assessmentDate=release["assessmentDate"],
                provenance="Derived by private HTML audit. Original narratives and author identities are not included.",
                pages=[dict({key: page[key] for key in page_fields},
                            rows=[{key: row[key] for key in row_fields} for row in page["rows"]])
                       for page in release["pages"]])


def validate_public_release(release):
    fingerprint = load(HERE / "release-fingerprint.json")
    require(fingerprint.get("schemaVersion") == 1, "Unsupported public release fingerprint")
    require(fingerprint["overlaySha256"] == sha(encoded(release)), "Editorial overlay fingerprint mismatch")
    require(fingerprint["decisions"] == reference(HERE / "decisions.json"), "Editorial decisions changed")
    require(fingerprint["sourceReceipts"] == reference(HERE / "source-receipts.json"),
            "Public source receipt fingerprint mismatch")
    require(fingerprint["validatorSha256"] == sha(Path(__file__).read_bytes()), "Editorial validator changed")
    require(load(HERE / "source-receipts.json") == source_receipts(release),
            "Public source account or identity receipt mismatch")
    for ref in release["inputs"]:
        require(reference(ROOT / ref["path"]) == ref, "Current public editorial input changed")
    require(release["releaseValidatorSha256"] ==
            sha((ROOT / "scripts/regions/release-reviews.py").read_bytes()), "Official identity validator changed")
    providers = {p["id"]: p for p in load(BASE / "runtime/providers.json")}
    crosswalk = load(BASE / "runtime/crosswalk.json")
    policies = load(BASE / "reviews/source-access.json")["sources"]
    require(any(p["source"] == "MyLivingChoice" and p["access_decision"] == "permitted_low_volume"
                for p in policies), "Source policy no longer permits this source")
    decisions = load(HERE / "decisions.json")
    require(len(release["pages"]) == len(decisions["pages"]), "Public page population changed")
    seen = set()
    for page in release["pages"]:
        RELEASE.validate_identity(page, page, providers, crosswalk)
        require(page["source"] == "MyLivingChoice" and page["sourceFamily"] == "google"
                and page["completeVisiblePopulation"] is True, "Public source scope changed")
        slug = page["url"].removeprefix("https://www.mylivingchoice.com/property/")
        require(page["sourceId"] == "mlc-" + slug, "Public source ID mismatch")
        choices = decisions["pages"][slug]
        require({row["sourceReviewId"] for row in page["rows"]} == set(choices),
                "Public decisions do not cover every account")
        for row in page["rows"]:
            require(row["originalReviewKey"] not in seen, "Duplicate public original account")
            seen.add(row["originalReviewKey"])
            require(row["id"] == "mlc-external-" + row["sourceReviewId"]
                    and re.fullmatch(r"[0-9a-f]{64}", row["bodySha256"]), "Malformed public source identity")
            choice = choices[row["sourceReviewId"]]
            if choice[0] == "withheld":
                require(row["publication"] == "withheld" and "paraphrase" not in row
                        and row["exclusionReasons"] == [choice[1]], "Withheld decision changed")
            else:
                require(row["publication"] == "released" and row["representation"] == "editorial-paraphrase"
                        and [row["sentiment"], row["role"], row["experienceStage"], row["paraphrase"]] == choice,
                        "Editorial paraphrase decision changed")
                publication_text(row["paraphrase"])
    return release


def write_public_release(release):
    (HERE / "overlay.json").write_bytes(encoded(release))
    receipts_path = HERE / "source-receipts.json"
    receipts_path.write_bytes((json.dumps(source_receipts(release), ensure_ascii=False,
                                         separators=(",", ":")) + "\n").encode())
    fingerprint = dict(schemaVersion=1, kind="reviewed-editorial-release-fingerprint",
                       overlaySha256=sha(encoded(release)), decisions=reference(HERE / "decisions.json"),
                       sourceReceipts=reference(receipts_path), validatorSha256=sha(Path(__file__).read_bytes()))
    (HERE / "release-fingerprint.json").write_bytes(encoded(fingerprint))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--audit-private-captures", action="store_true")
    parser.add_argument("--write-public-receipts", action="store_true")
    args = parser.parse_args()
    try:
        if args.write_public_receipts:
            require(not args.check, "Cannot write public receipts during --check")
            result = build()
            write_public_release(result)
        result = validate_public_release(load(HERE / "overlay.json"))
        if args.audit_private_captures:
            require(encoded(build()) == encoded(result), "Private original evidence no longer reproduces public release")
        print(json.dumps(result["counts"], sort_keys=True))
    except (ValueError, RELEASE.ReleaseError, KeyError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
