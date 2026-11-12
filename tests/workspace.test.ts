import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyWorkspace,
  safeRelativeRedirect,
  validateWorkspace,
} from "../src/lib/workspace";

test("valid workspace preserves a Boston ZIP and personal plain text", () => {
  const w = createEmptyWorkspace();
  w.profile.zip = "02108";
  w.savedProviderIds = ["boston-1"];
  w.notes["boston-1"] = "<script>plain text only</script>";
  w.tasks = [
    {
      id: "t-1",
      title: "Call provider",
      category: "Care",
      dueDate: "2026-12-01",
      status: "todo",
      providerId: "boston-1",
    },
  ];
  assert.deepEqual(validateWorkspace(w), { ok: true, workspace: w });
});

test("rejects overlong data, duplicate IDs, forged ownership and task status", () => {
  const base = createEmptyWorkspace();
  for (const bad of [
    { ...base, user_id: "other-owner" },
    { ...base, savedProviderIds: ["p", "p"] },
    { ...base, notes: { p: "x".repeat(2001) } },
    { ...base, profile: { ...base.profile, zip: 2108 } },
    {
      ...base,
      tasks: [
        {
          id: "t",
          title: "Call",
          category: "Care",
          dueDate: "2026-02-30",
          status: "todo",
        },
      ],
    },
    {
      ...base,
      tasks: [
        {
          id: "t",
          title: "Call",
          category: "Care",
          dueDate: "",
          status: "approved",
        },
      ],
    },
    { ...base, notes: JSON.parse('{"__proto__":"unsafe"}') },
  ])
    assert.equal(validateWorkspace(bad).ok, false);
});

test("missing required fields and prototype keys cannot pass", () => {
  assert.equal(validateWorkspace({}).ok, false);
  assert.equal(validateWorkspace(null).ok, false);
  assert.equal(
    validateWorkspace({ ...createEmptyWorkspace(), tasks: Array(101).fill({}) })
      .ok,
    false,
  );
});

test("callback redirects stay on same-origin application paths", () => {
  for (const value of [
    null,
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/%2f%2fevil.test",
    "/%5cevil.test",
    "/\nevil.test",
    "/auth/callback",
    "/api/workspace",
  ]) {
    assert.equal(safeRelativeRedirect(value), "/dashboard");
  }
  assert.equal(
    safeRelativeRedirect("/dashboard?tab=saved#list"),
    "/dashboard?tab=saved#list",
  );
  assert.equal(
    safeRelativeRedirect("/search?zip=02108&category=care"),
    "/search?zip=02108&category=care",
  );
});
