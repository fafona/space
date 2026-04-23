import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { buildMerchantBookingPushNotification } from "@/lib/merchantPushEvents";
import {
  acknowledgeMerchantBookingBySite,
  createMerchantBooking,
  listMerchantBookings,
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
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import { verifyFrontendAuthProof } from "@/lib/frontendAuthProof.server";
import { buildPersonalMerchantContactMap } from "@/lib/personalMerchantContacts.server";
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

async function resolveBookingAdminSession(request: Request, siteId: string) {
  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: siteId,
  });
  if (!session || session.merchantId !== siteId) return null;
  return session;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("scope")?.trim() === "personal") {
      const session = await resolvePersonalAccountSessionFromRequest(request);
      if (!session) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
      return NextResponse.json({ ok: true, bookings, merchantContacts });
    }

    const siteId = searchParams.get("siteId")?.trim() ?? "";
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    const session = await resolveBookingAdminSession(request, siteId);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const bookings = await listMerchantBookings(siteId, {
      includeAutomationState: true,
      includeCustomerEmailLogs: true,
      includeTimeline: true,
    });
    return NextResponse.json({ ok: true, bookings });
  } catch (error) {
    return NextResponse.json(
      {
        error: "booking_list_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<MerchantBookingCreateInput> & { frontendAuthProof?: unknown };
    const siteId = String(body.siteId ?? "").trim();
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
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
    const merchantCustomerSession = personalSession
      ? null
      : await resolveMerchantSessionFromRequest(request).catch(() => null);
    const fallbackCustomerEmail = personalProfile?.email || personalProof?.email || merchantCustomerSession?.merchantEmail || "";
    const fallbackCustomerName =
      personalProfile?.name ||
      merchantCustomerSession?.merchantName ||
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
      customerAccountId: personalSession?.accountId ?? personalProof?.accountId ?? merchantCustomerSession?.merchantId ?? "",
      customerUserId: personalSession?.userId ?? personalProof?.userId ?? "",
      customerLoginEmail: personalSession?.email ?? personalProof?.email ?? merchantCustomerSession?.merchantEmail ?? "",
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

    return NextResponse.json({ ok: true, ...created });
  } catch (error) {
    return NextResponse.json(
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
    return getTrustedMutationRequestErrorResponse();
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
      const session = await resolvePersonalAccountSessionFromRequest(request);
      if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      const booking = await updatePersonalMerchantBooking({
        bookingId: String(body?.bookingId ?? "").trim(),
        action: body.action,
        accountId: session.accountId,
        userId: session.userId,
        email: session.email,
        updates: body.updates,
      });
      return NextResponse.json({ ok: true, booking });
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
      const session = await resolveBookingAdminSession(request, maybeSiteId);
      if (!session) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      if (body?.sendCustomerEmail === true) {
        const booking = await sendMerchantBookingManualEmailBySite({
          siteId: maybeSiteId,
          bookingId: String(body?.bookingId ?? "").trim(),
        });
        return NextResponse.json({ ok: true, booking });
      }
      if (body?.markTouched === true) {
        const booking = await acknowledgeMerchantBookingBySite({
          siteId: maybeSiteId,
          bookingId: String(body?.bookingId ?? "").trim(),
        });
        return NextResponse.json({ ok: true, booking });
      }
      if (Array.isArray(body?.bookingIds) && maybeStatus) {
        const bookings = await updateMerchantBookingsBatchBySite({
          siteId: maybeSiteId,
          bookingIds: body.bookingIds.map((item) => String(item ?? "").trim()),
          status: maybeStatus,
        });
        return NextResponse.json({ ok: true, bookings });
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
      });
      return NextResponse.json({ ok: true, booking });
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
    return NextResponse.json({ ok: true, booking });
  } catch (error) {
    return NextResponse.json(
      {
        error: "booking_update_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
