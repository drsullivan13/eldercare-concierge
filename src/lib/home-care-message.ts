export type FamilyOutreachPurpose = "interview" | "introduction";

const newJerseyTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function familyOutreachMessage(
  purpose: FamilyOutreachPurpose,
  at?: Date,
) {
  const introduction = purpose === "introduction";
  const subject = introduction ? "In-home introduction" : "Home care interview";
  const request = introduction
    ? "Thank you for speaking with us. Our family would like to invite you for an in-home introduction."
    : "Our family is exploring in-home care. Could we arrange a phone interview to discuss your services, rates, and availability?";
  const time =
    at && Number.isFinite(at.getTime())
      ? `Would ${newJerseyTime.format(at)} (New Jersey time) work for you? Please confirm or suggest another time.`
      : "What times are available?";
  return { subject, body: `Hello,\n\n${request}\n\n${time}\n\nThank you` };
}
