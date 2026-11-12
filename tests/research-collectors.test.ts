import { test } from "node:test";
import assert from "node:assert/strict";
import {
  workerTicketHash,
  collectCms,
  collectYelpIdentifiers,
  exactYelpListing,
  sha256,
  type Fetcher,
} from "../supabase/functions/_shared/research-collectors";

const provider = {
  name: "Example Care",
  address: "10 Main Street",
  city: "Newton",
  state: "MA",
  zip: "02459",
};
const listing = {
  id: "synthetic-listing-id",
  name: provider.name,
  location: {
    address1: "10 Main St",
    city: "Newton",
    state: "MA",
    zip_code: "02459",
    country: "US",
  },
};
const response = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

test("worker ticket parser rejects public keys and malformed tokens and hashes valid tickets for database authorization", async () => {
  const token = "a".repeat(64);
  const hash = await sha256(token);
  assert.equal(await workerTicketHash(null), null);
  assert.equal(await workerTicketHash("Bearer sb_publishable_example"), null);
  assert.equal(await workerTicketHash(`Bearer ${"b".repeat(63)}`), null);
  assert.equal(await workerTicketHash(`Bearer ${token}`), hash);
});

test("CMS collector fetches only a fixed dataset and exact CCN, preserves original bytes and skips unchanged snapshots", async () => {
  const raw = JSON.stringify({
    results: [
      {
        cms_certification_number_ccn: "227068",
        hhcahps_survey_summary_star_rating: "4",
      },
    ],
    count: 1,
    schema: {},
  });
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "data.cms.gov");
    assert.equal(url.searchParams.get("conditions[0][value]"), "227068");
    assert.equal(init?.redirect, "error");
    return new Response(raw);
  };
  const first = await collectCms(
    { dataset: "ccn4-8vby", mode: "record", ccn: "227068" },
    null,
    fetcher,
  );
  assert.equal(first.status, "succeeded");
  assert.equal(first.snapshot?.content, raw);
  assert.equal(first.snapshot?.sha256, await sha256(raw));
  assert.equal(first.candidates?.[0].kind, "cms-survey");
  const next = await collectCms(
    { dataset: "ccn4-8vby", mode: "record", ccn: "227068" },
    first.snapshot!.sha256,
    fetcher,
  );
  assert.equal(next.status, "unchanged");
  assert.equal(next.snapshot, undefined);
});

test("CMS never accepts a wrong identity, incomplete periods or an arbitrary configured URL", async () => {
  const badIdentity: Fetcher = async () =>
    response({
      results: [{ cms_certification_number_ccn: "999999" }],
      schema: {},
      count: 1,
    });
  assert.equal(
    (
      await collectCms(
        { dataset: "ccn4-8vby", mode: "record", ccn: "227068" },
        null,
        badIdentity,
      )
    ).error_code,
    "CMS_IDENTITY_REVIEW_REQUIRED",
  );
  const incomplete: Fetcher = async () =>
    response({ results: [{ measure: "period" }], schema: {}, count: 2 });
  assert.equal(
    (
      await collectCms(
        { dataset: "fa88-6ff2", mode: "periods" },
        null,
        incomplete,
      )
    ).error_code,
    "CMS_PERIOD_COVERAGE_INCOMPLETE",
  );
  const noNetwork: Fetcher = async () => {
    throw new Error("must not fetch");
  };
  assert.equal(
    (
      await collectCms(
        { dataset: "https://127.0.0.1/secret", mode: "metadata" },
        null,
        noNetwork,
      )
    ).error_code,
    "CMS_CONFIG_INVALID",
  );
});

