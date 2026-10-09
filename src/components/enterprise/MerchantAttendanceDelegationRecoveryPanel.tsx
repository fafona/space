"use client";
import { useEffect, useRef, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { DelegationRecoveryStorage } from "@/lib/merchantAttendanceDelegationRecovery";
import { listKnownAttendanceRecoveries, recoverKnownAttendance,
  type KnownAttendanceRecovery, type AttendanceRecoveryReceipt } from "@/lib/merchantAttendanceRecovery";

const defaultStorage = () => sessionStorage;
const actionLabel = { grant: "已授予委托", revoke: "已撤销委托", approve: "已批准", reject: "已驳回", publish: "已发布排班", cancel: "已取消排班", send:"已保存周期并送本人核对",respond:"已保存周期争议回复",seal:"已封存周期",reopen:"已重开周期",save_draft:"规则草稿已保存",withdraw:"未来规则发布已撤销" };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:opacity-40";
export default function MerchantAttendanceDelegationRecoveryPanel({ authUserId, apiFetch, isCurrentAuth, storage = defaultStorage }: {
  authUserId: string; apiFetch: AttendanceApiFetch; isCurrentAuth: () => boolean; storage?: () => DelegationRecoveryStorage;
}) {
  const [entries, setEntries] = useState<readonly KnownAttendanceRecovery[]>([]), [receipt, setReceipt] = useState<AttendanceRecoveryReceipt | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("请点击下方按钮查找本标签页、当前账号的待确认编号。不会查询全部考勤记录。");
  const epoch = useRef(0), mounted = useRef(false), running = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    const clear = () => { epoch.current++; running.current?.abort(); running.current = null;
      if (mounted.current) { setBusy(false); setEntries([]); setReceipt(null); setMessage("页面状态已变化，显示内容已清除；原待确认编号保留，请重新查找。"); } };
    const hide = () => { if (document.hidden) clear(); };
    const changed = (e: StorageEvent) => { if (e.storageArea === sessionStorage) clear(); };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", clear); window.addEventListener("storage", changed);
    return () => { mounted.current = false; clear(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", clear); window.removeEventListener("storage", changed); };
  }, [authUserId, apiFetch, isCurrentAuth, storage]);
  const current = (generation: number) => mounted.current && generation === epoch.current && !document.hidden && isCurrentAuth();
  const scan = async () => {
    if (running.current || document.hidden || !isCurrentAuth()) return;
    const generation = ++epoch.current, controller = new AbortController(); running.current = controller;
    setBusy(true); setEntries([]); setReceipt(null); setMessage("正在检查本标签页待确认编号，不发送考勤请求…");
    try { const found = await listKnownAttendanceRecoveries(storage(), authUserId, isCurrentAuth, controller.signal);
      if (!current(generation)) return; setEntries(found.entries);
      setMessage(found.invalid ? "部分本地记录无法核验，已保留且不会发送；有效编号如下。请联系负责人核对异常记录。"
        : found.entries.length ? "请选择一个原编号读取结果；不会重新审批、停用或恢复账号。" : "本标签页没有当前账号可核验的考勤待确认编号。其他账号或已关闭标签页的编号不会显示。");
    } catch { if (current(generation)) setMessage("无法安全读取本地存储；没有发送请求或删除编号，请联系负责人核对。"); }
    finally { if (current(generation)) { running.current = null; setBusy(false); } }
  };
  const recover = async (entry: KnownAttendanceRecovery) => {
    if (running.current || document.hidden || !isCurrentAuth() || !entries.includes(entry)) return;
    const generation = ++epoch.current, controller = new AbortController(); running.current = controller;
    setBusy(true); setReceipt(null); setMessage("正在读取这个原编号的最小回执…");
    try { const result = await recoverKnownAttendance(entry, { authenticatedUserId: authUserId, apiFetch, storage: storage(), signal: controller.signal, isCurrentAuth });
      if (!current(generation)) return;
      if (result) { setReceipt(result); setEntries(list => list.filter(x => x.storageKey !== entry.storageKey)); setMessage(result.kind === "account-status"
        ? "原账号操作结果已核实，匹配的待确认标记已解除。没有重新停用或恢复账号，也没有解除考勤暂停、设置 PIN 或恢复委托。"
        : result.kind === "employment" ? "原任职操作结果已核实，匹配的待确认标记已解除。没有重复结束或新增任职，也没有恢复考勤或凭证。"
        : "原操作结果已核实，匹配的待确认标记已解除。没有重新提交，也没有恢复审批权限。"); }
      else setMessage("原结果尚未核实；查无回执不等于失败，编号继续保留。请稍后再次读取或交负责人核验，不要重复提交。");
    } catch { if (current(generation)) setMessage("身份、存储或页面状态已变化，未继续核对。请重新查找；不会重发操作或丢弃未确认编号。"); }
    finally { if (current(generation)) { running.current = null; setBusy(false); } }
  };
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5" aria-label="考勤原编号恢复">
    <p className="text-sm leading-6 text-slate-600">支持本标签页保存的首次补正审批委托、漏卡、请假、工作安排和排班委托操作、周期委托操作、企业账号停用／恢复，以及任职结束／再入职的待确认编号。也支持运营规则台账、办理责任登记／接手、行政结案／异议／回复及本地单条处置原编号。请留在原标签页；不要清除网站数据。不能登录或身份已换绑时，请把原编号交负责人核验。</p>
    <button type="button" className={button} disabled={busy} onClick={() => void scan()}>查找本标签页待确认编号</button>
    <p role="status" className="break-words text-sm leading-6">{message}</p>
    <ul className="space-y-3">{(isCurrentAuth() ? entries : []).map(entry => <KnownAttendanceRecoveryEntry key={entry.storageKey} entry={entry} busy={busy} onRecover={() => void recover(entry)}/>)}</ul>
    {isCurrentAuth() && receipt && <AttendanceRecoveryReceiptView receipt={receipt}/>}
  </section>;
}
export function KnownAttendanceRecoveryEntry({ entry, busy = false, onRecover = () => {} }: { entry: KnownAttendanceRecovery; busy?: boolean; onRecover?: () => void }) {
  return <li data-attendance-recovery-kind={entry.kind} className="min-w-0 space-y-2 rounded-xl border p-4">
    <p className="text-sm font-semibold">{entry.kind === "retention-disposal" ? "本地单条处置原操作" : entry.kind === "review-routing" ? "办理责任登记／接手原操作" : entry.kind === "administrative-closure" ? "行政结案／异议／回复原操作" : entry.kind === "operational-consumer-activation" ? "业务规则消费启用原操作" : entry.kind === "operational-punch-activation" ? "在线规则启用原操作" : entry.kind === "operational-rules" ? "运营规则台账原操作" : entry.kind === "correction" ? "首次补正审批委托原操作" : entry.kind === "missing" ? "漏卡审批委托" : entry.kind === "application" ? "请假／工作安排审批委托" : entry.kind === "schedule" ? "授权员工排班原操作" : entry.kind === "period-delegation" ? "周期授权／撤销原操作" : entry.kind === "period-closure" ? "受托周期原操作" : entry.kind === "employment" ? "任职结束／再入职原操作" : "企业账号状态原操作"} · 企业 {entry.siteId}</p>
    <p className="break-all text-xs text-slate-600">原操作编号：{entry.operationId}</p>
    <button type="button" className={button} disabled={busy} onClick={onRecover}>读取这个原编号</button>
  </li>;
}
export function AttendanceRecoveryReceiptView({ receipt }: { receipt: AttendanceRecoveryReceipt }) {
  return <section aria-label="已核实最小回执" data-attendance-recovery-receipt={receipt.kind} className="space-y-2 rounded-xl bg-emerald-50 p-4 text-sm">
      <p className="font-semibold">{receipt.kind === "retention-disposal" ? receipt.action === "approve" ? "原操作确认：单条处置批准已保存，尚不表示已执行" : "原操作确认：单条三字段处置已执行" : receipt.kind === "review-routing" ? receipt.action === "register" ? "原操作确认：办理责任已登记" : "原操作确认：负责人已接手协调" : receipt.kind === "administrative-closure" ? ({ record_unknown: "原操作确认：结束时刻不明记录已保存", close: "原操作确认：行政结案已保存", self_dispute: "原操作确认：本人异议已保存", owner_respond: "原操作确认：负责人回复已保存" }[receipt.action]) : receipt.kind === "operational-consumer-activation" ? receipt.action === "activate" ? "原操作确认：已启用业务规则消费" : "原操作确认：已停用业务规则消费" : receipt.kind === "operational-punch-activation" ? receipt.action === "activate" ? "原操作确认：已启用在线规则开班" : "原操作确认：已停用新规则开班" : receipt.kind === "account-status" ? receipt.status === "active" ? "原操作确认：企业账号已恢复" : "原操作确认：企业账号已停用"
        : receipt.kind === "employment" ? receipt.action === "close" ? "原操作确认：任职已结束" : "原操作确认：已新增再入职区间" : receipt.kind === "operational-rules" && receipt.action === "publish" ? "原操作确认：未来规则台账已发布" : actionLabel[receipt.action]}</p>
      <p className="break-all">原操作编号：{receipt.operationId}</p><p className="break-all">记录时间：{receipt.recordedAt}</p>
      <p className="break-all">真实操作者编号：{receipt.actorId}</p>
      {receipt.kind === "retention-disposal" && <p className="break-all">原批准编号：{receipt.approvalOperationId}。仅确认原操作，不显示定位精度、理由或关联归档，不重复执行。</p>}
      {receipt.kind === "review-routing" && <p>保存责任版本 {receipt.revision}。仅确认原登记／接手结果；不显示员工材料或理由，也不恢复当前审批权限。</p>}
      {receipt.kind === "administrative-closure" && <p>保存行政版本 {receipt.revision}。不显示说明或员工来源，不改打卡、工时或任职，也不恢复账号与当前处理权限。</p>}
      {receipt.kind === "operational-rules" && <p>保存台账修订 {receipt.revision}。不恢复负责人资格、不显示规则正文，不证明规则已被实际打卡、审批、周期或自动提醒消费。</p>}
      {receipt.kind === "operational-punch-activation" && <p>保存启用修订 {receipt.revision}。仅证明原账本操作，不证明当前仍启用或四通路已验收，不恢复负责人资格。</p>}
      {receipt.kind === "operational-consumer-activation" && <p>保存业务范围 {receipt.consumer} · 启用修订 {receipt.revision}。仅核对原操作，不恢复权限，也不启用其他业务规则。</p>}
      {receipt.kind === "schedule" && <p>原授权版本 {receipt.grantRevision}{receipt.scheduleRevision === null ? "" : `；原排班版本 ${receipt.scheduleRevision}`}。这里只确认原操作，不证明当前授权仍有效，也不会重复发布或取消排班。</p>}
      {(receipt.kind === "period-delegation" || receipt.kind === "period-closure") && <p>原授权版本 {receipt.grantRevision}{receipt.periodRevision===null?"":`；原周期修订 ${receipt.periodRevision}`}。只核对保存结果，不恢复周期查看或审批权限，也不代员工确认。</p>}
      {receipt.kind === "employment" && <><p>保存任职版本 {receipt.revision}。这是原操作回执，不代表当前任职或打卡权限。</p>
        <p>原任职区间：{receipt.startsOn} 至 {receipt.endsOn ?? "未结束"}。这里不会恢复账号、考勤、PIN或委托。</p></>}
      {receipt.kind === "account-status" && <><p>保存账号版本 {receipt.version}。这是原操作回执，不证明当前账号仍处于该状态。</p>
        <p>{receipt.suspensionId ? "此原操作关联考勤暂停记录，不代表该暂停已解除。" : "此原操作未关联暂停记录，不能推断考勤已恢复。"}</p>
        <p>企业账号恢复、解除考勤暂停、设置新 PIN、重新授予委托是四个独立结果；这里不会执行任何一项。</p></>}
      <p>此处不显示申请正文、理由或其他员工资料。</p>
    </section>;
}
