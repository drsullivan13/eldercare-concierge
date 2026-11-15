import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import markets from "../src/data/regional-markets.json";
import release from "../src/data/home-care-association-directories.json";
import { projectHomeCareAssociationDirectories as project } from "../scripts/release-home-care-association-directories";

const root = new URL("../", import.meta.url);
const directory = "research/north-jersey/home-care-pulse/";
const load = (file: string) =>
  JSON.parse(readFileSync(new URL(file, root), "utf8"));
const hchanj = load(`${directory}association-branches.json`);
const cahc = load(`${directory}cahc-branches.json`);
const decisions = load(`${directory}cahc-decisions.json`);
const providers = markets.find(
  (market) => market.id === "north-jersey",
)!.providers;
const script = "scripts/release-home-care-association-directories.ts";
const artifact = "src/data/home-care-association-directories.json";
const fixtureHchanj = hchanj.find((row: { providerId: string }) =>
  cahc.some(
    (other: { providerId: string }) => other.providerId === row.providerId,
  ),
);
const fixtureProvider = providers.find(
  (provider) => provider.id === fixtureHchanj.providerId,
)!;
const fixtureCahc = cahc.find(
  (row: { providerId: string }) => row.providerId === fixtureProvider.id,
);
assert.ok(
  fixtureCahc,
  "The fixtures exercise overlapping association evidence.",
);

