import type { Provider } from "./providers";
import { getRegistrationTradeNames } from "./registration-facts";

export function providerSearchText(
  provider: Pick<Provider, "id" | "name" | "city" | "state" | "category">,
): string {
  const dbas = getRegistrationTradeNames(provider);
  return `${provider.name} ${provider.city}${dbas ? ` ${dbas}` : ""}`.toLocaleLowerCase(
    "en-US",
  );
}
