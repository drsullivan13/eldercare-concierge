import test from "node:test";
import assert from "node:assert/strict";
import { isSameOriginRequest } from "../src/lib/request-origin";
test("browser authority takes precedence over internal listen address", () => {
  assert.equal(
    isSameOriginRequest(
      new Request("http://0.0.0.0:3000/api/workspace", {
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginRequest(
      new Request("http://0.0.0.0:3000/api/workspace", {
        headers: {
          host: "harbor.example",
          origin: "https://harbor.example",
          "x-forwarded-proto": "https",
        },
      }),
    ),
    true,
  );
});
test("foreign, opaque, malformed and browser cross-site origins are rejected", () => {
  for (const origin of [
    "https://evil.example",
    "null",
    "https://harbor.example/path",
    "https://evil.example@harbor.example",
  ])
    assert.equal(
      isSameOriginRequest(
        new Request("https://harbor.example/api/workspace", {
          headers: { host: "harbor.example", origin },
        }),
      ),
      false,
    );
  assert.equal(
    isSameOriginRequest(
      new Request("https://harbor.example/api/workspace", {
        headers: {
          host: "harbor.example",
          origin: "https://harbor.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    ),
    false,
  );
});
