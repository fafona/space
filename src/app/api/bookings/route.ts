import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { buildMerchantBookingPushNotification } from "@/lib/merchantPushEvents";
import {
  acknowledgeMerchantBookingBySite,
  createMerchantBooking,
  listMerchantBookings,
  listMerchantBookingsWindow,
  listPersonalMerchantBookings,
  sendMerchantBookingManualEmailBySite,
  updateMerchantBooking,
  updateMerchantBookingBySite,
  updateMerchantBookingsBatchBySite,
  updatePersonalMerchantBooking,
} from "@/lib/merchantBookings.server";
import type { MerchantPushSubscriptionStoreClient } from "@/lib/merchantPushSubscriptionStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { notifyMerchantPushSubscribers } from "@/lib/webPush";
import {
  authorizeMerchantBusinessRequest,
  MerchantBusinessAccessError,
  reauthorizeMerchantBusinessMutation,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import {
  getMerchantBookingMutationRequiredPermissions,
  redactMerchantBookingForBusinessActor,
  redactMerchantBookingsForBusinessActor,
} from "@/lib/merchantBusinessBookingPermissions";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import { verifyFrontendAuthProof } from "@/lib/frontendAuthProof.server";
import { buildPersonalMerchantContactMap } from "@/lib/personalMerchantContacts.server";
import { hashPersonalGuestMergeToken } from "@/lib/personalGuestMerge.server";
import type {
  MerchantBookingActionInput,
  MerchantBookingCreateInput,
  MerchantBookingStatus,
} from "@/lib/merchantBookings";
import type { MerchantBookingRuleViewport } from "@/lib/merchantBookingRules";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeBookingViewport(value: unknown): MerchantBookingRuleViewport | undefined {
  return value === "mobile" || value === "desktop" ? value : undefined;
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function applyPrivateResponseHeaders(response: Response) {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function privateJson(body: unknown, init?: ResponseInit) {
  return applyPrivateResponseHeaders(NextResponse.json(body, init));
}

function normalizeBookingListOffset(value: string | null) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeBookingListLimit(value: string | null) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric < 1) return 500;
  return Math.min(Math.max(numeric, 1), 1000);
}

async function resolveBookingAdminSession(
  request: Request,
  siteId: string,
  requiredPermissions: readonly MerchantStaffBusinessPermission[],
): Promise<{
  merchantId: string;
  actor: MerchantBusinessActor;
  assertAuthorizationCurrent: () => Promise<void>;
}> {
  const firstPermission = requiredPermissions[0];
  if (!firstPermission) {
    throw new MerchantBusinessAccessError("invalid_business_permission", 500);
  }
  const actor = await authorizeMerchantBusinessRequest(request, {
    siteId,
    requiredPermission: firstPermission,
  });
  if (
    requiredPermissions.some(
      (permission) => !actor.businessPermissions.includes(permission),
    )
  ) {
    throw new MerchantBusinessAccessError("permission_denied", 403);
  }
  return {
    merchantId: actor.siteId,
    actor,
    assertAuthorizationCurrent: async () => {
      await reauthorizeMerchantBusinessMutation(request, {
        actor,
        requiredPermissions,
      });
    },
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("scope")?.trim() === "personal") {
      if (request.headers.has("x-merchant-access-token")) {
        return privateJson(
          { error: "business_scope_required" },
          { status: 403 },
        );
      }
      const session = await resolvePersonalAccountSessionFromRequest(request);
      if (!session) {
        return privateJson({ error: "unauthorized" }, { status: 401 });
      }
      const bookings = await listPersonalMerchantBookings(
        {
          accountId: session.accountId,
          userId: session.userId,
          email: session.email,
        },
        {
          includeAutomationState: true,
        },
      );
      const merchantContacts = await buildPersonalMerchantContactMap(bookings.map((booking) => booking.siteId));
      return privateJson({ ok: true, bookings, merchantContacts });
    }

    const siteId = readUniqueMerchantBusinessSiteId(request.url);
    if (!siteId) {
      return privateJson({ error: "invalid_site_id" }, { status: 400 });
    }
    const session = await resolveBookingAdminSession(request, siteId, [
      "bookings.view",
    ]);
    if (!session) {
      return privateJson({ error: "unauthorized" }, { status: 401 });
    }
    if (searchParams.has("offset") || searchParams.has("limit")) {
      const windowResult = await listMerchantBookingsWindow(siteId, {
        offset: normalizeBookingListOffset(searchParams.get("offset")),
        limit: normalizeBookingListLimit(searchParams.get("limit")),
        includeAutomationState: true,
        includeCustomerEmailLogs: true,
        includeTimeline: true,
      });
      return privateJson({
        ok: true,
        bookings: redactMerchantBookingsForBusinessActor(
          windowResult.records,
          session.actor,
        ),
        offset: windowResult.offset,
        limit: windowResult.limit,
        total: windowResult.total,
        hasMore: windowResult.hasMore,
      });
    }
    const bookings = await listMerchantBookings(siteId, {
      includeAutomationState: true,
      includeCustomerEmailLogs: true,
      includeTimeline: true,
    });
    return privateJson({
      ok: true,
      bookings: redactMerchantBookingsForBusinessActor(
        bookings,
        session.actor,
      ),
    });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) {
      return privateJson({ error: error.code }, { status: error.status });
    }
    return privateJson(
      {
        error: "booking_list_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (request.headers.has("x-merchant-access-token")) {
    return privateJson(
      { error: "business_scope_required" },
      { status: 403 },
    );
  }
  try {
    const body = (await request.json()) as Partial<MerchantBookingCreateInput> & {
      frontendAuthProof?: unknown;
      customerGuestToken?: unknown;
    };
    const siteId = String(body.siteId ?? "").trim();
    if (!isMerchantNumericId(siteId)) {
      return privateJson({ error: "invalid_site_id" }, { status: 400 });
    }
    const personalSession = await resolvePersonalAccountSessionFromRequest(request).catch(() => null);
    const frontendProof = personalSession ? null : verifyFrontendAuthProof(body.frontendAuthProof);
    const personalProof = frontendProof?.accountType === "personal" ? frontendProof : null;
    const personalProfile = personalSession
      ? readPersonalCustomerProfileFromSession({
          authenticated: true,
          accountType: "personal",
          accountId: personalSession.accountId,
          user: personalSession.user,
        })
      : null;
    const fallbackCustomerEmail = personalProfile?.email || personalProof?.email || "";
    const fallbackCustomerName =
      personalProfile?.name ||
      (fallbackCustomerEmail.includes("@") ? fallbackCustomerEmail.split("@")[0] ?? "" : "");
    const created = await createMerchantBooking({
      siteId,
      siteName: String(body.siteName ?? "").trim(),
      bookingBlockId: String(body.bookingBlockId ?? "").trim() || undefined,
      bookingViewport: normalizeBookingViewport(body.bookingViewport),
      store: String(body.store ?? ""),
      item: String(body.item ?? ""),
      appointmentAt: String(body.appointmentAt ?? ""),
      title: String(body.title ?? ""),
      customerName: trimText(body.customerName) || fallbackCustomerName,
      email: trimText(body.email) || fallbackCustomerEmail,
      phone: trimText(body.phone) || personalProfile?.phone || "",
      note: String(body.note ?? ""),
      customerAccountId: personalSession?.accountId ?? personalProof?.accountId ?? "",
      customerUserId: personalSession?.userId ?? personalProof?.userId ?? "",
      customerLoginEmail: personalSession?.email ?? personalProof?.email ?? "",
      customerGuestHash: personalSession || personalProof ? "" : hashPersonalGuestMergeToken(body.customerGuestToken),
    });

    const supabase = createServerSupabaseServiceClient();
    if (supabase) {
      const notification = buildMerchantBookingPushNotification({
        siteId,
        booking: created.booking,
      });
      await notifyMerchantPushSubscribers(supabase as unknown as MerchantPushSubscriptionStoreClient, {
        merchantId: siteId,
        ...notification,
      }).catch(() => {
        // Ignore notification delivery failures; the booking itself should still succeed.
      });
    }

    return privateJson({ ok: true, ...created });
  } catch (error) {
    return privateJson(
      {
        error: "booking_create_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return applyPrivateResponseHeaders(getTrustedMutationRequestErrorResponse());
  }
  try {
    const body = (await request.json()) as
        | (Partial<MerchantBookingActionInput> & {
          scope?: string;
          action?: MerchantBookingActionInput["action"] | "restore";
          siteId?: string;
          status?: MerchantBookingStatus;
          markTouched?: boolean;
          sendCustomerEmail?: boolean;
          bookingIds?: string[];
        })
      | null;

    if (
      String(body?.scope ?? "").trim() === "personal" &&
      (body?.action === "cancel" || body?.action === "update" || body?.action === "restore")
    ) {
      if (request.headers.has("x-merchant-access-token")) {
        return privateJson(
          { error: "business_scope_required" },
          { status: 403 },
        );
      }
      const session = await resolvePersonalAccountSessionFromRequest(request);
      if (!session) return privateJson({ error: "unauthorized" }, { status: 401 });
      const booking = await updatePersonalMerchantBooking({
        bookingId: String(body?.bookingId ?? "").trim(),
        action: body.action,
        accountId: session.accountId,
        userId: session.userId,
        email: session.email,
        updates: body.updates,
      });
      return privateJson({ ok: true, booking });
    }

    const maybeSiteId = String(body?.siteId ?? "").trim();
    const maybeStatus =
      body?.status === "cancelled"
        ? "cancelled"
        : body?.status === "active"
          ? "active"
          : body?.status === "confirmed"
            ? "confirmed"
            : body?.status === "completed"
              ? "completed"
              : body?.status === "no_show"
                ? "no_show"
              : null;
    if (isMerchantNumericId(maybeSiteId)) {
      const requiredPermissions = getMerchantBookingMutationRequiredPermissions({
        status: body?.status,
        updates: body?.updates,
        bookingBlockId: body?.bookingBlockId,
        bookingViewport: body?.bookingViewport,
        sendCustomerEmail: body?.sendCustomerEmail,
        markTouched: body?.markTouched,
        bookingIds: body?.bookingIds,
      });
      if (!requiredPermissions) {
        return privateJson(
          { error: "invalid_booking_action" },
          { status: 400 },
        );
      }
      const session = await resolveBookingAdminSession(
        request,
        maybeSiteId,
        requiredPermissions,
      );
      if (!session) {
        return privateJson({ error: "unauthorized" }, { status: 401 });
      }
      if (body?.sendCustomerEmail === true) {
        const booking = await sendMerchantBookingManualEmailBySite({
          siteId: maybeSiteId,
          bookingId: String(body?.bookingId ?? "").trim(),
          assertAuthorizationCurrent: session.assertAuthorizationCurrent,
        });
        return privateJson({
          ok: true,
          booking: redactMerchantBookingForBusinessActor(
            booking,
            session.actor,
          ),
        });
      }
      if (body?.markTouched === true) {
        const booking = await acknowledgeMerchantBookingBySite({
          siteId: maybeSiteId,
          bookingId: String(body?.bookingId ?? "").trim(),
          assertAuthorizationCurrent: session.assertAuthorizationCurrent,
        });
        return privateJson({
          ok: true,
          booking: redactMerchantBookingForBusinessActor(
            booking,
            session.actor,
          ),
        });
      }
      if (Array.isArray(body?.bookingIds) && maybeStatus) {
        const bookings = await updateMerchantBookingsBatchBySite({
          siteId: maybeSiteId,
          bookingIds: body.bookingIds.map((item) => String(item ?? "").trim()),
          status: maybeStatus,
          assertAuthorizationCurrent: session.assertAuthorizationCurrent,
        });
        return privateJson({
          ok: true,
          bookings: redactMerchantBookingsForBusinessActor(
            bookings,
            session.actor,
          ),
        });
      }
      const booking = await updateMerchantBookingBySite({
        siteId: maybeSiteId,
        bookingId: String(body?.bookingId ?? "").trim(),
        status: maybeStatus ?? undefined,
        bookingBlockId: String(body?.bookingBlockId ?? "").trim() || undefined,
        bookingViewport: normalizeBookingViewport(body?.bookingViewport),
        updates: body?.updates
          ? {
              store: String(body.updates.store ?? ""),
              item: String(body.updates.item ?? ""),
              appointmentAt: String(body.updates.appointmentAt ?? ""),
              title: String(body.updates.title ?? ""),
              customerName: String(body.updates.customerName ?? ""),
              email: String(body.updates.email ?? ""),
              phone: String(body.updates.phone ?? ""),
              note: String(body.updates.note ?? ""),
            }
          : undefined,
        assertAuthorizationCurrent: session.assertAuthorizationCurrent,
      });
      return privateJson({
        ok: true,
        booking: redactMerchantBookingForBusinessActor(
          booking,
          session.actor,
        ),
      });
    }

    if (request.headers.has("x-merchant-access-token")) {
      return privateJson(
        { error: "business_scope_required" },
        { status: 403 },
      );
    }

    const action = body?.action === "cancel" ? "cancel" : "update";
    const booking = await updateMerchantBooking({
      bookingId: String(body?.bookingId ?? "").trim(),
      editToken: String(body?.editToken ?? "").trim(),
      bookingBlockId: String(body?.bookingBlockId ?? "").trim() || undefined,
      bookingViewport: normalizeBookingViewport(body?.bookingViewport),
      action,
      updates:
        action === "update"
          ? {
              store: String(body?.updates?.store ?? ""),
              item: String(body?.updates?.item ?? ""),
              appointmentAt: String(body?.updates?.appointmentAt ?? ""),
              title: String(body?.updates?.title ?? ""),
              customerName: String(body?.updates?.customerName ?? ""),
              email: String(body?.updates?.email ?? ""),
              phone: String(body?.updates?.phone ?? ""),
              note: String(body?.updates?.note ?? ""),
            }
          : undefined,
    });
    return privateJson({ ok: true, booking });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) {
      return privateJson({ error: error.code }, { status: error.status });
    }
    return privateJson(
      {
        error: "booking_update_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
