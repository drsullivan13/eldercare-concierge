import {
  bookCalendlySlot,
  listCalendlySlots,
  reconcileCalendlyBooking,
  type CalendlyConfig,
} from "./calendly-booking";
import {
  bookHighLevelSlot,
  listHighLevelSlots,
  reconcileHighLevelBooking,
  type HighLevelConfig,
} from "./highlevel-booking";

const elderlySavior = {
  providerId: "north-jersey-hp-hp0265900",
  calendarId: "QnvoAQkNH8HYRfrJk8Ri",
  url: "https://elderlysaviorhc.com/book-now",
};
export const publicBookingUrl = (providerId: string) =>
  providerId === elderlySavior.providerId ? elderlySavior.url : null;

type Window = { startTime: string; endTime: string };
type Invitee = Parameters<typeof bookHighLevelSlot>[1];
type Lookup = Parameters<typeof reconcileHighLevelBooking>[1];
function officeConfig(providerId: string, raw: string | undefined) {
  const agencies = JSON.parse(raw || "{}");
  return Object.hasOwn(agencies, providerId) ? agencies[providerId] : undefined;
}
function officeSecret(key: unknown, prefix: string) {
  return typeof key === "string" &&
    key.startsWith(prefix) &&
    /^[A-Z0-9_]+$/.test(key.slice(prefix.length))
    ? process.env[key]
    : undefined;
}
export function consultationConfig(providerId: string) {
  const office = officeConfig(
    providerId,
    process.env.HARBOR_HIGHLEVEL_AGENCIES,
  );
  const highLevelToken = officeSecret(
    office?.tokenEnv,
    "HARBOR_HIGHLEVEL_TOKEN_",
  );
  if (
    highLevelToken &&
    typeof office.locationId === "string" &&
    office.locationId &&
    typeof office.calendarId === "string" &&
    office.calendarId &&
    (providerId !== elderlySavior.providerId ||
      office.calendarId === elderlySavior.calendarId)
  ) {
    const config: HighLevelConfig = {
      token: highLevelToken,
      locationId: office.locationId,
      calendarId: office.calendarId,
      inviteDelivery: office.inviteDelivery === "harbor" ? "harbor" : "agency",
    };
    return {
      source: "highlevel" as const,
      inviteDelivery: config.inviteDelivery,
      phoneRequired: Boolean(office.phoneRequired),
      slots: (window: Window) => listHighLevelSlots(config, window),
      book: (invitee: Invitee) => bookHighLevelSlot(config, invitee),
      reconcile: (lookup: Lookup) => reconcileHighLevelBooking(config, lookup),
    };
  }
  const agency = officeConfig(providerId, process.env.HARBOR_CALENDLY_AGENCIES);
  const token = officeSecret(agency?.tokenEnv, "HARBOR_CALENDLY_TOKEN_");
  if (!token || typeof agency.eventTypeUri !== "string") return;
  const config: CalendlyConfig = {
    token,
    eventTypeUri: agency.eventTypeUri,
    location: agency.location,
    organizationUri: agency.organizationUri,
  };
  return {
    source: "calendly" as const,
    inviteDelivery: "agency" as const,
    phoneRequired: config.location?.kind === "outbound_call",
    slots: (window: Window) => listCalendlySlots(config, window),
    book: (invitee: Invitee) => bookCalendlySlot(config, invitee),
    reconcile: config.organizationUri
      ? (lookup: Lookup) => reconcileCalendlyBooking(config, lookup)
      : undefined,
  };
}
