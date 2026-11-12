import evidence from "../data/daily-life-evidence.json";
import type { DailyLifeResearch } from "./daily-life-types";

const locations = evidence.locations as Record<string, DailyLifeResearch>;

export function getDailyLifeResearch(
  providerId: string,
): DailyLifeResearch | null {
  if (!Object.hasOwn(locations, providerId)) return null;
  return structuredClone(locations[providerId]);
}
