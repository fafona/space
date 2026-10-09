"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendancePeriodClosureClient, periodClosureAllowsMutation, periodClosureCanSendPreview } from "@/lib/merchantAttendancePeriodClosureClient";
import type { PeriodClosureArtifact, PeriodClosureCommand, PeriodClosureEntry, PeriodClosureSummary } from "@/lib/merchantAttendancePeriodClosure";
import { deliverAttendancePrint } from "@/lib/merchantAttendancePrintBrowser";
import type { PeriodClosureLauncherProps } from "./MerchantAttendancePeriodClosureLauncher";
type Props = PeriodClosureLauncherProps & { onClose: () => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white p-2 text-sm";
const actions: Record<PeriodClosureCommand["action"], string> = { send: "保存版本并发起核对", confirm: "确认本保存版本", dispute: "提交周期争议", respond: "回复周期争议", seal: "封存本人已确认版本", reopen: "说明理由并重开" };
const states: Record<PeriodClosureSummary["state"], string> = { open: "已重开／准备中", review: "待本人核对", confirmed: "本人已明确确认", disputed: "有争议待处理", sealed: "已封存" };
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const csvCell = (value: unknown) => { let text = value == null ? "" : String(value); if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text; return `"${text.replaceAll('"', '""')}"`; };
const contextTitles: Record<string, string> = { pendingCorrections: "待处理补正与修订申请", missing: "整段漏卡及最新修订", leave: "请假申请与批准状态", calendar: "企业日历", plans: "排班、固定规则及采用依据", reviews: "异常处理与本人说明", workArrangements: "出差／外勤／远程工作安排（非实际工时）", outages: "故障恢复核对与双方确认（不另计工时）", administrativeClosures: "行政关闭固定证据（未知工时不计作零）" };
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function periodClosureSavedContext(artifact: PeriodClosureArtifact) {
  const context = artifact.source.context;
  return plain(context) ? Object.entries(context).map(([key, value]) => ({ key, title: contextTitles[key] ?? `其他已保存上下文 · ${key}`, value })) : [];
}
/** Format stored values only. This does not run timesheet calculations, current
 * timezone boundary code or the legacy dynamic export endpoints. */
export function buildPeriodClosureOutput(artifact: PeriodClosureArtifact, periodId: string, version: number) {
  const rows: unknown[][] = [["记录类型", "编号／日期", "保存版本", "口径", "UTC开始／值", "UTC结束", "工作微秒", "起止微秒", "休息微秒", "带薪休息微秒", "来源说明"]];
  const add = (...values: unknown[]) => rows.push(values);
  add("周期", periodId, version, "固定版本，不是工资或法律签名", artifact.period.startAt, artifact.period.endAt, "", "", "", "", artifact.calculationVersion);
  add("员工", artifact.worker.employeeId, version, artifact.worker.workerName, artifact.worker.workerNo, artifact.worker.workerId);
  add("来源指纹", artifact.sourceFingerprint, version, artifact.period.timeZone, artifact.period.fromDate, artifact.period.throughDate);
  const amounts = (kind: string, id: string, basis: string, value: PeriodClosureArtifact["report"]["totals"]["selected"] | null, from = "", to = "", note = "") =>
    add(kind, id, version, basis, from, to, value?.workedUs ?? "待核定", value?.elapsedUs ?? "待核定", value?.breakUs ?? "待核定", value?.paidBreakUs ?? "待核定", note);
  const subtotal = !!artifact.report.base.administrativeUnassessedCount;
  if (subtotal) add("工时完整性", periodId, version, "仅已知部分小计；行政关闭未知工时不按零计算", artifact.report.base.administrativeUnassessedCount);
  for (const basis of ["original", "recordedSelected", "missingSelected", "selected"] as const) amounts(subtotal ? "周期已知部分小计" : "周期合计", periodId, basis, artifact.report.totals[basis]);
  for (const day of artifact.report.days) for (const basis of ["original", "recordedSelected", "missingSelected", "selected"] as const) amounts(subtotal ? "按日已知部分小计" : "按日", day.date, basis, day[basis]);
  for (const boundary of artifact.dayBoundaries) add("保存日界", boundary.date, version, boundary.skipped ? "该民用日期被跳过" : "半开UTC", boundary.fromAt, boundary.toAt);
  for (const row of artifact.report.base.rows) {
    for (const basis of ["original", "selected"] as const) {
      amounts("原班次", row.startEventId, basis, basis === "original" ? row.originalInPeriod : row.selectedInPeriod, row[basis].startAt, row[basis].endAt ?? "未结束", row.administrativeBoundary ? "行政关闭，工时待核定；不补造下班" : row.correction ? `${row.correction.operationId} / r${row.correction.revision}` : "原始记录");
      for (const rest of row[basis].breaks) add("休息", row.startEventId, version, basis, rest.startAt, rest.endAt, "", "", "", "", rest.paid ? "带薪标记" : "非带薪标记");
    }
    if (row.correction) add("批准版本", row.correction.requestId, version, row.correction.revision, row.correction.operationId, row.correction.recordedAt, "", "", "", "", JSON.stringify(row.correction.lineage ?? null));
    for (const eventId of row.eventIds) add("原事件引用", eventId, version, row.startEventId);
  }
  for (const missing of artifact.report.missing) {
    amounts("已批准整段漏卡", missing.requestId, "missing-approved", missing.inPeriod, missing.proposal.startAt, missing.proposal.endAt, missing.operationId);
    add("漏卡依据", missing.requestId, version, missing.workerName, missing.approvedAt, missing.timeZone, "", "", "", "", `${missing.locationId} / policy ${missing.policyRevision}`);
    for (const rest of missing.proposal.breaks) add("漏卡休息", missing.requestId, version, "missing-approved", rest.startAt, rest.endAt, "", "", "", "", rest.paid ? "带薪标记" : "非带薪标记");
  }
  // Preserve every saved context/root field, including latest missing revisions
  // and rule/exception receipts. JSON is escaped, never executed or truncated.
  for (const entry of periodClosureSavedContext(artifact)) add("保存上下文完整证据", entry.title, version, entry.key, "", "", "", "", "", "", JSON.stringify(entry.value));
  for (const [key, value] of Object.entries(artifact.source)) if (key !== "context") add("保存来源完整字段", key, version, "服务端已保存原值", "", "", "", "", "", "", JSON.stringify(value));
  const csv = "\ufeff" + rows.map(row => Array.from({ length: 11 }, (_, n) => csvCell(row[n])).join(",")).join("\r\n") + "\r\n";
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>周期保存版本 ${version}</title><style>body{font:11px sans-serif;color:#111}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #999;padding:4px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}@page{size:A4 landscape;margin:10mm}</style></head><body data-attendance-print-document="unified"><h1>周期保存版本 ${version}</h1><p>周期 ${escape(periodId)} · 固定来源 ${escape(artifact.sourceFingerprint)}。不重算当前工时；不是工资结算、法律签名或当前事实未变化的证明。</p><table><thead><tr>${rows[0].map(cell => `<th>${escape(String(cell))}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map(row => `<tr>${Array.from({ length: 11 }, (_, n) => `<td>${escape(row[n] == null ? "" : String(row[n]))}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  if (new TextEncoder().encode(csv).byteLength > 3145728 || new TextEncoder().encode(html).byteLength > 4194304) throw Error("period_output_too_large");
  return { csv, html, filename: `attendance-period-${periodId}-v${version}.csv` };
}
export function confirmPeriodClosureAction(confirm: () => boolean, current: () => boolean, action: () => void) {
  if (!current() || !confirm() || !current()) return false; action(); return true;
}
export default function MerchantAttendancePeriodClosureWorkspace(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED === "1";
  const key = `${props.siteId}:${props.access}:${props.actorId}:${props.workerId}:${props.fromDate}:${props.throughDate}`;
  const [scope, setScope] = useState({ key, apiFetch: props.apiFetch, enabled, epoch: 0 });
  if (scope.key !== key || scope.apiFetch !== props.apiFetch || scope.enabled !== enabled) { setScope({ key, apiFetch: props.apiFetch, enabled, epoch: scope.epoch + 1 }); return null; }
  return <Prepared key={scope.epoch} {...props} enabled={enabled}/>;
}
function Prepared(props: Props & { enabled: boolean }) {
  const { siteId, access, actorId, workerId, fromDate, throughDate, apiFetch, enabled } = props;
  const client = useMemo(() => { try { return new AttendancePeriodClosureClient({ siteId, access, actorId, workerId, fromDate, throughDate, apiFetch, enabled, storage: () => sessionStorage }); } catch { return null; } },
    [siteId, access, actorId, workerId, fromDate, throughDate, apiFetch, enabled]);
  return client ? <Screen {...props} client={client}/> : <section aria-label="周期核对与封存"><p role="alert">当前身份或周期范围无法核对；未发出请求。</p><button type="button" className={button} onClick={props.onClose}>返回合并核对</button></section>;
}
function Screen({ access, enabled, workerId, fromDate, throughDate, onClose, registerLeaveGuard, client }: Props & { enabled: boolean; client: AttendancePeriodClosureClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [reason, setReason] = useState(""), [shown, setShown] = useState(() => typeof document === "undefined" || !document.hidden);
  const epoch = useRef(0), dirty = useRef(false), printController = useRef<AbortController | null>(null);
  const clear = useCallback(() => { dirty.current = false; setReason(""); }, []);
  const leave = useCallback(() => { const generation = epoch.current; return (!(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交理由；已发送操作不撤销，原编号保留。继续？")) && generation === epoch.current; }, [client]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => {
    const invalidate = () => { epoch.current++; printController.current?.abort(); printController.current = null; client.pause(); };
    const hide = () => flushSync(() => { invalidate(); clear(); setShown(false); });
    const show = () => { if (!document.hidden) { flushSync(() => setShown(true)); void client.initialize(); } };
    const visibility = () => document.hidden ? hide() : show();
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    if (document.hidden) hide(); else void client.initialize();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { invalidate(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clear]);
  const result = shown ? state.result : null, pending = shown ? state.pending : null, busy = state.phase === "loading" || state.phase === "saving";
  const period = result?.kind === "detail" ? result.period : null;
  const artifact = result?.kind === "preview" ? result.preview.artifact : result?.kind === "detail" ? result.artifact : null;
  const currentVersion = result?.kind === "detail" && result.artifactVersion === period?.currentVersion;
  const matchesNavigation = state.query?.workerId === workerId && state.query.fromDate === fromDate && state.query.throughDate === throughDate;
  const writable = shown && !busy && !pending && !!result && matchesNavigation;
  const newActions = enabled && !!result?.moduleEnabled;
  const editable = writable && (newActions || access === "owner" && period?.sealed);
  const validReason = reason === reason.trim() && [...reason].length >= 1 && [...reason].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(reason);
  const read = (action: () => void) => { if (!shown || document.hidden || busy) return; const generation = epoch.current;
    if (dirty.current && !window.confirm("读取会清除未提交理由，继续？")) return; if (generation !== epoch.current || document.hidden) return; epoch.current++; printController.current?.abort(); clear(); action(); };
  const submit = (action: PeriodClosureCommand["action"]) => { const generation = epoch.current, snapshot = client.getSnapshot();
    const message = action === "confirm" ? "确认已核对所示保存版本？不代表工资结清、放弃争议或认可后续变化。" : action === "seal" ? "封存本人已确认的指定版本，并限制本员工该范围的新补正／漏卡提交和批准；正常打卡、下班不受阻。确认？"
      : action === "reopen" ? "按此理由重开？旧封存与确认保留，新版本须重新核对；不解开原企业补正锁或延长期限。" : `确认“${actions[action]}”？只对当前版本保存明确操作，不直接修改工时。`;
    confirmPeriodClosureAction(() => window.confirm(message), () => shown && !document.hidden && !busy && generation === epoch.current && client.getSnapshot() === snapshot,
      () => { clear(); void client.submit(action, reason); }); };
  const output = (kind: "csv" | "print") => { if (result?.kind !== "detail" || !result.artifact || result.artifactVersion === null) return;
    const { period, artifactVersion, artifact } = result; const generation = epoch.current, snapshot = client.getSnapshot();
    confirmPeriodClosureAction(() => window.confirm("重新核验独立导出权限后输出这个保存版本。下载或打印后平台不能收回副本；不是当前动态报表或工资表。继续？"),
      () => shown && !document.hidden && !busy && !pending && epoch.current === generation && client.getSnapshot() === snapshot, () => {
        printController.current?.abort(); const lifetime = new AbortController(); printController.current = lifetime;
        void client.exportVersion(period.periodId, artifactVersion, artifact.sourceFingerprint, async (saved, signal, authorized) => {
          const file = buildPeriodClosureOutput(saved, period.periodId, artifactVersion);
          const current = () => authorized() && epoch.current === generation && !lifetime.signal.aborted;
          if (!current()) throw Error("output_expired");
          if (kind === "print") { const started = performance.now(); signal.addEventListener("abort", () => lifetime.abort(), { once: true });
            await deliverAttendancePrint({ ...file, kind: "unified", signal: lifetime.signal, authorized: current, remainingMs: () => Math.max(0, 60000 - (performance.now() - started)) });
          } else { const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv;charset=utf-8" })), anchor = document.createElement("a");
            try { if (!current()) throw Error("output_expired"); anchor.href = url; anchor.download = file.filename; anchor.hidden = true; document.body.append(anchor); anchor.click(); }
            finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); } }
        });
      }); };
  return <section aria-label="周期核对与封存" data-period-closure className="min-w-0 space-y-4 rounded-2xl border border-indigo-300 bg-white p-3 sm:p-5">
    <header className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-bold">周期核对、争议与封存</h2><button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>返回合并核对</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">双方核对同一保存版本，包含原始记录、最新批准补正及整段漏卡。沉默、已读或负责人回复不代替本人确认。不计算工资或法律签名；缺记录不等于缺勤。{access === "owner" ? "封存及重开仅当前负责人操作。" : "本人只能核对和提出争议，不能代负责人封存或重开。"}</p>
    <p className="text-sm">导航范围 {fromDate} → {throughDate}；实际版本以服务端保存的日期、时区与 UTC 半开范围为准。</p>
    <p data-period-closure-timezone-rule className="rounded-xl bg-indigo-50 p-3 text-sm leading-6">已有周期继续使用首次保存的时区和每日 UTC 边界；修改企业时区不会重新划分旧周期。新周期按创建时的企业设置确定范围。预览会按这些固定边界重新核对当前资料，不会改写旧版报表。</p>
    {result && !matchesNavigation && <p role="alert" className="text-sm text-amber-900">这是其他人员／日期范围的原号恢复收据，只供核对；请明确读取当前范围后再开始新操作或导出。</p>}
    {!enabled && <p className="text-sm text-amber-900">新操作入口关闭；原编号和已有保存版本仍须独立授权核对，不保证当前服务器一定可恢复。</p>}
    <p role="status" className="text-sm">{shown ? state.message : "资料已隐藏，返回后请明确重新读取。"}</p>
    {shown && ["blocked", "unconfirmed"].includes(state.phase) && <p role="alert" className="text-sm text-amber-900">{state.message}</p>}
    {pending && <div data-period-closure-pending className="min-w-0 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="break-all">待确认操作 {pending.command.operationId} · 周期 {pending.command.periodId}。原内容保留，不能被另一操作覆盖，不阻断正常打卡。</p>
      <button type="button" className={button} disabled={busy} onClick={() => read(() => { void client.recover(); })}>核对原周期编号</button>
      {state.definitiveRejection && <><p className="text-sm">服务器已明确拒绝本次写入（{state.definitiveRejection}）。可结束这次未成功尝试；之后必须重新预览／读取，不会直接重发。</p><button type="button" className={button} disabled={busy} onClick={() => { const generation = epoch.current; if (window.confirm("本次写入已明确被拒绝。仅结束本标签页这个未成功尝试，不撤销事实；之后重新读取再操作。继续？") && generation === epoch.current && !document.hidden) { clear(); void client.endAttempt(); } }}>结束这次未成功尝试</button></>}
    </div>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!shown || busy || !!pending} onClick={() => read(() => { void client.list(); })}>读取周期列表</button>
      {access === "owner" && <button type="button" className={button} disabled={!shown || !enabled || busy || !!pending} onClick={() => read(() => { void client.preview(matchesNavigation ? period?.periodId ?? state.query?.periodId ?? null : null); })}>预览完整周期资料</button>}</div>
    {result?.kind === "list" && <section aria-label="保存周期列表"><p className="text-sm">本范围最多 20 个周期，超限明确拒绝；空列表不是没有出勤。</p><ul className="space-y-2">{result.items.map(item => <li key={item.periodId} className="min-w-0 rounded-xl border p-3 text-sm"><p>{item.workerName} · {item.fromDate} → {item.throughDate} · {states[item.state]}</p><p className="break-all text-xs">{item.periodId} · 当前来源版 {item.currentVersion} · 操作修订 {item.revision}</p><button type="button" className={button} onClick={() => read(() => { void client.detail(item.periodId); })}>读取保存版本</button></li>)}</ul></section>}
    {result?.kind === "preview" && <div data-period-closure-preview className="space-y-2"><h3 className="font-bold">本次预览尚未保存</h3>{result.preview.blockers.length ? <><p className="text-sm">{periodClosureCanSendPreview(result.preview.blockers) ? "完整但仍有待处理资料，可以先发给本人核对；这些问题解决前不能封存。" : result.preview.blockers.includes("unresolved_outage") ? "相关故障恢复尚未核完，暂不能送审或封存；请先完成双方核对，再重新预览。" : "周期尚未结束，暂不能保存并发起核对；不会将未完周期当作完整封存。"}</p><ul aria-label="周期处理限制" className="list-disc pl-5 text-sm">{result.preview.blockers.map(code => <li className="break-all" key={code}>{code === "pending_work_arrangement" ? "有相关工作安排待审批，处理后才能封存" : code === "unresolved_outage" ? "有未结案、异议或依据已变化的故障恢复记录" : code}</li>)}</ul></> : <p className="text-sm">本次预览未发现阻断项；保存时服务器仍会重新核对，不自动沿用旧确认。</p>}</div>}
    {result?.kind === "detail" && <div data-period-closure-detail className="space-y-3"><h3 className="font-bold">{period!.workerName} · {states[period!.state]}</h3><p className="break-all text-xs">周期 {period!.periodId} · 操作修订 {period!.revision} · 当前来源版 {period!.currentVersion} · 正在查看 {result.artifactVersion ?? "无正文"}</p>
      <p className="text-sm">{period!.sealed ? "封存版保留；后续争议不改旧确认。" : "尚未封存。"}{period!.unresolvedDispute ? "有未解决争议，不能封存。" : ""}</p>
      <p className="text-sm">{result.sourceChanged === true ? "当前来源已变化；旧确认不适用于新资料，须重新保存版本核对。" : result.sourceChanged === false ? "本次服务器已核对当前来源。" : "当前来源未重新核查；不声称保存版仍等于现实资料。"}</p>
      {period!.currentVersion > 0 && <label className="block text-sm">选择保存版本<select aria-label="选择保存版本" className={input} value={result.artifactVersion ?? ""} disabled={busy || !!pending} onChange={event => read(() => { void client.detail(period!.periodId, Number(event.target.value)); })}><option value="" disabled>请选择</option>{Array.from({ length: Math.min(20, period!.currentVersion) }, (_, i) => i + 1).map(version => <option key={version} value={version}>来源版本 {version}</option>)}</select></label>}
      <History entries={result.history} key={`${period!.periodId}:${period!.revision}`}/>
    </div>}
    {artifact && <PeriodClosureSavedReport artifact={artifact} key={artifact.sourceFingerprint}/>}
    {result && result.kind !== "list" && <div className="space-y-3 rounded-xl border p-3"><label className="block text-sm">操作理由／本人争议<textarea aria-label="周期操作理由" rows={3} className={input} maxLength={500} value={reason} disabled={!editable} onChange={event => { epoch.current++; dirty.current = true; setReason(event.target.value); }}/></label>
      <p className="text-xs">1–500 字，公开给本周期双方；说明不直接更改工时。事实错误仍按原补正／漏卡申请处理。</p><div className="flex flex-wrap gap-2">
        {access === "owner" ? <>
          {result.kind === "preview" && <button type="button" className={button} disabled={!editable || !newActions || !validReason || !periodClosureCanSendPreview(result.preview.blockers)} onClick={() => submit("send")}>{actions.send}</button>}
          {period && <><button type="button" className={button} disabled={!editable || !newActions || !validReason || !period.unresolvedDispute} onClick={() => submit("respond")}>{actions.respond}</button>
            <button type="button" className={button} disabled={!editable || !newActions || !validReason || !currentVersion || period.state !== "confirmed" || period.sealed || period.unresolvedDispute || result.kind !== "detail" || result.sourceChanged !== false} onClick={() => submit("seal")}>{actions.seal}</button>
            <button type="button" className={button} disabled={!writable || !validReason || !period.sealed || !periodClosureAllowsMutation("reopen", enabled, !!result.moduleEnabled)} onClick={() => submit("reopen")}>{actions.reopen}</button></>}
        </> : period && <><button type="button" className={button} disabled={!editable || !newActions || !validReason || !currentVersion || !["review", "disputed"].includes(period.state) || result.kind !== "detail" || result.sourceChanged === true} onClick={() => submit("confirm")}>{actions.confirm}</button>
          <button type="button" className={button} disabled={!editable || !newActions || !validReason || !currentVersion} onClick={() => submit("dispute")}>{actions.dispute}</button></>}
      </div></div>}
    {result?.kind === "detail" && artifact && result.artifactVersion !== null && <section aria-label="保存版本导出与打印" className="space-y-2"><p className="text-sm">独立核验导出权限，只输出所选保存版本；不是上方旧动态导出。</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || !!pending || !shown || !matchesNavigation} onClick={() => output("csv")}>下载本保存版本 CSV</button><button type="button" className={button} disabled={busy || !!pending || !shown || !matchesNavigation} onClick={() => output("print")}>打印本保存版本</button></div></section>}
  </section>;
}
function History({ entries }: { entries: PeriodClosureEntry[] }) { const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(entries.length / 10));
  return <details className="min-w-0 text-sm"><summary>周期操作历史（{entries.length} 条）</summary><ol className="space-y-2">{entries.slice(page * 10, page * 10 + 10).map(entry => <li key={entry.operationId} className="break-words rounded-lg bg-slate-50 p-2"><strong>{actions[entry.action]} · 修订 {entry.revision} · 来源版 {entry.version}</strong><p>{entry.reason}</p><p className="break-all text-xs">{entry.operationId} · {entry.actorId} · {entry.recordedAt}</p></li>)}</ol>{pages > 1 && <nav aria-label="周期历史本地分页" className="flex gap-2"><button className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1}/{pages}</span><button className={button} disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>下一页</button></nav>}</details>;
}
export function PeriodClosureSavedReport({ artifact: a }: { artifact: PeriodClosureArtifact }) {
  const [page, setPage] = useState(0), rows = [...a.report.base.rows.map(row => ({ key: row.startEventId, row, missing: null })), ...a.report.missing.map(missing => ({ key: missing.requestId, row: null, missing }))];
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  return <article aria-label="周期固定资料版本" data-period-closure-artifact className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
    <h3 className="font-bold">{a.worker.workerName} · {a.worker.workerNo}</h3><p className="text-sm">{a.period.fromDate} → {a.period.throughDate} · 保存时区 {a.period.timeZone}</p>
    <p className="break-all text-xs">UTC [{a.period.startAt}, {a.period.endAt}) · 固定指纹 {a.sourceFingerprint} · {a.calculationVersion}</p>
    <p className="text-xs">以下仅显示保存值，不用今天的时区数据库或工时算法重算。带薪休息不自动加回工作段，不是工资结算。</p>
    <dl className="grid gap-2 text-sm sm:grid-cols-2">{([["original", "原始打卡"], ["recordedSelected", "原记录／最新批准补正"], ["missingSelected", "最新批准整段漏卡"], ["selected", "合并核定"]] as const).map(([key, label]) => <div key={key} className="min-w-0 rounded-lg bg-slate-50 p-2"><dt className="font-semibold">{label}</dt><dd className="break-all">工作 {a.report.totals[key].workedUs} 微秒<br/>起止 {a.report.totals[key].elapsedUs} · 休息 {a.report.totals[key].breakUs} · 带薪休息 {a.report.totals[key].paidBreakUs}</dd></div>)}</dl>
    <details className="min-w-0 text-xs"><summary>保存的日界与分日结果（{a.dayBoundaries.length} 日）</summary>{a.dayBoundaries.map(boundary => <p key={boundary.date} className="break-all">{boundary.date} · {boundary.fromAt} → {boundary.toAt} {boundary.skipped ? "民用日期跳过，不计作缺勤" : ""} · 保存工作微秒 {a.report.days.find(day => day.date === boundary.date)?.selected.workedUs ?? "不适用"}</p>)}</details>
    <section aria-label="周期保存来源明细" className="space-y-2"><p className="text-sm">原记录／补正 {a.report.base.rows.length} 条；批准整段漏卡 {a.report.missing.length} 条。每页最多 10 条。</p>{rows.slice(page * 10, page * 10 + 10).map(({ key, row, missing }) => <details key={key} className="min-w-0 rounded-lg border p-2 text-xs"><summary className="break-all">{row ? row.source === "approved" ? "原记录与最新批准补正" : "原始记录" : "独立已批准整段漏卡（不是原打卡）"} · {key}</summary>
      {row ? <><p className="break-all">原始 UTC {row.original.startAt} → {row.original.endAt ?? "未结束"}</p><p className="break-all">核定 UTC {row.selected.startAt} → {row.selected.endAt ?? "未结束"}</p><p className="break-all">批准 {row.correction?.operationId ?? "未替换"} · 核定版本 {row.correction?.revision ?? "无"}</p></>
        : missing && <><p className="break-all">申报 UTC {missing.proposal.startAt} → {missing.proposal.endAt} · {missing.timeZone}</p><p className="break-all">批准操作 {missing.operationId} · {missing.approvedAt}</p></>}</details>)}</section>
    {pages > 1 && <nav aria-label="周期来源本地分页" className="flex gap-2"><button className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1}/{pages}</span><button className={button} disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>下一页</button></nav>}
    <section aria-label="周期已保存完整上下文" className="min-w-0 space-y-2"><h4 className="font-semibold">一起核对的完整保存上下文</h4>
      <p className="text-xs">请假、日历、排班、规则、异常处理及待申请均为该版本保存值，不自动抵扣工时或证明当前状态。每类可展开全部证据；分页只影响页面显示，固定 CSV／打印包含全部保存内容，不截断。</p>
      {periodClosureSavedContext(a).map(entry => <SavedContextSection key={entry.key} title={entry.title} value={entry.value}/>)}
      <SavedJson title="完整保存来源（含原事件、身份与最新修订链）" value={a.source}/>
    </section>
  </article>;
}
function SavedJson({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return <details className="min-w-0 rounded-lg border p-2 text-xs" onToggle={event => setOpen(event.currentTarget.open)}><summary className="break-words">{title}</summary>
    {open && <pre className="max-h-96 max-w-full overflow-auto whitespace-pre-wrap break-all p-2" tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>}</details>;
}
function SavedContextSection({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0), items = Array.isArray(value) ? value : null, pages = items ? Math.max(1, Math.ceil(items.length / 10)) : 1;
  return <details className="min-w-0 rounded-lg border p-2 text-sm" onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}><summary className="break-words">{title} · {items ? `${items.length} 项` : "保存的结构化依据"}</summary>
    {open && (items ? <><p className="py-2 text-xs">本保存版本 {items.length} 项；不表示当前没有新申请。每页最多 10 项。</p>{items.slice(page * 10, page * 10 + 10).map((item, n) => {
      const v = plain(item) ? item : null, label = v ? [v.requestId ?? v.caseId ?? v.operationId ?? v.slotId ?? v.declarationId, v.revision && `修订 ${v.revision}`, plain(v.status) ? v.status.resolved === true ? "保存时已核对结案" : "保存时尚未核完" : v.status].filter(Boolean).join(" · ") : "保存值";
      return <SavedJson key={page * 10 + n} title={`第 ${page * 10 + n + 1} 项 · ${label}`} value={item}/>;
    })}{pages > 1 && <nav aria-label={`${title}本地分页`} className="flex gap-2"><button type="button" className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1}/{pages}</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页</button></nav>}</> : <SavedJson title="展开完整结构化证据" value={value}/>)}
  </details>;
}
