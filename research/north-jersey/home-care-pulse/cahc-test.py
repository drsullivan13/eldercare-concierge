#!/usr/bin/env python3
"""Regression checks for the retained CAHC exact-office release."""

import copy
import csv
import io
import json
from pathlib import Path
import re
import runpy
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
GENERATOR = HERE / "cahc-generate.py"
G = runpy.run_path(str(GENERATOR))
URL = "https://www.cahcusa.org/category/new-jersey/bergen-county/"
SCOPE = "Companion/Personal Care Services"
DATE = "2026-11-14"
PUBLIC_SCOPES = {
    "Companion/Personal Care Services":
        "CAHC lists companion/personal care accreditation",
    "Community Based Skilled Nursing":
        "CAHC lists community-based skilled nursing accreditation",
    "Community Based Skilled Nursing Services":
        "CAHC lists community-based skilled nursing accreditation",
    "Community Based Skilled Nursing Service":
        "CAHC lists community-based skilled nursing accreditation",
    "Community Based Skilled Nursing – Infusion Services":
        "CAHC lists community-based skilled nursing accreditation limited to infusion services",
    "Community Based Skilled Nursing and School Student Nursing":
        "CAHC lists community-based skilled nursing and school student nursing accreditation",
    "Companion/Personal Care Services & Community Based Skilled Nursing":
        "CAHC lists companion/personal care and community-based skilled nursing accreditation",
    "Companion/Personal Care Services and Community Based Skilled Nursing":
        "CAHC lists companion/personal care and community-based skilled nursing accreditation",
    "Companion/Personal Care Services & Comunity Based Skilled Nursing":
        "CAHC lists companion/personal care and community-based skilled nursing accreditation",
    "Companion/Personal Care Services & Community Based Skilled Nursing Services":
        "CAHC lists companion/personal care and community-based skilled nursing accreditation",
}


def listing(**changes):
    return {**dict(legalName="Acme Care, LLC", city="Hackensack", zip="07601",
                   phone="201-555-0100", scope=[SCOPE], sourceUrl=URL), **changes}


def office(**changes):
    return {**dict(id="office-a", category="home-care", name="ACME CARE, LLC",
                   city="HACKENSACK", state="NJ", address="10 Main Street, Suite 1",
                   phone="(201) 555-0100", zip="07601"), **changes}


def bridge(provider, trade_name, **changes):
    return {**dict(providerId=provider["id"], sourceRow="10", legalName=provider["name"],
                   stateRegisteredTradeNames=trade_name, address=provider["address"],
                   city=provider["city"], phone=provider["phone"]), **changes}


def generate(rows=None, registry=None, dbas=None, issues=None):
    rows = rows if rows is not None else [listing()]
    return G["build"](
        rows, dbas or [], registry if registry is not None else [office()],
        [dict(inputOrder=i, issues=issues or []) for i in range(len(rows))], DATE,
    )


def decision(**kwargs):
    return generate(**kwargs)["cahc-decisions.json"][0]


def raw(name="Acme Care, LLC", body=None, **changes):
    return {**dict(name=name, sourceText=body or (
        "Acme Care, LLC Hackensack, NJ 07601 Accredited for: "
        "Companion/Personal Care Services Phone: 201-555-0100 "
        "Email: private@example.test http://agency.example.test"
    ), county="Bergen County", indexUrl=URL), **changes}


