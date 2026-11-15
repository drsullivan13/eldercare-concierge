import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgencyInquiryLinks } from "../src/components/dashboard/agency-inquiry-links";
import routes from "../src/data/inputs/nj-home-care-inquiry-routes.json";
import { familyOutreachMessage } from "../src/lib/home-care-message";
import type { HomeCareOutreachRecord } from "../src/lib/home-care-outreach";
import { homeCareProvider } from "./helpers/home-care-outreach";

const reviewed = {
  "north-jersey-hp-hp0015347": {
    email: null,
    form: "https://www.bayada.com/office/nj/morristown/personal-and-companion-care/morris-county-10005",
    sourceUrl:
      "https://www.bayada.com/office/nj/morristown/personal-and-companion-care/morris-county-10005",
  },
  "north-jersey-hp-hp0022500": {
    email: "bergenhomecare@gmail.com",
    form: null,
    sourceUrl: "https://www.bergenhomecare.net/contact-us",
  },
  "north-jersey-hp-hp0033500": {
    email: "accoffice@acccares.net",
    form: null,
    sourceUrl: "https://www.acccares.com/",
  },
  "north-jersey-hp-hp0082500": {
    email: "info@serenity-senior-care.com",
    form: null,
    sourceUrl: "https://www.serenity-senior-care.com/health-care-contact-us",
  },
  "north-jersey-hp-hp0099100": {
    email: "info@gsecare.com",
    form: null,
    sourceUrl: "https://www.gsecare.com/contact/",
  },
  "north-jersey-hp-hp0115500": {
    email: "services@ccihomecare.com",
    form: null,
    sourceUrl: "https://ccihomecare.com/contact-us/",
  },
  "north-jersey-hp-hp0118200": {
    email: null,
    form: "https://www.homeinstead.com/home-care/usa/nj/millburn/288/",
    sourceUrl: "https://www.homeinstead.com/home-care/usa/nj/millburn/288/",
  },
  "north-jersey-hp-hp0119000": {
    email: null,
    form: "https://www.visitingangels.com/montclair/contact-us",
    sourceUrl: "https://www.visitingangels.com/montclair/contact-us",
  },
  "north-jersey-hp-hp0427400": {
    email: null,
    form: "https://agapehomecareagency.org/contact-us/",
    sourceUrl: "https://agapehomecareagency.org/contact-us/",
  },
  "north-jersey-hp-hp0440600": {
    email: null,
    form: null,
    sourceUrl: "https://www.landlhomecare.com/contact-us/",
  },
} as const;

const officeIds = Object.keys(reviewed);

const invitationTime = new Date("2026-11-17T22:30:00.000Z");
const suitableRecord: HomeCareOutreachRecord = {
  providerName: "Agency",
  stage: "interview",
  interview: {
    status: "completed",
    outcome: "suitable",
    occurredAt: "2026-11-12T18:00:00.000Z",
  },
  notes: "",
  updatedAt: "2026-11-13T18:00:00.000Z",
};

function markup(
  providerId: string,
  purpose: "interview" | "introduction",
  options: Partial<ComponentProps<typeof AgencyInquiryLinks>> = {},
) {
  return renderToStaticMarkup(
    createElement(AgencyInquiryLinks, { providerId, purpose, ...options }),
  );
}

function hrefs(html: string) {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) =>
    match[1].replaceAll("&amp;", "&"),
  );
}

function mailtoParts(href: string) {
  const [address, query] = href.slice("mailto:".length).split("?");
  const entries = query.split("&").map((part) => {
    const [key, value] = part.split("=");
    return [decodeURIComponent(key), decodeURIComponent(value)];
  });
  const params = Object.fromEntries(entries);
  return {
    address: decodeURIComponent(address),
    keys: entries.map(([key]) => key),
    subject: params.subject,
    body: params.body,
  };
}

test("the registry covers the ten reviewed home-care offices and no others", () => {
  assert.deepEqual(Object.keys(routes.offices).sort(), [...officeIds].sort());
  assert.equal(routes.checkedAt, "2026-11-13");
});

