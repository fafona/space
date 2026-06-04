import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  normalizeMerchantOperationLogEntry,
  shouldKeepMerchantOperationLog,
  type MerchantOperationLogEntry,
  type MerchantOperationLogStatus,
} from "@/lib/merchantOperationLogs";
import {
  loadStoredMerchantOperationLogs,
  queryMerchantOperationLogs,
  saveStoredMerchantOperationLogs,
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

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function buildLogsCsv(logs: MerchantOperationLogEntry[]) {
  const rows = [
    ["时间", "状态", "菜单", "操作", "说明", "详情", "方法", "接口"],
    ...logs.map((item) => [
      item.at,
      item.status === "success" ? "成功" : "失败",
      item.module,
      item.action,
      item.summary,
      item.detail ?? "",
      item.method ?? "",
      item.endpoint ?? "",
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
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
    const store = requireStoreClient();
    const logs = await loadStoredMerchantOperationLogs(store, siteId);
    const query = {
      module: trimText(url.searchParams.get("module"), 80),
      status: trimText(url.searchParams.get("status"), 16) as "all" | MerchantOperationLogStatus,
      startDate: trimText(url.searchParams.get("startDate"), 32),
      endDate: trimText(url.searchParams.get("endDate"), 32),
      offset: normalizeOffset(url.searchParams.get("offset")),
      limit: normalizeLimit(url.searchParams.get("limit")),
    };
    const result = queryMerchantOperationLogs(logs, query);
    if (trimText(url.searchParams.get("export"), 16) === "csv") {
      const exportResult = queryMerchantOperationLogs(logs, { ...query, offset: 0, limit: Math.max(logs.length, 1) });
      return new Response(buildLogsCsv(exportResult.logs), {
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
    const current = await loadStoredMerchantOperationLogs(store, entry.siteId);
    const saved = await saveStoredMerchantOperationLogs(store, {
      siteId: entry.siteId,
      logs: [entry, ...current],
      updatedAt: entry.at,
    });
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