test("the release replays every reviewed source record and retains separate association provenance", () => {
  const check = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "--check"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.equal(release.schemaVersion, 1);
  assert.equal(hchanj.length, 6);
  assert.equal(release.offices.length, hchanj.length + cahc.length);
  assert.deepEqual(
    project(hchanj, cahc, decisions, providers),
    release.offices,
  );
  for (const input of release.inputs)
    assert.equal(
      input.sha256,
      createHash("sha256")
        .update(readFileSync(new URL(input.file, root)))
        .digest("hex"),
    );
  for (const row of [...hchanj, ...cahc]) {
    const office: (typeof release.offices)[number] | undefined =
      release.offices.find(
        (office) =>
          office.providerId === row.providerId &&
          office.source.url === row.sourceUrl,
      );
    assert.ok(office, row.providerId);
    assert.deepEqual(office.office, { name: row.title, address: row.address });
    assert.equal(office.source.publisher, row.publisher);
    assert.equal(office.source.checkedAt, row.checkedAt);
    assert.equal(office.source.title, row.sourceTitle);
    assert.equal(office.source.publishedAt, null);
    assert.equal(office.source.kind, "public-directory");
    assert.deepEqual(office.paymentOptions, row.paymentOptions);
    assert.deepEqual(office.awards, []);
    if (hchanj.includes(row)) {
      assert.equal(office.source.access, "pdf");
      assert.match(office.source.url, /\.pdf#page=[1-9]\d*$/);
      assert.deepEqual(office.services, row.services);
      assert.equal("accreditations" in office, false);
    } else {
      assert.equal(office.source.access, "full-page");
      assert.deepEqual(office.services, []);
      assert.deepEqual(
        "accreditations" in office && office.accreditations,
        row.services.map((claim: string) =>
          claim.replace(/^CAHC lists /, "").replace(" accreditation", ""),
        ),
      );
    }
  }
  const overlapping = release.offices.filter(
    (office) => office.providerId === fixtureProvider.id,
  );
  assert.equal(overlapping.length, 2);
  assert.equal(new Set(overlapping.map((office) => office.source.id)).size, 2);
  assert.equal(
    new Set(overlapping.map((office) => office.source.publisher)).size,
    2,
  );
});

test("private accounts, review data, prices, employee awards and unknown fields cannot be projected", () => {
  const privateFields = {
    accounts: ["private-account-sentinel"],
    reviews: [{ text: "private-review-sentinel" }],
    price: "$1234",
    awards: [{ name: "Employer of Choice", years: [2026] }],
    unknown: "unknown-sentinel",
  };
  const baseline = project([fixtureHchanj], [fixtureCahc], decisions, [
    fixtureProvider,
  ]);
  const result = project(
    [{ ...fixtureHchanj, ...privateFields }],
    [{ ...fixtureCahc, ...privateFields }],
    decisions,
    [fixtureProvider],
  );
  assert.deepEqual(result, baseline);
  assert.doesNotMatch(
    JSON.stringify(result),
    /sentinel|Employer of Choice|\$1234|"accounts"|"reviews"|"price"/,
  );
  for (const unsafe of [
    "Hourly care $120",
    "USD 120",
    "4.9 rating",
    "Employer of Choice",
    "Client reviews",
  ]) {
    assert.throws(() =>
      project(
        [{ ...fixtureHchanj, services: [unsafe] }],
        [],
        [],
        [fixtureProvider],
      ),
    );
    assert.throws(() =>
      project(
        [{ ...fixtureHchanj, paymentOptions: [unsafe] }],
        [],
        [],
        [fixtureProvider],
      ),
    );
  }
});

test("HCHANJ requires the complete office address or a pinned reviewed address difference", () => {
  for (const row of hchanj) {
    const provider = providers.find(
      (provider) => provider.id === row.providerId,
    )!;
    for (const change of [
      { address: provider.address.replace(/^\d+/, "99999") },
      { address: provider.address + " SUITE WRONG" },
      { address: "348 DIFFERENT ROAD" },
      { city: "Other City" },
      { zip: "00000" },
      { state: "MA" },
      { category: "home-health" },
    ]) {
      assert.throws(
        () => project([row], [], [], [{ ...provider, ...change }]),
        row.providerId,
      );
    }
    assert.throws(() =>
      project(
        [{ ...row, address: row.address.replace(/^\d+/, "99999") }],
        [],
        [],
        [provider],
      ),
    );
  }
  assert.throws(() => project([fixtureHchanj], [], [], []));
  assert.throws(() =>
    project([fixtureHchanj], [], [], [fixtureProvider, fixtureProvider]),
  );
  assert.throws(() =>
    project([fixtureHchanj, fixtureHchanj], [], [], [fixtureProvider]),
  );
});

test("CAHC needs documented unique city, name, street and primary-phone identity without inventing a street in its display", () => {
  const result = project([], [fixtureCahc], decisions, [fixtureProvider])[0];
  assert.equal(result.office.address, fixtureCahc.address);
  assert.deepEqual(result.services, []);
  assert.ok(result.accreditations?.length);
  assert.throws(() => project([], [fixtureCahc], [], [fixtureProvider]));
  for (const change of [
    { address: "99999 WRONG ROAD" },
    { city: "Wrong City" },
    { phone: "(000) 000-0000" },
  ])
    assert.throws(() =>
      project([], [fixtureCahc], decisions, [
        { ...fixtureProvider, ...change },
      ]),
    );
  for (const change of [
    { title: "Unrelated office" },
    { address: "Wrong City, NJ" },
    { services: ["Skilled nursing"] },
    { services: [] },
    { paymentOptions: ["Medicare"] },
  ])
    assert.throws(() =>
      project([], [{ ...fixtureCahc, ...change }], decisions, [
        fixtureProvider,
      ]),
    );
  for (const flag of [
    "sameCity",
    "comparableName",
    "exactPrimaryPhone",
    "bridgeConsistent",
    "eligible",
  ]) {
    const invalid = structuredClone(decisions);
    for (const decision of invalid.filter(
      (row: { providerId: string }) => row.providerId === fixtureProvider.id,
    ))
      for (const candidate of decision.candidateEvidence)
        candidate[flag] = false;
    assert.throws(
      () => project([], [fixtureCahc], invalid, [fixtureProvider]),
      flag,
    );
  }
  assert.throws(() =>
    project([], [fixtureCahc, fixtureCahc], decisions, [fixtureProvider]),
  );
});

test("official links, PDF physical pages, dates and publishers fail closed", () => {
  for (const sourceUrl of [
    fixtureHchanj.sourceUrl.replace("#page=", "?page="),
    fixtureHchanj.sourceUrl.replace(/#page=\d+/, "#page=0"),
    fixtureHchanj.sourceUrl.replace(/#page=\d+/, "#page=77"),
    fixtureHchanj.sourceUrl.replace("higherlogicdownload", "unrelated"),
    fixtureHchanj.sourceUrl.replace("https://", "https://user@"),
  ])
    assert.throws(() =>
      project([{ ...fixtureHchanj, sourceUrl }], [], [], [fixtureProvider]),
    );
  for (const sourceUrl of [
    "https://www.cahcusa.org/archives/unreviewed/",
    fixtureCahc.sourceUrl + "?tracking=1",
    fixtureCahc.sourceUrl.replace(
      "www.cahcusa.org",
      "www.cahcusa.org.evil.example",
    ),
    fixtureCahc.sourceUrl.replace("https://", "http://"),
  ])
    assert.throws(() =>
      project([], [{ ...fixtureCahc, sourceUrl }], decisions, [
        fixtureProvider,
      ]),
    );
  for (const checkedAt of [
    "2026-02-30",
    "not-a-date",
    "2026-1-1",
    "2999-01-01",
  ])
    assert.throws(() =>
      project([{ ...fixtureHchanj, checkedAt }], [], [], [fixtureProvider]),
    );
  assert.throws(() =>
    project(
      [{ ...fixtureHchanj, publisher: "Unverified publisher" }],
      [],
      [],
      [fixtureProvider],
    ),
  );
});

test("the standalone CLI works with a synthetic raw market and check detects stale artifacts without writing", () => {
  const temp = mkdtempSync(join(tmpdir(), "association-release-"));
  const put = (file: string, value: string) => {
    const path = join(temp, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, value);
  };
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", join(temp, script), ...args],
      { cwd: root, encoding: "utf8" },
    );
  try {
    put(script, readFileSync(new URL(script, root), "utf8"));
    const scopePath = `${directory}cahc-scope-claims.json`;
    put(scopePath, readFileSync(new URL(scopePath, root), "utf8"));
    put(
      "src/data/regional-markets.json",
      JSON.stringify([{ id: "north-jersey", providers: [fixtureProvider] }]),
    );
    put(
      `${directory}association-branches.json`,
      JSON.stringify([fixtureHchanj]),
    );
    put(`${directory}cahc-branches.json`, JSON.stringify([fixtureCahc]));
    put(
      `${directory}cahc-decisions.json`,
      JSON.stringify(
        decisions.filter(
          (row: { providerId: string }) =>
            row.providerId === fixtureProvider.id,
        ),
      ),
    );
    const generated = run();
    assert.equal(generated.status, 0, generated.stdout + generated.stderr);
    assert.equal(
      JSON.parse(readFileSync(join(temp, artifact), "utf8")).offices.length,
      2,
    );
    assert.equal(run("--check").status, 0);
    put(artifact, "{}\n");
    const stale = run("--check");
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /differs from reviewed projection/);
    assert.equal(readFileSync(join(temp, artifact), "utf8"), "{}\n");
    put(
      `${directory}association-branches.json`,
      JSON.stringify([{ ...fixtureHchanj, checkedAt: "2999-01-01" }]),
    );
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(join(temp, artifact), "utf8"), "{}\n");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
