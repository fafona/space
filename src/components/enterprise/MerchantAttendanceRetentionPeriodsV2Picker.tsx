"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendanceRetentionPeriodsV2Client, type AttendanceRetentionPeriodsV2ClientOptions, type RetentionPeriodArtifactSelection } from "@/lib/merchantAttendanceRetentionPeriodsV2Client";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

export type RetentionPeriodsV2PickerProps = Omit<AttendanceRetentionPeriodsV2ClientOptions, "timeoutMs"> & {
  onSelect: (selection: RetentionPeriodArtifactSelection) => void;
  onClose: () => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void;
};
type PickerClient = Pick<AttendanceRetentionPeriodsV2Client, "getSnapshot" | "selectVersion" | "pause">;

/** Headers obtained after a render-time scope change must not reach the client. */
export function retentionPeriodsV2Fetch(apiFetch: AttendanceApiFetch, isCurrent: () => boolean): AttendanceApiFetch {
  return async (path, init) => {
    if (!isCurrent()) throw Error("identity_changed");
    const response = await apiFetch(path, init);
    if (!isCurrent()) { void response.body?.cancel().catch(() => {}); throw Error("identity_changed"); }
    return response;
  };
}

/** A metadata selection is not authority to hold/release; the parent must do its record GET. */
export function handoffRetentionPeriodArtifact(client: PickerClient, version: number, isCurrent: () => boolean,
  onSelect: (selection: RetentionPeriodArtifactSelection) => void) {
  if (!isCurrent()) return false;
  const snapshot = client.getSnapshot(), selection = client.selectVersion(version);
  if (!selection || !isCurrent() || client.getSnapshot() !== snapshot) return false;
  client.pause();
  if (!isCurrent()) return false;
  onSelect(selection); return true;
}

const button = "max-w-full whitespace-normal break-words rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";

/* eslint-disable react-hooks/refs -- This monotonic render-time fence revokes stale async authority before cleanup. An interrupted render can only conservatively invalidate a lease, never reauthorize one. */
export default function MerchantAttendanceRetentionPeriodsV2Picker(props: RetentionPeriodsV2PickerProps) {
  const { siteId, actorId, workerId, fromDate, throughDate, enabled, apiFetch, isCurrentAuth: checkAuth } = props;
  const key = JSON.stringify([siteId, actorId, workerId, fromDate, throughDate, enabled]);
  const live = useRef({ key, fetch: apiFetch, auth: checkAuth, token: 0 });
  if (live.current.key !== key || live.current.fetch !== apiFetch || live.current.auth !== checkAuth)
    live.current = { key, fetch: apiFetch, auth: checkAuth, token: live.current.token + 1 };
  const token = live.current.token;
  const isCurrent = useCallback(() => {
    try { return live.current.token === token && checkAuth() === true; } catch { return false; }
  }, [token, checkAuth]);
  return <Prepared key={token} {...props} isCurrent={isCurrent}/>;
}
/* eslint-enable react-hooks/refs */

function Prepared(props: RetentionPeriodsV2PickerProps & { isCurrent: () => boolean }) {
  const { siteId, actorId, workerId, fromDate, throughDate, enabled, apiFetch, isCurrent } = props;
  const client = useMemo(() => {
    try { return new AttendanceRetentionPeriodsV2Client({ siteId, actorId, workerId, fromDate, throughDate, enabled,
      apiFetch: retentionPeriodsV2Fetch(apiFetch, isCurrent), isCurrentAuth: isCurrent }); } catch { return null; }
  }, [siteId, actorId, workerId, fromDate, throughDate, enabled, apiFetch, isCurrent]);
  return client ? <Screen {...props} client={client}/> : <section aria-label="长期周期归档查找" className="min-w-0 space-y-3 p-4">
    <p role="alert">人员、身份或日期范围无效，未读取资料。</p>
    <button type="button" className={button} onClick={props.onClose}>返回保留资料</button>
  </section>;
}

