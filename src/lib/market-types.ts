type MarketId = "massachusetts" | "north-jersey";

export type Market = {
  id: MarketId;
  label: string;
  state: "MA" | "NJ";
};
