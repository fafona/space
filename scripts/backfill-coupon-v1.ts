import {
  buildMerchantCouponBackfillPlan,
  MERCHANT_COUPON_BACKFILL_MAX_BATCH_SIZE,
} from "../src/lib/merchantCouponBackfill.server";
import { reconcileMerchantCouponStorage } from "../src/lib/merchantCouponReconciliation";
import {
  assertCouponWriteReady,
  createCouponRestRuntime,
  loadCouponV1,
  loadLegacyCoupons,
  requestCouponJson,
  trimCouponCliText,
} from "./coupon-v1-runtime";

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

  const siteId = trimCouponCliText(
    args.find((value) => value.startsWith("--site="))?.slice("--site=".length),
  );
  if (!/^\d{8}$/.test(siteId)) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }
  const batchText = trimCouponCliText(
    args
      .find((value) => value.startsWith("--batch-size="))
      ?.slice("--batch-size=".length),
  );
  const batchSize = batchText ? Number.parseInt(batchText, 10) : 10;
  if (
    (batchText && !/^\d+$/.test(batchText)) ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MERCHANT_COUPON_BACKFILL_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `batch_size_must_be_between_1_and_${MERCHANT_COUPON_BACKFILL_MAX_BATCH_SIZE}`,
    );
  }
  return {
    siteId,
    batchSize,
    write: args.includes("--write"),
    confirmation: trimCouponCliText(
      args
        .find((value) => value.startsWith("--confirm="))
        ?.slice("--confirm=".length),
    ),
  };
}

function assertWriteAuthorized(options: CliOptions) {
  if (!options.write) return;
  if (
    trimCouponCliText(
      process.env.COUPON_V1_BACKFILL_WRITE_ENABLED,
    ).toLowerCase() !== "true"
  ) {
    throw new Error(
      "write_disabled:set_COUPON_V1_BACKFILL_WRITE_ENABLED=true_for_this_command",
    );
  }
  if (options.confirmation !== options.siteId) {
    throw new Error(
      `merchant_confirmation_required:--confirm=${options.siteId}`,
    );
  }
}

function reconcile(
  siteId: string,
  legacy: Awaited<ReturnType<typeof loadLegacyCoupons>>,
  v1: Awaited<ReturnType<typeof loadCouponV1>>,
) {
  return reconcileMerchantCouponStorage({
    merchantId: siteId,
    legacyCoupons: legacy,
    v1Coupons: v1[0],
    v1Claims: v1[1],
    v1Redemptions: v1[2],
    v1Events: v1[3],
  });
}

async function main() {
  const options = readOptions();
  const runtime = createCouponRestRuntime();
  assertWriteAuthorized(options);
  const legacyCoupons = await loadLegacyCoupons(runtime, options.siteId);
  const plan = buildMerchantCouponBackfillPlan({
    merchantId: options.siteId,
    coupons: legacyCoupons,
    batchSize: options.batchSize,
  });
  console.log(
    `[coupon-v1-backfill] merchant=${options.siteId} mode=${options.write ? "write" : "dry-run"} coupons=${plan.couponCount} claims=${plan.claimCount} redemptions=${plan.redemptionCount} batches=${plan.batches.length} batch-size=${plan.batchSize} blockers=${plan.blockers.length}`,
  );
  if (plan.blockers.length > 0) {
    plan.blockers.slice(0, 20).forEach((blocker) => {
      console.error(
        `[coupon-v1-backfill] blocker coupon=${blocker.couponId} code=${blocker.code}`,
      );
    });
    process.exitCode = 2;
    return;
  }
  if (!options.write) {
    console.log(
      "[coupon-v1-backfill] dry-run complete; no database writes were attempted",
    );
    return;
  }

  await assertCouponWriteReady(runtime);
  let completed = 0;
  for (let index = 0; index < plan.batches.length; index += 1) {
    const batch = plan.batches[index] ?? [];
    const result = await requestCouponJson(
      runtime,
      "/rest/v1/rpc/faolla_upsert_merchant_coupons_v1",
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
      `[coupon-v1-backfill] progress batch=${index + 1}/${plan.batches.length} coupons=${completed}/${plan.couponCount}`,
    );
  }

  const [latestLegacy, latestV1] = await Promise.all([
    loadLegacyCoupons(runtime, options.siteId),
    loadCouponV1(runtime, options.siteId),
  ]);
  const report = reconcile(options.siteId, latestLegacy, latestV1);
  console.log(
    `[coupon-v1-backfill] reconciliation legacy=${report.legacyCouponCount} v1=${report.v1CouponCount} matched=${report.matchedCouponCount} missing=${report.missingCoupons.length} unexpected=${report.unexpectedCoupons.length} missing-claims=${report.missingClaims.length} missing-redemptions=${report.missingRedemptions.length} unexpected-active-redemptions=${report.unexpectedActiveRedemptions.length} missing-events=${report.missingEventKeys.length} mismatched=${report.mismatches.length}`,
  );
  if (!report.isMatch) {
    process.exitCode = 2;
    return;
  }
  console.log(
    "[coupon-v1-backfill] complete; legacy remains the source of truth",
  );
}

main().catch((error) => {
  console.error(
    `[coupon-v1-backfill] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
