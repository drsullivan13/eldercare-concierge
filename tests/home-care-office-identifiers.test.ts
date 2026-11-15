import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import release from "../src/data/home-care-office-identifiers.json";
import { HomeCareOfficeIdentifiers } from "../src/components/home-care-office-identifiers";
import { getHomeCareOfficeIdentifiers } from "../src/lib/home-care-office-identifiers";
import { getMarket } from "../src/lib/markets";
import { projectHomeCareOfficeIdentifiers } from "../scripts/release-home-care-office-identifiers";
import { GET } from "../src/app/api/research/route";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const network = JSON.parse(read(release.inputs[0].file));
const nppes = JSON.parse(read(release.inputs[1].file));
const uhc = JSON.parse(
  read("research/north-jersey/home-care-network/uhc-verified.json"),
);
const providers = getMarket("north-jersey")!.providers;
const projected = () =>
  projectHomeCareOfficeIdentifiers(network, nppes, uhc, providers);

test("the release replays offline in normal form with every reviewed branch ID", () => {
  assert.equal(release.schemaVersion, 1);
  for (const input of release.inputs) {
    assert.equal(input.sha256, hash(read(input.file)));
  }
  assert.deepEqual(release.offices, projected());
  const ids = [
    ...new Set([
      ...Object.keys(network),
      ...Object.keys(nppes),
      ...Object.keys(uhc),
    ]),
  ].sort();
  assert.deepEqual(
    release.offices.map((office) => office.providerId),
    ids,
  );
  assert.equal(new Set(ids).size, release.offices.length);
  for (const office of release.offices) {
    assert.ok(
      providers.some(
        (provider) =>
          provider.id === office.providerId &&
          provider.category === "home-care" &&
          provider.state === "NJ",
      ),
    );
    assert.ok(office.historicalDirectories || office.federalOrganization);
    assert.deepEqual(
      Object.keys(office).sort(),
      [
        "providerId",
        ...(network[office.providerId] || uhc[office.providerId]
          ? ["historicalDirectories"]
          : []),
        ...(nppes[office.providerId] ? ["federalOrganization"] : []),
      ].sort(),
    );
    for (const directory of office.historicalDirectories ?? []) {
      assert.deepEqual(Object.keys(directory).sort(), [
        "checkedAt",
        "payer",
        "program",
        "sources",
      ]);
      for (const source of directory.sources) {
        assert.deepEqual(
          Object.keys(source).sort(),
          [
            "url",
            "asOf",
            "physicalPage",
            ...(Object.hasOwn(source, "printedPage") ? ["printedPage"] : []),
          ].sort(),
        );
      }
    }
  }
  const check = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/release-home-care-office-identifiers.ts",
      "--check",
    ],
    { cwd: root, encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test("both CLI modes fail closed for missing or empty UHC evidence without writing", () => {
  const before = read("src/data/home-care-office-identifiers.json");
  for (const mode of ["release", "check"]) {
    for (const missing of [true, false]) {
      const code = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
const read = fs.readFileSync;
fs.readFileSync = function(path, ...args) {
  if (String(path).endsWith("/home-care-network/uhc-verified.json")) {
    if (${missing}) throw new Error("Missing UHC evidence");
    return "{}";
  }
  return read.call(this, path, ...args);
};
fs.writeFileSync = () => { throw new Error("Unexpected release write"); };
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(new URL("scripts/release-home-care-office-identifiers.ts", root).pathname)}, ${JSON.stringify(mode === "check" ? "--check" : "")}];
await import(pathToFileURL(process.argv[1]).href);
`;
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", code],
        { cwd: root, encoding: "utf8", timeout: 60_000 },
      );
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        missing
          ? /Missing UHC evidence/
          : /Expected nonempty reviewed UHC directory evidence/,
      );
      assert.doesNotMatch(result.stderr, /Unexpected release write/);
    }
  }
  assert.equal(read("src/data/home-care-office-identifiers.json"), before);
});

test("every payer keeps its check date, source date, printed page and physical PDF page", () => {
  for (const [id, value] of Object.entries(network).concat(
    Object.entries(uhc),
  )) {
    const row = value as {
      payer: string;
      program: string;
      checkedDate: string;
      listings: {
        sourceUrl: string;
        sourceDate: string;
        physicalPage: number;
        printedPage?: string | null;
      }[];
    };
    const directory = getHomeCareOfficeIdentifiers(
      id,
    )!.historicalDirectories!.find(
      (directory) =>
        directory.payer === row.payer && directory.program === row.program,
    )!;
    assert.ok(directory, id);
    assert.equal(directory.checkedAt, row.checkedDate);
    assert.equal(
      directory.sources.length,
      new Set(
        row.listings.map((listing) =>
          JSON.stringify([
            listing.sourceUrl,
            listing.sourceDate,
            listing.physicalPage,
            listing.printedPage,
          ]),
        ),
      ).size,
    );
    for (const listing of row.listings) {
      assert.ok(
        directory.sources.some(
          (source) =>
            source.url === listing.sourceUrl &&
            source.asOf === listing.sourceDate &&
            source.physicalPage === listing.physicalPage &&
            source.printedPage === (listing.printedPage ?? undefined),
        ),
      );
      assert.ok(listing.sourceDate < row.checkedDate);
    }
  }
});

test("all federal identifiers match retained organizational responses, not individuals", () => {
  for (const [id, value] of Object.entries(nppes)) {
    const row = value as {
      npi: string;
      legal_name: string;
      nppes_last_updated: string;
      exact_lookup_query_id: string;
      receipts: string[];
    };
    const organization = getHomeCareOfficeIdentifiers(id)!.federalOrganization!;
    assert.deepEqual(organization, {
      npi: row.npi,
      legalName: row.legal_name,
      lastUpdated: row.nppes_last_updated,
      sourceUrl: `https://npiregistry.cms.hhs.gov/provider-view/${row.npi}`,
    });
    const receipts = row.receipts.map((path) =>
      JSON.parse(read(`research/north-jersey/home-care-nppes/${path}`)),
    );
    const receipt = receipts.find(
      (item) => item.query_id === row.exact_lookup_query_id,
    );
    assert.ok(receipt, id);
    assert.equal(receipt.query.number, row.npi);
    const attempt = receipt.attempts.findLast(
      (attempt: { http_status: number }) => attempt.http_status === 200,
    );
    assert.ok(attempt, id);
    const raw = read(`research/north-jersey/home-care-nppes/${attempt.raw}`);
    assert.equal(hash(raw), attempt.sha256);
    const entity = JSON.parse(raw).results.find(
      (entity: { number: string }) => String(entity.number) === row.npi,
    );
    assert.ok(entity, id);
    assert.equal(entity.enumeration_type, "NPI-2");
    assert.equal(entity.basic.organization_name, organization.legalName);
    assert.equal(entity.basic.last_updated, organization.lastUpdated);
    assert.equal(entity.basic.status, "A");
  }
});