class MatchingTests(unittest.TestCase):
    def test_unique_legal_name_city_and_primary_phone(self):
        d = decision()
        self.assertEqual((d["status"], d["providerId"]), ("accepted", "office-a"))
        self.assertTrue(d["candidateEvidence"][0]["exactPrimaryPhone"])

    def test_no_name_only(self):
        d = decision(rows=[listing(phone="201-555-0199")])
        self.assertEqual(d["status"], "rejected")
        self.assertIn("primary-phone-mismatch", d["reason"])

    def test_no_phone_only_or_directory_identity_proof(self):
        d = decision(rows=[listing(legalName="Unrelated Agency")])
        self.assertEqual(d["status"], "rejected")
        self.assertIn("phone-only", d["reason"])

    def test_wrong_city_and_no_city_alias(self):
        for city in ("Teaneck", "South Hackensack", "Hackensack Township"):
            with self.subTest(city=city):
                d = decision(rows=[listing(city=city)])
                self.assertEqual(d["status"], "rejected")
                self.assertFalse(d["candidateEvidence"][0]["sameCity"])

    def test_non_nj_office_and_other_category(self):
        self.assertEqual(decision(registry=[office(state="NY")])["status"], "rejected")
        self.assertEqual(decision(registry=[office(category="nursing-home")])["status"], "rejected")

    def test_missing_phone_cannot_use_name_and_city(self):
        self.assertEqual(decision(rows=[listing(phone="")])["status"], "rejected")
        self.assertEqual(decision(registry=[office(phone="")])["status"], "rejected")

    def test_primary_not_bridge_alternate_phone(self):
        p = office(name="Registered Legal Company")
        b = bridge(p, "Acme Care, LLC", phone="201-555-0100")
        p["phone"] = "201-555-0199"
        d = decision(registry=[p], dbas=[b])
        self.assertNotEqual(d["status"], "accepted")
        self.assertFalse(d["candidateEvidence"][0]["bridgeConsistent"])
        self.assertFalse(d["candidateEvidence"][0]["exactPrimaryPhone"])

    def test_missing_registry_primary_is_not_filled_from_bridge(self):
        p = office(name="Registered Legal Company")
        b = bridge(p, "Acme Care, LLC")
        p["phone"] = ""
        self.assertNotEqual(decision(registry=[p], dbas=[b])["status"], "accepted")

    def test_exact_registered_dba_with_commas_not_split(self):
        p = office(name="Registered Legal Company")
        b = bridge(p, "Helping, Hands, Inc.")
        self.assertEqual(decision(rows=[listing(legalName="Helping, Hands, Inc.")],
                                  registry=[p], dbas=[b])["status"], "accepted")
        self.assertEqual(decision(rows=[listing(legalName="Helping")],
                                  registry=[p], dbas=[b])["status"], "rejected")
        self.assertEqual(b["stateRegisteredTradeNames"], "Helping, Hands, Inc.")

    def test_registered_legal_dba_marker_is_explicit(self):
        p = office(name="Registered Legal Company DBA Acme Care, LLC")
        self.assertEqual(decision(registry=[p])["status"], "accepted")

    def test_no_invented_alias_or_fuzzy_threshold(self):
        for name in ("Acme Healthcare", "Acme Home Care", "Acmee Care", "Acme"):
            self.assertEqual(decision(rows=[listing(legalName=name)])["status"], "rejected")

    def test_bridge_must_anchor_exact_legal_city_street_and_primary(self):
        p = office(name="Registered Legal Company")
        for key, wrong in (("legalName", "Other Legal"), ("city", "Teaneck"),
                           ("address", "10 Main Street, Suite 2"), ("phone", "201-555-0199")):
            with self.subTest(key=key):
                b = bridge(p, "Acme Care, LLC", **{key: wrong})
                self.assertEqual(decision(registry=[p], dbas=[b])["status"], "ambiguous")

    def test_shared_primary_same_city_brand_multiple_offices_fail_closed(self):
        p = office(id="office-b", address="20 Main Street")
        d = decision(registry=[office(), p])
        self.assertEqual(d["status"], "ambiguous")
        self.assertIsNone(d["providerId"])
        self.assertEqual(len([e for e in d["candidateEvidence"] if e["eligible"]]), 2)

    def test_conflicting_bridge_cannot_hide_a_shared_phone_competing_office(self):
        p = office(id="office-b", address="20 Main Street")
        b = bridge(p, "Acme Care, LLC", address="30 Main Street")
        d = decision(registry=[office(), p], dbas=[b])
        self.assertEqual(d["status"], "ambiguous")
        self.assertIsNone(d["providerId"])
        self.assertEqual(d["reason"], "registry-dba-bridge-identity-conflict")

    def test_conflicting_bridge_cannot_hide_a_registered_dba_competing_office(self):
        p = office(id="office-b", name="Separate Legal", address="20 Main Street")
        b = bridge(p, "Acme Care, LLC", address="30 Main Street")
        self.assertEqual(decision(registry=[office(), p], dbas=[b])["status"], "ambiguous")

    def test_same_city_brand_offices_distinguished_by_primary_phone(self):
        p = office(id="office-b", address="20 Main Street", phone="201-555-0199")
        self.assertEqual(decision(registry=[p, office()])["providerId"], "office-a")

    def test_unrelated_colocated_shared_phone_conflict_fails_closed(self):
        p = office(id="office-b", name="Unrelated Staffing")
        d = decision(registry=[office(), p])
        self.assertEqual(d["status"], "ambiguous")
        self.assertEqual(d["reason"], "colocated-conflicting-registrations")

    def test_colocated_conflict_uses_literal_street_abbreviations_and_suite(self):
        p = office(id="office-b", name="Unrelated Staffing", address="10 Main St., Ste. 1")
        self.assertEqual(decision(registry=[office(), p])["status"], "ambiguous")
        p["address"] = "10 Main St., Ste. 2"
        self.assertEqual(decision(registry=[office(), p])["status"], "accepted")

    def test_unrelated_colocated_office_does_not_gain_evidence(self):
        p = office(id="office-b", name="Unrelated Staffing", phone="201-555-0199")
        self.assertEqual(decision(registry=[office(), p])["providerId"], "office-a")
        d = decision(rows=[listing(legalName="Unrelated Staffing")], registry=[office(), p])
        self.assertEqual(d["status"], "rejected")

    def test_duplicate_ids_do_not_choose_arbitrary_first(self):
        with self.assertRaisesRegex(ValueError, "duplicate registry"):
            generate(registry=[office(), office()])
        b = bridge(office(), "Acme")
        with self.assertRaisesRegex(ValueError, "duplicate DBA"):
            generate(dbas=[b, b])


