"use client";
//243 Local-only discovery; a saved query is not current authority or a receipt.
import { useEffect, useMemo, useRef, useState } from "react";
import { discoverApplicationWindowPendings, type ApplicationWindowPrepareQuery } from "@/lib/merchantAttendanceApplicationWindowClient";
const currentAuth = () => true;
export type ApplicationWindowRecoveryLauncherProps = { siteId: string; employeeId: string; authUserId: string; family: "correction" | "correction_revision" | "missing";
  disabled?: boolean; isCurrentAuth?: () => boolean; beforeDiscover: () => boolean; onSelect: (query: ApplicationWindowPrepareQuery) => void };
export default function MerchantAttendanceApplicationWindowRecoveryLauncher({ siteId, employeeId, authUserId, family, disabled = false, isCurrentAuth = currentAuth, beforeDiscover, onSelect }: ApplicationWindowRecoveryLauncherProps) {
  const marker = useMemo(() => ({ siteId, employeeId, authUserId, family, isCurrentAuth }), [siteId, employeeId, authUserId, family, isCurrentAuth]);
  /* eslint-disable react-hooks/refs -- Revoke an older local SHA lease synchronously; not rendered state. */
  const latest = useRef(marker), mounted = useRef(false), generation = useRef(0); if(latest.current!==marker){latest.current=marker;++generation.current;}
  /* eslint-enable react-hooks/refs */
  const [state, setState] = useState<{ marker: typeof marker; busy: boolean; message: string; items: readonly { query: ApplicationWindowPrepareQuery; operationId: string }[] }>({ marker, busy: false, message: "", items: [] });
  useEffect(() => { mounted.current = true; const invalidate=()=>{++generation.current;};const hide = () => { if (document.hidden) { invalidate(); setState({ marker, busy: false, message: "", items: [] }); } };
    document.addEventListener("visibilitychange", hide); return () => { mounted.current = false; invalidate(); document.removeEventListener("visibilitychange", hide); }; }, [marker]);
  const shown = state.marker === marker ? state : { busy: false, message: "", items: [] };
  const read = async () => { if (disabled || shown.busy || document.hidden || !isCurrentAuth() || !beforeDiscover()) return; const g = ++generation.current;
    const live = () => mounted.current && latest.current === marker && generation.current === g && !document.hidden && isCurrentAuth();
    setState({ marker, busy: true, message: "仅检查本标签页三个已知申请槽，不发送HTTP。", items: [] });
    try { const all = await discoverApplicationWindowPendings({ siteId, employeeId, authUserId, isCurrentAuth: live, storage: () => sessionStorage }); if (!live()) return;
      const items = all.filter(item => family === "missing" ? item.query.family.startsWith("missing") : item.query.family === family);
      setState({ marker, busy: false, items, message: items.length ? "找到完整原意图；选择后只可显式GET核对。" : "此类申请槽未发现可验证的新窗口编号；没有删除或迁移任何数据。" });
    } catch { if (live()) setState({ marker, busy: false, items: [], message: "无法完整验证本地原意图；原槽保持不变，请使用原账号核对。" }); }
  };
  return <div className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
    <button type="button" className="rounded-xl border bg-white px-3 py-2 disabled:opacity-40" disabled={disabled || shown.busy} onClick={() => void read()}>核验规则窗口原编号</button>
    {shown.message && <p role="status">{shown.message}</p>}
    {shown.items.map(item => <button type="button" className="block max-w-full break-all rounded-xl border bg-white p-3 text-left" key={item.operationId} disabled={disabled || shown.busy}
      onClick={() => { if (!disabled && !document.hidden && latest.current === marker && isCurrentAuth() && beforeDiscover()) onSelect(item.query); }}>打开原编号核对：{item.operationId}</button>)}
  </div>;
}