test("all ten route IDs identify home-care offices in the retained catalog", () => {
  const providers: {
    id: string;
    category: string;
    locationKind: string;
  }[] = JSON.parse(
    readFileSync(
      new URL(
        "../research/north-jersey/runtime/providers.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const id of Object.keys(routes.offices)) {
    const matches = providers.filter((provider) => provider.id === id);
    assert.equal(matches.length, 1, id);
    assert.equal(matches[0].category, "home-care", id);
    assert.equal(matches[0].locationKind, "office", id);
  }
});

test("each office keeps the reviewed route, source, and check date", () => {
  for (const [id, expected] of Object.entries(reviewed)) {
    const office = routes.offices[id as keyof typeof routes.offices];
    const email = office.routes.find((route) => route.kind === "email");
    const form = office.routes.find((route) => route.kind === "form");
    assert.equal(
      email && "address" in email ? email.address : null,
      expected.email,
    );
    assert.equal(form && "href" in form ? form.href : null, expected.form);
    for (const route of office.routes) {
      assert.equal(route.sourceUrl, expected.sourceUrl);
      assert.equal(route.checkedAt, "2026-11-13");
      assert.equal(route.sourceUrl.startsWith("https://"), true);
    }
  }
});

test("Agape keeps the form and never exposes the conflicting email", () => {
  const office = routes.offices["north-jersey-hp-hp0427400"];
  assert.deepEqual(
    office.routes.map((route) => route.kind),
    ["form"],
  );
  assert.deepEqual(office.excluded, [
    {
      kind: "email",
      value: "info@agapehomecare.com",
      sourceUrl: "https://agapehomecareagency.org/contact-us/",
      checkedAt: "2026-11-13",
      reason:
        "The page body lists info@agapehomecare.com and the footer mailto target differs. Neither address is a usable route.",
    },
  ]);
  const html = markup("north-jersey-hp-hp0427400", "interview");
  assert.equal(html.includes("info@agapehomecare.com"), false);
  assert.equal(html.includes("mailto:"), false);
  assert.deepEqual(hrefs(html), [
    "https://agapehomecareagency.org/contact-us/",
  ]);
});

test("L & L keeps the company-wide form out of usable routes", () => {
  const office = routes.offices["north-jersey-hp-hp0440600"];
  assert.deepEqual(office.routes, []);
  assert.deepEqual(office.excluded, [
    {
      kind: "form",
      value: "https://www.landlhomecare.com/contact-us/",
      sourceUrl: "https://www.landlhomecare.com/contact-us/",
      checkedAt: "2026-11-13",
      reason:
        "The company-wide form features Englewood in the text above it. The site labels the Union office separately, so this form is not a usable route for Union.",
    },
  ]);
  assert.equal(markup("north-jersey-hp-hp0440600", "interview"), "");
  assert.equal(markup("north-jersey-hp-hp0440600", "introduction"), "");
});

test("an unknown office and a same-brand different office render nothing", () => {
  for (const id of [
    "",
    "constructor",
    "__proto__",
    "toString",
    "north-jersey-hp-hp9999999",
    "cms-317020",
    "north-jersey-campus-crane-s-mill-07006",
    "north-jersey-hp-hp0015319",
    "north-jersey-hp-hp0035001",
    "north-jersey-hp-hp0067900",
    "north-jersey-hp-hp0208200",
    "north-jersey-hp-hp0286800",
    "north-jersey-hp-hp0297500",
    "north-jersey-hp-hp0336100",
  ]) {
    for (const purpose of ["interview", "introduction"] as const) {
      assert.equal(AgencyInquiryLinks({ providerId: id, purpose }), null, id);
      assert.equal(markup(id, purpose), "", id);
    }
  }
});

test("email drafts differ by purpose and contain no personal details", () => {
  for (const [id, expected] of Object.entries(reviewed)) {
    if (!expected.email) continue;
    for (const purpose of ["interview", "introduction"] as const) {
      const [href] = hrefs(
        markup(id, purpose, { at: invitationTime, record: suitableRecord }),
      );
      const draft = mailtoParts(href);
      assert.equal(draft.address, expected.email);
      assert.equal(href.startsWith("mailto:"), true);
      assert.doesNotMatch(href, /\+/);
      assert.match(href, /%20/);
      assert.match(href, /%0A/);
      assert.deepEqual(draft.keys, ["subject", "body"]);
      assert.deepEqual(
        { subject: draft.subject, body: draft.body },
        familyOutreachMessage(purpose, invitationTime),
      );
      assert.match(
        draft.body,
        /Tuesday, November 17, 2026 at 5:30 PM EST \(New Jersey time\)/,
      );
      assert.doesNotMatch(
        draft.body,
        /diagnos|medication|medicare|medicaid|ssn|date of birth/i,
      );
    }
  }
  const id = "north-jersey-hp-hp0022500";
  const interview = mailtoParts(hrefs(markup(id, "interview"))[0]);
  const introduction = mailtoParts(
    hrefs(
      markup(id, "introduction", {
        at: invitationTime,
        record: suitableRecord,
      }),
    )[0],
  );
  assert.notEqual(interview.subject, introduction.subject);
  assert.notEqual(interview.body, introduction.body);
});

test("every usable office renders only its reviewed email or https form", () => {
  for (const [id, expected] of Object.entries(reviewed)) {
    const html = markup(id, "interview");
    if (!expected.email && !expected.form) {
      assert.equal(html, "");
      continue;
    }
    const links = hrefs(html);
    assert.equal(links.length, 1);
    assert.equal(html.includes('class="text-link"'), true);
    assert.equal(html.includes("<form"), false);
    assert.equal(html.includes("<button"), false);
    assert.equal(html.includes("website"), false);
    assert.equal(html.includes("tel:"), false);
    assert.equal(html.includes("confirmed"), false);
    if (expected.email) {
      assert.equal(mailtoParts(links[0]).address, expected.email);
      assert.match(html, />Draft an email<\/a>/);
      assert.equal(html.includes("target="), false);
    }
    if (expected.form) {
      assert.equal(links[0], expected.form);
      assert.equal(links[0].startsWith("https://"), true);
      assert.match(html, /target="_blank"/);
      assert.match(html, /rel="noreferrer"/);
    }
  }
});

test("every public introduction route requires a recorded suitable interview and a valid later time", () => {
  for (const id of officeIds) {
    for (const options of [
      {},
      { at: invitationTime },
      { record: suitableRecord },
      { record: suitableRecord, at: new Date("invalid") },
      {
        record: suitableRecord,
        at: new Date(
          suitableRecord.interview.status === "completed"
            ? suitableRecord.interview.occurredAt
            : "",
        ),
      },
      { record: suitableRecord, at: new Date("2026-11-11T18:00:00.000Z") },
      {
        record: {
          ...suitableRecord,
          interview: {
            status: "scheduled" as const,
            scheduledAt: "2026-11-12T18:00:00.000Z",
          },
        },
        at: invitationTime,
      },
      {
        record: {
          ...suitableRecord,
          interview: {
            status: "completed" as const,
            outcome: "not-suitable" as const,
            occurredAt: "2026-11-12T18:00:00.000Z",
          },
        },
        at: invitationTime,
      },
    ]) {
      assert.equal(markup(id, "introduction", options), "", id);
    }
    assert.equal(
      hrefs(
        markup(id, "introduction", {
          record: suitableRecord,
          at: invitationTime,
        }),
      ).length,
      reviewed[id as keyof typeof reviewed].email ||
        reviewed[id as keyof typeof reviewed].form
        ? 1
        : 0,
    );
  }
});

test("other home-care agencies use their published phone, mail and website", () => {
  const html = markup(homeCareProvider.id, "interview", {
    provider: homeCareProvider,
  });
  const links = hrefs(html);
  assert.deepEqual(
    links.map((href) => href.split("?")[0]),
    [
      "tel:9735550100",
      "https://agency.example.invalid/contact",
      "mailto:care@agency.example.invalid",
      "https://agency.example.invalid/",
    ],
  );
  assert.equal(
    new URL(links[2]).searchParams.get("body"),
    familyOutreachMessage("interview").body,
  );
  assert.equal(
    markup(homeCareProvider.id, "introduction", { provider: homeCareProvider }),
    "",
  );
  for (const category of [
    "home-health",
    "staffing",
    "assisted-living",
  ] as const)
    assert.equal(
      markup(homeCareProvider.id, "interview", {
        provider: { ...homeCareProvider, category },
      }),
      "",
    );
  assert.equal(
    markup(homeCareProvider.id, "interview", {
      provider: {
        ...homeCareProvider,
        phone: "javascript:alert(1)",
        website: undefined,
        sources: homeCareProvider.sources.map((source) => ({
          ...source,
          url: "https://user:password@agency.example.invalid/contact",
        })),
      },
    }),
    "",
  );
});
