import assert from "node:assert/strict";
import test from "node:test";
import { bookingWorkbenchDiagnosticCode, bookingWorkbenchDiagnosticDetails, getBookingWorkbenchSaveFailure } from "./merchantBookingWorkbenchSaveFailure";

test("save diagnostics accept fixed codes only, never arbitrary provider/customer content", () => {
  assert.equal(bookingWorkbenchDiagnosticCode(new Error("booking_atomic_conflict")), "booking_atomic_conflict");
  for (const value of [new Error("private@example.invalid bearer-secret"), new Error("booking_atomic_private_customer_payload"), "token", {}]) {
    assert.equal(bookingWorkbenchDiagnosticCode(value), "booking_workbench_failed");
  }
  const result = getBookingWorkbenchSaveFailure(503, { error: "private@example.invalid", message: "bearer-secret", reference: "raw-token" });
  assert.equal(result.reference, ""); assert.equal(result.code, "booking_workbench_failed");
  assert.ok(!JSON.stringify(result).includes("private@example.invalid"));
  assert.ok(!JSON.stringify(result).includes("bearer-secret"));
  const error = new TypeError("private@example.invalid bearer-secret");
  error.stack = "TypeError: private@example.invalid bearer-secret\n    at fn (/www/private-site/.next/server/chunks/1234.js:1:42)\n    at customer@example.invalid";
  assert.deepEqual(bookingWorkbenchDiagnosticDetails(error), { reason: "booking_workbench_failed", type: "TypeError", frame: "chunks/1234.js:1:42" });
});

test("failure messages distinguish sign-in, permission, invalid settings, conflicts and uncertainty", () => {
  for (const locale of ["zh-CN", "es-ES", "en-GB"]) {
    const reference = "0123456789abcdef";
    const fallback = getBookingWorkbenchSaveFailure(503, { reason: "booking_atomic_storage_unconfirmed", reference }, locale);
    assert.equal(fallback.reference, reference);
    assert.equal(fallback.code, "booking_atomic_storage_unconfirmed");
    for (const [status, error] of [[401, "unauthorized"], [403, "permission_denied"], [400, "invalid_booking_time_zone"], [400, "invalid_booking_reply_to"], [503, "booking_atomic_conflict"]] as const) {
      assert.notEqual(getBookingWorkbenchSaveFailure(status, { error }, locale).message, fallback.message);
    }
  }
});
