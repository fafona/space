import { NextResponse } from "next/server";
import {
  buildMerchantOrderWorkbenchDashboard,
  normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes,
} from "@/lib/merchantOrderWorkbench";
import { getMerchantOrderErrorMessage } from "@/lib/merchantOrders";
import { listMerchantOrders } from "@/lib/merchantOrders.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import {
  authorizeMerchantBusinessRequest,
  MerchantBusinessAccessError,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import { redactMerchantOrderWorkbenchForBusinessActor } from "@/lib/merchantBusinessOrderPermissions";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type MerchantOrderWorkbenchRouteDependencies = {
  resolveSession: (
    request: Request,
    siteId: string,
  ) => Promise<{ merchantId: string; actor?: MerchantBusinessActor } | null>;
  loadSnapshotSite: typeof loadCurrentMerchantSnapshotSiteBySiteId;
  listOrders: typeof listMerchantOrders;
};

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

async function resolveOrderWorkbenchSession(request: Request, siteId: string) {
  const actor = await authorizeMerchantBusinessRequest(request, {
    siteId,
    requiredPermission: "orders.analytics.view",
  });
  return { merchantId: actor.siteId, actor };
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
  const siteId = readUniqueMerchantBusinessSiteId(request.url);
  if (!siteId) {
    return noStoreJson({ error: "invalid_site_id" }, { status: 400 });
  }

  try {
    const session = await dependencies.resolveSession(request, siteId);
    if (!session) {
      return noStoreJson({ error: "unauthorized" }, { status: 401 });
    }
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
    return noStoreJson({
      ok: true,
      dashboard: session.actor
        ? redactMerchantOrderWorkbenchForBusinessActor(
            dashboard,
            session.actor,
          )
        : dashboard,
    });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) {
      return noStoreJson({ error: error.code }, { status: error.status });
    }
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
