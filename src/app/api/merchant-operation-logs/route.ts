import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  buildMerchantOperationLogsCsv,
  normalizeMerchantOperationLogEntry,
  shouldKeepMerchantOperationLog,
  type MerchantOperationLogStatus,
} from "@/lib/merchantOperationLogs";
import {
  appendStoredMerchantOperationLog,
  loadStoredMerchantOperationLogs,
  parseMerchantOperationLogBoundary,
  queryMerchantOperationLogs,
  type MerchantOperationLogsStoreClient,
} from "@/lib/merchantOperationLogsStore";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeOffset(value: unknown) {
  const numberValue = Number(trimText(value, 32));
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
}

function normalizeLimit(value: unknown) {
  const numberValue = Number(trimText(value, 32));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 100;
  return Math.min(500, Math.max(1, Math.floor(numberValue)));
}

function requireStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) throw new Error("merchant_operation_logs_store_unavailable");
  return supabase as unknown as MerchantOperationLogsStoreClient;
}

async function requireMerchant(siteId: string, request: Request) {
  const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
  return Boolean(session && session.merchantId === siteId);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = trimText(url.searchParams.get("siteId"), 64);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    if (!(await requireMerchant(siteId, request))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const startDate = trimText(url.searchParams.get("startDate"), 32);
    const endDate = trimText(url.searchParams.get("endDate"), 32);
    const startAt = trimText(url.searchParams.get("startAt"), 32);
    const endAt = trimText(url.searchParams.get("endAt"), 32);
    const resolvedStartAt = parseMerchantOperationLogBoundary(startAt || startDate, "start");
    const resolvedEndAt = parseMerchantOperationLogBoundary(endAt || endDate, "end");
    if ((startAt || startDate) && resolvedStartAt === null) {
      return NextResponse.json({ error: "invalid_start_date" }, { status: 400 });
    }
    if ((endAt || endDate) && resolvedEndAt === null) {
      return NextResponse.json({ error: "invalid_end_date" }, { status: 400 });
    }
    if (resolvedStartAt !== null && resolvedEndAt !== null && resolvedStartAt > resolvedEndAt) {
      return NextResponse.json({ error: "invalid_date_range" }, { status: 400 });
    }
    const query = {
      module: trimText(url.searchParams.get("module"), 80),
      status: trimText(url.searchParams.get("status"), 16) as "all" | MerchantOperationLogStatus,
      startDate,
      endDate,
      startAt,
      endAt,
      offset: normalizeOffset(url.searchParams.get("offset")),
      limit: normalizeLimit(url.searchParams.get("limit")),
    };
    const store = requireStoreClient();
    const logs = await loadStoredMerchantOperationLogs(store, siteId);
    const result = queryMerchantOperationLogs(logs, query);
    if (trimText(url.searchParams.get("export"), 16) === "csv") {
      const exportResult = queryMerchantOperationLogs(logs, { ...query, offset: 0, limit: Math.max(logs.length, 1) });
      return new Response(buildMerchantOperationLogsCsv(exportResult.logs), {
        headers: {
          "content-type": "text/csv;charset=utf-8",
          "content-disposition": `attachment; filename="merchant-operation-logs-${siteId}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_operation_logs_load_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = await request.json().catch(() => null);
    const entry = normalizeMerchantOperationLogEntry(body);
    if (!entry || !isMerchantNumericId(entry.siteId) || !shouldKeepMerchantOperationLog(entry)) {
      return NextResponse.json({ error: "invalid_operation_log" }, { status: 400 });
    }
    if (!(await requireMerchant(entry.siteId, request))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const store = requireStoreClient();
    const saved = await appendStoredMerchantOperationLog(store, entry);
    if (saved.error) {
      return NextResponse.json({ error: "merchant_operation_log_save_failed", message: saved.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_operation_log_save_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