class DirectoryCollisionTests(unittest.TestCase):
    def test_same_city_distinct_directory_names_veto_every_accepted_scope(self):
        rows = [listing(), listing(legalName="Unrelated Staffing"),
                listing(scope=["Community Based Skilled Nursing"])]
        outputs = generate(rows=rows)
        self.assertEqual(outputs["cahc-branches.json"], [])
        for d in outputs["cahc-decisions.json"]:
            self.assertEqual((d["status"], d["reason"]), (
                "ambiguous", "directory-shared-phone-identity-conflict"))
            self.assertIsNone(d["providerId"])
            self.assertTrue(any(e["identityConflict"] for e in d["directoryPhoneEvidence"]))

    def test_two_registry_matches_do_not_override_cross_row_conflict(self):
        p = office(id="office-b", name="Unrelated Staffing", address="20 Main Street")
        out = generate(rows=[listing(), listing(legalName=p["name"])], registry=[office(), p])
        self.assertEqual(out["cahc-branches.json"], [])
        self.assertTrue(all(d["reason"] == "directory-shared-phone-identity-conflict"
                            for d in out["cahc-decisions.json"]))

    def test_competing_registry_name_with_wrong_primary_stays_in_candidate_audit(self):
        p = office(id="office-b", name="Unrelated Staffing", phone="201-555-0199")
        d = decision(rows=[listing(), listing(legalName=p["name"])], registry=[office(), p])
        candidate = next(e for e in d["candidateEvidence"] if e["providerId"] == "office-b")
        self.assertFalse(candidate["exactPrimaryPhone"])
        self.assertFalse(candidate["eligible"])
        self.assertEqual(candidate["directoryNameInputOrders"], [1])

    def test_unknown_scope_does_not_hide_competing_directory_identity(self):
        d = decision(rows=[listing(), listing(legalName="Unrelated Staffing", scope=["Unknown"])])
        self.assertEqual(d["reason"], "directory-shared-phone-identity-conflict")

    def test_duplicate_body_and_contaminated_heading_are_not_competing_names(self):
        rows, audit = G["extract_discoveries"]([raw(), raw(name="Unrelated Staffing")],
                                               [office()], [])
        out = G["build"](rows, [], [office()], audit, DATE)
        self.assertEqual([d["status"] for d in out["cahc-decisions.json"]],
                         ["accepted", "accepted"])
        self.assertEqual(len(out["cahc-branches.json"]), 1)
        self.assertFalse(out["cahc-decisions.json"][0]["directoryPhoneEvidence"][0]["identityConflict"])

    def test_punctuation_and_registered_legal_dba_names_are_not_conflicts(self):
        p = office(name="Registered Legal Company")
        for b in (bridge(p, "Acme Care, LLC"),
                  bridge(p, "Registered Legal Company DBA Acme Care, LLC")):
            out = generate(rows=[listing(), listing(legalName=p["name"]),
                                 listing(legalName="ACME CARE INC.")], registry=[p], dbas=[b])
            self.assertTrue(all(d["status"] == "accepted" for d in out["cahc-decisions.json"]))

    def test_unregistered_directory_dba_cannot_explain_competing_name(self):
        rows = [listing(legalName="Acme Care DBA Unregistered Brand"),
                listing(legalName="Unregistered Brand")]
        self.assertEqual(decision(rows=rows)["reason"], "directory-shared-phone-identity-conflict")

    def test_unrelated_other_city_is_audited_without_transferring_identity(self):
        rows = [listing(), listing(legalName="Unrelated Staffing", city="Teaneck")]
        out = generate(rows=rows)
        a, b = out["cahc-decisions.json"]
        self.assertEqual(a["status"], "accepted")
        self.assertEqual(b["status"], "rejected")
        self.assertFalse(a["directoryPhoneEvidence"][0]["sameCity"])
        self.assertFalse(a["directoryPhoneEvidence"][0]["identityConflict"])
        self.assertEqual(len(out["cahc-audit.json"]["sharedDirectoryPhones"]), 1)
        rows[0]["city"] = "Teaneck"
        self.assertEqual(decision(rows=rows)["reason"], "directory-shared-phone-identity-conflict")

    def test_different_city_same_brand_needs_correct_city_and_primary_phone(self):
        p = office(id="office-b", city="TEANECK", address="20 Main Street")
        out = generate(rows=[listing(), listing(city="Teaneck")], registry=[office(), p])
        self.assertEqual([d["providerId"] for d in out["cahc-decisions.json"]],
                         ["office-a", "office-b"])

    def test_unrelated_other_city_can_accept_its_own_matching_registry_office(self):
        p = office(id="office-b", name="Unrelated Staffing", city="TEANECK")
        rows = [listing(), listing(legalName=p["name"], city="Teaneck")]
        out = generate(rows=rows, registry=[office(), p])
        self.assertEqual([d["providerId"] for d in out["cahc-decisions.json"]],
                         ["office-a", "office-b"])
        rows[1]["city"] = "South Hackensack"
        self.assertEqual(decision(rows=rows, registry=[office(), p])["status"], "accepted")
        self.assertEqual(generate(rows=rows, registry=[office(), p])[
            "cahc-decisions.json"][1]["status"], "rejected")

    def test_conflict_does_not_depend_on_row_order_or_phone_punctuation(self):
        rows = [listing(), listing(legalName="Unrelated Staffing", phone="+1 (201) 555-0100")]
        for source in (rows, list(reversed(rows))):
            out = generate(rows=source)
            self.assertEqual(out["cahc-branches.json"], [])
            self.assertEqual(out["cahc-audit.json"]["decisions"], {"ambiguous": 2})

    def test_registry_colocation_audit_covers_unrelated_different_primary(self):
        p = office(id="office-b", name="Unrelated Staffing", phone="201-555-0199",
                   address="10 Main St., Ste. 1")
        out = generate(registry=[office(), p])
        self.assertEqual(out["cahc-branches.json"][0]["providerId"], "office-a")
        trace = out["cahc-audit.json"]["acceptedRegistryColocations"][0]
        self.assertEqual(trace["providerId"], "office-a")
        peer = trace["colocations"][0]
        self.assertEqual(peer["providerId"], "office-b")
        self.assertTrue(peer["exactOfficeAddress"])
        self.assertFalse(peer["samePrimaryPhone"])
        self.assertFalse(peer["identityConflict"])

    def test_registry_building_match_does_not_invent_same_suite_or_directory_street(self):
        p = office(id="office-b", name="Unrelated Staffing", address="10 Main St., Ste. 2")
        out = generate(registry=[office(), p])
        self.assertEqual(out["cahc-branches.json"][0]["address"], "Hackensack, NJ")
        peer = out["cahc-audit.json"]["acceptedRegistryColocations"][0]["colocations"][0]
        self.assertFalse(peer["exactOfficeAddress"])
        self.assertTrue(peer["samePrimaryPhone"])
        self.assertFalse(peer["identityConflict"])

    def test_equivalent_names_shared_phone_same_office_suite_punctuation_reject(self):
        p = office(id="office-b", name="Acme Care Inc.", address="10 Main St., Ste. 1")
        self.assertEqual(decision(registry=[office(), p])["status"], "ambiguous")

    def test_colocated_comparable_registered_dba_with_different_primary_keeps_match(self):
        p = office(id="office-b", name="Other Legal Company", phone="201-555-0199",
                   address="10 Main St., Ste. 1")
        out = generate(registry=[office(), p], dbas=[bridge(p, "Acme Care")])
        trace = out["cahc-audit.json"]["acceptedRegistryColocations"][0]
        self.assertEqual(trace["providerId"], "office-a")
        self.assertTrue(trace["colocations"][0]["comparableName"])
        self.assertTrue(trace["colocations"][0]["exactOfficeAddress"])
        self.assertFalse(trace["colocations"][0]["samePrimaryPhone"])
        self.assertEqual(out["cahc-branches.json"][0]["providerId"], "office-a")


