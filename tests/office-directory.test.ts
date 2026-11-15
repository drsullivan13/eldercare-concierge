import { mergeAnnualClientAwards } from "../scripts/release-activated-insights-office-directory";
import accreditation from "../src/data/home-care-accreditation-extension.json";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "../src/app/api/research/route";
import {
  ClientSurveyRecognition,
  OfficeDirectory,
} from "../src/components/office-directory";
import { RegistrationProfile } from "../src/components/registration-profile";
import { getMarket } from "../src/lib/markets";
import { getLocationResearch } from "../src/lib/location-research";
import { getOfficeDirectoryResearch } from "../src/lib/office-directory-research";
import { getRegistrationFacts } from "../src/lib/registration-facts";
import activated from "../src/data/activated-insights-office-directory.json";
import associations from "../src/data/home-care-association-directories.json";
import identifiers from "../src/data/home-care-office-identifiers.json";
import state from "../src/data/nj-registration-facts.json";

const nj = getMarket("north-jersey")!;
const offices = nj.providers.filter(
  (provider) => provider.category === "home-care",
);
const id = "north-jersey-hp-hp0256900";

test("each live office has its exact state facts while catalog records remain small", () => {
  assert.equal(offices.length, Object.keys(state.providers).length);
  for (const provider of offices) {
    const facts = getRegistrationFacts(provider)!;
    assert.equal(facts.businessName, provider.name);
    assert.equal(
      provider.id,
      "north-jersey-hp-" + facts.registration.toLowerCase(),
    );
    assert.equal(facts.source.checkedAt, state.source.checkedAt);
    assert.equal("registrationFacts" in provider, false);
  }
  assert.equal(getRegistrationFacts({ ...offices[0], state: "MA" }), undefined);
  assert.equal(
    getRegistrationFacts({ ...offices[0], name: "Different organization" }),
    undefined,
  );
  const stale = offices
    .map(getRegistrationFacts)
    .find(
      (facts) => facts?.expiresOn && facts.expiresOn < facts.source.checkedAt,
    )!;
  const html = renderToStaticMarkup(
    createElement(RegistrationProfile, { facts: stale }),
  );
  assert.ok(html.includes("Confirm the current registration"));
});

test("every directory office has source-specific evidence and the provider research route publishes only the requested office", async () => {
  const combined = [
    ...activated.offices,
    ...associations.offices,
    ...accreditation.offices,
  ];
  for (const entry of combined) {
    const published = getOfficeDirectoryResearch(entry.providerId)!;
    assert.ok(
      published.some(
        (record) =>
          record.source.url === entry.source.url &&
          record.source.id === entry.source.id,
      ),
    );
    assert.ok(
      published.every((record) => record.providerId === entry.providerId),
    );
  }
  const response = await GET(
    new Request("https://harbor.example/api/research?id=" + id),
  ).json();
  assert.equal(response.registrationFacts.registration, "HP0256900");
  assert.ok(
    response.officeDirectories.some(
      (record: { source: { publisher: string } }) =>
        record.source.publisher === "Activated Insights",
    ),
  );
  assert.equal(
    JSON.stringify(response.officeDirectories).includes('"accounts"'),
    false,
  );
  const [activatedOffice] = getOfficeDirectoryResearch(id)!.filter(
    (record) => record.source.publisher === "Activated Insights",
  );
  const html = renderToStaticMarkup(
    createElement(OfficeDirectory, {
      data: activatedOffice,
      uid: "test-office",
    }),
  );
  assert.ok(!html.includes("Provider of Choice"));
  const awards = renderToStaticMarkup(
    createElement(ClientSurveyRecognition, {
      directories: [activatedOffice],
      uid: "awards",
    }),
  );
  assert.ok(awards.includes("Client survey recognition"));
  assert.ok(awards.includes("Provider of Choice"));
  assert.ok(html.includes("Listed services"));
  assert.ok(html.includes(activatedOffice.source.url));
  const accredited = associations.offices.find(
    (office) => "accreditations" in office,
  )!;
  const listing = getOfficeDirectoryResearch(accredited.providerId)!.find(
    (record) => record.source.id === accredited.source.id,
  )!;
  assert.ok(
    renderToStaticMarkup(
      createElement(OfficeDirectory, { data: listing, uid: "cahc" }),
    ).includes("Listed accreditation"),
  );
});

