import { after, NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  buildMerchantCouponClaimValidUntil,
  buildMerchantCouponSettlementCode,
  hasActiveMerchantMembershipForCouponClaim,
  isMerchantCouponOldUserEligible,
  merchantCouponRequiresClaimCode,
  merchantCouponRequiresPersonalClaim,
  merchantCouponSupportsUsageScenario,
  normalizeMerchantCouponClaimCode,
  toPublicMerchantCouponRecord,
  type MerchantCouponClaimEvent,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { claimMerchantCouponRecord } from "@/lib/merchantCoupons.server";
import {
  parseMerchantCouponDailyTimeWindow,
  parseMerchantCouponDateTimeWindow,
} from "@/lib/merchantCouponClaimWindows";
import { listMerchantOrders } from "@/lib/merchantOrders.server";
import { getMerchantMembershipsSnapshot } from "@/lib/merchantMemberships.server";
import { isCouponWebsiteBlockEnabled } from "@/lib/merchantCouponPermissions.server";
import { buildPersonalClaimedCoupon, writePersonalClaimedCouponToUserMetadata, type PersonalClaimedCoupon } from "@/lib/personalCoupons";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import { matchesExactPersonalIdentity } from "@/lib/personalAccountId";
import { resolvePersonalAccountSessionFromRequest, type PersonalAccountSession } from "@/lib/personalAccountSession.server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { readMerchantAuthAccountTypeCookie } from "@/lib/merchantAuthSession";
import { createServerTiming } from "@/lib/serverTiming";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPTIONAL_PERSONAL_SESSION_INLINE_WAIT_MS = 150;
const OPTIONAL_PERSONAL_SESSION_TIMEOUT = Symbol("optional_personal_session_timeout");
const personalCouponMetadataMutationTails = new Map<string, Promise<void>>();

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function withPersonalCouponMetadataMutationLock<T>(userId: string, task: () => Promise<T>) {
  const normalizedUserId = trimText(userId, 128);
  if (!normalizedUserId) throw new Error("coupon_account_save_failed");
  const previous = personalCouponMetadataMutationTails.get(normalizedUserId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  personalCouponMetadataMutationTails.set(normalizedUserId, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (personalCouponMetadataMutationTails.get(normalizedUserId) === tail) {
      personalCouponMetadataMutationTails.delete(normalizedUserId);
    }
  }
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

function shouldTryOptionalPersonalSession(request: Request) {
  return readMerchantAuthAccountTypeCookie(request) !== "merchant";
}

async function waitForOptionalPersonalSession(
  task: Promise<PersonalAccountSession | null> | null,
  timeoutMs = OPTIONAL_PERSONAL_SESSION_INLINE_WAIT_MS,
) {
  if (!task) return { session: null, timedOut: false };
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      task,
      new Promise<typeof OPTIONAL_PERSONAL_SESSION_TIMEOUT>((resolve) => {
        timeout = setTimeout(() => resolve(OPTIONAL_PERSONAL_SESSION_TIMEOUT), timeoutMs);
      }),
    ]);
    if (result === OPTIONAL_PERSONAL_SESSION_TIMEOUT) return { session: null, timedOut: true };
    return { session: result, timedOut: false };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

function claimEventMatchesSession(
  event: MerchantCouponClaimEvent,
  session: PersonalAccountSession,
) {
  return matchesExactPersonalIdentity(
    { accountId: event.accountId, userId: event.userId },
    { accountId: session.accountId, userId: session.userId },
  );
}

function countClaimEvents(coupon: MerchantCouponRecord, input: { after?: number; session?: PersonalAccountSession | null }) {
  return coupon.claimEvents.filter((event) => {
    const timestamp = Date.parse(event.at);
    if (!Number.isFinite(timestamp)) return false;
    if (input.after !== undefined && timestamp < input.after) return false;
    if (input.session && !claimEventMatchesSession(event, input.session)) return false;
    return true;
  }).length;
}

function assertCouponClaimTimeAllowed(coupon: MerchantCouponRecord, now: Date) {
  const nowTime = now.getTime();
  if (coupon.claimDateTimeWindows.length > 0) {
    const inWindow = coupon.claimDateTimeWindows.some((line) => {
      const window = parseMerchantCouponDateTimeWindow(line);
      return window ? nowTime >= Math.min(window.start, window.end) && nowTime <= Math.max(window.start, window.end) : false;
    });
    if (!inWindow) throw new Error("coupon_claim_time_not_allowed");
  }
  if (coupon.claimDailyTimeWindows.length > 0) {
    const minute = now.getHours() * 60 + now.getMinutes();
    const inWindow = coupon.claimDailyTimeWindows.some((line) => {
      const window = parseMerchantCouponDailyTimeWindow(line);
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

function assertCouponPerUserClaimAllowed(coupon: MerchantCouponRecord, session: PersonalAccountSession, now: Date) {
  const limits: Array<[number, number | undefined, string]> = [
    [coupon.claimPerUserTotalLimit, undefined, "coupon_user_total_limit_reached"],
    [coupon.claimPerUserDailyLimit, getPeriodStart(now, "day"), "coupon_user_daily_limit_reached"],
    [coupon.claimPerUserWeeklyLimit, getPeriodStart(now, "week"), "coupon_user_weekly_limit_reached"],
    [coupon.claimPerUserMonthlyLimit, getPeriodStart(now, "month"), "coupon_user_monthly_limit_reached"],
  ];
  limits.forEach(([limit, after, error]) => {
    if (limit > 0 && countClaimEvents(coupon, { after, session }) >= limit) throw new Error(error);
  });
}

async function assertCouponClaimIdentityAllowed(
  coupon: MerchantCouponRecord,
  request: Request,
  claimCode: string,
  now: Date,
  personalSessionTask?: Promise<PersonalAccountSession | null> | null,
) {
  const requiresPersonal = merchantCouponRequiresPersonalClaim(coupon);
  assertCouponClaimTimeAllowed(coupon, now);
  assertCouponClaimStockAllowed(coupon, now);
  if (merchantCouponRequiresClaimCode(coupon) && !coupon.claimAllowedCodes.includes(claimCode)) {
    throw new Error("coupon_claim_code_not_allowed");
  }
  if (!requiresPersonal) return null;

  const session = personalSessionTask ? await personalSessionTask : await resolvePersonalAccountSessionFromRequest(request);
  if (!session) throw new Error("coupon_login_required");
  const metadataProfile =
    session.user.user_metadata?.personal_profile && typeof session.user.user_metadata.personal_profile === "object"
      ? (session.user.user_metadata.personal_profile as Record<string, unknown>)
      : {};
  if (coupon.claimRequiresMember) {
    const membershipSnapshot = await getMerchantMembershipsSnapshot(coupon.siteId, {
      applyScheduledRules: false,
    });
    if (
      !hasActiveMerchantMembershipForCouponClaim(membershipSnapshot.memberships, {
        accountId: session.accountId,
        userId: session.userId,
      })
    ) {
      throw new Error("coupon_membership_required");
    }
  }

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
    const userCreatedAt = (session.user as { created_at?: unknown }).created_at;
    const createdAt = Date.parse(trimText(userCreatedAt));
    if (!isMerchantCouponOldUserEligible(coupon, userCreatedAt)) {
      throw new Error("coupon_old_user_required");
    }
    if (coupon.claimMinRegisteredDays > 0) {
      const ageDays = Number.isFinite(createdAt) ? Math.floor((now.getTime() - createdAt) / 86_400_000) : 0;
      if (ageDays < coupon.claimMinRegisteredDays) throw new Error("coupon_registered_days_not_met");
    }
    if (coupon.claimMinSpendAmount > 0 || coupon.claimMinOrderCount > 0) {
      const orders = (await listMerchantOrders(coupon.siteId)).filter((order) => {
        if (order.status !== "completed") return false;
        return matchesExactPersonalIdentity(
          {
            accountId: order.customerAccountId,
            userId: order.customerUserId,
          },
          { accountId: session.accountId, userId: session.userId },
        );
      });
      const totalSpend = orders.reduce((sum, order) => sum + order.totalAmount, 0);
      if (coupon.claimMinOrderCount > 0 && orders.length < coupon.claimMinOrderCount) throw new Error("coupon_order_count_not_met");
      if (coupon.claimMinSpendAmount > 0 && totalSpend < coupon.claimMinSpendAmount) throw new Error("coupon_spend_not_met");
    }
  }
  assertCouponPerUserClaimAllowed(coupon, session, now);
  return session;
}

async function addFavoriteSite(
  session: PersonalAccountSession | null,
  input: { siteId: string; siteName: string; pageUrl: string; claimedCoupon?: PersonalClaimedCoupon | null },
) {
  if (!session) return;
  await withPersonalCouponMetadataMutationLock(session.userId, async () => {
    const admin = session.adminSupabase.auth.admin as typeof session.adminSupabase.auth.admin & {
      getUserById?: (userId: string) => Promise<{
        data?: { user?: { user_metadata?: Record<string, unknown> | null } | null } | null;
        error?: { message?: string } | null;
      }>;
    };
    let sourceMetadata = session.user.user_metadata;
    if (typeof admin.getUserById === "function") {
      const fresh = await admin.getUserById(session.userId);
      if (fresh.error) throw new Error(fresh.error.message || "coupon_account_read_failed");
      sourceMetadata = fresh.data?.user?.user_metadata ?? sourceMetadata;
    }
    const userMetadata = sourceMetadata && typeof sourceMetadata === "object" ? { ...sourceMetadata } : {};
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
    personalProfile.favoriteSites = [
      favorite,
      ...currentSites.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return trimText((item as Record<string, unknown>).id) !== input.siteId;
      }),
    ].slice(0, 200);
    userMetadata.personal_profile = personalProfile;
    const metadataWithCoupon = input.claimedCoupon
      ? writePersonalClaimedCouponToUserMetadata(userMetadata, input.claimedCoupon)
      : userMetadata;
    const updated = await admin.updateUserById(session.userId, { user_metadata: metadataWithCoupon });
    if (updated.error) throw new Error(updated.error.message || "coupon_account_save_failed");
  });
}

async function retryAccountSave(task: () => Promise<void>, attempts = 3, reportFailure = true) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await task();
      return true;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  if (reportFailure) console.error("[coupon-claim] account metadata save failed", lastError);
  return false;
}

function scheduleAccountSaveAfterResponse(input: {
  claimSession: PersonalAccountSession | null;
  optionalPersonalSessionTask: Promise<PersonalAccountSession | null> | null;
  siteId: string;
  siteName: string;
  pageUrl: string;
  coupon: MerchantCouponRecord;
  claimEvent: MerchantCouponClaimEvent | null;
  claimedCoupon: PersonalClaimedCoupon | null;
}) {
  if (!input.claimSession && !input.optionalPersonalSessionTask) return false;
  after(async () => {
    const session = input.claimSession ?? (await input.optionalPersonalSessionTask?.catch(() => null)) ?? null;
    if (!session) return;
    const claimedCoupon =
      input.claimedCoupon ??
      (input.claimEvent
        ? buildPersonalClaimedCoupon({
            coupon: input.coupon,
            claimEvent: input.claimEvent,
            siteName: input.siteName,
            pageUrl: input.pageUrl,
          })
        : null);
    await retryAccountSave(() =>
      addFavoriteSite(session, {
        siteId: input.siteId,
        siteName: input.siteName,
        pageUrl: input.pageUrl,
        claimedCoupon,
      }),
    );
  });
  return true;
}

export async function POST(request: Request) {
  const timing = createServerTiming();
  const withTiming = (response: NextResponse) => {
    timing.apply(response.headers);
    return response;
  };
  if (!isTrustedSameOriginMutationRequest(request)) {
    return withTiming(getTrustedMutationRequestErrorResponse());
  }
  try {
    const body = await timing.time("body", async () => (await request.json()) as { siteId?: unknown; couponId?: unknown; claimCode?: unknown; siteName?: unknown; pageUrl?: unknown } | null);
    const siteId = trimText(body?.siteId);
    const couponId = trimText(body?.couponId);
    const claimCode = normalizeMerchantCouponClaimCode(body?.claimCode);
    if (!isMerchantNumericId(siteId) || !couponId) {
      return withTiming(NextResponse.json({ error: "invalid_coupon" }, { status: 400 }));
    }
    const siteName = trimText(body?.siteName);
    const pageUrl = trimText(body?.pageUrl, 1200);
    const optionalPersonalSessionTask = shouldTryOptionalPersonalSession(request)
      ? resolvePersonalAccountSessionFromRequest(request).catch(() => null)
      : null;
    if (!(await timing.time("permission", () => isCouponWebsiteBlockEnabled(siteId)))) {
      return withTiming(NextResponse.json({ error: "coupon_block_disabled" }, { status: 403 }));
    }
    let claimSession: PersonalAccountSession | null = null;
    let claimEventId = "";
    let settlementType: "qr" | "barcode" = "qr";
    let settlementCode = "";
    let claimValidUntil: string | null = null;
    const now = new Date();
    let optionalSessionDeferred = false;
    const coupon = await timing.time("claim_write", () => claimMerchantCouponRecord({
      siteId,
      couponId,
      beforeClaim: async (current) => {
        claimSession = await assertCouponClaimIdentityAllowed(current, request, claimCode, now, optionalPersonalSessionTask);
        if (!claimSession && optionalPersonalSessionTask) {
          const optionalSessionResult = await timing.time("optional_session", () => waitForOptionalPersonalSession(optionalPersonalSessionTask));
          claimSession = optionalSessionResult.session;
          optionalSessionDeferred = optionalSessionResult.timedOut;
        }
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
    }));
    const claimEvent = coupon.claimEvents.find((event) => event.id === claimEventId) ?? null;
    if (!claimEvent) throw new Error("coupon_claim_event_missing");
    const claimedCoupon =
      claimSession && claimEvent
        ? buildPersonalClaimedCoupon({
            coupon,
            claimEvent,
            siteName,
            pageUrl,
          })
        : null;
    const deferredPersonalSessionTask = optionalSessionDeferred && !claimSession ? optionalPersonalSessionTask : null;
    let savedToAccount = false;
    let accountSaveScheduled = false;
    if (claimSession && claimedCoupon) {
      savedToAccount = await timing.time("account_save", () =>
        retryAccountSave(
          () => addFavoriteSite(claimSession, { siteId, siteName, pageUrl, claimedCoupon }),
          1,
          false,
        ),
      );
    }
    if (!savedToAccount) {
      accountSaveScheduled = scheduleAccountSaveAfterResponse({
        claimSession,
        optionalPersonalSessionTask: deferredPersonalSessionTask,
        siteId,
        siteName,
        pageUrl,
        coupon,
        claimEvent,
        claimedCoupon,
      });
      timing.add("account_save_deferred", 0, accountSaveScheduled ? "scheduled" : "skipped");
    }
    if (optionalSessionDeferred) timing.add("optional_session_deferred", 0);
    return withTiming(NextResponse.json({
      ok: true,
      coupon: toPublicMerchantCouponRecord(coupon),
      claimEventId,
      claimResultUrl: `/coupon/claim/${encodeURIComponent(claimEventId)}?siteId=${encodeURIComponent(siteId)}&couponId=${encodeURIComponent(couponId)}`,
      savedToAccount,
      accountSavePending: accountSaveScheduled,
      settlementCodes: {
        checkoutQr: claimEvent?.settlementType === "qr" ? claimEvent.settlementCode : null,
        checkoutBarcode: claimEvent?.settlementType === "barcode" ? claimEvent.settlementCode : null,
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status = message === "coupon_login_required" ? 401 : message === "coupon_not_claimable" ? 409 : 400;
    return withTiming(NextResponse.json(
      {
        error: "coupon_claim_failed",
        message,
      },
      { status },
    ));
  }
}
