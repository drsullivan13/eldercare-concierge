import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import regionalData from "../src/data/regional-markets.json";
import type { MarketSnapshot } from "../src/lib/markets";
import type { Provider } from "../src/lib/providers";
import type { LocationDescriptionResponse } from "../src/lib/location-description-types";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const nj = (regionalData as unknown as MarketSnapshot[]).find(
  (market) => market.id === "north-jersey",
)!;
const office = nj.providers.find(
  (provider) => provider.id === "north-jersey-hp-hp0015318",
)!;
const other = nj.providers.find(
  (provider) => provider.category === "home-care" && provider.id !== office.id,
)!;
const reviewed = {
  text: "Reviewed local office copy for families arranging help at home.",
  source: "https://example.com/reviewed-office",
  checkedAt: "2026-11-25",
};

type Harness = {
  descriptionGET: typeof import("../src/app/api/location-description/route").GET;
  searchGET: typeof import("../src/app/api/search/route").GET;
  providersGET: typeof import("../src/app/api/providers/route").GET;
  getMarket: typeof import("../src/lib/markets").getMarket;
  renderOverview: (provider: Provider) => string;
  renderDetail: (provider: Provider) => string;
  renderCard: (provider: Provider) => string;
  project: (provider: Provider) => LocationDescriptionResponse | null;
};

async function harness(records: Record<string, unknown>): Promise<Harness> {
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: `
        export {GET as descriptionGET} from "./src/app/api/location-description/route";
        export {GET as searchGET} from "./src/app/api/search/route";
        export {GET as providersGET} from "./src/app/api/providers/route";
        export {getMarket} from "./src/lib/markets";
        export {reviewedHomeCareDescription as project} from "./src/lib/reviewed-home-care-descriptions";
        import {createElement} from "react";
        import {renderToStaticMarkup} from "react-dom/server";
        import {PropertyOverview} from "./src/components/property-overview";
        import {ProviderDetail} from "./src/components/provider-detail";
        import {ProviderCard} from "./src/components/provider-card";
        import {projectSearchCard} from "./src/lib/search";
        export const renderCard = provider => renderToStaticMarkup(
          createElement(ProviderCard, {
            provider: projectSearchCard({...provider, distanceMiles:1}),
            saved:false, onSave(){}, onOpen(){}, onReviews(){}
          }));
        export const renderOverview = provider =>
          renderToStaticMarkup(createElement(PropertyOverview, {provider}));
        export const renderDetail = provider =>
          renderToStaticMarkup(createElement(ProviderDetail, {
            provider, saved:false, note:"", onSave(){}, onNote(){return true},
            onTask(){return true}, close(){}, saveStatus:"", saveError:"",
            initialPane:"details"
          }));
      `,
      resolveDir: root,
      loader: "ts",
    },
    plugins: [
      {
        name: "isolated-reviewed-publication",
        setup(builder) {
          builder.onLoad(
            { filter: /[/\\]reviewed-home-care-descriptions\.json$/ },
            () => ({ contents: JSON.stringify(records), loader: "json" }),
          );
        },
      },
    ],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "cjs",
    write: false,
    loader: { ".css": "empty" },
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    require,
    loaded,
    loaded.exports,
  );
  return loaded.exports as Harness;
}