class ExtractionTests(unittest.TestCase):
    def extract(self, rows):
        return G["extract_discoveries"](rows, [office()], [])

    def test_heading_neighbor_contamination_uses_body_only(self):
        rows, audit = self.extract([raw(name="Unrelated Staffing")])
        self.assertEqual(rows[0]["legalName"], "Acme Care, LLC")
        self.assertIn("heading-body-conflict", audit[0]["issues"])
        outputs = G["build"](rows, [], [office(), office(
            id="office-b", name="Unrelated Staffing", phone="201-555-0199")], audit, DATE)
        self.assertEqual(outputs["cahc-branches.json"][0]["providerId"], "office-a")

    def test_unresolved_heading_body_conflict_is_audited_and_not_published(self):
        rows, audit = self.extract([raw(name="Other", body=(
            "Mystery Agency Nowhere, NJ 07601 Accredited for: "
            "Companion/Personal Care Services Phone: 201-555-0100"))])
        self.assertEqual(rows[0]["legalName"], "")
        self.assertEqual(audit[0]["bodyPrefix"], "Mystery Agency Nowhere")
        self.assertIn("uncertain-name-city-boundary", audit[0]["issues"])
        self.assertEqual(generate(rows=rows, issues=audit[0]["issues"])["cahc-branches.json"], [])

    def test_two_listing_bodies_cannot_transfer_evidence(self):
        rows, audit = self.extract([raw(body=raw()["sourceText"] + " " + raw()["sourceText"])])
        self.assertIn("uncertain-listing-boundary", audit[0]["issues"])
        self.assertEqual(generate(rows=rows, issues=audit[0]["issues"])["cahc-branches.json"], [])

    def test_missing_and_malformed_zip_preserved_without_repair(self):
        for zip_text, expected in (("", "missing"), ("080755", "malformed")):
            with self.subTest(zip=zip_text):
                rows, audit = self.extract([raw(body=raw()["sourceText"].replace("07601", zip_text))])
                self.assertEqual(rows[0]["zip"], zip_text)
                self.assertIn(expected + "-zip", audit[0]["issues"])
                out = G["build"](rows, [], [office()], audit, DATE)
                self.assertEqual(out["cahc-branches.json"][0]["address"], "Hackensack, NJ")
                self.assertEqual(out["cahc-decisions.json"][0]["zipStatus"], expected)

    def test_well_formed_zip_is_not_corrected_from_registry(self):
        out = generate(rows=[listing(zip="08102")])
        d = out["cahc-decisions.json"][0]
        self.assertEqual(d["listing"]["zip"], "08102")
        self.assertEqual((d["status"], d["reason"], d["providerId"]),
                         ("ambiguous", "directory-registry-zip-conflict", None))
        self.assertEqual(out["cahc-branches.json"], [])
        self.assertEqual(out["cahc-audit.json"]["acceptedZipConflicts"], [])
        self.assertFalse(d["candidateEvidence"][0]["directoryZipMatchesRegistry"])

    def test_directory_phone_missing_or_multiple(self):
        for body in (raw()["sourceText"].replace("Phone: 201-555-0100", ""),
                     raw()["sourceText"] + " Phone: 201-555-0199"):
            rows, audit = self.extract([raw(body=body)])
            self.assertEqual(rows[0]["phone"], "")
            self.assertEqual(generate(rows=rows)["cahc-branches.json"], [])

    def test_unlabeled_phone_stays_out_of_scope(self):
        rows, audit = self.extract([raw(body=raw()["sourceText"].replace("Phone: ", ""))])
        self.assertEqual(rows[0]["phone"], "201-555-0100")
        self.assertEqual(rows[0]["scope"], [SCOPE])

    def test_distinction_is_not_a_public_award(self):
        rows, audit = self.extract([raw(body=raw()["sourceText"].replace(
            "Accredited for:", "Accredited with Distinction for:"))])
        out = G["build"](rows, [], [office()], audit, DATE)
        self.assertEqual(out["cahc-branches.json"][0]["awards"], [])
        self.assertNotIn("Distinction", json.dumps(out["cahc-branches.json"]))

    def test_redaction_retains_only_six_fields(self):
        rows, _ = self.extract([raw(officeUrl="https://www.cahcusa.org/acme/")])
        self.assertEqual(set(rows[0]), G["LISTING_FIELDS"])
        self.assertEqual(rows[0]["sourceUrl"], URL)
        self.assertNotIn("private@", json.dumps(rows))
        self.assertNotIn("agency.example", json.dumps(rows))

    def test_csv_preserves_complete_dba_strings(self):
        text = 'providerId,stateRegisteredTradeNames\\na,"Helping, Hands, Inc."\\n'.replace("\\n", "\n")
        rows = list(csv.DictReader(io.StringIO(text)))
        self.assertEqual(rows[0]["stateRegisteredTradeNames"], "Helping, Hands, Inc.")


