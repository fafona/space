"use client";
import { useEffect, useState } from "react";
import type { AccountTrafficReport, TrafficCountRow } from "@/lib/accountTraffic";
import TrafficChannelLinkBuilder from "./TrafficChannelLinkBuilder";

const labels: Record<string, string> = {
  website: "网站", product: "产品", booking: "预约", card: "名片", coupon: "优惠券", poll: "投票", membership: "会员", order: "订单",
  booking_created: "预约已创建", order_created: "订单已创建（不代表付款）", membership_joined: "会员已加入", poll_submitted: "投票已提交",
  direct_unknown: "直接访问／来源未知", internal: "站内来源", google: "Google 来源", bing: "Bing 来源", baidu: "百度来源",
  facebook: "Facebook 来源", instagram: "Instagram 来源", other_referral: "其他外部来源",
  wechat: "微信内置浏览器", facebook_app: "Facebook 内置浏览器", instagram_app: "Instagram 内置浏览器",
  edge: "Edge", chrome: "Chrome", firefox: "Firefox", safari: "Safari", other: "其他浏览器",
  mobile: "手机", tablet: "平板", desktop: "电脑",
  view: "页面／详情浏览", exposure: "模块曝光", add_to_cart: "加入购物车操作", form_start: "开始填写表单",
  submit_attempt: "尝试提交表单", website_click: "进入官网点击", contact_download_click: "保存通讯录点击",
  claim_attempt: "尝试领取优惠券", copy_attempt: "尝试复制优惠码", entry_click: "会员入口点击", join_attempt: "尝试加入会员",
  phone_click: "电话点击", email_click: "邮箱点击", whatsapp_click: "WhatsApp 点击",
  unknown: "未标记／未知", qr: "二维码渠道链接", share: "分享渠道链接", nfc: "NFC 渠道链接", ad: "广告渠道链接",
};
function Counts({ title, rows, columns = false, onSelect }: { title: string; rows: TrafficCountRow[]; columns?: boolean; onSelect?: (row: TrafficCountRow) => void }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-3">
    <h4 className="mb-2 font-semibold">{title}</h4>
    {!rows.length ? <p className="text-slate-500">此范围暂无已采集记录</p> : <div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs">
      <thead><tr className="border-b text-slate-500"><th className="py-2">项目</th>{columns ? <><th>浏览</th><th>曝光</th><th>操作</th><th>已确认</th></> : <th>次数</th>}</tr></thead>
      <tbody>{rows.map((row) => <tr className="border-b last:border-0" key={`${row.module ?? ""}:${row.key}`}>
        <td className="max-w-72 break-words py-2 pr-3">{onSelect ? <button type="button" className="text-left text-blue-700 underline underline-offset-2" onClick={() => onSelect(row)}>{row.label || labels[row.key] || row.key} · 查看明细</button> : row.label || labels[row.key] || row.key}{row.module && <div className="text-[10px] text-slate-500">{labels[row.module]} · {row.key}</div>}</td>
        {columns ? <><td>{row.views ?? 0}</td><td>{row.exposures ?? 0}</td><td>{row.actions ?? 0}</td><td>{row.successes ?? 0}</td></> : <td>{row.count}</td>}
      </tr>)}</tbody></table></div>}
  </section>;
}
export default function AccountTrafficPanel({ siteId }: { siteId: string }) {
  const [days, setDays] = useState(30);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ key: string; text: string } | null>(null);
  const [module, setModule] = useState("");
  const [object, setObject] = useState<{ id: string; label: string } | null>(null);
  const [result, setResult] = useState<{ key: string; report?: AccountTrafficReport; enabled?: boolean; error?: string } | null>(null);
  const key = `${siteId}:${days}:${offset}:${refresh}:${module}:${object?.id ?? ""}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => { controller.abort(); if (!disposed) setResult({ key, error: "读取统计超时，请点击刷新重试。" }); }, 12000);
    void (async () => {
      try {
        const response = await fetch(`/api/super-admin/traffic?siteId=${encodeURIComponent(siteId)}&days=${days}&offset=${offset}&module=${encodeURIComponent(module)}&objectId=${encodeURIComponent(object?.id ?? "")}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(response.status === 401 ? "请重新验证超级后台登录。" : body.message || "统计暂不可用。");
        if (!disposed) setResult({ key, report: body.report, enabled: body.enabled });
      } catch (error) { if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "统计暂不可用。" }); }
      finally { clearTimeout(timeout); }
    })();
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [siteId, days, offset, key, module, object?.id]);
  const report = current?.report;
  const exportCsv = async () => {
    if (exporting || !report) return;
    setExporting(true); setExportStatus(null);
    try {
      const params = new URLSearchParams({ siteId, days: String(days), module, objectId: object?.id || "", format: "csv-all" });
      const response = await fetch(`/api/super-admin/traffic?${params}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(response.status === 401 ? "请重新验证超级后台登录。" : "导出失败，请稍后重试。");
      if (!response.headers.get("content-type")?.startsWith("text/csv")) throw new Error("导出响应异常，未生成文件。");
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = blobUrl;
      anchor.download = `faolla-traffic-${siteId}-${days}d-all.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setExportStatus({ key, text: "已生成筛选范围汇总及全部匹配对象，文件内已注明范围和对象行数。" });
    } catch (error) { setExportStatus({ key, text: error instanceof Error ? error.message : "导出失败。" }); }
    finally { setExporting(false); }
  };
  return <div className="mt-3 rounded-xl border border-blue-200 bg-slate-50 p-4 text-sm" aria-label="账号访问分析">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">账号访问分析 · {siteId}</h3>
      <div className="flex items-center gap-2"><select aria-label="统计时间范围" className="rounded border bg-white p-2" value={days} onChange={(event) => { setDays(Number(event.target.value)); setOffset(0); }}>
        <option value={1}>今天</option><option value={7}>近 7 个自然日</option><option value={30}>近 30 个自然日</option><option value={90}>近 90 个自然日</option><option value={365}>近 365 个自然日</option><option value={730}>近 730 个自然日</option>
      </select><button type="button" className="rounded border bg-white px-3 py-2" onClick={() => setRefresh((value) => value + 1)}>刷新统计</button></div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><select aria-label="访问模块" className="rounded border bg-white p-2" value={module} onChange={(event) => { setModule(event.target.value); setObject(null); setOffset(0); }}>
      <option value="">全部已接入模块</option><option value="website">网站</option><option value="product">产品</option><option value="booking">预约</option><option value="card">名片</option><option value="coupon">优惠券</option><option value="poll">投票</option><option value="membership">会员</option>
      <option value="order">订单</option>
    </select>{object && <><span className="rounded bg-blue-50 px-3 py-2 text-blue-800">当前内容：{object.label}</span><button type="button" className="rounded border bg-white p-2" onClick={() => { setObject(null); setOffset(0); }}>返回模块汇总</button></>}</div>
    <p className="my-3 text-xs text-slate-500">时区 Europe/Madrid。仅统计新采集记录；旧月访量不混入。浏览、模块曝光和操作分别统计，不代表独立人数。点击不等于预约成功、接通电话或保存联系人。</p>
    <div className="mb-3 flex flex-wrap items-center gap-2"><button type="button" disabled={!report || exporting} className="rounded border bg-white px-3 py-2 disabled:opacity-40" onClick={() => void exportCsv()}>{exporting ? "正在导出…" : "导出完整 CSV"}</button><span className="text-xs text-slate-500">包含当前筛选的全部对象，不受界面分页限制；超时不会生成截断文件。</span></div>
    {exportStatus?.key === key && <p role="status" className="mb-3 text-xs">{exportStatus.text}</p>}
    {!current && <p role="status">正在读取统计…</p>}
    {current?.error && <p role="alert" className="text-amber-800">{current.error}</p>}
    {report && <>
      {!current.enabled && <p className="mb-3 rounded bg-amber-50 p-2 text-amber-900">新采集尚未启用；展示的是已有记录（如有）。</p>}
      <p className="mb-3 text-xs text-slate-500">最早保留记录：{report.firstCollectedAt ? new Date(report.firstCollectedAt).toLocaleString("zh-CN", { timeZone: "Europe/Madrid" }) : "尚无记录"}。独立访客、会话和访问时长：暂未采集。</p>
      <div className="mb-3 grid grid-cols-3 gap-3">{[["页面／详情浏览", report.views], ["模块曝光", report.exposures], ["操作次数", report.actions]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>)}</div>
      <div className="grid gap-3 lg:grid-cols-2"><Counts title="模块明细" rows={report.modules} columns/><Counts title="按日趋势" rows={report.daily} columns/></div>
      <div className="mt-3"><Counts title="已访问内容／每张名片（点击查看其来源与操作）" rows={report.objects} columns onSelect={(row) => { setModule(row.module ?? ""); setObject({ id: row.key, label: row.label || row.key }); setOffset(0); }}/></div>
      <div className="my-3 flex items-center justify-end gap-3 text-xs"><span>共 {report.objectCount} 项 · 第 {Math.floor(offset / 50) + 1} 页</span><button type="button" disabled={offset === 0} className="rounded border bg-white p-2 disabled:opacity-40" onClick={() => setOffset((value) => value - 50)}>上一页</button><button type="button" disabled={offset + 50 >= report.objectCount} className="rounded border bg-white p-2 disabled:opacity-40" onClick={() => setOffset((value) => value + 50)}>下一页</button></div>
      <div className="grid gap-3 lg:grid-cols-2"><Counts title="访问来源（浏览＋曝光，依据 referrer）" rows={report.sources}/><Counts title="操作类型" rows={report.actionTypes}/><Counts title="浏览器／应用环境（浏览＋曝光）" rows={report.browsers}/><Counts title="设备类型（浏览＋曝光，估计）" rows={report.devices}/></div>
      <div className="mt-3"><Counts title="链接渠道（浏览＋曝光，依据链接标签）" rows={report.media || []}/></div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2"><Counts title="服务端确认结果" rows={report.outcomes || []}/><Counts title="活动／投放位置" rows={report.campaigns || []} columns/></div>
      <p className="mt-2 text-xs text-slate-500">已确认结果按业务记录去重，只记录新建结果，不代表付款、履约或扣除后来取消的净转化；与浏览不是同一访客漏斗。统计故障或隐私退出可能漏报，业务账本仍是最终依据。</p>
      <p className="mt-3 text-xs text-slate-500">微信内打开不等于微信分享。未标记的二维码、复制链接和直接输入网址无法可靠区分；未接入的模块不显示为零。浏览器隐私设置、拦截工具或网络失败可能造成漏报。已拦截部分已知机器人特征，不能保证排除所有自动访问。</p>
    </>}
    <TrafficChannelLinkBuilder key={siteId} siteId={siteId}/>
  </div>;
}
