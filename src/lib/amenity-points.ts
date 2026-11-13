const presentations = new Map<string, readonly string[]>([
  [
    "The operator lists three chef-prepared meals daily and a 24-hour bistro with complimentary snacks and drinks.",
    [
      "Three chef-prepared meals daily",
      "24-hour bistro with complimentary snacks and drinks",
    ],
  ],
  [
    "The operator lists weekly housekeeping and laundry, a library, chapel, salon and transportation for medical visits and recreation.",
    [
      "Weekly housekeeping and laundry",
      "Library, chapel and salon",
      "Transportation for medical visits and recreation",
    ],
  ],
  [
    "The provider shows six private suite layouts and lists studios, one-bedroom and two-bedroom suites. Typical features include a kitchenette, private bathroom and emergency call system.",
    [
      "Six private suite layouts, including studios and one- and two-bedroom suites",
      "Typical suite features include a kitchenette, private bathroom and emergency call system",
    ],
  ],
  [
    "Chef-prepared seasonal menus, modified diets and private dining for events.",
    [
      "Chef-prepared seasonal menus and modified diets",
      "Private dining for events",
    ],
  ],
  [
    "Music, crafts, arts and exercise classes; outings and movies.",
    ["Music, crafts, arts and exercise classes", "Outings and movies"],
  ],
  [
    "Weekly housekeeping, laundry and linen service; scheduled transportation; fitness center, demonstration kitchen, theater and bistro/pub.",
    [
      "Weekly housekeeping, laundry and linen service",
      "Scheduled transportation",
      "Fitness center, demonstration kitchen, theater and bistro/pub",
    ],
  ],
  [
    "Two full-time music therapists; gardening, cooking, arts and fitness programs.",
    [
      "Two full-time music therapists",
      "Gardening, cooking, arts and fitness programs",
    ],
  ],
  [
    "Expressive arts and music therapy; drumming, dancing, movies and guided relaxation.",
    [
      "Expressive arts and music therapy",
      "Drumming, dancing, movies and guided relaxation",
    ],
  ],
  [
    "Casual/formal/private dining, bistro and café; three meals and unlimited snacks; special dietary menus.",
    [
      "Casual, formal and private dining, bistro and café",
      "Three meals and unlimited snacks",
      "Special dietary menus",
    ],
  ],
  [
    "The location lists tableside dining with dietary preferences and a bistro for snacks.",
    ["Tableside dining with dietary preferences", "Bistro for snacks"],
  ],
  [
    "Advertised amenities include weekly housekeeping/linen service, transportation, exercise facilities, walking paths, studios and a woodworking shop; the page explicitly adds fees for pool access/personal trainers and excludes phone/internet/cable utilities.",
    [
      "Advertised weekly housekeeping/linen service and transportation",
      "Advertised exercise facilities, walking paths, studios and woodworking shop",
      "Pool access and personal trainers cost extra; phone/internet/cable utilities are excluded",
    ],
  ],
  [
    "The 2026 independent-living fee sheet includes $750 in monthly meal credits, plus biweekly housekeeping, utilities, wellness center, fitness/indoor pool and activities. Telephone, internet and cable are excluded on the cooperative-model page.",
    [
      "2026 independent-living fees include $750 in monthly meal credits and biweekly housekeeping",
      "2026 independent-living fees include utilities, wellness center, fitness/indoor pool and activities",
      "The cooperative-model page excludes telephone, internet and cable",
    ],
  ],
]);

/** Presentation only. Keep the original text in the source disclosure. */
export function amenityPoints(text: string): readonly string[] {
  const original = text.trim();
  if (!original) return [];

  // Only provider-offerings.py's explicit list wrapper defines item boundaries.
  const directory = original.match(
    /^MyLivingChoice lists: (.+)\. Confirm these details with the location\.$/,
  );
  if (directory) {
    const items = directory[1].split("; ");
    if (items.every((item) => item.trim())) {
      return items;
    }
  }

  // Unknown prose has no reliable boundary between a claim and its qualifiers.
  return [...(presentations.get(original) ?? [original])];
}
