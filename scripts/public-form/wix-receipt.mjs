// Observe the request made by the provider's own button. Never issue or replay a booking request.
const bookingPath =
  "https://www.wellcarenurses.com/_api/bookings-service/v2/bulk/bookings/create";
const serviceId = "fdc44397-89fc-4d88-8dfd-997a4839e0e6";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function sameInstant(value, target, timezone) {
  if (typeof value !== "string") return false;
  if (/Z$|[+-]\d\d:\d\d$/.test(value)) return Date.parse(value) === +target;
  if (timezone !== "America/New_York") return false;
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(target)
    .replace(" ", "T");
  return value.replace(/\.000$/, "") === local;
}
function sameSlot(slot, start) {
  return (
    slot?.serviceId === serviceId &&
    sameInstant(slot.startDate, start, slot.timezone) &&
    sameInstant(slot.endDate, new Date(+start + 1800000), slot.timezone)
  );
}
export function observeWixReceipt(page, start) {
  let evidence;
  const read = async (response) => {
    try {
      const request = response.request();
      if (
        response.url().split("?")[0] !== bookingPath ||
        request.method() !== "POST" ||
        request.frame() !== page.mainFrame() ||
        !response.ok()
      )
        return;
      const items = request.postDataJSON()?.createBookingsInfo;
      if (
        items?.length !== 1 ||
        !sameSlot(items[0]?.booking?.bookedEntity?.slot, start)
      )
        return;
      const body = await response.json();
      if (body.results?.length !== 1) return;
      const { itemMetadata, item } = body.results[0];
      const booking = item?.booking ?? item;
      const id = booking?.id ?? booking?._id;
      if (
        itemMetadata?.success !== true ||
        !uuid.test(id) ||
        !sameSlot(booking?.bookedEntity?.slot, start)
      )
        return;
      if (booking.status === "CONFIRMED")
        evidence = {
          status: "confirmed",
          receipt:
            "Wellcare confirmed the approved online Free Assessment. Appointment reference: " +
            id +
            ".",
        };
      if (["PENDING", "PENDING_APPROVAL", "CREATED"].includes(booking.status))
        evidence = {
          status: "pending",
          receipt:
            "Wellcare recorded the assessment request. Appointment reference: " +
            id +
            ".",
        };
    } catch {
      /* Unrelated or unverified response. */
    }
  };
  page.on("response", read);
  return {
    get evidence() {
      return evidence;
    },
    close() {
      page.off("response", read);
    },
  };
}
