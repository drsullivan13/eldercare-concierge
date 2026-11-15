import type { HomeCareOutreachRecord } from "../../src/lib/home-care-outreach";
import type { SearchProvider } from "../../src/lib/providers";

export const homeCareProvider: SearchProvider = {
  id: "test-home-care-outreach",
  name: "Test family care agency",
  category: "home-care",
  address: "1 Test Lane",
  city: "Chatham",
  state: "NJ",
  zip: "07928",
  lat: 40.74,
  lng: -74.38,
  locationKind: "office",
  phone: "9735550100",
  website: "https://agency.example.invalid/",
  description: "Test agency, not a real provider.",
  services: [],
  officialRecord: false,
  sources: [
    {
      title: "Care inquiry",
      publisher: "Test agency",
      url: "https://agency.example.invalid/contact",
      kind: "provider",
      checkedAt: "2026-11-13",
      supports: "Care inquiry form",
    },
    {
      title: "Agency inquiry email",
      publisher: "Test agency",
      url: "mailto:care@agency.example.invalid",
      kind: "provider",
      checkedAt: "2026-11-13",
      supports: "Published inquiry email",
    },
  ],
  warnings: [],
  limitations: [],
  distanceMiles: 1,
};

export const suitableHomeCareInterview: HomeCareOutreachRecord = {
  providerName: homeCareProvider.name,
  notes: "Ask about weekend availability.",
  updatedAt: "2026-11-13T14:00:00.000Z",
  stage: "interview",
  interview: {
    status: "completed",
    outcome: "suitable",
    occurredAt: "2026-11-12T10:00:00.000Z",
  },
};
