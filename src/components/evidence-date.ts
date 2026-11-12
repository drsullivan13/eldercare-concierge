const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function evidenceDate(value: string | null | undefined): string {
  if (!value) return "Date not published";
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    return monthFormat.format(new Date(value + "-01T00:00:00Z"));
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const stamp = new Date(value + "T00:00:00Z");
    if (Number.isFinite(stamp.valueOf())) return dayFormat.format(stamp);
  }
  return value;
}