test("the retained directory matcher verifies every current office street and unit", () => {
  const code = `
import csv, importlib.util, json, pathlib, sys
root = pathlib.Path.cwd()
spec = importlib.util.spec_from_file_location("network_replay", root / "research/north-jersey/home-care-network/replay.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
providers = {p["id"]: p for p in json.load(sys.stdin)}
network = json.loads((module.ROOT / "verified.json").read_text())
rows = {r["providerId"]: r for r in csv.DictReader((module.ROOT / "sources/roster.csv").open())}
for pid, evidence in network.items():
    provider, row = providers[pid], rows[pid]
    assert module.organization(provider["name"]) == module.organization(row["legalName"]), pid
    assert module.street(provider["address"]) == module.street(row["address"]), pid
    for listing in evidence["listings"]:
        current = dict(row, address=provider["address"], city=provider["city"], zip=provider["zip"], phone=provider["phone"])
        checks, _ = module.identity(current, listing)
        assert all(checks.values()), (pid, checks)
print(f"Verified {len(network)} exact current directory offices.")
`;
  const result = spawnSync("python3", ["-B", "-c", code], {
    cwd: root,
    input: JSON.stringify(providers),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("UHC evidence replays from retained page-and-line evidence and current exact office identities", () => {
  const code = `
import importlib.util, json, pathlib, sys
root = pathlib.Path.cwd() / "research/north-jersey/home-care-network"
spec = importlib.util.spec_from_file_location("uhc_replay", root / "uhc-replay.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
outputs = module.build()
for name, value in outputs.items():
    assert (root / name).read_bytes() == module.encoded(value), name
current = {p["id"]: p for p in json.load(sys.stdin)}
_, roster, _, _, _ = module.load()
for pid in outputs["uhc-verified.json"]:
    assert module.organization(current[pid]["name"]) == module.organization(roster[pid]["name"]), pid
    assert module.address_key(current[pid]) == module.address_key(roster[pid]), pid
    assert module.phone(current[pid]["phone"]) == module.phone(roster[pid]["phone"]), pid
`;
  const result = spawnSync("python3", ["-B", "-c", code], {
    cwd: root,
    input: JSON.stringify(providers),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("overlapping payers merge by exact provider ID without replacing the NPI or another directory", () => {
  const id = "north-jersey-hp-hp0024800";
  assert.ok(network[id] && uhc[id] && nppes[id]);
  const [office] = projectHomeCareOfficeIdentifiers(
    { [id]: network[id] },
    { [id]: nppes[id] },
    { [id]: uhc[id] },
    providers,
  );
  assert.equal(office.providerId, id);
  assert.deepEqual(
    office.historicalDirectories?.map(({ payer, program, checkedAt }) => ({
      payer,
      program,
      checkedAt,
    })),
    [network[id], uhc[id]].map((row) => ({
      payer: row.payer,
      program: row.program,
      checkedAt: row.checkedDate,
    })),
  );
  assert.equal(office.federalOrganization?.npi, nppes[id].npi);
  assert.deepEqual(office, getHomeCareOfficeIdentifiers(id));
  const reversedNetwork = structuredClone(network);
  const reversedUhc = structuredClone(uhc);
  for (const row of Object.values(reversedNetwork).concat(
    Object.values(reversedUhc),
  ))
    (row as { listings: unknown[] }).listings.reverse();
  assert.deepEqual(
    projectHomeCareOfficeIdentifiers(
      reversedNetwork,
      nppes,
      reversedUhc,
      providers,
    ),
    projected(),
  );
});

test("distinct dates and printed pages survive the same URL and physical page while identical sources deduplicate", () => {
  const id = Object.keys(network)[0];
  const row = structuredClone(network[id]);
  const listing = row.listings[0];
  row.listings.push(
    { ...listing },
    { ...listing, sourceDate: "2026-10-05" },
    { ...listing, printedPage: "999" },
  );
  const [office] = projectHomeCareOfficeIdentifiers(
    { [id]: row },
    {},
    {},
    providers,
  );
  const sources = office.historicalDirectories![0].sources;
  assert.equal(sources.length, network[id].listings.length + 2);
  for (const listing of row.listings)
    assert.ok(
      sources.some(
        (source) =>
          source.url === listing.sourceUrl &&
          source.asOf === listing.sourceDate &&
          source.physicalPage === listing.physicalPage &&
          source.printedPage === listing.printedPage,
      ),
    );
  const html = renderToStaticMarkup(
    createElement(HomeCareOfficeIdentifiers, { data: office, uid: id }),
  );
  assert.match(html, /physical PDF page 103 · as of Oct 5, 2026/);
  assert.match(html, /physical PDF page 103 · as of Oct 6, 2026/);
});

test("the existing research API passes both payer directories and the organizational NPI through unchanged", async () => {
  for (const id of [
    "north-jersey-hp-hp0015320",
    "north-jersey-hp-hp0015322",
    "north-jersey-hp-hp0022500",
    "north-jersey-hp-hp0024800",
  ]) {
    const response = GET(new Request(`http://localhost/api/research?id=${id}`));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.providerId, id);
    assert.deepEqual(data.officeIdentifiers, getHomeCareOfficeIdentifiers(id));
    assert.equal(
      Object.hasOwn(data.officeIdentifiers, "historicalDirectory"),
      false,
    );
  }
});

test("UHC rejects changed branch identities, payer metadata, unsafe links, invalid dates and pages", () => {
  const id = Object.keys(uhc)[0];
  const changes = [
    { payer: "Another payer" },
    { program: "Medicare" },
    { evidenceType: "current_contract" },
    { checkedDate: "2026-02-30" },
    { listings: [] },
  ];
  for (const change of changes) {
    const row = { ...structuredClone(uhc[id]), ...change };
    assert.throws(() =>
      projectHomeCareOfficeIdentifiers({}, {}, { [id]: row }, providers),
    );
  }
  const listingChanges = [
    { address: uhc[id].listings[0].address + " SUITE 999" },
    { city: "Another city" },
    { zip: "99999" },
    { state: "NY" },
    { phone: "0000000000" },
    ...["2026-00", "2026-13", "2099-01", "2026-02-30", "2026-11-15"].map(
      (sourceDate) => ({ sourceDate }),
    ),
    ...[0, -1, 1.5, 374, Number.MAX_SAFE_INTEGER + 1, "25", null].map(
      (physicalPage) => ({ physicalPage }),
    ),
    ...["", "0", "1.5", 25].map((printedPage) => ({ printedPage })),
    ...[
      "https://www.uhc.com.evil.example/directory.pdf",
      "https://www.uhc.com/communityplan/assets/plandocuments/providerdirectory/other.pdf",
      uhc[id].listings[0].sourceUrl + "#page=25",
      uhc[id].listings[0].sourceUrl + "?redirect=elsewhere",
      uhc[id].listings[0].sourceUrl.replace("https:", "http:"),
    ].map((sourceUrl) => ({ sourceUrl })),
  ];
  for (const change of listingChanges) {
    const row = structuredClone(uhc[id]);
    Object.assign(row.listings[0], change);
    assert.throws(
      () => projectHomeCareOfficeIdentifiers({}, {}, { [id]: row }, providers),
      JSON.stringify(change),
    );
  }
  for (const value of [undefined, null, [], "", 0])
    assert.throws(() =>
      projectHomeCareOfficeIdentifiers(network, nppes, value, providers),
    );
  assert.throws(() =>
    projectHomeCareOfficeIdentifiers({}, {}, { unknown: uhc[id] }, providers),
  );
  assert.throws(() =>
    projectHomeCareOfficeIdentifiers(
      {},
      {},
      { [id]: uhc[id] },
      providers.filter((provider) => provider.id !== id),
    ),
  );
});

test("the projection allowlists fields and never copies private identities or taxonomies", () => {
  const privateFields = {
    authorized_official_first_name: "private-person-sentinel",
    accounts: ["private-account-sentinel"],
    other_names: [{ name: "private-alias-sentinel" }],
    source_reported_taxonomies: [{ desc: "private-taxonomy-sentinel" }],
    unknown: { identity: "private-identity-sentinel" },
    services: ["private-service-sentinel"],
  };
  const injectedNetwork = structuredClone(network);
  const injectedNppes = structuredClone(nppes);
  const injectedUhc = structuredClone(uhc);
  for (const row of Object.values(injectedNetwork).concat(
    Object.values(injectedUhc),
  )) {
    Object.assign(row as object, privateFields);
    for (const listing of (row as { listings: object[] }).listings)
      Object.assign(listing, privateFields);
  }
  for (const row of Object.values(injectedNppes))
    Object.assign(row as object, privateFields);
  const output = projectHomeCareOfficeIdentifiers(
    injectedNetwork,
    injectedNppes,
    injectedUhc,
    providers,
  );
  assert.deepEqual(output, projected());
  assert.doesNotMatch(JSON.stringify(output), /private-[a-z]+-sentinel/);
  assert.doesNotMatch(
    JSON.stringify(release),
    /authorized_official|source_reported_taxonomies|practice_locations|receipts|roster_identity|directoryProviderId|organizationBasis|taxonomy|services|registrationFacts/,
  );
});

test("invalid branch identity, source dates, source links and NPI check digits fail closed", () => {
  const networkId = Object.keys(network)[0];
  const nppesId = Object.keys(nppes)[0];
  const invalidNetwork = (change: (row: (typeof network)[string]) => void) => {
    const rows = structuredClone(network);
    change(rows[networkId]);
    assert.throws(() =>
      projectHomeCareOfficeIdentifiers(rows, nppes, uhc, providers),
    );
  };
  invalidNetwork((row) => {
    row.checkedDate = "2026-02-30";
  });
  invalidNetwork((row) => {
    row.listings[0].sourceDate = "2099-01-01";
  });
  invalidNetwork((row) => {
    row.listings[0].sourceDate = "2026-11-15";
    row.checkedDate = "2026-11-14";
  });
  invalidNetwork((row) => {
    row.listings[0].physicalPage = 0;
  });
  invalidNetwork((row) => {
    row.listings[0].physicalPage = 1.5;
  });
  for (const printedPage of ["", "0", "-1", "1.5", " 88 ", 88]) {
    invalidNetwork((row) => {
      row.listings[0].printedPage = printedPage;
    });
  }
  invalidNetwork((row) => {
    row.listings[0].sourceUrl = "https://example.com/directory.pdf";
  });
  invalidNetwork((row) => {
    row.listings[0].sourceUrl += "#page=88";
  });
  invalidNetwork((row) => {
    row.listings[0].phone = "(000) 000-0000";
  });
  for (const [field, value] of [
    ["city", "Different City"],
    ["zip", "99999"],
    ["state", "NY"],
  ]) {
    invalidNetwork((row) => {
      row.listings[0][field] = value;
    });
  }
  invalidNetwork((row) => {
    row.listings = [];
  });
  invalidNetwork((row) => {
    row.evidenceType = "current_contract";
  });
  for (const [field, value] of [
    ["provider_id", networkId],
    ["npi", "1659689207"],
    ["nppes_last_updated", "2026-02-30"],
    ["roster_identity_sha256", "changed"],
    ["basis", "mailing_only_address_match"],
    ["nppes_status", "D"],
  ]) {
    const rows = structuredClone(nppes);
    rows[nppesId][field] = value;
    assert.throws(() =>
      projectHomeCareOfficeIdentifiers(network, rows, uhc, providers),
    );
  }
  const changed = providers.map((provider) =>
    provider.id === nppesId
      ? { ...provider, address: provider.address + " SUITE 999" }
      : provider,
  );
  assert.throws(() =>
    projectHomeCareOfficeIdentifiers(network, nppes, uhc, changed),
  );
  assert.throws(() =>
    projectHomeCareOfficeIdentifiers(
      { unknown: network[networkId] },
      nppes,
      uhc,
      providers,
    ),
  );
  assert.throws(() =>
    projectHomeCareOfficeIdentifiers(
      network,
      nppes,
      uhc,
      providers.filter((provider) => provider.id !== nppesId),
    ),
  );
});

test("historical directory release rejects different streets and units while accepting source spelling", () => {
  const id = "north-jersey-hp-hp0015322";
  assert.equal(nppes[id], undefined);
  for (const address of [
    "123 Different Road",
    "123 Liberty View Dr Suite 999",
  ]) {
    const rows = structuredClone(network);
    rows[id].listings[0].address = address;
    assert.throws(() =>
      projectHomeCareOfficeIdentifiers(rows, nppes, uhc, providers),
    );
    const catalog = providers.map((provider) =>
      provider.id === id ? { ...provider, address } : provider,
    );
    assert.throws(() =>
      projectHomeCareOfficeIdentifiers(network, nppes, uhc, catalog),
    );
  }
  const rows = structuredClone(network);
  rows[id].listings[0].address = "123 LIBERTY VIEW DRIVE";
  assert.deepEqual(
    projectHomeCareOfficeIdentifiers(rows, nppes, uhc, providers),
    projected(),
  );
});

test("the getter returns only the requested branch and protects later calls from mutation", () => {
  const ids = new Set(release.offices.map((office) => office.providerId));
  for (const office of release.offices) {
    assert.deepEqual(getHomeCareOfficeIdentifiers(office.providerId), office);
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(getHomeCareOfficeIdentifiers(office.providerId)),
      ),
      office,
    );
  }
  for (const provider of providers) {
    if (!ids.has(provider.id))
      assert.equal(getHomeCareOfficeIdentifiers(provider.id), undefined);
  }
  for (const id of ["__proto__", "constructor", "toString", "cms-315001", ""])
    assert.equal(getHomeCareOfficeIdentifiers(id), undefined);
  for (const office of release.offices) {
    const copy = getHomeCareOfficeIdentifiers(office.providerId)!;
    for (const directory of copy.historicalDirectories ?? [])
      directory.sources[0].url = "changed";
    if (copy.federalOrganization)
      copy.federalOrganization.legalName = "changed";
    assert.deepEqual(getHomeCareOfficeIdentifiers(office.providerId), office);
  }
});

test("the compact disclosure labels historical evidence and organizational identifiers without new claims", () => {
  for (const office of release.offices) {
    const data = getHomeCareOfficeIdentifiers(office.providerId)!;
    const html = renderToStaticMarkup(
      createElement(HomeCareOfficeIdentifiers, {
        data,
        uid: office.providerId,
      }),
    );
    assert.match(html, /^<details class="evidence-disclosure">/);
    assert.match(html, /Office source records/);
    assert.match(html, /Source records matched to this office only/);
    if (data.historicalDirectories?.length) {
      assert.equal(
        (html.match(/Historical directory listing/g) ?? []).length,
        data.historicalDirectories.length,
      );
      assert.match(html, /Checked Nov 14, 2026/);
      assert.equal((html.match(/Confirm current coverage/g) ?? []).length, 1);
      assert.match(html, /office and your plan/);
      for (const directory of data.historicalDirectories) {
        assert.ok(html.includes(directory.payer));
        assert.ok(html.includes(directory.program));
        assert.match(
          html,
          directory.payer === "Fidelis Care New Jersey"
            ? /as of Oct 6, 2026/
            : /as of Jun 2026/,
        );
        assert.doesNotMatch(html, /Jun 1, 2026/);
        for (const source of directory.sources) {
          assert.ok(
            html.includes(`href="${source.url}#page=${source.physicalPage}"`),
          );
          assert.ok(html.includes(`physical PDF page ${source.physicalPage}`));
          if (source.printedPage)
            assert.ok(html.includes(`Printed page ${source.printedPage}`));
        }
      }
    } else assert.doesNotMatch(html, /Fidelis|NJ FamilyCare|nonparticipation/);
    assert.doesNotMatch(html, /Other NJ FamilyCare plans|were not searched/);
    if (data.federalOrganization) {
      assert.match(html, /Federal organizational NPI/);
      assert.ok(html.includes(`NPI ${data.federalOrganization.npi}`));
      assert.ok(html.includes(`href="${data.federalOrganization.sourceUrl}"`));
      assert.match(html, /record last updated/);
      assert.match(html, /not evidence of licensing/);
    } else
      assert.doesNotMatch(html, /Federal organizational NPI|CMS NPI Registry/);
    assert.doesNotMatch(
      html.replace(/<[^>]+>/g, ""),
      /taxonomy|registered trade|HP\d{7}|score/i,
    );
  }
  assert.equal(
    renderToStaticMarkup(
      createElement(HomeCareOfficeIdentifiers, {
        data: { providerId: "empty" },
        uid: "empty",
      }),
    ),
    "",
  );
});

test("runtime imports use only the public snapshot and the browser never imports the getter", () => {
  const emittedImports = (file: string) => {
    const compiled = ts.transpileModule(read(file), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    return ts
      .preProcessFile(compiled)
      .importedFiles.map((item) => item.fileName);
  };
  assert.deepEqual(emittedImports("src/lib/home-care-office-identifiers.ts"), [
    "../data/home-care-office-identifiers.json",
  ]);
  const imports = emittedImports(
    "src/components/home-care-office-identifiers.tsx",
  );
  assert.ok(imports.includes("./evidence-date"));
  assert.equal(
    imports.some((name) => /research|identifiers|data\//.test(name)),
    false,
  );
});