for (const present of [true, false]) {
  test(`reviewed home-care publication ${present ? "present" : "missing"} reaches APIs and both profile views without legacy fallback`, async () => {
    const file = resolve(root, "src/data/reviewed-home-care-descriptions.json");
    const before = await readFile(file, "utf8");
    const app = await harness(
      present
        ? {
            [office.id]: reviewed,
            [other.id]: {
              ...reviewed,
              text: "Another office's private projection.",
            },
            "cms-317058": reviewed,
            "lifeplan-brooksby-village": reviewed,
          }
        : {},
    );
    const provider = app
      .getMarket("north-jersey")!
      .providers.find((provider) => provider.id === office.id)!;
    const { description, locationDescription, ...facts } = provider;
    const { description: legacy, ...originalFacts } = office;
    assert.deepEqual(facts, originalFacts);
    assert.equal(description, present ? reviewed.text : "");
    assert.equal(
      locationDescription?.summary ?? null,
      present ? reviewed.text : null,
    );
    const response = await app.descriptionGET(
      new Request(
        `https://harbor.test/api/location-description?id=${office.id}`,
      ),
    );
    assert.equal(response.status, present ? 200 : 404);
    if (present) {
      assert.deepEqual(await response.json(), locationDescription);
      assert.equal(locationDescription?.sources[0].url, reviewed.source);
      assert.equal(
        locationDescription?.sources[0].checkedAt,
        reviewed.checkedAt,
      );
      assert.equal(locationDescription?.scope, "agency-office");
    }
    for (const render of [app.renderOverview, app.renderDetail]) {
      const html = render(provider);
      assert.equal(html.includes(reviewed.text), present);
      assert.equal(html.includes(reviewed.source), present);
      assert.equal(html.includes('aria-label="Location description"'), present);
      assert.equal(html.includes(legacy), false);
      assert.equal(
        html.includes("Another office's private projection."),
        false,
      );
      if (!present) assert.equal(html.includes("About this provider"), false);
      // Even a stale caller's generated prose must not resurrect a withdrawn description.
      assert.equal(
        render({ ...provider, description: legacy }).includes(legacy),
        false,
      );
    }
    assert.ok(app.renderOverview(provider).includes(provider.address));
    assert.equal(app.renderCard(provider).includes(reviewed.text), present);
    assert.equal(app.renderCard(provider).includes(legacy), false);
    assert.ok(
      app
        .renderDetail(provider)
        .includes(`tel:${provider.phone?.replace(/[^+\d]/g, "")}`),
    );
    const saved = await app
      .providersGET(
        new Request(`https://harbor.test/api/providers?ids=${office.id}`),
      )
      .json();
    assert.deepEqual(
      saved.providers[0].locationDescription,
      locationDescription,
    );
    assert.equal(saved.providers[0].description, description);
    for (const mode of ["", "&response=compact", "&response=cards"]) {
      const response = app.searchGET(
        new Request(
          `https://harbor.test/api/search?zip=${office.zip}&radius=50&category=home-care&q=${encodeURIComponent(office.name)}${mode}`,
        ),
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.providers.length);
      assert.ok(body.providers.some((item: Provider) => item.id === office.id));
      for (const item of body.providers) {
        if (mode === "&response=cards") {
          assert.equal("description" in item, false);
          const expected = present && [office.id, other.id].includes(item.id);
          if (expected)
            assert.deepEqual(item.locationDescription, {
              summary:
                item.id === office.id
                  ? reviewed.text
                  : "Another office's private projection.",
            });
          else assert.equal("locationDescription" in item, false);
        } else {
          const expected = present && [office.id, other.id].includes(item.id);
          assert.equal(Boolean(item.description), expected);
          assert.equal(Boolean(item.locationDescription), expected);
          if (item.id === office.id)
            assert.equal(item.description, description);
        }
      }
      for (const marker of body.markers ?? []) {
        assert.equal("description" in marker, false);
        assert.equal("locationDescription" in marker, false);
      }
    }
    for (const market of [app.getMarket()!, app.getMarket("north-jersey")!]) {
      const original = market.id === "north-jersey" ? nj : null;
      for (const item of market.providers) {
        if (market.id === "north-jersey" && item.category === "home-care")
          continue;
        assert.equal("locationDescription" in item, false);
        if (original)
          assert.deepEqual(
            item,
            original.providers.find((p) => p.id === item.id),
          );
      }
    }
    assert.notEqual(
      (
        await app
          .descriptionGET(
            new Request(
              "https://harbor.test/api/location-description?id=cms-317058",
            ),
          )
          .then((r) => r.json())
      ).summary,
      reviewed.text,
    );
    if (present) {
      for (const address of [
        "PO BOX 24",
        "P.O. Box 24",
        "Post Office Box 24",
      ]) {
        const mailing = app.project({ ...provider, address });
        assert.equal(mailing?.scope, "service-area");
        assert.ok(
          mailing?.limitations.some((text) =>
            /not a visit location/.test(text),
          ),
        );
      }
    }
    assert.equal(await readFile(file, "utf8"), before);
  });
}

test("profile client graph contains neither the catalog nor description snapshots", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/components/provider-detail.tsx"],
    bundle: true,
    platform: "browser",
    write: false,
    metafile: true,
    loader: { ".css": "empty" },
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const filename of [
    "reviewed-home-care-descriptions.json",
    "location-descriptions.json",
    "regional-markets.json",
    "providers.json",
  ])
    assert.equal(
      inputs.some((path) => path.endsWith(`/${filename}`)),
      false,
      filename,
    );
});
