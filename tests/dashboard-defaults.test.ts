import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useCareSearch } from "../src/hooks/use-care-search";
import { createEmptyWorkspace } from "../src/lib/workspace";

for (const { name, zip, expected } of [
  { name: "fresh signed-in profile", zip: "", expected: "07928" },
  { name: "saved Massachusetts profile", zip: "02459", expected: "02459" },
  { name: "saved New Jersey profile", zip: "07030", expected: "07030" },
]) {
  test(`${name} initializes the dashboard form and submitted search ZIP`, () => {
    const profile = { ...createEmptyWorkspace().profile, zip };
    let observed: { draft: string; request: string } | undefined;
    function SearchProbe() {
      const search = useCareSearch(profile);
      observed = { draft: search.draft.zip, request: search.request.zip };
      return null;
    }
    renderToStaticMarkup(createElement(SearchProbe));
    assert.deepEqual(observed, { draft: expected, request: expected });
  });
}
