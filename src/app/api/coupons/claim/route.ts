import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  buildMerchantCouponClaimValidUntil,
  buildMerchantCouponSettlementCode,
  merchantCouponRequiresClaimCode,
  merchantCouponRequiresPersonalClaim,
  merchantCouponSupportsUsageScenario,
  normalizeMerchantCouponClaimCode,
  type MerchantCouponClaimEvent,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { claimMerchantCouponRecord } from "@/lib/merchantCoupons.server";
import { listMerchantOrders } from "@/lib/merchantOrders.server";
import { buildPersonalClaimedCoupon, writePersonalClaimedCouponToUserMetadata, type PersonalClaimedCoupon } from "@/lib/personalCoupons";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import { resolvePersonalAccountSessionFromRequest, type PersonalAccountSession } from "@/lib/personalAccountSession.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeComparableText(value: unknown) {
  return trimText(value).toLowerCase();
}

function listContainsNormalized(list: string[], value: unknown) {
  const normalized = normalizeComparableText(value);
  return Boolean(normalized) && list.map((item) => normalizeComparableText(item)).includes(normalized);
}

function readProfileText(profile: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseDateTimeWindow(value: string) {
  const [startRaw, endRaw] = value.split(/\s*(?:~|至|\|)\s*/);
  const start = Date.parse(trimText(startRaw).replace(" ", "T"));
  const end = Date.parse(trimText(endRaw).replace(" ", "T"));
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

function parseDailyTimeWindow(value: string) {
  const [startRaw, endRaw] = value.split(/\s*(?:~|至|\|)\s*/);
  const startMatch = trimText(startRaw).match(/^(\d{1,2}):(\d{2})$/);
  const endMatch = trimText(endRaw).match(/^(\d{1,2}):(\d{2})$/);
  if (!startMatch || !endMatch) return null;
  const start = Number(startMatch[1]) * 60 + Number(startMatch[2]);
  const end = Number(endMatch[1]) * 60 + Number(endMatch[2]);
  if (start < 0 || start >= 1440 || end < 0 || end >= 1440) return null;
  return { start, end };
}

function getPeriodStart(date: Date, period: "hour" | "day" | "week" | "month") {
  const next = new Date(date);
  if (period === "hour") {
    next.setMinutes(0, 0, 0);
  } else if (period === "day") {
    next.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    next.setHours(0, 0, 0, 0);
    const mondayOffset = (next.getDay() + 6) % 7;
    next.setDate(next.getDate() - mondayOffset);
  } else {
    next.setDate(1);
    next.setHours(0, 0, 0, 0);
  }
  return next.getTime();
}

function claimEventMatchesSession(event: MerchantCouponClaimEvent, session: PersonalAccountSession, email: string) {
  return Boolean(
    (event.accountId && event.accountId === session.accountId) ||
      (event.userId && event.userId === session.userId) ||
      (event.email && email && event.email.toLowerCase() === email.toLowerCase()),
  );
}

function countClaimEvents(coupon: MerchantCouponRecord, input: { after?: number; session?: PersonalAccountSession | null; email?: string }) {
  return coupon.claimEvents.filter((event) => {
    const timestamp = Date.parse(event.at);
    if (!Number.isFinite(timestamp)) return false;
    if (input.after !== undefined && timestamp < input.after) return false;
    if (input.session && !claimEventMatchesSession(event, input.session, input.email ?? "")) return false;
    return true;
  }).length;
}

function assertCouponClaimTimeAllowed(coupon: MerchantCouponRecord, now: Date) {
  const nowTime = now.getTime();
  if (coupon.claimDateTimeWindows.length > 0) {
    const inWindow = coupon.claimDateTimeWindows.some((line) => {
      const window = parseDateTimeWindow(line);
      return window ? nowTime >= Math.min(window.start, window.end) && nowTime <= Math.max(window.start, window.end) : false;
    });
    if (!inWindow) throw new Error("coupon_claim_time_not_allowed");
  }
  if (coupon.claimDailyTimeWindows.length > 0) {
    const minute = now.getHours() * 60 + now.getMinutes();
    const inWindow = coupon.claimDailyTimeWindows.some((line) => {
      const window = parseDailyTimeWindow(line);
      if (!window) return false;
      return window.start <= window.end
        ? minute >= window.start && minute <= window.end
        : minute >= window.start || minute <= window.end;
    });
    if (!inWindow) throw new Error("coupon_claim_time_not_allowed");
  }
}

function assertCouponClaimStockAllowed(coupon: MerchantCouponRecord, now: Date) {
  const limits: Array<[number, "hour" | "day" | "week" | "month", string]> = [
    [coupon.claimHourlyStockLimit, "hour", "coupon_hourly_stock_exhausted"],
    [coupon.claimDailyStockLimit, "day", "coupon_daily_stock_exhausted"],
    [coupon.claimWeeklyStockLimit, "week", "coupon_weekly_stock_exhausted"],
    [coupon.claimMonthlyStockLimit, "month", "coupon_monthly_stock_exhausted"],
  ];
  limits.forEach(([limit, period, error]) => {
    if (limit > 0 && countClaimEvents(coupon, { after: getPeriodStart(now, period) }) >= limit) throw new Error(error);
  });
}

function assertCouponPerUserClaimAllowed(coupon: MerchantCouponRecord, session: PersonalAccountSession, email: string, now: Date) {
  const limits: Array<[number, number | undefined, string]> = [
    [coupon.claimPerUserTotalLimit, undefined, "coupon_user_total_limit_reached"],
    [coupon.claimPerUserDailyLimit, getPeriodStart(now, "day"), "coupon_user_daily_limit_reached"],
    [coupon.claimPerUserWeeklyLimit, getPeriodStart(now, "week"), "coupon_user_weekly_limit_reached"],
    [coupon.claimPerUserMonthlyLimit, getPeriodStart(now, "month"), "coupon_user_monthly_limit_reached"],
  ];
  limits.forEach(([limit, after, error]) => {
    if (limit > 0 && countClaimEvents(coupon, { after, session, email }) >= limit) throw new Error(error);
  });
}

async function assertCouponClaimIdentityAllowed(coupon: MerchantCouponRecord, request: Request, claimCode: string, now: Date) {
  const requiresPersonal = merchantCouponRequiresPersonalClaim(coupon);
  assertCouponClaimTimeAllowed(coupon, now);
  assertCouponClaimStockAllowed(coupon, now);
  if (merchantCouponRequiresClaimCode(coupon) && !coupon.claimAllowedCodes.includes(claimCode)) {
    throw new Error("coupon_claim_code_not_allowed");
  }
  if (!requiresPersonal) return null;

  const session = await resolvePersonalAccountSessionFromRequest(request);
  if (!session) throw new Error("coupon_login_required");
  const profile = readPersonalCustomerProfileFromSession({
    authenticated: true,
    accountType: "personal",
    accountId: session.accountId,
    user: session.user,
  });
  const metadataProfile =
    session.user.user_metadata?.personal_profile && typeof session.user.user_metadata.personal_profile === "object"
      ? (session.user.user_metadata.personal_profile as Record<string, unknown>)
      : {};

  if (coupon.claimAllowedAccountIds.length > 0 && !coupon.claimAllowedAccountIds.includes(session.accountId)) {
    throw new Error("coupon_account_not_allowed");
  }
  if (coupon.claimAllowedCountries.length > 0 && !listContainsNormalized(coupon.claimAllowedCountries, readProfileText(metadataProfile, "country"))) {
    throw new Error("coupon_location_not_allowed");
  }
  if (coupon.claimAllowedProvinces.length > 0 && !listContainsNormalized(coupon.claimAllowedProvinces, readProfileText(metadataProfile, "province"))) {
    throw new Error("coupon_location_not_allowed");
  }
  if (coupon.claimAllowedCities.length > 0 && !listContainsNormalized(coupon.claimAllowedCities, readProfileText(metadataProfile, "city"))) {
    throw new Error("coupon_location_not_allowed");
  }

  if (coupon.claimOldUserOnly || coupon.claimMinRegisteredDays > 0 || coupon.claimMinSpendAmount > 0 || coupon.claimMinOrderCount > 0) {
    const createdAt = Date.parse(trimText((session.user as { created_at?: unknown }).created_at));
    if (coupon.claimMinRegisteredDays > 0) {
      const ageDays = Number.isFinite(createdAt) ? Math.floor((Date.now() - createdAt) / 86_400_000) : 0;
      if (ageDays < coupon.claimMinRegisteredDays) throw new Error("coupon_registered_days_not_met");
    }
    if (coupon.claimMinSpendAmount > 0 || coupon.claimMinOrderCount > 0) {
      const orders = (await listMerchantOrders(coupon.siteId)).filter((order) => {
        if (order.status === "cancelled") return false;
        if (order.customerAccountId && order.customerAccountId === session.accountId) return true;
        if (order.customerUserId && order.customerUserId === session.userId) return true;
        const email = session.email || profile.email || profile.loginEmail;
        return Boolean(email) && (order.customerLoginEmail === email || order.customer.email === email);
      });
      const totalSpend = orders.reduce((sum, order) => sum + order.totalAmount, 0);
      if (coupon.claimMinOrderCount > 0 && orders.length < coupon.claimMinOrderCount) throw new Error("coupon_order_count_not_met");
      if (coupon.claimMinSpendAmount > 0 && totalSpend < coupon.claimMinSpendAmount) throw new Error("coupon_spend_not_met");
    }
  }
  const email = session.email || profile.email || profile.loginEmail || "";
  assertCouponPerUserClaimAllowed(coupon, session, email, now);
  return session;
}

async function addFavoriteSite(
  session: PersonalAccountSession | null,
  input: { siteId: string; siteName: string; pageUrl: string; claimedCoupon?: PersonalClaimedCoupon | null },
) {
  if (!session) return;
  const userMetadata = session.user.user_metadata && typeof session.user.user_metadata === "object" ? { ...session.user.user_metadata } : {};
  const personalProfile =
    userMetadata.personal_profile && typeof userMetadata.personal_profile === "object"
      ? { ...(userMetadata.personal_profile as Record<string, unknown>) }
      : {};
  const currentSites = Array.isArray(personalProfile.favoriteSites) ? personalProfile.favoriteSites : [];
  const pageUrl = trimText(input.pageUrl, 1200);
  let subtitle = "";
  try {
    subtitle = pageUrl ? new URL(pageUrl).host : "";
  } catch {
    subtitle = "";
  }
  const favorite = {
    id: input.siteId,
    url: pageUrl || `/${input.siteId}`,
    name: trimText(input.siteName, 120) || input.siteId,
    subtitle,
    addedAt: new Date().toISOString(),
  };
  const nextSites = [
    favorite,
    ...currentSites.filter((item) => {
      if (!item || typeof item !== "object") return false;
      return trimText((item as Record<string, unknown>).id) !== input.siteId;
    }),
  ].slice(0, 200);
  personalProfile.favoriteSites = nextSites;
  userMetadata.personal_profile = personalProfile;
  const metadataWithCoupon = input.claimedCoupon
    ? writePersonalClaimedCouponToUserMetadata(userMetadata, input.claimedCoupon)
    : userMetadata;
  await session.adminSupabase.auth.admin.updateUserById(session.userId, { user_metadata: metadataWithCoupon }).catch(() => null);
}

async function isCouponWebsiteBlockEnabled(siteId: string) {
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  return Boolean(site?.permissionConfig?.allowCouponModule && site?.permissionConfig?.allowCouponBlock);
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json()) as { siteId?: unknown; couponId?: unknown; claimCode?: unknown; siteName?: unknown; pageUrl?: unknown } | null;
    const siteId = trimText(body?.siteId);
    const couponId = trimText(body?.couponId);
    const claimCode = normalizeMerchantCouponClaimCode(body?.claimCode);
    if (!isMerchantNumericId(siteId) || !couponId) {
      return NextResponse.json({ error: "invalid_coupon" }, { status: 400 });
    }
    if (!(await isCouponWebsiteBlockEnabled(siteId))) {
      return NextResponse.json({ error: "coupon_block_disabled" }, { status: 403 });
    }
    let claimSession: PersonalAccountSession | null = null;
    let claimEventId = "";
    let settlementType: "qr" | "barcode" = "qr";
    let settlementCode = "";
    let claimValidUntil: string | null = null;
    const now = new Date();
    const coupon = await claimMerchantCouponRecord({
      siteId,
      couponId,
      beforeClaim: async (current) => {
        claimSession = await assertCouponClaimIdentityAllowed(current, request, claimCode, now);
        claimEventId = `CE${now.getTime().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        settlementType = merchantCouponSupportsUsageScenario(current, "checkout_barcode") && !merchantCouponSupportsUsageScenario(current, "checkout_qr") ? "barcode" : "qr";
        settlementCode = buildMerchantCouponSettlementCode(
          current,
          settlementType === "barcode" ? "checkout_barcode" : "checkout_qr",
          current.claimedCount + 1,
          claimCode,
        );
        claimValidUntil = buildMerchantCouponClaimValidUntil(current, now);
        const profile = claimSession
          ? readPersonalCustomerProfileFromSession({
              authenticated: true,
              accountType: "personal",
              accountId: claimSession.accountId,
              user: claimSession.user,
            })
          : null;
        return {
          id: claimEventId,
          accountId: claimSession?.accountId ?? "",
          userId: claimSession?.userId ?? "",
          email: claimSession?.email ?? "",
          code: claimCode,
          customerName: profile?.name ?? "",
          settlementType,
          settlementCode,
          validUntil: claimValidUntil,
        };
      },
    });
    const claimEvent = coupon.claimEvents.find((event) => event.id === claimEventId) ?? coupon.claimEvents[0] ?? null;
    const claimedCoupon =
      claimSession && claimEvent
        ? buildPersonalClaimedCoupon({
            coupon,
            claimEvent,
            siteName: trimText(body?.siteName),
            pageUrl: trimText(body?.pageUrl, 1200),
          })
        : null;
    await addFavoriteSite(claimSession, { siteId, siteName: trimText(body?.siteName), pageUrl: trimText(body?.pageUrl, 1200), claimedCoupon });
    return NextResponse.json({
      ok: true,
      coupon,
      claimEventId,
      claimResultUrl: `/coupon/claim/${encodeURIComponent(claimEventId)}?siteId=${encodeURIComponent(siteId)}&couponId=${encodeURIComponent(couponId)}`,
      savedToAccount: Boolean(claimedCoupon),
      settlementCodes: {
        checkoutQr: claimEvent?.settlementType === "qr" ? claimEvent.settlementCode : null,
        checkoutBarcode: claimEvent?.settlementType === "barcode" ? claimEvent.settlementCode : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status = message === "coupon_login_required" ? 401 : message === "coupon_not_claimable" ? 409 : 400;
    return NextResponse.json(
      {
        error: "coupon_claim_failed",
        message,
      },
      { status },
    );
  }
}