function Screen({ client, fromDate, throughDate, enabled, isCurrent, onSelect, onClose, registerLeaveGuard }:
  RetentionPeriodsV2PickerProps & { client: AttendanceRetentionPeriodsV2Client; isCurrent: () => boolean }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [shown, setShown] = useState(false);
  // There is no draft or pending intent here. Leaving always invalidates the read first.
  const leave = useCallback(() => { client.pause(); return true; }, [client]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => {
    const hide = () => { client.pause(); setShown(false); };
    const eventHide = () => flushSync(hide);
    const show = () => { if (isCurrent() && !document.hidden) setShown(true); };
    const visibility = () => document.hidden ? eventHide() : show();
    if (document.hidden) hide(); else show();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", eventHide); window.addEventListener("pageshow", show);
    return () => {
      // pause is reusable for React StrictMode effect replay; it releases the request and all displayed data.
      client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", eventHide); window.removeEventListener("pageshow", show);
    };
  }, [client, isCurrent]);
  const current = () => shown && enabled && isCurrent() && !document.hidden;
  const busy = state.phase === "loading", ready = shown && enabled && isCurrent() && !busy;
  const result = shown && isCurrent() ? state.result : null;
  const read = (run: () => Promise<void>) => { if (current() && !busy) void run(); };
  return <section aria-label="长期周期归档查找" className="min-w-0 space-y-4 p-4 text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">按长期周期／版本查找归档</h2>
      <button type="button" className={button} onClick={() => { if (isCurrent() && leave()) onClose(); }}>返回保留资料</button></header>
    <p className="break-words text-sm leading-6">这里只查找已保存归档，不试算整期、不删除或保全资料。选择后仍需重新核对本条归档及当前权限；同一归档可能被多个版本复用。</p>
    <p className="break-words text-sm">相交搜索日期：{fromDate} — {throughDate}。读取版本使用所选周期保存的完整日期，不用搜索窗口替代。</p>
    {!enabled && <p role="alert" className="text-sm">长期周期查找入口未开启，未读取任何资料。</p>}
    <p role="status" aria-live="polite" className="break-words text-sm">{shown ? state.message : "资料已隐藏；返回后需明确重新读取。"}</p>
    {shown && <button type="button" className={button} disabled={!ready} onClick={() => read(() => client.list())}>读取长期周期</button>}
    {result?.kind === "list" && <section aria-label="长期周期列表" className="min-w-0 space-y-3">
      <p className="text-sm">本页最多25个周期；换页会替换当前列表，不会自动读取后续页或归档正文。</p>
      {!result.items.length && <p className="text-sm">本页没有可读取的周期。</p>}
      <ol className="min-w-0 space-y-3">{result.items.map(period => <li key={period.periodId} data-period-id={period.periodId} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
        <p className="break-words">{period.workerName}{period.workerNo ? ` · ${period.workerNo}` : ""}</p>
        <p className="break-words">保存日期：{period.fromDate} — {period.throughDate} · {period.timeZone}</p>
        <p>当前版本 {period.currentVersion} · 修订 {period.revision}</p><p className="break-all">周期编号：{period.periodId}</p>
        <button type="button" className={button} disabled={!ready} onClick={() => read(() => client.openPeriod(period.periodId))}>读取此周期版本</button>
      </li>)}</ol>
      <button type="button" className={button} disabled={!ready || !result.nextCursor} onClick={() => read(() => client.nextPeriods())}>下一页周期</button>
    </section>}
    {result?.kind === "versions" && <section aria-label="周期归档版本列表" className="min-w-0 space-y-3">
      <p className="break-words text-sm">保存周期：{result.period.fromDate} — {result.period.throughDate} · {result.period.timeZone}</p>
      <p className="break-all text-sm">周期编号：{result.period.periodId}</p>
      <p className="text-sm">本页最多20个版本，只显示元数据。不同版本即使归档编号相同，也不会自动合并或改变保存记录。</p>
      {!result.items.length && <p className="text-sm">本页没有可读取的版本。</p>}
      <ol className="min-w-0 space-y-3">{result.items.map(version => <li key={version.version} data-version={version.version} data-artifact-id={version.artifactId}
        className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
        <p>版本 {version.version} · 正文 {version.artifactBytes} 字节</p>
        <p className="break-all">保存 UTC：{version.recordedAt}<br/>归档编号：{version.artifactId}</p>
        <button type="button" className={button} disabled={!ready || state.phase !== "ready"} onClick={() => {
          handoffRetentionPeriodArtifact(client, version.version, current, onSelect);
        }}>核对本条归档</button>
      </li>)}</ol>
      <button type="button" className={button} disabled={!ready || !result.nextCursor} onClick={() => read(() => client.nextVersions())}>下一页版本</button>
    </section>}
  </section>;
}
