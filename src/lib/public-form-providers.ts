export const ELDERLY_SAVIOR_PROVIDER_ID = "north-jersey-hp-hp0265900";

export const publicFormProviders = [
  {
    providerId: ELDERLY_SAVIOR_PROVIDER_ID,
    agencyName: "Elderly Savior Homecare LLC",
    shortName: "Elderly Savior",
    serviceTitle: "Free 30-minute Google Meet",
    durationMinutes: 30,
    consentVersion: "elderly-savior-v1",
    consent:
      "I authorize Harbor to book one consultation in this window and share my name, email and phone with Elderly Savior Homecare LLC. I agree to phone calls, texts or emails about home care, appointments, referrals and related marketing, including automated or prerecorded calls and AI voice. Message and data rates may apply.",
    consentNote:
      "Consent is optional for purchasing services. Opt out by replying STOP, asking the office to stop calling, or calling (973) 855-4461. Harbor leaves the separate promotional-text opt-in unchecked.",
  },
  {
    providerId: "north-jersey-hp-hp0054400",
    agencyName: "WellCare Nurses and Staffing Inc.",
    shortName: "WellCare",
    serviceTitle: "Free Assessment · 30 minutes · Available online",
    durationMinutes: 30,
    consentVersion: "wellcare-v1",
    consent:
      "I authorize Harbor to book one assessment in this window and share my name, verified account email and phone with WellCare Nurses and Staffing Inc. By completing this booking, I agree to receive booking-related phone notifications.",
    consentNote: null,
  },
] as const;

export type PublicFormProvider = (typeof publicFormProviders)[number];

export function publicFormProvider(providerId: string) {
  return publicFormProviders.find((office) => office.providerId === providerId);
}

export function publicFormRebookable(
  job: { status: string; startTime: string | null } | null,
  office: PublicFormProvider,
  now: number,
) {
  return (
    !job ||
    job.status === "failed" ||
    job.status === "unavailable" ||
    (job.status === "confirmed" &&
      job.startTime !== null &&
      Date.parse(job.startTime) + office.durationMinutes * 60_000 <= now)
  );
}
