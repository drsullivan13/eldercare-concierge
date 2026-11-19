import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { observeWixReceipt } from "./wix-receipt.mjs";

test("the provider's create response must identify the exact approved appointment", async () => {
  const page = new EventEmitter();
  const frame = {};
  page.mainFrame = () => frame;
  const slot = {
    serviceId: "fdc44397-89fc-4d88-8dfd-997a4839e0e6",
    timezone: "America/New_York",
    startDate: "2026-11-30T11:30:00.000",
    endDate: "2026-11-30T12:00:00.000",
  };
  const booking = {
    id: "17242066-9223-4103-8462-6ea552fb41a5",
    status: "CONFIRMED",
    bookedEntity: { slot },
  };
  const cases = [
    [booking, "confirmed"],
    [{ ...booking, status: "CREATED" }, "pending"],
    [{ ...booking, status: "DECLINED" }, undefined],
    [{ ...booking, id: "private@example.com" }, undefined],
    [
      {
        ...booking,
        bookedEntity: { slot: { ...slot, startDate: "2026-11-30T12:30:00" } },
      },
      undefined,
    ],
    [
      { ...booking, bookedEntity: { slot: { ...slot, serviceId: "other" } } },
      undefined,
    ],
    [undefined, undefined],
  ];
  for (const [item, expected] of cases) {
    const observer = observeWixReceipt(page, new Date("2026-11-30T16:30:00Z"));
    page.emit("response", {
      url: () =>
        "https://www.wellcarenurses.com/_api/bookings-service/v2/bulk/bookings/create",
      ok: () => true,
      request: () => ({
        frame: () => frame,
        method: () => "POST",
        postDataJSON: () => ({ createBookingsInfo: [{ booking }] }),
      }),
      json: async () => ({
        results: [{ itemMetadata: { success: true }, item }],
      }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(observer.evidence?.status, expected);
    observer.close();
    assert.equal(page.listenerCount("response"), 0);
  }
});
