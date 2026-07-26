import {
  buildMerchantBookingBackfillPlan,
  MERCHANT_BOOKING_BACKFILL_MAX_BATCH_SIZE,
} from "../src/lib/merchantBookingBackfill.server";
import { reconcileMerchantBookingStorage } from "../src/lib/merchantBookingReconciliation";
import {
  assertBookingWriteReady,
  createBookingRestRuntime,
  loadBookingV1,
  loadLegacyBookings,
  requestBookingJson,
  trimBookingCliText,
} from "./booking-v1-runtime";

type CliOptions = {
  siteId: string;
  batchSize: number;
  write: boolean;
  confirmation: string;
};

function readOptions(): CliOptions {
  const args = process.argv.slice(2);
  const knownArguments = args.filter(
    (value) =>
      value === "--write" ||
      value.startsWith("--site=") ||
      value.startsWith("--batch-size=") ||
      value.startsWith("--confirm="),
  );
  if (knownArguments.length !== args.length) {
    const unknown = args.filter((value) => !knownArguments.includes(value));
    throw new Error(`unknown_arguments:${unknown.join(",")}`);
  }

  const siteId = trimBookingCliText(
    args.find((value) => value.startsWith("--site="))?.slice("--site=".length),
  );
  if (!/^\d{8}$/.test(siteId)) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }

  const batchText = trimBookingCliText(
    args
      .find((value) => value.startsWith("--batch-size="))
      ?.slice("--batch-size=".length),
  );
  const batchSize = batchText ? Number.parseInt(batchText, 10) : 25;
  if (
    (batchText && !/^\d+$/.test(batchText)) ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MERCHANT_BOOKING_BACKFILL_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `batch_size_must_be_between_1_and_${MERCHANT_BOOKING_BACKFILL_MAX_BATCH_SIZE}`,
    );
  }

  return {
    siteId,
    batchSize,
    write: args.includes("--write"),
    confirmation: trimBookingCliText(
      args
        .find((value) => value.startsWith("--confirm="))
        ?.slice("--confirm=".length),
    ),
  };
}

function assertWriteAuthorized(options: CliOptions) {
  if (!options.write) return;
  if (
    trimBookingCliText(
      process.env.BOOKING_V1_BACKFILL_WRITE_ENABLED,
    ).toLowerCase() !== "true"
  ) {
    throw new Error(
      "write_disabled:set_BOOKING_V1_BACKFILL_WRITE_ENABLED=true_for_this_command",
    );
  }
  if (options.confirmation !== options.siteId) {
    throw new Error(
      `merchant_confirmation_required:--confirm=${options.siteId}`,
    );
  }
}

function printReconciliation(
  siteId: string,
  legacyBookings: Awaited<ReturnType<typeof loadLegacyBookings>>,
  v1: Awaited<ReturnType<typeof loadBookingV1>>,
) {
  const report = reconcileMerchantBookingStorage({
    merchantId: siteId,
    legacyBookings,
    v1Bookings: v1[0],
    v1Events: v1[1],
  });
  console.log(
    `[booking-v1-backfill] reconciliation legacy=${report.legacyCount} v1=${report.v1Count} matched=${report.matchedCount} missing=${report.missingInV1.length} unexpected=${report.unexpectedInV1.length} duplicate=${report.duplicateV1Ids.length} missing-events=${report.missingEventKeys.length} mismatched=${report.mismatches.length}`,
  );
  for (const mismatch of report.mismatches.slice(0, 20)) {
    console.log(
      `[booking-v1-backfill] mismatch booking=${mismatch.bookingId} fields=${mismatch.fields.join(",")}`,
    );
  }
  if (report.missingInV1.length > 0) {
    console.log(
      `[booking-v1-backfill] missing-booking-ids=${report.missingInV1.slice(0, 20).join(",")}`,
    );
  }
  if (report.unexpectedInV1.length > 0) {
    console.log(
      `[booking-v1-backfill] unexpected-booking-ids=${report.unexpectedInV1.slice(0, 20).join(",")}`,
    );
  }
  if (report.missingEventKeys.length > 0) {
    console.log(
      `[booking-v1-backfill] missing-event-count=${report.missingEventKeys.length}`,
    );
  }
  return report.isMatch;
}

async function main() {
  const options = readOptions();
  const runtime = createBookingRestRuntime();
  assertWriteAuthorized(options);

  const legacyBookings = await loadLegacyBookings(runtime, options.siteId);
  const plan = buildMerchantBookingBackfillPlan({
    merchantId: options.siteId,
    bookings: legacyBookings,
    batchSize: options.batchSize,
  });
  console.log(
    `[booking-v1-backfill] merchant=${options.siteId} mode=${options.write ? "write" : "dry-run"} bookings=${plan.bookingCount} batches=${plan.batches.length} batch-size=${plan.batchSize} blockers=${plan.blockers.length}`,
  );

  if (plan.blockers.length > 0) {
    for (const blocker of plan.blockers.slice(0, 20)) {
      console.error(
        `[booking-v1-backfill] blocker booking=${blocker.bookingId} code=${blocker.code}`,
      );
    }
    process.exitCode = 2;
    return;
  }

  if (!options.write) {
    console.log(
      "[booking-v1-backfill] dry-run complete; no database writes were attempted",
    );
    return;
  }

  await assertBookingWriteReady(runtime);
  let completed = 0;
  for (let index = 0; index < plan.batches.length; index += 1) {
    const batch = plan.batches[index] ?? [];
    const result = await requestBookingJson(
      runtime,
      "/rest/v1/rpc/faolla_upsert_merchant_bookings_v1",
      {
        method: "POST",
        body: JSON.stringify({ p_mutations: batch }),
      },
      30000,
    );
    if (Number(result) !== batch.length) {
      throw new Error(
        `backfill_rpc_count_mismatch:expected=${batch.length}:actual=${String(result)}`,
      );
    }
    completed += batch.length;
    console.log(
      `[booking-v1-backfill] progress batch=${index + 1}/${plan.batches.length} bookings=${completed}/${plan.bookingCount}`,
    );
  }

  const [latestLegacy, latestV1] = await Promise.all([
    loadLegacyBookings(runtime, options.siteId),
    loadBookingV1(runtime, options.siteId),
  ]);
  if (!printReconciliation(options.siteId, latestLegacy, latestV1)) {
    process.exitCode = 2;
    return;
  }
  console.log(
    "[booking-v1-backfill] complete; legacy remains the source of truth",
  );
}

main().catch((error) => {
  console.error(
    `[booking-v1-backfill] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
