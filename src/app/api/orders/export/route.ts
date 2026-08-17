import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  MerchantOrderExportError,
  buildMerchantOrdersCsvExport,
  normalizeMerchantOrderExportInput,
  type MerchantOrderCsvExport,
  type MerchantOrderExportInput,
} from "@/lib/merchantOrderExport";
import { listMerchantOrders } from "@/lib/merchantOrders.server";
import {
  appendStoredMerchantOperationLog,
  type MerchantOperationLogsStoreClient,
} from "@/lib/merchantOperationLogsStore";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type MerchantOrderExportAuditMetadata = {
  siteId: string;
  createdFrom: string;
  createdToExclusive: string;
  statuses: string[];
  includeCustomerData: boolean;
  orderCount: number;
  byteLength: number;
};

export type MerchantOrderExportRouteDependencies = {
  resolveSession: (request: Request, siteId: string) => Promise<{ merchantId: string } | null>;
  isManagementEnabled: (siteId: string) => Promise<boolean>;
  listOrders: typeof listMerchantOrders;
  buildExport: (
    orders: Awaited<ReturnType<typeof listMerchantOrders>>,
    input: MerchantOrderExportInput,
  ) => MerchantOrderCsvExport;
  recordAudit: (metadata: MerchantOrderExportAuditMetadata) => Promise<void>;
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

async function resolveOrderExportSession(request: Request, siteId: string) {
  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: siteId,
  });
  if (!session || session.merchantId !== siteId) return null;
  return session;
}

async function isOrderExportManagementEnabled(siteId: string) {
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId);
  return Boolean(site?.permissionConfig?.allowProductBlock && site.permissionConfig.allowOrderManagement);
}

async function recordOrderExportAudit(metadata: MerchantOrderExportAuditMetadata) {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return;
  const at = new Date().toISOString();
  const result = await appendStoredMerchantOperationLog(
    supabase as unknown as MerchantOperationLogsStoreClient,
    {
      id: `order-export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      siteId: metadata.siteId,
      at,
      module: "orders",
      action: "export_csv",
      summary: `Generated order summary CSV (${metadata.orderCount} orders)`,
      status: "success",
      method: "POST",
      endpoint: "/api/orders/export",
      detail: [
        `from=${metadata.createdFrom}`,
        `toExclusive=${metadata.createdToExclusive}`,
        `statuses=${metadata.statuses.join("|")}`,
        `includeCustomerData=${metadata.includeCustomerData}`,
        `orders=${metadata.orderCount}`,
        `bytes=${metadata.byteLength}`,
      ].join(";"),
    },
  );
  if (result.error) throw new Error(result.error);
}

const DEFAULT_DEPENDENCIES: MerchantOrderExportRouteDependencies = {
  resolveSession: resolveOrderExportSession,
  isManagementEnabled: isOrderExportManagementEnabled,
  listOrders: listMerchantOrders,
  buildExport: buildMerchantOrdersCsvExport,
  recordAudit: recordOrderExportAudit,
};

function buildExportFileName(siteId: string, exportResult: MerchantOrderCsvExport) {
  const fromDate = exportResult.input.createdFrom.slice(0, 10).replaceAll("-", "");
  const toDate = exportResult.input.createdToExclusive.slice(0, 10).replaceAll("-", "");
  return `orders-${siteId}-${fromDate}-${toDate}.csv`;
}

function getExportErrorStatus(error: MerchantOrderExportError) {
  if (
    error.code === "order_export_order_limit_exceeded" ||
    error.code === "order_export_size_limit_exceeded"
  ) {
    return 413;
  }
  return 400;
}

export async function handleMerchantOrderExportPost(
  request: Request,
  dependencyOverrides: Partial<MerchantOrderExportRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  if (!isTrustedSameOriginMutationRequest(request)) {
    return applyPrivateResponseHeaders(getTrustedMutationRequestErrorResponse());
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return privateJson({ error: "invalid_order_export_request" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return privateJson({ error: "invalid_order_export_request" }, { status: 400 });
  }

  const siteId = trimText(body.siteId);
  if (!isMerchantNumericId(siteId)) {
    return privateJson({ error: "invalid_site_id" }, { status: 400 });
  }
  try {
    const session = await dependencies.resolveSession(request, siteId);
    if (!session || session.merchantId !== siteId) {
      return privateJson({ error: "unauthorized" }, { status: 401 });
    }
    if (!(await dependencies.isManagementEnabled(siteId))) {
      return privateJson({ error: "order_management_disabled" }, { status: 403 });
    }
  } catch {
    return privateJson({ error: "order_export_failed" }, { status: 503 });
  }

  const rawInput: MerchantOrderExportInput = {
    createdFrom: body.createdFrom,
    createdToExclusive: body.createdToExclusive,
    statuses: body.statuses,
    includeCustomerData: body.includeCustomerData,
  };

  try {
    // Validate before the canonical full-set read. The later build repeats this
    // pure validation so direct callers cannot bypass the export contract.
    const normalizedInput = normalizeMerchantOrderExportInput(rawInput);
    const orders = await dependencies.listOrders(siteId);
    const exportResult = dependencies.buildExport(orders, {
      createdFrom: normalizedInput.createdFrom,
      createdToExclusive: normalizedInput.createdToExclusive,
      statuses: normalizedInput.statuses,
      includeCustomerData: normalizedInput.includeCustomerData,
    });

    await dependencies
      .recordAudit({
        siteId,
        createdFrom: exportResult.input.createdFrom,
        createdToExclusive: exportResult.input.createdToExclusive,
        statuses: exportResult.input.statuses,
        includeCustomerData: exportResult.input.includeCustomerData,
        orderCount: exportResult.orderCount,
        byteLength: exportResult.byteLength,
      })
      .catch(() => undefined);

    return applyPrivateResponseHeaders(
      new Response(exportResult.csv, {
        status: 200,
        headers: {
          "content-type": "text/csv;charset=utf-8",
          "content-disposition": `attachment; filename="${buildExportFileName(siteId, exportResult)}"`,
          "content-length": String(exportResult.byteLength),
        },
      }),
    );
  } catch (error) {
    if (error instanceof MerchantOrderExportError) {
      return privateJson({ error: error.code }, { status: getExportErrorStatus(error) });
    }
    return privateJson({ error: "order_export_failed" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  return handleMerchantOrderExportPost(request);
}
