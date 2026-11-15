import assert from "node:assert/strict";
import test from "node:test";
import {
  homeCareContactLinks,
  homeCareNextAction,
  parseHomeCareOutreach,
  recordHomeCareInterview,
  recordHomeCareIntroduction,
} from "../src/lib/home-care-outreach";
import { createEmptyWorkspace, validateWorkspace } from "../src/lib/workspace";
import { parseDemoImport } from "../src/lib/demo-workspace-import";
import { parseAccountSnapshot } from "../src/lib/account-workspace";
import { mergeOutreach } from "../src/lib/outreach";
import { carePlanText } from "../src/components/dashboard/export-plan";
import {
  homeCareProvider as provider,
  suitableHomeCareInterview as suitable,
} from "./helpers/home-care-outreach";

const id = provider.id;
const confirmed = recordHomeCareIntroduction(
  suitable,
  {
    status: "confirmed",
    startsAt: "2026-11-15T10:00:00.000Z",
  },
  "2026-11-13T15:00:00.000Z",
);

test("home-care-outreach gates introductions and clears invalidated confirmation after interview corrections", () => {
  for (const status of [
    "not-started",
    "declined",
    "no-response",
    "reschedule",
  ] as const) {
    const record = recordHomeCareInterview(
      provider.name,
      confirmed,
      { status },
      "",
    );
    assert.equal(record.stage, "interview");
    assert.equal("introduction" in record, false);
    assert.throws(
      () =>
        recordHomeCareIntroduction(record, {
          status: "proposed",
          startsAt: "2026-11-15T10:00:00.000Z",
        }),
      /Complete a suitable interview/,
    );
  }
  const notSuitable = recordHomeCareInterview(
    provider.name,
    confirmed,
    {
      status: "completed",
      outcome: "not-suitable",
      occurredAt: "2026-11-12T10:00:00.000Z",
    },
    "",
  );
  assert.equal(notSuitable.stage, "interview");
  assert.throws(() =>
    recordHomeCareIntroduction(
      notSuitable,
      confirmed.stage === "introduction"
        ? confirmed.introduction
        : { status: "confirmed", startsAt: "" },
    ),
  );
  const correctedTime = recordHomeCareInterview(
    provider.name,
    confirmed,
    {
      status: "completed",
      outcome: "suitable",
      occurredAt: "2026-11-12T11:00:00.000Z",
    },
    "",
  );
  assert.equal(correctedTime.stage, "interview");
  assert.equal(
    recordHomeCareInterview(
      provider.name,
      confirmed,
      suitable.interview,
      "Corrected notes",
    ).stage,
    "introduction",
  );
  assert.throws(
    () =>
      recordHomeCareIntroduction(suitable, {
        status: "confirmed",
        startsAt: "2026-11-12T10:00:00.000Z",
      }),
    /after the interview/,
  );
});

test("home-care-outreach strict workspace boundary rejects forged, oversized and impossible stages", () => {
  const raw = {
    ...suitable,
    introduction: { status: "confirmed", startsAt: "2026-11-15T10:00:00.000Z" },
  };
  const invalid: unknown[] = [
    null,
    [],
    { ...suitable, stage: "confirmed" },
    raw,
    { ...suitable, owner: "another-family" },
    { ...suitable, notes: "x".repeat(2001) },
    { ...suitable, notes: "unsafe\u0000" },
    { ...suitable, providerName: "" },
    { ...suitable, providerName: "x".repeat(241) },
    { ...suitable, updatedAt: "2026-02-30T12:00:00.000Z" },
    { ...suitable, updatedAt: "2026-11-13T25:00:00.000Z" },
    { ...suitable, updatedAt: "2026-11-13T14:00:00Z" },
    { ...suitable, interview: { status: "completed", outcome: "suitable" } },
    {
      ...suitable,
      interview: {
        status: "completed",
        outcome: "maybe",
        occurredAt: "2026-11-12T10:00:00.000Z",
      },
    },
    {
      ...suitable,
      interview: {
        ...suitable.interview,
        occurredAt: "2026-12-01T10:00:00.000Z",
      },
    },
    {
      ...suitable,
      interview: {
        status: "scheduled",
        scheduledAt: "2026-02-30T10:00:00.000Z",
      },
    },
    {
      ...suitable,
      interview: { status: "scheduled", scheduledAt: "2026-11-13" },
    },
    {
      ...suitable,
      interview: {
        status: "scheduled",
        scheduledAt: "2026-11-13T10:00:00.000Z",
        confirmed: true,
      },
    },
    { ...suitable, stage: "introduction" },
    { ...confirmed, interview: { status: "no-response" } },
    {
      ...confirmed,
      interview: {
        status: "completed",
        outcome: "not-suitable",
        occurredAt: "2026-11-12T10:00:00.000Z",
      },
    },
    {
      ...confirmed,
      introduction: {
        status: "auto-confirmed",
        startsAt: "2026-11-15T10:00:00.000Z",
      },
    },
    {
      ...confirmed,
      introduction: {
        status: "confirmed",
        startsAt: "2026-11-15T10:00:00.000Z",
        verifiedByAgency: true,
      },
    },
    {
      ...confirmed,
      introduction: {
        status: "proposed",
        startsAt: "2026-11-11T10:00:00.000Z",
      },
    },
  ];
  for (const record of invalid) {
    assert.equal(
      validateWorkspace({
        ...createEmptyWorkspace(),
        homeCareOutreach: { [id]: record },
      }).ok,
      false,
      JSON.stringify(record),
    );
  }
  for (const key of ["__proto__", "constructor", "prototype", "not an id"]) {
    assert.equal(
      parseHomeCareOutreach(Object.fromEntries([[key, suitable]])),
      null,
    );
  }
  const maximum = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      `provider-${i}`,
      { ...confirmed, notes: "x".repeat(2000), providerName: "x".repeat(240) },
    ]),
  );
  assert.equal(
    validateWorkspace({ ...createEmptyWorkspace(), homeCareOutreach: maximum })
      .ok,
    true,
  );
  assert.equal(parseHomeCareOutreach({ ...maximum, excess: suitable }), null);
});

