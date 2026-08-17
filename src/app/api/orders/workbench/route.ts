import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  buildMerchantOrderWorkbenchDashboard,
  normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes,
} from "@/lib/merchantOrderWorkbench";
import { getMerchantOrderErrorMessage } from "@/lib/merchantOrders";
import { listMerchantOrders } from "@/lib/merchantOrders.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type MerchantOrderWorkbenchRouteDependencies = {
  resolveSession: (request: Request, siteId: string) => Promise<{ merchantId: string } | null>;
  loadSnapshotSite: typeof loadCurrentMerchantSnapshotSiteBySiteId;
  listOrders: typeof listMerchantOrders;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function resolveOrderWorkbenchSession(request: Request, siteId: string) {
  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: siteId,
  });
  if (!session || session.merchantId !== siteId) return null;
  return session;
}

const DEFAULT_DEPENDENCIES: MerchantOrderWorkbenchRouteDependencies = {
  resolveSession: resolveOrderWorkbenchSession,
  loadSnapshotSite: loadCurrentMerchantSnapshotSiteBySiteId,
  listOrders: listMerchantOrders,
};

export async function handleMerchantOrderWorkbenchGet(
  request: Request,
  dependencyOverrides: Partial<MerchantOrderWorkbenchRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const { searchParams } = new URL(request.url);
  const siteId = trimText(searchParams.get("siteId"));
  if (!isMerchantNumericId(siteId)) {
    return noStoreJson({ error: "invalid_site_id" }, { status: 400 });
  }

  const session = await dependencies.resolveSession(request, siteId);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const site = await dependencies.loadSnapshotSite(siteId);
    if (!site?.permissionConfig?.allowProductBlock || !site.permissionConfig.allowOrderManagement) {
      return noStoreJson({ error: "order_management_disabled" }, { status: 403 });
    }
    // listMerchantOrders deliberately reads the full merchant order set. The
    // workbench must not derive operational counts from a paginated UI window.
    const orders = await dependencies.listOrders(siteId);
    const dashboard = buildMerchantOrderWorkbenchDashboard(orders, {
      now: new Date(),
      timezoneOffsetMinutes: normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes(
        searchParams.get("timezoneOffsetMinutes"),
      ),
    });
    return noStoreJson({ ok: true, dashboard });
  } catch (error) {
    return noStoreJson(
      {
        error: "order_workbench_failed",
        message: getMerchantOrderErrorMessage(error),
      },
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  return handleMerchantOrderWorkbenchGet(request);
}
