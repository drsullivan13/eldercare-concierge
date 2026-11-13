type ComparisonDemo = {
  selector: { parameter: string; value: string };
  providerIds: readonly [string, string];
  href: string;
};

export const comparisonDemo = {
  selector: { parameter: "compareDemo", value: "morris-plains-florham-park" },
  providerIds: ["north-jersey-doh-nj13a012", "north-jersey-doh-nj60a001"],
  href: "/dashboard?demo=1&compareDemo=morris-plains-florham-park",
} as const satisfies ComparisonDemo;
