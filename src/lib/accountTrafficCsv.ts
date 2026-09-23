import type { AccountTrafficReport, TrafficCountRow } from "@/lib/accountTraffic";

/** Quote every cell and neutralize spreadsheet formulas in public object labels. */
export function trafficCsvCell(value: unknown): string {
  let text = String(value ?? "").replace(/\u0000/g, "");
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
export function buildTrafficCsv(report: AccountTrafficReport, scope: { siteId: string; days: number; offset: number; module: string | null; objectId: string | null }) {
  const rows: unknown[][] = [
    ["Faolla 账号访问分析", report.exportScope === "all" ? "筛选范围汇总＋全部匹配对象明细" : "筛选范围汇总＋当前页对象（不是全部对象明细）"],
    ["账号", scope.siteId], ["时区", report.timezone], ["自然日数", scope.days],
    ["范围开始", report.from], ["查询时间", report.to], ["模块", scope.module || "全部已接入模块"],
    ["对象 ID", scope.objectId || "全部"], ["对象偏移", scope.offset],
    ["匹配对象总数", report.objectCount], ["本文件对象行数", report.objects.length],
    ["浏览", report.views], ["曝光", report.exposures], ["操作", report.actions],
    ["口径", "浏览不是独立人数；尝试不等于成功。渠道表示链接标签，不证明实际扫码或分享。"],
    [], ["分组", "模块", "ID/类别", "公开名称", "次数", "浏览", "曝光", "操作", "服务端确认成功"],
  ];
  const section = (name: string, items: TrafficCountRow[]) => {
    for (const item of items) rows.push([name, item.module || "", item.key, item.label || "", item.count,
      item.views ?? "", item.exposures ?? "", item.actions ?? "", item.successes ?? ""]);
  };
  section("模块", report.modules); section("按日趋势", report.daily); section(report.exportScope === "all" ? "全部匹配对象" : "当前页对象", report.objects);
  section("活动渠道", report.campaigns || []); section("服务端确认成功", report.outcomes || []);
  section("来路（浏览＋曝光）", report.sources); section("链接渠道（浏览＋曝光）", report.media || []);
  section("浏览器（浏览＋曝光）", report.browsers); section("设备（浏览＋曝光）", report.devices);
  section("动作", report.actionTypes);
  return "\uFEFF" + rows.map((row) => row.map(trafficCsvCell).join(",")).join("\r\n") + "\r\n";
}
