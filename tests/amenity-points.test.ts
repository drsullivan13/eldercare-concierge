import test from "node:test";
import assert from "node:assert/strict";
import { amenityPoints } from "../src/lib/amenity-points";
import { getProviderMarket, markets } from "../src/lib/markets";

function profileFacts(id: string) {
  const record = getProviderMarket(id)?.locationResearch?.[id];
  assert.ok(record, `Missing retained profile ${id}`);
  return record.facts;
}

function factText(id: string, beginning: string) {
  const fact = profileFacts(id).find(({ text }) => text.startsWith(beginning));
  assert.ok(fact, `Missing retained fact ${id} ${beginning}`);
  return fact.text;
}

test("all three Victoria Mews operator facts become concise reported bullets", () => {
  const id = "north-jersey-doh-nj60a004";
  const expected = [
    [
      "The operator lists three chef-prepared",
      [
        "Three chef-prepared meals daily",
        "24-hour bistro with complimentary snacks and drinks",
      ],
    ],
    [
      "The operator lists weekly housekeeping",
      [
        "Weekly housekeeping and laundry",
        "Library, chapel and salon",
        "Transportation for medical visits and recreation",
      ],
    ],
    [
      "The provider shows six private suite layouts",
      [
        "Six private suite layouts, including studios and one- and two-bedroom suites",
        "Typical suite features include a kitchenette, private bathroom and emergency call system",
      ],
    ],
  ] as const;
  for (const [beginning, points] of expected) {
    const text = factText(id, beginning);
    assert.deepEqual(amenityPoints(text), points);
    assert.ok(points.every((point) => point.length < text.length));
  }
});

test("representative MA profiles retain meals, schedules and therapy counts", () => {
  const cases = [
    [
      "ma-alr-evans-park-at-newton-corner",
      "Chef-prepared seasonal",
      [
        "Chef-prepared seasonal menus and modified diets",
        "Private dining for events",
      ],
    ],
    [
      "ma-alr-evans-park-at-newton-corner",
      "Music, crafts",
      ["Music, crafts, arts and exercise classes", "Outings and movies"],
    ],
    [
      "ma-alr-evans-park-at-newton-corner",
      "Weekly housekeeping",
      [
        "Weekly housekeeping, laundry and linen service",
        "Scheduled transportation",
        "Fitness center, demonstration kitchen, theater and bistro/pub",
      ],
    ],
    [
      "ma-alr-adelaide-of-newton-centre",
      "Two full-time",
      [
        "Two full-time music therapists",
        "Gardening, cooking, arts and fitness programs",
      ],
    ],
    [
      "ma-alr-the-falls-at-cordingly-dam",
      "Expressive arts",
      [
        "Expressive arts and music therapy",
        "Drumming, dancing, movies and guided relaxation",
      ],
    ],
    [
      "ma-alr-charter-senior-living-of-dedham",
      "Casual/formal",
      [
        "Casual, formal and private dining, bistro and café",
        "Three meals and unlimited snacks",
        "Special dietary menus",
      ],
    ],
    [
      "north-jersey-doh-nj05a200",
      "The location lists tableside",
      ["Tableside dining with dietary preferences", "Bistro for snacks"],
    ],
  ] as const;
  for (const [id, beginning, expected] of cases) {
    assert.deepEqual(amenityPoints(factText(id, beginning)), expected);
  }
});

test("reviewed presentations retain paid extras, exclusions and dated amounts", () => {
  const carleton = factText(
    "lifeplan-carleton-willard-village",
    "Advertised amenities",
  );
  assert.deepEqual(amenityPoints(carleton), [
    "Advertised weekly housekeeping/linen service and transportation",
    "Advertised exercise facilities, walking paths, studios and woodworking shop",
    "Pool access and personal trainers cost extra; phone/internet/cable utilities are excluded",
  ]);
  const foxHill = factText(
    "lifeplan-fox-hill-village",
    "The 2026 independent-living fee sheet",
  );
  assert.deepEqual(amenityPoints(foxHill), [
    "2026 independent-living fees include $750 in monthly meal credits and biweekly housekeeping",
    "2026 independent-living fees include utilities, wellness center, fitness/indoor pool and activities",
    "The cooperative-model page excludes telephone, internet and cable",
  ]);
});

