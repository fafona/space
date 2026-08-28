import assert from "node:assert/strict";
import test from "node:test";
import { updateMerchantBookingStatusBySite } from "@/lib/merchantBookings.server";

test("legacy booking status writes fail before canonical reads when authorization is revoked", async () => {
  let authorizationCalls = 0;

  await assert.rejects(
    () =>
      updateMerchantBookingStatusBySite({
        siteId: "12345678",
        bookingId: "booking-that-must-not-be-read",
        status: "confirmed",
        assertAuthorizationCurrent: async () => {
          authorizationCalls += 1;
          throw new Error("authorization_revoked_before_queue_write");
        },
      }),
    /authorization_revoked_before_queue_write/,
  );

  assert.equal(authorizationCalls, 1);
});
