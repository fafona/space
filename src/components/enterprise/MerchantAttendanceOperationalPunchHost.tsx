"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { operationalPunchPendingKey, type OperationalPunchClientScope } from "@/lib/merchantAttendanceOperationalPunchClient";
import { operationalPunchUiPendingRoutes } from "@/lib/merchantAttendanceOperationalPunchUi";
import Workspace, { type OperationalPunchWorkspaceProps } from "./MerchantAttendanceOperationalPunchWorkspace";
type Route = { scope: OperationalPunchClientScope; valid: boolean; workerId: string | null };
type Mode = { key: string; open: boolean; routes: Route[]; target: Route };
const labels = { self: "普通网页", location: "定位", onsite: "现场扫码", pin: "终端 PIN" };

// One writer surface. Other same-Auth web slots are original-number recovery
// only, so the outer self host cannot hide a pending location's recovery path.
export default function MerchantAttendanceOperationalPunchHost({ children, beforeOpen, openOperationalOnMount = false, ...props }: Omit<OperationalPunchWorkspaceProps, "onClose"> & { children: ReactNode; beforeOpen?: () => boolean; openOperationalOnMount?: boolean }) {
  const { siteId, channel, authUserId, terminalId, workerNo } = props.scope, defaultWorker = props.workerId ?? null;
  const key = operationalPunchPendingKey(props.scope), [mode, setMode] = useState<Mode | null>(null), guard = useRef<(() => boolean) | null>(null);
  // This local-only hint opens the existing workspace once. It is not a ready
  // result or an authorization token, and cannot follow an Auth/scope change.
  const initialOpen = useRef({ key, requested: openOperationalOnMount });
  const parentRegister = props.registerLeaveGuard;
  const register = useCallback((value: (() => boolean) | null) => { guard.current = value; parentRegister?.(value); }, [parentRegister]);
  const inspect = useCallback((forceOpen: boolean): Mode => {
    const scope = { siteId, channel, authUserId, terminalId, workerNo }, fallback = { scope, valid: true, workerId: defaultWorker };
    try { const routes = operationalPunchUiPendingRoutes(scope, sessionStorage), target = routes.find(r => r.scope.channel === channel) ?? routes[0] ?? fallback;
      return { key, open: forceOpen || routes.length > 0, routes, target }; }
    catch { return { key, open: true, routes: [], target: fallback }; }
  }, [siteId, channel, authUserId, terminalId, workerNo, defaultWorker, key]);
  useEffect(() => {
    // Local-only gate before mounting a legacy writer. No automatic HTTP.
    if (initialOpen.current.key !== key) initialOpen.current = { key, requested: false };
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (!initialOpen.current.requested) setMode(inspect(false));
      else setMode(previous => previous?.key === key ? previous : inspect(true));
    });
    return () => { active = false; };
  }, [inspect, key]);
  if (mode?.key !== key) return <p role="status">正在检查本标签页待确认编号…</p>;
  if (mode.open) return <>
    {mode.routes.length > 1 && <nav aria-label="选择原号通路" className="my-3 flex flex-wrap gap-3">{mode.routes.map(r => <button key={r.scope.channel} type="button" className="rounded-xl border px-3 py-2 text-sm" onClick={() => {
      if (document.hidden || guard.current && !guard.current()) return; setMode({ ...mode, target: r });
    }}>核对{labels[r.scope.channel]}原号</button>)}</nav>}
    <Workspace {...props} key={operationalPunchPendingKey(mode.target.scope)} scope={mode.target.scope} workerId={mode.target.workerId}
      recoveryOnly={mode.target.scope.channel !== channel} registerLeaveGuard={register} onClose={() => setMode(inspect(false))}/>
  </>;
  return <><div className="my-4 rounded-xl border border-blue-200 bg-white p-3"><button type="button" className="rounded-xl border border-blue-300 px-4 py-3 text-sm font-semibold" onClick={() => {
    if (document.hidden || beforeOpen && !beforeOpen() || !window.confirm("打开规则打卡将关闭当前打卡操作区并清除未提交选择；已保存原编号不会删除。继续？")) return;
    setMode(inspect(true));
  }}>规则打卡／原号核对</button><p className="mt-2 text-xs text-slate-600">收到“需使用规则打卡入口”提示时，可在此核对；不会自动打卡。</p></div>{children}</>;
}
