#!/usr/bin/env python3
"""Offline discovery and strict identity assessment from retained FetchUrl JSON.

python3 scripts/regions/listing-index-discover.py queue
python3 scripts/regions/listing-index-discover.py ingest
python3 scripts/regions/listing-index-discover.py assess --dry-run
python3 scripts/regions/listing-index-discover.py queue --denominator runtime --expected-count 956

Queue writes listing-index/discovery-queue.json. Retain FetchUrl property results
in listing-index/discovery/pages/<slug>.json, then ingest writes the sibling
listing-index.py schema to discovery/normalized-observations.json. Assess is an
alias for ingest. Both recompute the sitemap queue in memory, never overwrite it,
and also assess retained property pages absent from the queue. Exact requests
require observed name or explicit legal/DBA alias, street/city/state, and one
compatible setting. The sibling verifier independently assesses these requests.
Missing source ZIP stays null. Default county-roster includes only included and
included_historical rows; the count is derived from current inputs (960 as of the
expanded roster) unless --expected-count asserts an explicit guard. Home-care
offices additionally require a location-specific, explicitly attributed consumer
review aggregate and no contradictory registered/staffing-only or service-area
scope. Interrupted or transport-error envelopes are unattempted, never full-page
inspections. --dry-run writes nothing and prints the
complete result. No fetches, runtime publication, review text or reviewer names.
Assessment emits structured street/city/state/zip identity fields. The verbatim
source address is retained separately as publishedAddress, never roster-filled.
"""

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
BASE = Path("research/north-jersey/listing-index")
COUNTIES = ["Union", "Morris", "Essex", "Bergen", "Hudson", "Passaic"]
PROPERTY = re.compile(
    r"https://www\.mylivingchoice\.com/property/([a-z0-9-]+?)"
    r"(?=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}|[^a-z0-9-]|$)"
)
GENERIC = set("""the and of at in for a an llc inc incorporated ltd corporation
care health healthcare home homes senior seniors living assisted independent
memory nursing skilled rehabilitation rehab center centre facility services
service agency agencies community communities residence residences long term
new jersey nj hospice staffing group management office registered dba""".split())
ALIASES = {"saint": "st", "mount": "mt", "township": "twp"}
SOURCE_NAMES = {"google": "google", "yelp": "yelp", "caring.com": "caring",
                "a place for mom": "aplaceformom", "senioradvisor.com": "aplaceformom",
                "mylivingchoice": "mylivingchoice"}
CARE_LABELS = {
    "skilled nursing / long term care": "nursing-home",
    "skilled nursing": "nursing-home",
    "assisted living": "assisted-living",
    "independent living": "independent-living",
    "memory care": "memory-care",
    "at-home care": "home-care",
    "home care": "home-care",
    "home health": "home-care",
    "hospice": "hospice",
    "respite / short-term care": None,
}
METHOD = ("Limited MyLivingChoice retained properties-0 through properties-6 sitemap "
          "name/slug and municipality token matching; not an Internet-wide listing search.")
LIMITATION = ("No sitemap candidate under this method does not establish that no listing "
              "or consumer reviews exist on this source or elsewhere.")


def read(path):
    return json.loads(path.read_text())


def write(root, relative, value):
    path = (root / BASE / relative).resolve()
    if not path.is_relative_to((root / BASE).resolve()):
        raise ValueError("output must stay inside listing-index")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False,
                               allow_nan=False) + "\n")


def tokens(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"\([^()]+\)", "", value.lower()).replace("&", " and ")
    return tuple(ALIASES.get(w, w) for w in re.findall(r"[a-z0-9]+", value))


def name_key(value):
    value = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", value.lower().replace("&", " and "))


def valid_day(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    if not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?"
            r"(Z|[+-]\d{2}:?\d{2})?", value):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def address_key(value):
    words = {"avenue": "ave", "street": "st", "road": "rd", "drive": "dr",
             "boulevard": "blvd", "lane": "ln", "court": "ct", "place": "pl",
             "north": "n", "south": "s", "east": "e", "west": "w", "suite": "ste"}
    return tuple(words.get(w, w) for w in re.findall(r"[a-z0-9]+", str(value or "").lower()))


