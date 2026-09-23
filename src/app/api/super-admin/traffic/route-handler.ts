import { NextResponse } from "next/server";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { trafficEnabled } from "@/lib/accountTraffic.server";
import { TRAFFIC_ACTIONS } from "@/lib/accountTraffic";
import { buildTrafficCsv } from "@/lib/accountTrafficCsv";
const defaults = { authorize: isSuperAdminRequestAuthorized, client: createServerSupabaseServiceClient, enabled: trafficEnabled };
export async function handleTrafficReport(request: Request, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", "Vary": "Cookie" } });
  if (!await deps.authorize(request)) return json({ error: "unauthorized" }, 401);
  const params = new URL(request.url).searchParams;
  const siteId = params.get("siteId") ?? "";
  const days = Number(params.get("days") ?? 30);
  const offset = Number(params.get("offset") ?? 0);
  const moduleFilter = params.get("module") || null;
  const objectId = params.get("objectId") || null;
  const format = params.get("format") || "json";
  if (format !== "json" && format !== "csv" && format !== "csv-all") return json({ error: "invalid_format" }, 400);
  if (!isMerchantNumericId(siteId) || !Number.isInteger(days) || days < 1 || days > 730 || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
    return json({ error: "invalid_scope" }, 400);
  }
  if ((moduleFilter && !Object.hasOwn(TRAFFIC_ACTIONS, moduleFilter)) || (objectId && (!moduleFilter || objectId.length > 240))) return json({ error: "invalid_object_scope" }, 400);
  try {
    const client = deps.client();
    if (!client) return json({ error: "traffic_unavailable" }, 503);
    const full = format === "csv-all";
    const { data, error } = await client.rpc(full ? "faolla_account_traffic_report_full" : "faolla_account_traffic_report", { p_site_id: siteId, p_days: days, ...(!full ? { p_offset: offset } : {}), p_module: moduleFilter, p_object_id: objectId }).abortSignal(AbortSignal.timeout(full ? 25000 : 8000));
    if (error || !data) return json({ error: "traffic_schema_unavailable", message: "访问分析尚未初始化，或统计服务暂不可用。" }, 503);
    if (full && (data.exportScope !== "all" || data.objects?.length !== data.objectCount)) return json({ error: "incomplete_export", message: "完整导出校验失败，未生成截断文件。" }, 503);
    if (format === "csv" || full) return new NextResponse(buildTrafficCsv(data, { siteId, days, offset: full ? 0 : offset, module: moduleFilter, objectId }), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="faolla-traffic-${siteId}-${days}d-${full ? "all" : `page${Math.floor(offset / 50) + 1}`}.csv"`,
        "Cache-Control": "no-store, private", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" },
    });
    return json({ report: data, enabled: deps.enabled(), siteId });
  } catch { return json({ error: "traffic_unavailable", message: "统计服务暂不可用，请稍后重试。" }, 503); }
}