test("identity, historical payer, directory evidence and survey awards do not change experience scores", async () => {
  const ids = new Set(
    [
      ...activated.offices,
      ...associations.offices,
      ...accreditation.offices,
      ...identifiers.offices,
    ].map((p) => p.providerId),
  );
  for (const providerId of ids) {
    const custom = getLocationResearch(providerId, "2026-11-15", [nj]);
    const published = getLocationResearch(providerId, "2026-11-15");
    assert.deepEqual(published.experience, custom.experience);
    assert.deepEqual(published.reviewAggregates, custom.reviewAggregates);
    assert.deepEqual(published.availability, custom.availability);
    assert.equal(custom.officeDirectories, undefined);
    assert.equal(custom.officeIdentifiers, undefined);
    assert.equal(custom.registrationFacts, undefined);
  }
  const sample = identifiers.offices.find(
    (office) => "historicalDirectories" in office,
  )!;
  const json = await GET(
    new Request("https://harbor.example/api/research?id=" + sample.providerId),
  ).json();
  assert.deepEqual(json.officeIdentifiers, sample);
});

test("annual lists merge one recognition per year and reject wrong office, edition or recipient", () => {
  const provider = offices.find((p) => p.id === "north-jersey-hp-hp0191900")!;
  const facts = getRegistrationFacts(provider)!;
  const award = {
    year: 2022,
    namedRecipient: "SYNERGY HomeCare of N. Central NJ",
    sourceUrl:
      "https://activatedinsights.com/latest-news/2022-provider-of-choice/",
  };
  const row = {
    providerId: provider.id,
    registration: facts.registration,
    businessName: provider.name,
    registeredTradeName: facts.dbas,
    registryAddress: provider.address,
    registryCity: provider.city,
    registryZip: provider.zip,
    phone: provider.phone!,
    checkedAt: "2026-11-15",
    awards: [award],
  };
  const [office] = mergeAnnualClientAwards([], [row]);
  const [merged] = mergeAnnualClientAwards([office], [row]);
  assert.deepEqual(merged, office);
  assert.deepEqual(office.services, []);
  assert.deepEqual(office.awards, [
    {
      name: "Provider of Choice",
      years: [2022],
      annualSources: [{ year: 2022, url: award.sourceUrl }],
    },
  ]);
  assert.equal(
    renderToStaticMarkup(
      createElement(OfficeDirectory, { data: office, uid: "details" }),
    ),
    "",
  );
  assert.match(
    renderToStaticMarkup(
      createElement(ClientSurveyRecognition, {
        directories: [office],
        uid: "reviews",
      }),
    ),
    /href="https:\/\/activatedinsights.com\/latest-news\/2022-provider-of-choice\/"/,
  );
  for (const change of [
    { registryAddress: "Different unit" },
    { registeredTradeName: "SYNERGY HomeCare" },
    { awards: [{ ...award, year: 2024 }] },
    { awards: [{ ...award, namedRecipient: "Another office" }] },
  ])
    assert.throws(() => mergeAnnualClientAwards([], [{ ...row, ...change }]));
});

test("BAYADA award recipients require both operator team codes and the exact personal-care office", () => {
  const p = offices.find((p) => p.id === "north-jersey-hp-hp0015347")!;
  const f = getRegistrationFacts(p)!;
  const url =
    "https://www.bayada.com/office/nj/morristown/personal-and-companion-care/morris-county-10005";
  const award = {
    year: 2024,
    namedRecipient: "BAYADA Home Health Care, Morristown, NJ (MOR – 6)",
    sourceUrl:
      "https://activatedinsights.com/articles/2024-best-of-home-care-provider-of-choice-award-winners/",
  };
  const row = {
    providerId: p.id,
    registration: f.registration,
    businessName: f.businessName,
    registryAddress: p.address,
    registryCity: p.city,
    registryZip: p.zip,
    phone: p.phone!,
    checkedAt: "2026-11-15",
    operatorReceipt: {
      url,
      teamCode: "MOR",
      teamNumber: "6",
      address: "32 Maple Avenue, 1st Floor",
      city: "Morristown",
      zip: "07960",
      phone: p.phone!,
    },
    awards: [award],
  };
  assert.equal(mergeAnnualClientAwards([], [row])[0].awards[0].years[0], 2024);
  for (const change of [
    { operatorReceipt: { ...row.operatorReceipt, teamNumber: "60" } },
    {
      operatorReceipt: {
        ...row.operatorReceipt,
        url: url.replace("personal-and-companion-care", "pediatrics"),
      },
    },
    {
      operatorReceipt: {
        ...row.operatorReceipt,
        address: "32 Maple Avenue, 2nd Floor",
      },
    },
    {
      awards: [
        { ...award, namedRecipient: "BAYADA Home Health Care (MOR – 60)" },
      ],
    },
  ])
    assert.throws(() => mergeAnnualClientAwards([], [{ ...row, ...change }]));
});
