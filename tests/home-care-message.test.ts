import test from "node:test";
import assert from "node:assert/strict";
import { familyOutreachMessage } from "../src/lib/home-care-message";

test("a family can request a phone interview before suggesting a time", () => {
  const { subject, body } = familyOutreachMessage("interview");
  assert.match(subject, /interview/i);
  assert.match(body, /phone interview/i);
  assert.match(body, /What times are available/);
});

test("an invitation uses the proposed Eastern date and time year-round", () => {
  for (const [instant, local] of [
    ["2027-01-06T20:30:00Z", /Wednesday, January 6, 2027 at 3:30 PM EST/],
    ["2027-06-06T00:30:00Z", /Saturday, June 5, 2027 at 8:30 PM EDT/],
  ] as const) {
    const { body } = familyOutreachMessage("introduction", new Date(instant));
    assert.match(body, local);
    assert.match(body, /Please confirm or suggest another time/);
    assert.match(body, /in-home introduction/);
  }
});