class PublicationTests(unittest.TestCase):
    def test_exact_public_shape_identity_only_contacts(self):
        b = generate()["cahc-branches.json"][0]
        self.assertEqual(set(b), G["PUBLIC_FIELDS"])
        self.assertEqual(b["publisher"], "Commission on Accreditation for Home Care")
        self.assertEqual(b["sourceUrl"], URL)
        self.assertEqual(b["checkedAt"], DATE)
        for key in ("paymentOptions", "awards", "accounts"):
            self.assertEqual(b[key], [])
        text = json.dumps({k: v for k, v in b.items() if k != "sourceUrl"})
        self.assertNotRegex(text, r"201[- ()]*555|@|https?://|www\.")

    def test_unknown_scope_fails_closed(self):
        for scope in ([], ["HR/TC"], ["Other"], [SCOPE, "Other"],
                      ["companion/personal care services"], [SCOPE + " with Distinction"]):
            out = generate(rows=[listing(scope=scope)])
            self.assertEqual(out["cahc-branches.json"], [])
            self.assertEqual(out["cahc-decisions.json"][0]["reason"], "unknown-or-missing-scope")

    def test_every_actual_scope_phrase_preserved_without_broadening(self):
        self.assertEqual(set(G["SCOPES"]), set(PUBLIC_SCOPES))
        for scope, label in PUBLIC_SCOPES.items():
            with self.subTest(scope=scope):
                out = generate(rows=[listing(scope=[scope])])
                b = out["cahc-branches.json"][0]
                self.assertEqual(b["services"], [label])
                self.assertEqual(out["cahc-decisions.json"][0]["listing"]["scope"], [scope])
                self.assertEqual(b["awards"], [])
        infusion = "Community Based Skilled Nursing – Infusion Services"
        text = generate(rows=[listing(scope=[infusion])])["cahc-branches.json"][0]["services"][0]
        self.assertIn("limited to infusion services", text)
        self.assertNotIn("companion", text)

    def test_multiple_scopes_not_combined_or_silently_expanded(self):
        scopes = [SCOPE, "Community Based Skilled Nursing and School Student Nursing"]
        b = generate(rows=[listing(scope=scopes)])["cahc-branches.json"][0]
        self.assertEqual(set(b["services"]), {PUBLIC_SCOPES[s] for s in scopes})

    def test_scope_variants_keep_their_own_source(self):
        rows = [listing(), listing(scope=["Community Based Skilled Nursing – Infusion Services"],
                                   sourceUrl="https://www.cahcusa.org/category/new-jersey/page/2/")]
        out = generate(rows=rows)
        self.assertEqual(len(out["cahc-branches.json"]), 2)
        for b in out["cahc-branches.json"]:
            row = next(r for r in rows if r["sourceUrl"] == b["sourceUrl"])
            self.assertEqual(b["services"], [PUBLIC_SCOPES[s] for s in row["scope"]])

    def test_official_index_url_is_exact_and_not_agency_website(self):
        for url in ("http://www.cahcusa.org/category/new-jersey/",
                    "https://evil.test/category/new-jersey/",
                    "https://www.cahcusa.org/agency/acme/",
                    "https://www.cahcusa.org/archives",
                    "https://www.cahcusa.org/archives/page/2/",
                    "https://www.cahcusa.org/archives/?agency=acme",
                    "https://www.cahcusa.org/archives/#office",
                    "http://www.cahcusa.org/archives/",
                    "https://www.cahcusa.org.evil.test/archives/",
                    URL + "?agency=acme", URL + "#office", URL + "../",
                    URL.replace("www.cahcusa.org", "www.cahcusa.org.evil.test")):
            self.assertEqual(generate(rows=[listing(sourceUrl=url)])["cahc-branches.json"], [])
        self.assertTrue(G["valid_url"](
            "https://www.cahcusa.org/category/new-jersey/cape-may-county/page/2/"))
        self.assertEqual(generate(rows=[listing(sourceUrl="https://www.cahcusa.org/archives/")])[
            "cahc-branches.json"][0]["sourceUrl"], "https://www.cahcusa.org/archives/")

    def test_duplicate_directories_dedupe_sort_and_keep_every_decision(self):
        other_url = "https://www.cahcusa.org/category/new-jersey/page/2/"
        rows = [listing(sourceUrl=other_url), listing(), listing()]
        a, b = generate(rows=rows), generate(rows=list(reversed(rows)))
        self.assertEqual(len(a["cahc-decisions.json"]), 3)
        self.assertEqual(len(a["cahc-branches.json"]), 1)
        self.assertEqual(a["cahc-branches.json"], b["cahc-branches.json"])
        self.assertEqual(a["cahc-audit.json"]["publicEvidence"][0]["inputOrders"], [0, 1, 2])

    def test_replay_schema_rejects_contact_field_leak(self):
        with self.assertRaisesRegex(ValueError, "only the six"):
            generate(rows=[listing(email="private@example.test")])

    def test_public_contact_guard(self):
        p = office(name="Acme www.agency.test")
        with self.assertRaisesRegex(ValueError, "contact information"):
            generate(rows=[listing(legalName=p["name"])], registry=[p])

    def test_fixed_review_date_not_today(self):
        self.assertEqual(generate()["cahc-branches.json"][0]["checkedAt"], DATE)
        for bad in ("20261114", "2026-02-30"):
            with self.assertRaises(ValueError):
                G["build"]([], [], [], [], bad)


class RetainedReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.replay = G["read_json"](HERE / "cahc-replay.json")
        cls.decisions = G["read_json"](HERE / "cahc-decisions.json")
        cls.branches = G["read_json"](HERE / "cahc-branches.json")
        cls.audit = G["read_json"](HERE / "cahc-audit.json")
        cls.provenance = G["read_json"](HERE / "cahc-provenance.json")

    def test_original_capture_hashes_and_date_are_unchanged(self):
        self.assertEqual(self.provenance["checkedAt"], DATE)
        self.assertEqual([r["sha256"] for r in self.provenance["originalInputs"]], [
            "76174ad4dacbffd81b003ff75a5d59f30a23d98eae87946e9604386b51ce3286",
            "1124133bd57f992b28b292ac8050362bd33d3b25debf5ca2282632b1d62b5f7d"])
        self.assertEqual(self.provenance["registryInput"]["sha256"],
                         "3622ea8d3c089c77de4ab3abf8b4408d0b0fa349b1b9731106d09a2a0fde2b4f")

    def test_best_and_caring_east_brunswick_real_directory_collision(self):
        caring, best = self.decisions[109], self.decisions[115]
        self.assertEqual((best["listing"]["legalName"], best["listing"]["city"],
                          best["listing"]["phone"]),
                         ("Best Home Care, Inc.", "East Brunswick", "732-487-3001"))
        self.assertEqual((caring["listing"]["legalName"], caring["listing"]["city"],
                          caring["listing"]["phone"]),
                         ("Caring Homecare, LLC", "East Brunswick", "732-487-3001"))
        for d in (caring, best):
            self.assertEqual((d["status"], d["reason"], d["providerId"]), (
                "ambiguous", "directory-shared-phone-identity-conflict", None))
        peer = next(e for e in best["candidateEvidence"]
                    if e["providerId"] == "north-jersey-hp-hp0310900")
        self.assertEqual(peer["primaryPhone"], "(723)-487-3001")
        self.assertEqual(peer["address"], "723 NJ-18, 2ND FLOOR")
        self.assertFalse(peer["exactPrimaryPhone"])
        self.assertEqual(peer["directoryNameInputOrders"], [109])
        selected = next(e for e in best["candidateEvidence"] if e["eligible"])
        self.assertEqual(selected["address"], "723 NJ-18")
        self.assertEqual(selected["providerId"], "north-jersey-hp-hp0131705")
        self.assertNotIn(selected["providerId"], {b["providerId"] for b in self.branches})

    def test_reviewer_cases_use_actual_body_city_and_phone_not_global_shared_numbers(self):
        for order in (101, 109, 115, 116, 118, 237):
            self.assertEqual(self.decisions[order]["reason"], "directory-shared-phone-identity-conflict")
        self.assertEqual(self.replay[237]["phone"], "973-821-5733")
        self.assertEqual(self.replay[101]["phone"], "973-821-5733")
        self.assertEqual(self.decisions[123]["providerId"], "north-jersey-hp-hp0212300")
        self.assertEqual(self.decisions[117]["status"], "rejected")
        self.assertEqual(self.replay[117]["city"], "Rochelle Park")
        self.assertEqual(self.replay[123]["city"], "Manalapan")
        for order in (175, 176):
            self.assertEqual(self.decisions[order]["providerId"], "north-jersey-hp-hp0143900")
            self.assertFalse(any(e["identityConflict"] for e in
                                 self.decisions[order]["directoryPhoneEvidence"]))
        self.assertEqual(self.decisions[179]["status"], "rejected")
        self.assertEqual(self.replay[179]["city"], "Perth Amboy")
        self.assertEqual(self.replay[175]["city"], "South Plainfield")

    def test_release_counts_and_all_newly_excluded_provider_ids(self):
        self.assertEqual(self.audit["decisions"], {"accepted": 119, "ambiguous": 15, "rejected": 271})
        self.assertEqual((len(self.branches), self.audit["publicOffices"]), (111, 111))
        removed = {
            "north-jersey-hp-hp0131705",
            "north-jersey-hp-hp0181804",
            "north-jersey-hp-hp0306600",
        }
        self.assertFalse(removed & {b["providerId"] for b in self.branches})
        conflicts = [d for d in self.decisions if d["reason"] == "directory-shared-phone-identity-conflict"]
        self.assertEqual([d["inputOrder"] for d in conflicts],
                         [32, 38, 69, 77, 101, 109, 115, 116, 118, 237])

    def test_all_shared_directory_claims_and_accepted_colocations_are_audited(self):
        phones = {}
        for i, row in enumerate(self.replay):
            phone = G["phone_key"](row["phone"])
            if phone:
                phones.setdefault(phone, []).append(i)
        expected = {phone: orders for phone, orders in phones.items() if len(orders) > 1}
        self.assertEqual({g["normalizedPhone"]: g["inputOrders"]
                          for g in self.audit["sharedDirectoryPhones"]}, expected)
        self.assertEqual(len(expected), 31)
        for d in self.decisions:
            if d["status"] == "accepted":
                self.assertFalse(any(e["identityConflict"] for e in d["directoryPhoneEvidence"]))
                self.assertFalse(any(e["identityConflict"] for e in d["registryColocationEvidence"]))
        self.assertEqual({r["providerId"] for r in self.audit["acceptedRegistryColocations"]},
                         {b["providerId"] for b in self.branches})
        registry = G["offices_from"](G["read_json"](G["REGISTRY"]),
                                      G["read_json"](HERE / "cahc-dba-bridge.json"))
        for row in self.audit["acceptedRegistryColocations"]:
            anchor = row["registryOffice"]
            peers = [p for p in registry if p.providerId != anchor["providerId"] and p.state == "NJ"
                     and G["words"](p.city) == G["words"](anchor["city"])
                     and G["building_key"](p.address) == G["building_key"](anchor["address"])]
            self.assertEqual([e["providerId"] for e in row["colocations"]],
                             [p.providerId for p in peers])
        familee = next(r for r in self.audit["acceptedRegistryColocations"]
                       if r["providerId"] == "north-jersey-hp-hp0301200")
        self.assertEqual([p["providerId"] for p in familee["colocations"]],
                         ["north-jersey-hp-hp0139800", "north-jersey-hp-hp0436000"])
        self.assertTrue(all(p["exactOfficeAddress"] and not p["samePrimaryPhone"]
                            for p in familee["colocations"]))
        citadel = next(r for r in self.audit["acceptedRegistryColocations"]
                      if r["providerId"] == "north-jersey-hp-hp0282000")
        acadia = next(p for p in citadel["colocations"]
                      if p["providerId"] == "north-jersey-hp-hp0127200")
        self.assertTrue(acadia["comparableName"] and acadia["exactOfficeAddress"])
        self.assertFalse(acadia["samePrimaryPhone"])

    def test_every_discovery_has_ordered_evidence_and_reason(self):
        self.assertEqual(len(self.replay), 405)
        self.assertEqual([d["inputOrder"] for d in self.decisions], list(range(len(self.replay))))
        for d in self.decisions:
            self.assertIn(d["status"], {"accepted", "rejected", "ambiguous"})
            self.assertTrue(d["reason"])
            self.assertEqual(d["listing"], self.replay[d["inputOrder"]])
            if d["status"] == "accepted":
                eligible = [e for e in d["candidateEvidence"] if e["eligible"]]
                self.assertEqual(len(eligible), 1)
                self.assertEqual(eligible[0]["providerId"], d["providerId"])
                self.assertTrue(eligible[0]["sameCity"])
                self.assertTrue(eligible[0]["exactPrimaryPhone"])
                self.assertTrue(eligible[0]["comparableName"])

    def test_independent_raw_body_regressions(self):
        expected = {
            119: ("Companion Care LLC", "Hillsborough"),
            175: ("E&S Home Care Solutions", "South Plainfield"),
            197: ("Liberty Infusion Agency", "Manchester"),
            222: ("We Care Health Services", "Trenton"),
            234: ("Victory Healthcare Agency", "South Orange"),
            242: ("Progressive Home Care, Inc.", "Newark"),
            315: ("Liberty Home Care", "Hackensack"),
            325: ("Gentle Heart Care", "Englewood Cliffs"),
            345: ("Excellent Home Health Care, Inc.", "Paterson"),
            352: ("Helping Hands Homecare, Inc.", "Clark"),
        }
        for order, (name, city) in expected.items():
            self.assertEqual((self.replay[order]["legalName"], self.replay[order]["city"]), (name, city))
            self.assertIn("heading-body-conflict", self.decisions[order]["extractionIssues"])
        self.assertEqual(self.replay[12]["zip"], "080755")
        self.assertEqual(self.replay[13]["zip"], "")
        self.assertEqual(self.decisions[140]["reason"], "unknown-or-missing-scope")
        self.assertEqual(self.decisions[1]["status"], "ambiguous")

    def test_public_sources_scopes_and_privacy_match_selected_body(self):
        for b, trace in zip(self.branches, self.audit["publicEvidence"], strict=True):
            d = self.decisions[trace["selectedInputOrder"]]
            self.assertEqual(d["status"], "accepted")
            self.assertEqual(set(b), G["PUBLIC_FIELDS"])
            self.assertEqual(b["title"], d["listing"]["legalName"])
            self.assertEqual(b["sourceUrl"], d["listing"]["sourceUrl"])
            self.assertEqual(b["services"], [
                PUBLIC_SCOPES[s] for s in sorted(set(d["listing"]["scope"]))])
            self.assertEqual(b["checkedAt"], self.provenance["checkedAt"])
            self.assertFalse(b["awards"] or b["paymentOptions"] or b["accounts"])
            for field in ("title", "address", "sourceTitle", "publisher", "services"):
                self.assertNotRegex(str(b[field]), r"@|https?://|www\.")

    def test_retained_hashes_and_missing_input_hash_fail_closed(self):
        for name, expected in self.provenance["replayInputSha256"].items():
            self.assertEqual(G["sha"]((HERE / name).read_bytes()), expected)
        broken = copy.deepcopy(self.provenance)
        broken["replayInputSha256"]["cahc-replay.json"] = "0" * 64
        original = G["replay_outputs"].__globals__["read_json"]
        with patch.dict(G["replay_outputs"].__globals__, read_json=lambda p: (
                broken if p.name == "cahc-provenance.json" else original(p))):
            with self.assertRaisesRegex(ValueError, "replay input hash changed"):
                G["replay_outputs"]()

    def test_real_cli_default_and_check(self):
        for args in ([], ["--check"]):
            result = subprocess.run([sys.executable, "-B", str(GENERATOR), *args],
                                    cwd=HERE, capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), self.audit["decisions"])

    def test_clean_replay_without_transient_sources_or_network(self):
        child = """
import os, runpy, sys
def guard(event, args):
    if event.startswith("socket."):
        raise RuntimeError("network forbidden during clean replay")
    if event == "open":
        path = os.fspath(args[0]) if isinstance(args[0], (str, bytes, os.PathLike)) else ""
        if isinstance(path, bytes):
            path = os.fsdecode(path)
        if path.startswith(("/tmp/", "/private/tmp/")):
            raise RuntimeError("transient input forbidden: " + path)
        if path.endswith(("cahc-listings.json", "harbor-agency-exact-office-dba-bridge.csv")):
            raise RuntimeError("original discovery/bridge unavailable in clean replay")
sys.addaudithook(guard)
sys.argv = [sys.argv[1], "--check"]
runpy.run_path(sys.argv[0], run_name="__main__")
"""
        result = subprocess.run([sys.executable, "-B", "-c", child, str(GENERATOR)],
                                cwd=HERE, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), self.audit["decisions"])

    def test_empty_clean_checkout_reproduces_exact_bytes_and_check_detects_drift(self):
        child = """
import os, pathlib, sys
Path = pathlib.Path
real = Path(sys.argv[1]).resolve()
source = real.read_text()
names = ("cahc-replay.json", "cahc-dba-bridge.json", "cahc-extraction-audit.json",
         "cahc-provenance.json", "cahc-scope-claims.json")
outputs = ("cahc-decisions.json", "cahc-audit.json", "cahc-branches.json")
root = Path("/cahc-clean-checkout/research/north-jersey/home-care-pulse")
memory = {str(root / n): (real.parent / n).read_bytes() for n in names}
registry = root.parent / "home-care-supply" / "providers.json"
memory[str(registry)] = (real.parent.parent / "home-care-supply" / "providers.json").read_bytes()
expected = {str(root / n): (real.parent / n).read_bytes() for n in outputs}
def read_bytes(path):
    key = str(path)
    if key not in memory:
        raise FileNotFoundError(key)
    return memory[key]
def write_bytes(path, data):
    key = str(path)
    if key not in expected:
        raise RuntimeError("write outside clean generated outputs: " + key)
    memory[key] = bytes(data)
    return len(data)
def guard(event, args):
    if event.startswith("socket."):
        raise RuntimeError("network forbidden")
    if event == "open" and isinstance(args[0], (str, bytes, os.PathLike)):
        path = os.fsdecode(args[0])
        if path.startswith(("/tmp/", "/private/tmp/", str(real.parent))):
            raise RuntimeError("original checkout or transient input forbidden: " + path)
sys.addaudithook(guard)
Path.read_bytes = read_bytes
Path.read_text = lambda p, encoding=None, errors=None: read_bytes(p).decode(
    encoding or "utf-8", errors or "strict")
Path.write_bytes = write_bytes
Path.is_file = lambda p: str(p) in memory
virtual_script = str(root / "cahc-generate.py")
def invoke(args, expected_code=0):
    sys.argv = [virtual_script, *args]
    try:
        exec(compile(source, virtual_script, "exec"),
             {"__name__": "__main__", "__file__": virtual_script})
    except SystemExit as error:
        if error.code != expected_code:
            raise RuntimeError("unexpected CLI exit " + str(error.code))
    else:
        raise RuntimeError("CLI did not exit")
assert not any(n in memory for n in expected)
invoke([])
assert all(memory[n] == data for n, data in expected.items())
invoke(["--check"])
memory[str(root / "cahc-branches.json")] += b" "
invoke(["--check"], 1)
"""
        result = subprocess.run([sys.executable, "-B", "-c", child, str(GENERATOR)],
                                cwd=HERE, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([json.loads(line) for line in result.stdout.splitlines()],
                         [self.audit["decisions"], self.audit["decisions"]])
        self.assertIn("output differs: cahc-branches.json", result.stderr)

    def test_replay_cannot_refresh_review_date(self):
        result = subprocess.run(
            [sys.executable, "-B", str(GENERATOR), "--checked-at", "2030-01-01"],
            cwd=HERE, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn("capture-only options", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