test("home-care-outreach survives JSON, account parser, demo import, per-provider edits and voice merges without changing legacy work", () => {
  const legacy = createEmptyWorkspace();
  assert.deepEqual(validateWorkspace(legacy), { ok: true, workspace: legacy });
  assert.equal("homeCareOutreach" in legacy, false);
  const workspace = {
    ...legacy,
    notes: { existing: "Keep this note" },
    homeCareOutreach: { [id]: confirmed, other: suitable },
  };
  const checked = validateWorkspace(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(checked, { ok: true, workspace });
  assert.deepEqual(
    parseDemoImport(JSON.stringify(workspace), legacy),
    workspace,
  );
  assert.deepEqual(
    parseAccountSnapshot({
      owner: "11111111-1111-4111-8111-111111111111",
      revision: "2026-11-13T15:00:00.000001+00:00",
      workspace,
    }).workspace,
    workspace,
  );
  const merged = {
    ...workspace,
    outreach: mergeOutreach([], []),
    homeCareOutreach: {
      ...workspace.homeCareOutreach,
      [id]: suitable,
    },
  };
  assert.deepEqual(merged.homeCareOutreach.other, suitable);
  assert.deepEqual(merged.notes, workspace.notes);
  assert.equal(validateWorkspace(merged).ok, true);
  const exportText = carePlanText(workspace, [], "07928");
  for (const expected of [
    id,
    "2026-11-12T10:00:00.000Z",
    "2026-11-15T10:00:00.000Z",
    "Family-recorded confirmation: confirmed",
    suitable.notes,
    "separate from voice rehearsal",
    "Next action: Attend",
  ]) {
    assert.ok(exportText.includes(expected), expected);
  }
});

test("home-care-outreach next actions distinguish every outcome and proposed from family-confirmed times", () => {
  assert.match(homeCareNextAction(suitable).label, /Invite the agency/);
  assert.match(homeCareNextAction(confirmed).label, /confirmed by your family/);
  const proposed = recordHomeCareIntroduction(suitable, {
    status: "proposed",
    startsAt: "2026-11-15T10:00:00.000Z",
  });
  assert.match(homeCareNextAction(proposed).label, /confirm the proposed/);
  const cancelled = recordHomeCareIntroduction(suitable, {
    status: "cancelled",
    startsAt: "2026-11-15T10:00:00.000Z",
  });
  assert.match(homeCareNextAction(cancelled).label, /Arrange a new/);
  for (const status of [
    "not-started",
    "declined",
    "no-response",
    "reschedule",
  ] as const) {
    assert.ok(
      homeCareNextAction(
        recordHomeCareInterview(provider.name, undefined, { status }, ""),
      ).label,
    );
  }
  const scheduled = recordHomeCareInterview(
    provider.name,
    undefined,
    { status: "scheduled", scheduledAt: "2026-11-15T09:00:00.000Z" },
    "",
  );
  assert.equal(homeCareNextAction(scheduled).at, "2026-11-15T09:00:00.000Z");
});

test("home-care-outreach uses only published provider contact routes and never prefills personal data", () => {
  const links = homeCareContactLinks(provider);
  assert.deepEqual(
    links.map((link) => link.href),
    [
      "tel:9735550100",
      "https://agency.example.invalid/contact",
      "mailto:care@agency.example.invalid",
      "https://agency.example.invalid/",
    ],
  );
  assert.deepEqual(homeCareContactLinks({ sources: [] }), []);
  assert.deepEqual(
    homeCareContactLinks({
      phone: "call us",
      website: "javascript:alert(1)",
      sources: [
        {
          ...provider.sources[0],
          url: "https://user:password@evil.invalid/contact",
        },
        {
          ...provider.sources[1],
          url: "mailto:care@example.invalid?body=private",
        },
        { ...provider.sources[1], kind: "regulatory" },
      ],
    }),
    [],
  );
});
