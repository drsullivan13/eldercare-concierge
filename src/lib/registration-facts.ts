import registrationData from "@/data/nj-registration-facts.json";
import type { Provider, RegistrationFacts } from "./providers";

type Office = Pick<Provider, "id" | "name" | "state" | "category">;
type Captured = Omit<RegistrationFacts, "source"> & { sourceRows: number[] };
const byId: Readonly<Record<string, Captured | undefined>> =
  registrationData.providers;
const { title, publisher, url, checkedAt } = registrationData.source;
const source = { title, publisher, url, checkedAt };

function registeredOffice(provider: Office) {
  if (provider.state !== "NJ" || provider.category !== "home-care") return;
  const record = byId[provider.id];
  if (record?.businessName === provider.name) return record;
}

export function getRegistrationTradeNames(provider: Office) {
  return registeredOffice(provider)?.dbas;
}

export function getRegistrationFacts(
  provider: Office,
): RegistrationFacts | undefined {
  const record = registeredOffice(provider);
  if (!record) return;
  const { registration, businessName, dbas, licenseType, status, expiresOn } =
    record;
  return {
    registration,
    businessName,
    dbas,
    licenseType,
    status,
    expiresOn,
    source,
  };
}
