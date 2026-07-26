import { reconcileMerchantBookingStorage } from "../src/lib/merchantBookingReconciliation";
import {
  createBookingRestRuntime,
  loadBookingV1,
  loadLegacyBookings,
  trimBookingCliText,
} from "./booking-v1-runtime";

function readSiteId() {
  const args = process.argv.slice(2);
  if (
    args.length !== 1 ||
    !args[0]?.startsWith("--site=")
  ) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }
  const siteId = trimBookingCliText(args[0].slice("--site=".length));
  if (!/^\d{8}$/.test(siteId)) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }
  return siteId;
}

async function main() {
  const siteId = readSiteId();
  const runtime = createBookingRestRuntime();
  const [legacyBookings, v1] = await Promise.all([
    loadLegacyBookings(runtime, siteId),
    loadBookingV1(runtime, siteId),
  ]);
  const report = reconcileMerchantBookingStorage({
    merchantId: siteId,
    legacyBookings,
    v1Bookings: v1[0],
    v1Events: v1[1],
  });

  console.log(
    `[booking-v1-audit] merchant=${siteId} legacy=${report.legacyCount} v1=${report.v1Count} matched=${report.matchedCount} missing=${report.missingInV1.length} unexpected=${report.unexpectedInV1.length} duplicate=${report.duplicateV1Ids.length} missing-events=${report.missingEventKeys.length} mismatched=${report.mismatches.length}`,
  );
  for (const mismatch of report.mismatches.slice(0, 20)) {
    console.log(
      `[booking-v1-audit] mismatch booking=${mismatch.bookingId} fields=${mismatch.fields.join(",")}`,
    );
  }
  if (report.missingInV1.length > 0) {
    console.log(
      `[booking-v1-audit] missing-booking-ids=${report.missingInV1.slice(0, 20).join(",")}`,
    );
  }
  if (report.unexpectedInV1.length > 0) {
    console.log(
      `[booking-v1-audit] unexpected-booking-ids=${report.unexpectedInV1.slice(0, 20).join(",")}`,
    );
  }
  if (report.missingEventKeys.length > 0) {
    console.log(
      `[booking-v1-audit] missing-event-count=${report.missingEventKeys.length}`,
    );
  }
  if (!report.isMatch) process.exitCode = 2;
}

main().catch((error) => {
  console.error(
    `[booking-v1-audit] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