test("source failures preserve blocked vs retry status and never echo remote bodies or exception details", async () => {
  const config = { dataset: "ccn4-8vby", mode: "metadata" };
  const blocked = await collectCms(config, null, async () =>
    response({ secret: "sensitive-response" }, 403),
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(JSON.stringify(blocked).includes("sensitive-response"), false);
  const retry = await collectCms(config, null, async () =>
    response({}, 429, { "retry-after": "900" }),
  );
  assert.equal(retry.status, "retry");
  assert.equal(retry.retry_after_seconds, 900);
  const network = await collectCms(config, null, async () => {
    throw new Error("sensitive-request-header");
  });
  assert.equal(network.error_code, "SOURCE_NETWORK_ERROR");
  assert.equal(
    JSON.stringify(network).includes("sensitive-request-header"),
    false,
  );
});

test("an oversized response is rejected even without a content-length header", async () => {
  const result = await collectCms(
    { dataset: "ccn4-8vby", mode: "metadata" },
    null,
    async () => new Response("x".repeat(1_000_001)),
  );
  assert.equal(result.error_code, "SOURCE_RESPONSE_TOO_LARGE");
});

test("Yelp matches the exact name, street address, city, state, ZIP and country", () => {
  assert.deepEqual(exactYelpListing(listing, provider), { id: listing.id });
  assert.deepEqual(
    exactYelpListing(listing, {
      ...provider,
      address: "10 Main Street, Newton, MA 02459",
    }),
    { id: listing.id },
  );
  for (const changed of [
    { ...listing, name: "Example Care Memory Unit" },
    { ...listing, location: { ...listing.location, address1: "11 Main St" } },
    { ...listing, location: { ...listing.location, city: "Boston" } },
    { ...listing, location: { ...listing.location, zip_code: "02458" } },
    { ...listing, location: { ...listing.location, country: "CA" } },
  ])
    assert.equal(exactYelpListing(changed, provider), null);
});

test("Yelp capability check reserves each request and discards reviews, ratings and reviewer identities", async () => {
  let reserved = 0;
  let called = 0;
  const key = "synthetic-api-key-not-a-real-credential";
  const fetcher: Fetcher = async (input, init) => {
    called++;
    assert.equal(reserved, called);
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      `Bearer ${key}`,
    );
    assert.equal(init?.redirect, "error");
    const url = new URL(String(input));
    const path = url.pathname;
    if (path.endsWith("/matches"))
      assert.equal(url.searchParams.get("address1"), "10 Main Street");
    return response(
      path.endsWith("/matches")
        ? { businesses: [listing] }
        : {
            rating: 5,
            reviews: [
              {
                text: "SENSITIVE REVIEW TEXT",
                user: { name: "REVIEWER NAME" },
              },
            ],
          },
    );
  };
  const result = await collectYelpIdentifiers(
    { ...provider, address: "10 Main Street, Newton, MA 02459" },
    key,
    async () => {
      reserved++;
      return true;
    },
    fetcher,
  );
  assert.equal(result.status, "succeeded");
  assert.equal(result.listing_id, listing.id);
  assert.deepEqual(result.capabilities, {
    business_match: "available",
    business_details: "available",
    reviews: "available",
  });
  assert.equal(called, 3);
  for (const forbidden of [
    key,
    "SENSITIVE REVIEW TEXT",
    "REVIEWER NAME",
    '"rating"',
    '"snapshot"',
    '"candidates"',
  ])
    assert.equal(JSON.stringify(result).includes(forbidden), false);
});

test("missing credentials, exhausted budget and ambiguous matches do not trigger uncontrolled requests", async () => {
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls++;
    return response({ businesses: [] });
  };
  assert.equal(
    (
      await collectYelpIdentifiers(
        provider,
        undefined,
        async () => true,
        fetcher,
      )
    ).error_code,
    "YELP_KEY_NOT_CONFIGURED",
  );
  assert.equal(
    (
      await collectYelpIdentifiers(
        provider,
        "test-key",
        async () => false,
        fetcher,
      )
    ).error_code,
    "YELP_DAILY_BUDGET_REACHED",
  );
  assert.equal(calls, 0);
  const wrong: Fetcher = async () => {
    calls++;
    return response({
      businesses: [{ ...listing, name: "Different location" }],
    });
  };
  assert.equal(
    (
      await collectYelpIdentifiers(
        provider,
        "test-key",
        async () => true,
        wrong,
      )
    ).error_code,
    "YELP_MATCH_REVIEW_REQUIRED",
  );
  assert.equal(calls, 1);
});

test("a forbidden Yelp reviews endpoint is recorded as a capability limit, never fabricated as empty reviews", async () => {
  const fetcher: Fetcher = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/matches")) return response({ businesses: [listing] });
    return path.endsWith("/reviews") ? response({}, 403) : response({});
  };
  const result = await collectYelpIdentifiers(
    provider,
    "test-key",
    async () => true,
    fetcher,
  );
  assert.equal(result.status, "succeeded");
  assert.equal(result.capabilities?.reviews, "forbidden");
  assert.equal(result.error_code, "YELP_REVIEWS_NOT_AVAILABLE");
  assert.equal(result.snapshot, undefined);
});
