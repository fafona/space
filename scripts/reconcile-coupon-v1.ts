import { reconcileMerchantCouponStorage } from "../src/lib/merchantCouponReconciliation";
import {
  createCouponRestRuntime,
  loadCouponV1,
  loadLegacyCoupons,
  trimCouponCliText,
} from "./coupon-v1-runtime";

function readSiteId() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0]?.startsWith("--site=")) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }
  const siteId = trimCouponCliText(args[0].slice("--site=".length));
  if (!/^\d{8}$/.test(siteId)) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }
  return siteId;
}

async function main() {
  const siteId = readSiteId();
  const runtime = createCouponRestRuntime();
  const [legacyCoupons, v1] = await Promise.all([
    loadLegacyCoupons(runtime, siteId),
    loadCouponV1(runtime, siteId),
  ]);
  const report = reconcileMerchantCouponStorage({
    merchantId: siteId,
    legacyCoupons,
    v1Coupons: v1[0],
    v1Claims: v1[1],
    v1Redemptions: v1[2],
    v1Events: v1[3],
  });
  console.log(
    `[coupon-v1-audit] merchant=${siteId} legacy=${report.legacyCouponCount} v1=${report.v1CouponCount} matched=${report.matchedCouponCount} missing=${report.missingCoupons.length} unexpected=${report.unexpectedCoupons.length} missing-claims=${report.missingClaims.length} missing-redemptions=${report.missingRedemptions.length} unexpected-active-redemptions=${report.unexpectedActiveRedemptions.length} missing-events=${report.missingEventKeys.length} mismatched=${report.mismatches.length}`,
  );
  report.mismatches.slice(0, 20).forEach((mismatch) => {
    console.log(
      `[coupon-v1-audit] mismatch entity=${mismatch.entity} coupon=${mismatch.couponId} record=${mismatch.recordId} fields=${mismatch.fields.join(",")}`,
    );
  });
  if (report.missingCoupons.length > 0) {
    console.log(
      `[coupon-v1-audit] missing-coupon-ids=${report.missingCoupons.slice(0, 20).join(",")}`,
    );
  }
  if (!report.isMatch) process.exitCode = 2;
}

main().catch((error) => {
  console.error(
    `[coupon-v1-audit] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
