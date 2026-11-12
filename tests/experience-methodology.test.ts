import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Methodology from "../src/app/methodology/page";

test("public methodology explains sparse samples, disagreement and narrative independence without replacing the family-thread policy", () => {
  const text = renderToStaticMarkup(createElement(Methodology))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  assert.match(text, /EXPERIENCE V2/);
  assert.match(
    text,
    /single source family needs at least 30 reported reviews/i,
  );
  assert.match(text, /at least five each and ten total/);
  assert.match(
    text,
    /withholds its number when two independent sources with at least ten reviews each differ by two or more points/,
  );
  assert.match(
    text,
    /original platform averages and review counts remain visible/,
  );
  assert.match(
    text,
    /at least three recent, distinct critical reviews form a majority/,
  );
  assert.match(text, /same rule to favorable accounts/);
  assert.match(
    text,
    /Neither selected accounts nor Facebook posts add to the platform’s reported review count/,
  );
  assert.match(text, /These accounts do not change that score/);
  assert.match(text, /separately licensed nursing and assisted-living units/);
});