def official_address(provider):
    raw = provider.get("address", "")
    tail = re.search(r"(?i)\b(New Jersey|NJ)\s+(\d{5}(?:-\d{4})?)\s*$", raw)
    city = provider.get("city")
    state = provider.get("state") or ("NJ" if tail else None)
    if name_key(state) == "newjersey":
        state = "NJ"
    postal = provider.get("zip") or (tail[2] if tail else None)
    street = address_key(raw[:tail.start()] if tail else raw)
    municipality = address_key(city)
    if tail and municipality and street[-len(municipality):] == municipality:
        street = street[:-len(municipality)]
    return street, municipality, name_key(state), postal


def page_assessment(provider, page, campus_settings=()):
    identity = dict(page["identity"])
    identity["publishedAddress"] = identity.pop("address", None)
    official_street, official_city, official_state, postal = official_address(provider)
    exact_name = bool(identity.get("name") and
                      name_key(identity["name"]) == name_key(provider["name"]))
    alias = next((a for a in identity.get("legalAliases", [])
                  if name_key(a["name"]) == name_key(provider["name"])), None)
    legal_dba = re.split(r"(?i)\s+(?:d/?b/?a|doing business as)\s+", provider["name"], maxsplit=1)
    if len(legal_dba) == 2 and name_key(identity.get("name")) in {
            name_key(part) for part in legal_dba if part.strip()}:
        alias = {"evidence": f"Official roster explicitly names {provider['name']}; "
                             f"observed heading exactly names {identity['name']}."}
    if not exact_name and alias:
        identity["nameConfirmed"] = True
        identity["nameBasis"] = alias["evidence"]
    address_matches = bool(
        official_street and official_city and official_state and
        address_key(identity.get("street")) == official_street and
        address_key(identity.get("city")) == official_city and
        name_key(identity.get("state")) == official_state and
        (identity.get("zip") is None or (
            postal and (identity["zip"] == postal or
                        (len(identity["zip"]) == 5 and identity["zip"] == postal[:5])))))
    groups = {CARE_LABELS[label.lower()] for label in identity.get("careLabels", [])
              if CARE_LABELS[label.lower()] is not None}
    category = provider.get("category")
    base_scope = bool(
        category in {"nursing-home", "assisted-living", "home-care"} and
        groups == {category} and
        not identity.get("unrecognizedCareLabels") and
        not (set(campus_settings) - {category}))
    if category == "home-care":
        local_review = next((a for a in page.get("aggregates", [])
                             if a.get("family") and a.get("locationSpecific")), None)
        scope_matches = bool(
            base_scope and provider.get("locationKind") != "facility" and
            address_matches and local_review and not identity.get("contradictoryScope"))
        identity["localReviewAttribution"] = local_review["evidence"] if local_review else None
    else:
        scope_matches = base_scope
    identity["scopeConfirmed"] = scope_matches
    identity["careSetting"] = category if scope_matches else None
    identity["officialScope"] = {
        "category": category, "locationKind": provider.get("locationKind"),
        "services": provider.get("services", []), "limitations": provider.get("limitations", []),
        "limitation": "An office-address match does not expand official specialty, services or service-area limits.",
    }
    checks = {"name": bool(identity.get("name") and (exact_name or alias is not None)),
              "address": address_matches, "scope": scope_matches}
    access = page["pageAccess"]
    checks["page"] = (access["samePage"] and not access["restricted"]
                      and not access.get("interrupted"))
    checked = valid_day(page["observedAt"])
    checks["date"] = checked is not None and checked <= date.today()
    return {"identity": identity, "identityChecks": checks,
            "status": "exact" if all(checks.values()) else "candidate"}


def property_urls(text):
    return sorted({"https://www.mylivingchoice.com/property/" + m.group(1)
                   for m in PROPERTY.finditer(text)})


