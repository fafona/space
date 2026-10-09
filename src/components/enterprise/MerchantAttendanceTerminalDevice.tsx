"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { attendanceManagementRequest } from "@/lib/merchantAttendanceManagementClient";
import { TERMINAL_DEVICE_API, parseTerminalDevice, parseTerminalToken, terminalMessage, type TerminalDevice } from "@/lib/merchantAttendanceTerminal";
import { terminalErrorStatuses } from "@/lib/merchantAttendanceTerminalClient";
import { pairedTerminalGuidance, terminalConfigurationGuidance, terminalEntryGuidance } from "@/lib/merchantAttendanceTerminalGuidance";
import MerchantAttendanceTerminalRecovery from "./MerchantAttendanceTerminalRecovery";

const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export default function MerchantAttendanceTerminalDevice({recoveryUrl, onsiteEnabled = false}:{recoveryUrl?:string|null; onsiteEnabled?:boolean}={}) {
  const [state, setState] = useState<{ phase: "loading" | "unpaired" | "paired" | "blocked"; data: TerminalDevice | null; message: string }>({ phase: "loading", data: null, message: "正在检查当前终端凭证…" });
  const [token, setToken] = useState(""), [clearConfirmed, setClearConfirmed] = useState(false);
  const controller = useRef<AbortController | null>(null), generation = useRef(0), disposed = useRef(false);
  const request = useCallback(async (action: "status" | "pair" | "clear", inputToken?: string) => {
    if (disposed.current || controller.current) return;
    const g = ++generation.current, abort = new AbortController(); controller.current = abort;
    setState({ phase: "loading", data: null, message: "正在核对终端，请勿重复提交…" }); setToken(""); setClearConfirmed(false);
    try {
      const b = await attendanceManagementRequest((url, init) => fetch(url, { ...init, credentials: "same-origin", redirect: "error" }), TERMINAL_DEVICE_API,
        action === "status" ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "pair" ? { action, token: inputToken } : { action }) },
        { signal: abort.signal, errorStatuses: terminalErrorStatuses, maxBytes: 8192 });
      if (disposed.current || g !== generation.current) return;
      if (action === "clear") {
        if (b.cleared !== true) throw Error("invalid_response");
        setState({ phase: "unpaired", data: null, message: "已清除此浏览器凭证，但没有撤销服务器授权；不用的终端仍需负责人撤销。" });
      } else if (b.paired === false && action === "status") setState({ phase: "unpaired", data: null,
        message: "当前浏览器没有终端凭证。如刚才配对结果不确定，请先让负责人核对并撤销原终端，再生成新配对码。" });
      else {
        if (b.paired !== true || typeof b.moduleEnabled !== "boolean") throw Error("invalid_response");
        const data = parseTerminalDevice({ siteId: b.siteId, terminal: b.terminal, attendanceEnabled: b.attendanceEnabled, clockEnabled: b.clockEnabled },
          action === "pair" ? parseTerminalToken(inputToken) : undefined);
        setState({ phase: "paired", data, message: pairedTerminalGuidance(process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED === "1", onsiteEnabled, b.moduleEnabled) });
      }
    } catch (e) {
      if (!disposed.current && g === generation.current) setState({ phase: "blocked", data: null, message: terminalMessage(e instanceof Error ? e.message : "") });
    } finally { if (g === generation.current) controller.current = null; }
  }, [onsiteEnabled]);
  useEffect(() => {
    disposed.current = false; void request("status");
    const cancel = () => { generation.current++; controller.current?.abort(); controller.current = null; };
    const hide = () => { if (document.hidden) {
      cancel(); setToken("");
      setState({ phase: "blocked", data: null, message: "页面返回后请重新检查状态，不会自动重新配对。" });
    } };
    document.addEventListener("visibilitychange", hide);
    return () => { disposed.current = true; cancel(); document.removeEventListener("visibilitychange", hide); };
  }, [request]);
  const busy = state.phase === "loading";
  return <main className="mx-auto min-h-screen max-w-2xl space-y-5 p-5 py-10 text-slate-900">
    <p className="text-xs font-semibold tracking-widest text-slate-500">FAOLLA ENTERPRISE</p>
    <h1 className="text-2xl font-bold">门店终端</h1>
    <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6">{terminalEntryGuidance(process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED === "1", onsiteEnabled)}请使用门店专用浏览器，不要在此登录企业负责人账号。浏览器配对不等于设备物理位置验证，也不提供系统锁屏。</p>
    <p role="status" className="text-sm leading-6">{state.message}</p>
    {process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED==="1"&&<MerchantAttendanceTerminalRecovery url={recoveryUrl}/>}
    <button className={button} disabled={busy} onClick={() => void request("status")}>检查当前终端状态</button>
    {onsiteEnabled && <Link prefetch={false} className="block rounded-xl border border-slate-300 bg-white p-4 text-sm font-semibold" href="/enterprise/attendance-terminal/onsite">展示门店动态现场码（需已配对）</Link>}
    {state.data && <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold">{state.data.terminal.label}</h2><p>{state.data.terminal.locationName} · {state.data.terminal.timeZone}</p>
      <p className="text-sm">企业：{state.data.siteId}</p><p className="break-all font-mono text-xs">终端：{state.data.terminal.id}</p>
      <p className="text-sm">凭证有效至：{new Date(state.data.terminal.deviceExpiresAt!).toLocaleString()}</p>
      <p className="text-sm text-slate-600">{terminalConfigurationGuidance(state.data.attendanceEnabled)}</p>
      {process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_ENABLED==="1"&&<Link prefetch={false} className="inline-block text-sm underline" href="/enterprise/attendance-terminal/pin">试点：验证员工 PIN（不打卡）</Link>}
      {process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED==="1"&&<Link prefetch={false} className="block rounded-xl border border-slate-300 p-3 text-sm font-semibold" href="/enterprise/attendance-terminal/clock">进入门店 PIN 打卡</Link>}
    </section>}
    {state.phase === "unpaired" && <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={e => {
      e.preventDefault(); try { parseTerminalToken(token.trim()); void request("pair", token.trim()); }
      catch { setState({ phase: "unpaired", data: null, message: "请粘贴负责人提供的完整配对码。" }); }
    }}>
      <label className="block text-sm font-semibold">粘贴一次性配对码<textarea aria-label="粘贴一次性配对码" className="mt-2 w-full min-w-0 rounded-xl border border-slate-300 p-3 font-mono text-sm" rows={3}
        autoComplete="off" spellCheck={false} maxLength={100} value={token} onChange={e => setToken(e.target.value)}/></label>
      <p className="text-xs leading-5 text-slate-500">五分钟有效且只能使用一次。只需配对码，不需要负责人密码、员工密码或服务密钥。</p>
      <button className={button} disabled={!token.trim()} type="submit">确认配对此浏览器</button>
    </form>}
    {state.phase !== "unpaired" && !busy && <section className="space-y-3 rounded-xl border border-slate-200 p-4">
      <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1" checked={clearConfirmed} onChange={e => setClearConfirmed(e.target.checked)}/>
        <span>我知道清除仅影响此浏览器；停用或更换终端还需要负责人撤销服务器授权。</span></label>
      <button className={button} disabled={!clearConfirmed} onClick={() => void request("clear")}>清除此浏览器终端凭证</button>
    </section>}
  </main>;
}
