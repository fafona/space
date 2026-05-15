import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  createMerchantCoupon,
  normalizeMerchantCouponRecords,
  updateMerchantCoupon,
  type MerchantCouponInput,
} from "@/lib/merchantCoupons";
import { loadStoredMerchantCoupons, saveStoredMerchantCoupons } from "@/lib/merchantCouponsStore";

function requireCouponsStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    throw new Error("coupons_store_unavailable");
  }
  return supabase;
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function listMerchantCoupons(siteId: string) {
  const supabase = requireCouponsStoreClient();
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  return stored?.coupons ?? [];
}

export async function createMerchantCouponRecord(input: MerchantCouponInput) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  if (!siteId) throw new Error("invalid_site_id");
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  const current = normalizeMerchantCouponRecords(stored?.coupons ?? []);
  const coupon = createMerchantCoupon(
    {
      ...input,
      siteId,
    },
    current.map((item) => item.code),
  );
  const saved = await saveStoredMerchantCoupons(supabase, {
    siteId,
    coupons: [coupon, ...current],
    updatedAt: coupon.updatedAt,
  });
  if (saved.error) throw new Error(saved.error);
  return coupon;
}

export async function updateMerchantCouponRecord(input: {
  siteId: string;
  couponId: string;
  patch: MerchantCouponInput;
}) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  const couponId = trimText(input.couponId);
  if (!siteId || !couponId) throw new Error("coupon_not_found");
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  const coupons = normalizeMerchantCouponRecords(stored?.coupons ?? []);
  const index = coupons.findIndex((coupon) => coupon.id === couponId);
  if (index < 0) throw new Error("coupon_not_found");
  const current = coupons[index];
  const next = updateMerchantCoupon(
    current,
    input.patch,
    coupons.filter((coupon) => coupon.id !== couponId).map((coupon) => coupon.code),
  );
  const updatedCoupons = [...coupons];
  updatedCoupons[index] = next;
  const saved = await saveStoredMerchantCoupons(supabase, {
    siteId,
    coupons: updatedCoupons,
    updatedAt: next.updatedAt,
  });
  if (saved.error) throw new Error(saved.error);
  return next;
}

export async function archiveMerchantCouponRecord(input: { siteId: string; couponId: string }) {
  return updateMerchantCouponRecord({
    siteId: input.siteId,
    couponId: input.couponId,
    patch: {
      status: "archived",
      showOnWebsite: false,
      showOnContactCard: false,
    },
  });
}