def fingerprint(root, path):
    return {"path": path.relative_to(root).as_posix(),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def candidate_reason(provider, slug):
    if name_key(provider["name"]) == name_key(slug):
        return "fully normalized full name equals slug; identity unverified"
    name = set(tokens(provider["name"])) - GENERIC
    target = set(tokens(slug)) - GENERIC
    city = set(tokens(provider.get("city", "")))
    shared = name & target
    if not shared:
        return None
    if len(name) >= 2 and (name <= target or target <= name) and len(shared) >= 2:
        return "distinctive name token-set subset; municipality and identity unverified"
    full_name = set(tokens(provider["name"])) - {"the", "and", "of", "at", "llc", "inc"}
    full_slug = set(tokens(slug)) - {"the", "and", "of", "at", "llc", "inc"}
    if city and city <= set(tokens(slug)) and (
            shared - city or (len(full_name) >= 3 and full_name <= full_slug)):
        return "municipality tokens plus provider-name token overlap; identity unverified"
    long_name = sum(map(len, shared)) >= 18 or (
        full_name <= full_slug and sum(map(len, full_name)) >= 24)
    if (len(shared) >= 2 and long_name and
            len(shared) / max(len(name), 1) >= 0.8 and
            len(shared) / max(len(target), 1) >= 0.65):
        return "strong long-name token similarity; municipality and identity unverified"
    return None


def roster(root, denominator="county-roster", expected_count=None):
    providers = read(root / "research/north-jersey/runtime/providers.json")
    if len({p["id"] for p in providers}) != len(providers):
        raise ValueError("duplicate runtime provider IDs")
    counties = defaultdict(set)
    statuses = {"included", "included_historical"}
    for row in read(root / "research/north-jersey/runtime/crosswalk.json"):
        status = row.get("status", "")
        if status in statuses or (denominator == "runtime" and status.startswith("included")):
            counties[row["providerId"]].add(row.get("county"))
    selected, excluded = [], []
    for provider in providers:
        cs = counties[provider["id"]]
        if not cs and denominator == "county-roster":
            excluded.append(provider["id"])
            continue
        if len(cs) != 1 or not cs <= set(COUNTIES):
            raise ValueError(f"provider lacks a unique region county: {provider['id']}")
        selected.append(provider)
    if expected_count is not None and len(selected) != expected_count:
        raise ValueError(f"denominator drift: expected {expected_count}, found {len(selected)}")
    return selected, counties, excluded


def queue(root, denominator="county-roster", expected_count=None, persist=True):
    discovery = root / BASE / "discovery"
    providers_path = root / "research/north-jersey/runtime/providers.json"
    crosswalk_path = root / "research/north-jersey/runtime/crosswalk.json"
    providers, counties, excluded = roster(root, denominator, expected_count)
    index, exact_index = defaultdict(list), defaultdict(list)
    retained = [fingerprint(root, p) for p in (providers_path, crosswalk_path)]
    urls, sitemap_evidence = {}, []
    for number in range(7):
        path = discovery / f"properties-{number}.json"
        data = read(path)
        if data.get("metadata", {}).get("statusCode", 200) != 200:
            raise ValueError(f"unsuccessful retained sitemap: {path}")
        retained.append(fingerprint(root, path))
        sitemap_evidence.append({
            **retained[-1],
            "url": data.get("effectiveUrl") or data.get("url") or
                   f"https://www.mylivingchoice.com/sitemaps/properties-{number}.xml",
            "observedAt": data.get("retrievedAt") or data.get("observedAt"),
        })
        found = property_urls(data["markdown"])
        if not found:
            raise ValueError(f"no property URLs in retained sitemap: {path}")
        for url in found:
            urls.setdefault(url, []).append(path.relative_to(root).as_posix())
    for url in sorted(urls):
        slug = urlsplit(url).path.rsplit("/", 1)[-1]
        exact_index[name_key(slug)].append(url)
        for word in set(tokens(slug)) - GENERIC:
            index[word].append(url)
    city_links = {}
    directory = discovery / "nj-directory.json"
    data = read(directory)
    retained.append(fingerprint(root, directory))
    for url, city_slug in re.findall(
            r"(https://www\.mylivingchoice\.com/properties/best-senior-living/"
            r"([a-z0-9-]+)/new-jersey)", data["markdown"]):
        city_links[" ".join(tokens(city_slug))] = url
    requests, coverage = [], []
    for provider in providers:
        cs = counties[provider["id"]]
        if len(cs) != 1:
            raise ValueError(f"runtime provider lacks a unique region county: {provider['id']}")
        county = next(iter(cs))
        possible = set(exact_index.get(name_key(provider["name"]), []))
        for word in set(tokens(provider["name"])) - GENERIC:
            possible.update(index.get(word, []))
        candidates = []
        for url in sorted(possible):
            slug = urlsplit(url).path.rsplit("/", 1)[-1]
            reason = candidate_reason(provider, slug)
            if reason:
                candidates.append(url)
                requests.append({
                    "providerId": provider["id"], "county": county,
                    "providerName": provider["name"], "providerCity": provider.get("city"),
                    "category": provider.get("category"), "locationKind": provider.get("locationKind"),
                    "source": "MyLivingChoice", "url": url, "slug": slug,
                    "status": "candidate", "reason": reason,
                    "sitemapEvidence": urls[url],
                    "retainedPage": (BASE / "discovery/pages" / f"{slug}.json").as_posix(),
                })
        coverage.append({
            "providerId": provider["id"], "county": county, "candidateCount": len(candidates),
            "status": "candidates" if candidates else "scoped_sitemap_no_hit",
            "method": METHOD, "limitation": LIMITATION,
            "evidence": sitemap_evidence,
            "observedAt": min(e["observedAt"] for e in sitemap_evidence)
                          if all(valid_day(e["observedAt"]) for e in sitemap_evidence) else None,
            "cityDirectoryUrl": city_links.get(" ".join(tokens(provider.get("city", "")))),
        })
    order = lambda r: (COUNTIES.index(r["county"]), r.get("providerName", ""),
                       r["providerId"], r.get("url", ""))
    requests.sort(key=order)
    coverage.sort(key=order)
    result = {"schemaVersion": 1, "countyOrder": COUNTIES,
              "denominator": denominator, "excludedRuntimeProviders": excluded,
              "providerCount": len(providers), "publishedPropertyCount": len(urls),
              "inputs": retained, "requests": requests, "coverage": coverage,
              "limitation": "All URL similarities are candidates, never identity evidence."}
    if persist:
        write(root, "discovery-queue.json", result)
    return result


def request_plan(root, denominator="runtime", expected_count=None, persist=True):
    """Select pages for direct inspection while retaining every deferred candidate."""
    roster_queue = queue(root, denominator, expected_count, persist=False)
    priority, deferred = [], []
    legal_suffixes = {"llc", "inc", "corp", "corporation", "incorporated"}
    for row in roster_queue["requests"]:
        name = set(tokens(row["providerName"])) - legal_suffixes
        slug = set(tokens(row["slug"])) - legal_suffixes
        city = set(tokens(row["providerCity"]))
        distinctive = (name & slug) - GENERIC
        high_priority = (name_key(row["providerName"]) == name_key(row["slug"])
                         or name == slug or bool(distinctive and city and city <= slug)
                         or len(distinctive) >= 3)
        (priority if high_priority else deferred).append(row)
    result = {"providerCount": roster_queue["providerCount"], "denominator": denominator,
              "requests": priority, "deferredCandidates": deferred,
              "uniquePriorityUrls": len({r["url"] for r in priority}),
              "uniqueDeferredUrls": len({r["url"] for r in deferred}),
              "selection": "Exact normalized name, legal suffix variant, explicit municipality and name overlap, or three distinctive name tokens. All identities still require a source check."}
    if persist:
        write(root, "fetch-plan.json", result)
    return result


def target_text(markdown):
    stop = re.search(
        r"(?im)^#{1,6}\s+(?:more .*(?:near|like)|nearby|similar|other communities|"
        r"recommended communities|compare with similar|explore (?:nearby|other))", markdown)
    return markdown[:stop.start()] if stop else markdown


def aggregate_sections(text):
    blocks = re.split(r"(?m)^(#{1,6}\s+[^\n]+)\n", text)
    selected = []
    active = False
    for block in blocks:
        if re.match(r"^#{1,6}\s", block):
            active = bool(re.search(r"reviews|faq|frequently asked|common questions", block, re.I))
        elif active:
            selected.append(re.split(
                r"(?im)\[Write a review\]|\[via (?:Google|Yelp)|!\[\]\(https://lh3\.",
                block)[0])
    return "\n".join(selected)


BRAND_ROLLUP = re.compile(
    r"(?i)\b\d[\d,]*\s+(?:communities|locations)\b"
    r"|\b(?:nationwide|national\s+average|brand(?:\s+average|\s+wide)?|franchise)\b"
    r"|\bacross\s+all\s+(?:our\s+)?(?:locations|communities)\b")


def local_attribution(section, match, name):
    boundary = section.rfind("\n\n", 0, match.start())
    begin = 0 if boundary < 0 else boundary + 2
    finish = section.find("\n\n", match.end())
    paragraph = section[begin:finish if finish != -1 else len(section)]
    if BRAND_ROLLUP.search(paragraph):
        return False
    return bool(name and name_key(name) and name_key(name) in name_key(paragraph))


def aggregates(text, name=None):
    section = aggregate_sections(text)
    results = []
    # Only explicit aggregate statements survive. Individual excerpts never do.
    pattern = re.compile(
        r"(?P<value>\d(?:\.\d+)?)\s*(?:out of|/)\s*(?P<scale>5|10)"
        r"(?:\s+(?:rating|stars?))?\s*(?:based on|from|across)\s*"
        r"(?P<count>[\d,]+)\s+(?:public\s+)?"
        r"(?P<source>Google|Yelp|Caring\.com|A Place for Mom|SeniorAdvisor\.com|MyLivingChoice)"
        r"\s+(?:consumer\s+)?(?:reviews|ratings)", re.I)
    for match in pattern.finditer(section):
        line_start = section.rfind("\n", 0, match.start()) + 1
        prefix = section[line_start:match.start()]
        if prefix.lstrip().startswith((">", '"', "“")) or re.search(
                r"Medicare|CMS|nearby|other communit|individual|rated it", prefix, re.I):
            continue
        source = match["source"].lower()
        value, scale, count = float(match["value"]), int(match["scale"]), int(match["count"].replace(",", ""))
        if value <= scale:
            result = {"value": value, "scale": scale, "count": count,
                      "family": SOURCE_NAMES[source], "asOf": None,
                      "scope": "consumer", "kind": "consumer-average",
                      "evidence": match.group(0), "attribution": match["source"],
                      "locationSpecific": local_attribution(section, match, name),
                      "syndicated": source != "mylivingchoice"}
            if result not in results:
                results.append(result)
    google = re.compile(r"(?i)(\d(?:\.\d+)?)\s*(?:★|stars?)?\s*on\s+Google\s*\(([\d,]+)\)")
    for match in google.finditer(section):
        prefix = section[section.rfind("\n", 0, match.start()) + 1:match.start()]
        if prefix.lstrip().startswith((">", '"', "“")):
            continue
        value, count = float(match[1]), int(match[2].replace(",", ""))
        if value <= 5 and not any(r["family"] == "google" and r["value"] == value and r["count"] == count for r in results):
            results.append({"value": value, "scale": 5, "count": count, "family": "google",
                            "asOf": None, "scope": "consumer", "kind": "consumer-average",
                            "evidence": match[0], "attribution": "Google",
                            "locationSpecific": local_attribution(section, match, name),
                            "syndicated": True})
    if not results:
        combined = re.search(r"(?im)^(\d(?:\.\d+)?)\s*overall\s*[·•-]\s*([\d,]+)\s+ratings combined\s*$", section)
        if combined and float(combined[1]) <= 5:
            results.append({"value": float(combined[1]), "scale": 5,
                            "count": int(combined[2].replace(",", "")), "family": None,
                            "asOf": None, "scope": "consumer", "kind": "consumer-average",
                            "evidence": combined[0], "attribution": None,
                            "locationSpecific": local_attribution(section, combined, name),
                            "syndicated": None})
    return results


CONTRADICTORY_SCOPE = re.compile(
    r"(?i)\b(?:staffing\s+only|(?:registered|administrative|corporate)\s+office\s+only"
    r"|no\s+care\s+(?:is\s+)?(?:provided|delivered)\s+at\s+this\s+location"
    r"|does\s+not\s+provide\s+care\s+at\s+this\s+location"
    r"|service[- ]area\s+(?:listing|page)\s+only)\b")


def extract_page(data, url):
    error = data.get("error") or data.get("metadata", {}).get("error")
    text = target_text(data.get("markdown") or "")
    heading = re.search(r"(?m)^#\s+([^\n]+)", text)
    name = heading[1].strip() if heading else None
    header = re.split(r"(?m)^#{2,6}\s", text, maxsplit=1)[0]
    address = re.search(
        r"(?im)(?<!\w)(\d+[A-Za-z]?(?:[- ]\d+)?\s+[A-Za-z0-9 .#'’/-]+?),"
        r"\s*([A-Za-z .'-]+?),\s*(New Jersey|NJ)(?:\s+(\d{5}(?:-\d{4})?))?", header)
    identity = {"name": name, "address": address[0] if address else None,
                "street": address[1].strip() if address else None,
                "city": address[2].strip() if address else None,
                "state": "NJ" if address else None, "zip": address[4] if address else None,
                "scopeConfirmed": False, "careSetting": None, "careUnitText": None,
                "evidence": heading[0] if heading else None}
    care = re.search(r"(?ims)^#{1,6}\s+Types of Care[^\n]*\n(.*?)(?=^#{1,6}\s|\Z)", text)
    if care:
        labels = re.findall("|".join(re.escape(label) for label in CARE_LABELS), care[1], re.I)
        identity["careLabels"] = list(dict.fromkeys(labels))
        remaining = re.sub("|".join(re.escape(label) for label in CARE_LABELS), "", care[1], flags=re.I)
        identity["unrecognizedCareLabels"] = bool(re.search(r"[A-Za-z0-9]", remaining))
        identity["careUnitText"] = ", ".join(dict.fromkeys(labels)) or None
    aliases = []
    before_reviews = re.split(r"(?im)^#{1,6}\s+Reviews\b", text)[0]
    before_reviews = re.sub(
        r"(?ims)^#{1,6}\s+What Families Think\b.*?(?=^#{1,2}\s|\Z)", "", before_reviews)
    for alias in re.finditer(
            r"(?im)^(?:Legal name|DBA|D/B/A|Doing business as|Also legally known as)"
            r"\s*:\s*([^\n]+)$", before_reviews):
        aliases.append({"name": alias[1].strip(), "evidence": alias[0]})
    identity["legalAliases"] = aliases
    identity["evidence"] = "\n".join(x for x in (
        heading[0] if heading else None, address[0] if address else None,
        identity["careUnitText"]) if x) or None
    office = re.search(r"(?im)^(?:Registered office|Office location|Service area|Serves .+count(?:y|ies))\b[^\n]*", text)
    identity["officeScope"] = office[0].strip() if office and len(office[0]) <= 300 else None
    contradictory = CONTRADICTORY_SCOPE.search(text)
    identity["contradictoryScope"] = contradictory[0] if contradictory else None
    status = data.get("metadata", {}).get("statusCode", data.get("statusCode"))
    interrupted = bool(error)
    restricted = not interrupted and ((status is not None and status != 200) or bool(re.search(
        r"captcha|verify you are human|access denied|sign.in required", text[:2000], re.I)))
    effective = data.get("effectiveUrl") or data.get("url")
    same_page = not interrupted and (not effective or effective.rstrip("/") == url.rstrip("/"))
    return {"identity": identity, "aggregates": aggregates(text, name) if same_page and not restricted else [],
            "pageAccess": {"httpStatus": status, "effectiveUrl": effective,
                           "samePage": same_page, "restricted": restricted,
                           "interrupted": interrupted, "error": error if interrupted else None},
            "observedAt": data.get("retrievedAt") or data.get("observedAt")}


def ingest(root, denominator="county-roster", expected_count=None, persist=True):
    queued = queue(root, denominator, expected_count, persist=False)
    providers, _, _ = roster(root, denominator, expected_count)
    by_id = {p["id"]: p for p in providers}
    campus_settings, providers_by_address = defaultdict(set), defaultdict(list)
    for provider in read(root / "research/north-jersey/runtime/providers.json"):
        campus_settings[official_address(provider)[:3]].add(provider.get("category"))
    for provider in providers:
        providers_by_address[official_address(provider)[:3]].append(provider)
    policies_path = root / "research/north-jersey/reviews/source-access.json"
    policies = read(policies_path).get("sources", []) if policies_path.exists() else []
    policy = next((p for p in policies if p.get("source") == "MyLivingChoice"), {})
    permitted = policy.get("access_decision") == "permitted_low_volume"
    observations = []
    pages, requests = {}, list(queued["requests"])
    associated = {(r["providerId"], r["url"]) for r in requests}
    discovery = root / BASE / "discovery"
    for path in sorted(discovery.glob("**/*.json")):
        if path.name == "normalized-observations.json":
            continue
        data = read(path)
        if not isinstance(data, dict) or (
                "markdown" not in data and
                not (data.get("error") or data.get("metadata", {}).get("error"))):
            continue
        url = (data.get("effectiveUrl") or data.get("url") or
               data.get("metadata", {}).get("url"))
        if not url or property_urls(url) != [url.rstrip("/")]:
            continue
        page = extract_page(data, url)
        pages[(path.resolve(), url)] = page
        identity = page["identity"]
        if page["pageAccess"]["interrupted"] or not identity.get("street") or not identity.get("city"):
            continue
        address = (address_key(identity.get("street")), address_key(identity.get("city")),
                   name_key(identity.get("state")))
        for provider in providers_by_address.get(address, []):
            key = (provider["id"], url)
            assessment = page_assessment(provider, page, campus_settings[official_address(provider)[:3]])
            if (key not in associated and assessment["identityChecks"]["name"] and
                    assessment["identityChecks"]["address"]):
                requests.append({
                    "providerId": provider["id"], "url": url,
                    "reason": "Retained direct page matched by actual name/address, not slug; scope assessed separately.",
                    "retainedPage": path.relative_to(root).as_posix(),
                })
                associated.add(key)
    for request in requests:
        path = (root / request["retainedPage"]).resolve()
        if not path.is_relative_to(discovery.resolve()):
            raise ValueError("retained page outside discovery")
        key = (path, request["url"])
        if key not in pages:
            pages[key] = extract_page(read(path), request["url"]) if path.exists() else None
        page = pages[key]
        provider = by_id[request["providerId"]]
        interrupted = bool(page and page["pageAccess"].get("interrupted"))
        assessment = page_assessment(
            provider, page, campus_settings[official_address(provider)[:3]]
        ) if page and not interrupted else None
        base = {"providerId": request["providerId"], "source": "MyLivingChoice",
                "url": request["url"],
                "status": ("unattempted" if interrupted else
                           assessment["status"] if assessment else "candidate"),
                "sourceType": "review-platform", "discoveryReason": request["reason"],
                "inspection": "full-page" if assessment else None,
                "observedAt": page["observedAt"] if page and not interrupted else None,
                "identity": assessment["identity"] if assessment else {},
                "identityChecks": assessment["identityChecks"] if assessment else None,
                "access": {"decision": "permitted_low_volume" if permitted else "unknown"},
                "pageAccess": page["pageAccess"] if page else {"status": "not_retained"},
                "retainedPage": request["retainedPage"],
                "aggregate": None}
        if page:
            base["retainedSha256"] = fingerprint(root, path)["sha256"]
            if page["pageAccess"]["restricted"]:
                base["status"] = "access_restricted"
                base["access"]["decision"] = "restricted"
        found = page["aggregates"] if page else []
        for aggregate in found or [None]:
            observations.append({**base, "aggregate": aggregate})
    assessed = {o["providerId"] for o in observations if o.get("inspection") == "full-page"}
    for coverage in queued["coverage"]:
        if coverage["candidateCount"] == 0 and coverage["providerId"] not in assessed:
            observations.append({
                "providerId": coverage["providerId"], "source": "MyLivingChoice",
                "status": "no_hit" if valid_day(coverage["observedAt"]) and
                          valid_day(coverage["observedAt"]) <= date.today() else "unattempted",
                "method": coverage["method"], "limitation": coverage["limitation"],
                "observedAt": coverage["observedAt"], "evidence": coverage["evidence"],
                "url": coverage["evidence"][0]["url"], "inspection": "sitemap-only",
                "sourceType": "review-platform", "identity": {}, "aggregate": None,
                "access": {"decision": "permitted_low_volume" if permitted else "unknown"},
            })
    result = {"schemaVersion": 1, "observations": observations,
              "denominator": denominator, "providerCount": len(providers),
              "limitation": "Exact requests require independent sibling verification, not publication. "
                            "Unknown aggregate source families remain null, never inferred from the host."}
    if persist:
        write(root, "discovery/normalized-observations.json", result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["queue", "plan", "ingest", "assess"])
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--denominator", choices=["county-roster", "runtime"], default="county-roster")
    parser.add_argument("--expected-count", type=int, default=None,
                        help="optional guard asserting the derived roster count")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        run = {"queue": queue, "plan": request_plan, "ingest": ingest, "assess": ingest}[args.command]
        result = run(args.root.resolve(), args.denominator, args.expected_count, persist=not args.dry_run)
        if args.command == "queue" and not args.dry_run:
            result = {"providerCount": result["providerCount"],
                      "publishedPropertyCount": result["publishedPropertyCount"],
                      "requests": len(result["requests"]),
                      "countyCandidates": dict(Counter(r["county"] for r in result["requests"]))}
        elif not args.dry_run and args.command == "plan":
            result = {k: result[k] for k in ("providerCount", "uniquePriorityUrls", "uniqueDeferredUrls")}
        elif not args.dry_run:
            result = {"providerCount": result["providerCount"],
                      "observations": len(result["observations"]),
                      "statuses": dict(Counter(o["status"] for o in result["observations"])),
                      "aggregates": sum(o["aggregate"] is not None for o in result["observations"])}
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"listing-index-discover: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