test("every retained MyLivingChoice list is parsed without a catalog of item names", () => {
  const texts = new Set(
    markets.flatMap((market) =>
      Object.values(market.locationResearch ?? {}).flatMap((record) =>
        record.facts
          .map(({ text }) => text)
          .filter((text) => text.startsWith("MyLivingChoice lists: ")),
      ),
    ),
  );
  assert.ok(texts.size > 1, "Exercise real lists, not an empty fixture set");
  for (const text of texts) {
    const suffix = ". Confirm these details with the location.";
    assert.ok(text.endsWith(suffix));
    const items = text.slice("MyLivingChoice lists: ".length, -suffix.length);
    const points = amenityPoints(text);
    assert.deepEqual(points, items.split("; "));
  }
});

test("documented lists accept new items and keep embedded numbers and conditions", () => {
  assert.deepEqual(
    amenityPoints(
      "MyLivingChoice lists: Shuttle at 9:30 a.m. on Nov. 12, 2026 (reservation required); Meals from $12.50; Pool access only after assessment. Confirm these details with the location.",
    ),
    [
      "Shuttle at 9:30 a.m. on Nov. 12, 2026 (reservation required)",
      "Meals from $12.50",
      "Pool access only after assessment",
    ],
  );
});

test("unknown or malformed list wrappers are not interpreted as structured lists", () => {
  const texts = [
    "Other directory lists: Pool; Salon. Confirm these details with the location.",
    "MyLivingChoice lists: Pool; Salon.",
    "MyLivingChoice lists: Pool; Salon. Charges are unknown.",
    "MyLivingChoice lists: Pool; ; Salon. Confirm these details with the location.",
    "MyLivingChoice lists: Pool; Salon. Confirm these details with the location. Only for independent living.",
  ];
  for (const text of texts) assert.deepEqual(amenityPoints(text), [text]);
});

test("unknown qualified prose stays lossless, including doses, dates and conditional scope", () => {
  const texts = [
    "As of Nov. 12, 2026, support for 2.5 mg doses is offered at 8 a.m. and 8 p.m., only after assessment. This does not guarantee nurse availability; weekend visits cost $125.50 extra.",
    "A pool, salon and trips are advertised; not all are included. These are available only to residents with prior approval.",
    "Private rooms may be available in the short-term unit. This does not establish that all rooms are private.",
    "Meals are not included, except on Tuesdays; transport requires 48 hours' notice.",
    "A shuttle runs at 9 a.m. See https://example.org/policies?v=2.5 for conditions.",
  ];
  for (const text of texts) assert.deepEqual(amenityPoints(text), [text]);
});

test("real uncatalogued caveats remain visible without mutation of source facts", () => {
  for (const [id, beginning] of [
    ["ma-alr-adelaide-of-newton-centre", "Secured outdoor"],
    ["cms-225770", "The FAQ states visits"],
    ["lifeplan-lasell-village", "Independent-living monthly fees"],
    ["cms-225683", "Wi-Fi is advertised"],
  ]) {
    const facts = profileFacts(id);
    const before = JSON.stringify(facts);
    const text = factText(id, beginning);
    assert.deepEqual(amenityPoints(text), [text]);
    assert.equal(JSON.stringify(facts), before);
  }
});

test("all retained offering numbers survive formatting and original facts stay separate", () => {
  let checked = 0;
  for (const market of markets) {
    for (const record of Object.values(market.locationResearch ?? {})) {
      const before = JSON.stringify(record.facts);
      for (const fact of record.facts) {
        const points = amenityPoints(fact.text);
        const displayed = points.join(" ");
        for (const number of fact.text.match(/\d+(?:[.,:/–-]\d+)*/g) ?? []) {
          assert.ok(displayed.includes(number), `Lost ${number} in ${fact.id}`);
        }
        assert.ok(
          points.every((point) => typeof point === "string" && point.trim()),
        );
        checked++;
      }
      assert.equal(JSON.stringify(record.facts), before);
    }
  }
  assert.ok(checked > 0, "Exercise the retained catalog");
});

test("curation never applies to a similar phrase with an added qualification", () => {
  const source = factText(
    "north-jersey-doh-nj60a004",
    "The operator lists three",
  );
  const changed = `${source} Only on weekdays; drinks cost extra after 8 p.m.`;
  assert.deepEqual(amenityPoints(changed), [changed]);
  const points = amenityPoints(source);
  assert.notEqual(points, amenityPoints(source));
});

test("empty input produces no bullets and outer whitespace is ignored", () => {
  assert.deepEqual(amenityPoints(" \n\t "), []);
  assert.deepEqual(amenityPoints("  A garden, if weather permits. \n"), [
    "A garden, if weather permits.",
  ]);
});
