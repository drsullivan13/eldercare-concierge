import assert from "node:assert/strict";
import test from "node:test";
import { carePlanText } from "../src/components/dashboard/export-plan";
import { createEmptyWorkspace } from "../src/lib/workspace";
import type { Provider } from "../src/lib/providers";

const provider: Provider = {
  id: "known-provider",
  name: "Known care option",
  category: "assisted-living",
  address: "1 Main Street",
  city: "Boston",
  state: "MA",
  zip: "02108",
  lat: null,
  lng: null,
  locationKind: "facility",
  description: "",
  services: [],
  officialRecord: true,
  warnings: [],
  limitations: [],
  sources: [
    {
      title: "State listing",
      publisher: "Massachusetts",
      url: "https://www.mass.gov/",
      kind: "regulatory",
      checkedAt: "2026-11-12",
      supports: "Listing",
    },
  ],
};

test("plan export retains every saved ID and note when provider loading fails", () => {
  const workspace = createEmptyWorkspace();
  workspace.savedProviderIds = [provider.id, "unresolved-provider"];
  workspace.notes = {
    [provider.id]: "Ask about visits",
    "unresolved-provider": "Confirm costs",
    "unsaved-provider": "Keep this conversation",
  };
  workspace.tasks = [
    {
      id: "call",
      title: "Call about a room",
      category: "Care",
      dueDate: "2026-12-01",
      status: "todo",
      providerId: "unresolved-provider",
    },
  ];
  const text = carePlanText(
    workspace,
    [],
    "02459",
    new Date("2026-11-12T12:00:00Z"),
  );
  assert.match(text, /Search area: 02459/);
  for (const id of workspace.savedProviderIds)
    assert.ok(text.includes(`### ${id}`));
  for (const note of Object.values(workspace.notes))
    assert.ok(text.includes(note));
  assert.match(
    text,
    /- \[ \] Call about a room · Due 2026-12-01 · Care · Provider: unresolved-provider/,
  );
  assert.match(text, /Provider details could not be loaded/);
});

test("partially hydrated exports include sources while preserving missing saved options", () => {
  const workspace = createEmptyWorkspace();
  workspace.profile.zip = "02108";
  workspace.savedProviderIds = [provider.id, "unresolved-provider"];
  workspace.notes["unresolved-provider"] = "Keep this option";
  const text = carePlanText(workspace, [provider], "02459");
  assert.match(text, /Search area: 02108/);
  assert.match(text, /### Known care option/);
  assert.match(text, /State listing: https:\/\/www.mass.gov\//);
  assert.match(text, /### unresolved-provider/);
  assert.match(text, /Notes: Keep this option/);
});

test("card identities preserve unsaved note names and saved detail fallback without inventing sources", () => {
  const workspace = createEmptyWorkspace();
  workspace.savedProviderIds = [provider.id];
  workspace.notes = {
    [provider.id]: "Confirm care",
    "unsaved-card": "Ask about hours",
  };
  const text = carePlanText(
    workspace,
    [
      { id: provider.id, name: provider.name },
      { id: "unsaved-card", name: "Unsaved agency" },
    ],
    "07928",
  );
  assert.match(text, /### Known care option/);
  assert.match(text, /Provider details could not be loaded/);
  assert.match(text, /### Unsaved agency/);
  assert.match(text, /Notes: Ask about hours/);
  assert.doesNotMatch(text, /State listing|undefined/);
  const hydrated = carePlanText(
    workspace,
    [{ id: provider.id, name: provider.name }, provider],
    "07928",
  );
  assert.match(hydrated, /1 Main Street/);
  assert.match(hydrated, /State listing: https:\/\/www.mass.gov\//);
});
