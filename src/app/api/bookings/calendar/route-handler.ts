import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  authorizeMerchantBusinessRequest,
  MerchantBusinessAccessError,
  reauthorizeMerchantBusinessMutation,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import { buildMerchantBookingsCalendarIcs } from "@/lib/merchantBookingCalendar";
import { loadMerchantBookingWorkbenchSettings } from "@/lib/merchantBookingWorkbenchStore";
import { redactMerchantBookingsForBusinessActor } from "@/lib/merchantBusinessBookingPermissions";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";
import { listMerchantBookings } from "@/lib/merchantBookings.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MerchantBookingCalendarRouteDependencies = {
  loadSettings: typeof loadMerchantBookingWorkbenchSettings;
  authorizeActor: typeof authorizeMerchantBusinessRequest;
  reauthorizeActor: typeof reauthorizeMerchantBusinessMutation;
  listBookings: typeof listMerchantBookings;
  loadSnapshotSite: typeof loadCurrentMerchantSnapshotSiteBySiteId;
  buildCalendar: typeof buildMerchantBookingsCalendarIcs;
};

const DEFAULT_DEPENDENCIES: MerchantBookingCalendarRouteDependencies = {
  loadSettings: loadMerchantBookingWorkbenchSettings,
  authorizeActor: authorizeMerchantBusinessRequest,
  reauthorizeActor: reauthorizeMerchantBusinessMutation,
  listBookings: listMerchantBookings,
  loadSnapshotSite: loadCurrentMerchantSnapshotSiteBySiteId,
  buildCalendar: buildMerchantBookingsCalendarIcs,
};

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

function tokenMatches(candidate: string, expected: string) {
  if (!candidate || !expected) return false;
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}

function authorizationErrorResponse(error: unknown) {
  if (error instanceof MerchantBusinessAccessError) {
    return privateJson({ error: error.code }, { status: error.status });
  }
  return privateJson({ error: "booking_calendar_failed" }, { status: 503 });
}

export async function handleMerchantBookingCalendarGet(
  request: Request,
  dependencyOverrides: Partial<MerchantBookingCalendarRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const { searchParams } = new URL(request.url);
  const siteId = readUniqueMerchantBusinessSiteId(request.url);
  const token = trimText(searchParams.get("token"));
  const download = searchParams.get("download") === "1";

  if (!siteId) {
    return privateJson({ error: "invalid_site_id" }, { status: 400 });
  }

  try {
    const settings = await dependencies.loadSettings(siteId);
    const tokenAuthorized = tokenMatches(token, settings.calendarSyncToken);

    let actor: MerchantBusinessActor | null = null;
    if (!tokenAuthorized) {
      actor = await dependencies.authorizeActor(request, {
        siteId,
        requiredPermission: "bookings.export",
      });
      const requiredPermissions = actor.businessPermissions.includes(
        "bookings.customer_data.view",
      )
        ? (["bookings.export", "bookings.customer_data.view"] as const)
        : (["bookings.export"] as const);
      await dependencies.reauthorizeActor(request, {
        actor,
        requiredPermissions,
      });
    }

    const bookings = await dependencies.listBookings(siteId);
    const visibleBookings = actor
      ? redactMerchantBookingsForBusinessActor(bookings, actor)
      : bookings;
    const snapshotSite = await dependencies.loadSnapshotSite(siteId).catch(
      () => null,
    );
    const siteName =
      trimText(snapshotSite?.merchantName) ||
      trimText(snapshotSite?.name) ||
      siteId;
    const ics = dependencies.buildCalendar({
      siteId,
      siteName,
      bookings: visibleBookings,
    });

    const response = applyPrivateResponseHeaders(
      new NextResponse(ics, {
        status: 200,
        headers: {
          "content-type": "text/calendar; charset=utf-8",
        },
      }),
    );
    if (download) {
      response.headers.set(
        "content-disposition",
        `attachment; filename="bookings-${siteId}.ics"`,
      );
    }
    return response;
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantBookingCalendarGet(request);
}
