"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { merchantEnterpriseSupabase as supabase, isEnterpriseLogoutBlocked, onEnterpriseAuthStateChange, signInEnterpriseWithPassword, signOutEnterpriseSession } from "@/lib/merchantEnterpriseSupabase";
import { AttendanceOnsiteClockClient } from "@/lib/merchantAttendanceOnsiteClockClient";
import { AttendanceOnsiteScheduleClient } from "@/lib/merchantAttendanceOnsiteScheduleClient";
import MerchantAttendanceOnsiteScheduleClock, { onsiteScheduleCodeOwner } from "./MerchantAttendanceOnsiteScheduleClock";
import { decodeOnsiteToken, onsiteScanOrigin, parseOnsiteRecoveryLocation, parseOnsiteScanUrl, ONSITE_SCAN_PATH } from "@/lib/merchantAttendanceOnsiteQrBrowser";
import MerchantAttendanceOnsiteScanner from "./MerchantAttendanceOnsiteScanner";
import OperationalPunchHost from "./MerchantAttendanceOperationalPunchHost";

type Auth = { userId: string; email: string; token: string };
type Session = { access_token: string; user: { id: string; email?: string } } | null;
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:opacity-40";
export default function MerchantAttendanceOnsitePhone({ scanOrigin, onsiteScheduleEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_ENABLED === "1" }: { scanOrigin: string | null; onsiteScheduleEnabled?: boolean }) {
  const [siteId, setSiteId] = useState<string | null>(null), [code, setCode] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [codeRevision, setCodeRevision] = useState(0);
  const [auth, setAuth] = useState<Auth | null>(null), [checking, setChecking] = useState(true), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState(""), generation = useRef(0), mounted = useRef(false), scope = useRef<string | null>(null);
  const origin = useMemo(() => { try { return onsiteScanOrigin(scanOrigin); } catch { return null; } }, [scanOrigin]);
  const accept = useCallback((value: string) => {
    // A rejected new scan must not leave a previous, already-consumed code
    // usable in the child confirmation panel.
    setCodeRevision(revision => revision + 1);
    try { if (!origin) throw Error("origin_unavailable"); const parsed = parseOnsiteScanUrl(value, origin);
      if (scope.current && parsed.siteId !== scope.current) { setNotice("二维码属于另一家企业。请核对原企业的待确认记录，不会切换企业或提交打卡。"); setCode(null); return; }
      if (document.hidden) { setCode(null); setNotice("页面已隐藏，现场码未保留。返回后请重新扫码。"); return; }
      scope.current = parsed.siteId; setSiteId(parsed.siteId); setCode(parsed.token); setNotice("已读取现场码，请核对本人账号和动作。扫码不会自动打卡。");
    } catch { setNotice("这不是当前入口的有效现场码链接，请扫描门店屏幕上的新码。"); setCode(null); }
    finally { setPasted(""); window.history.replaceState(window.history.state, "", ONSITE_SCAN_PATH + (scope.current ? "?siteId=" + scope.current : "")); }
  }, [origin]);
  useEffect(() => {
    const readLocation = () => {
      const href = window.location.href;
      // Remove capabilities before login, navigation or any attendance request.
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      if (new URL(href).hash) { accept(href); return; }
      try {
        if (!origin) throw Error("origin_unavailable");
        const recovered = parseOnsiteRecoveryLocation(href, origin);
        if (scope.current && recovered !== scope.current) throw Error("scope_changed");
        scope.current = recovered; setSiteId(recovered);
      } catch { setNotice("现场码链接无效或企业不同，请核对原企业的记录后重新扫码。不会提交打卡。"); setCode(null); setCodeRevision(revision => revision + 1);
        window.history.replaceState(window.history.state, "", ONSITE_SCAN_PATH + (scope.current ? "?siteId=" + scope.current : "")); }
    };
    readLocation();
    // Native-camera rescans can reuse this document, rather than remounting it.
    window.addEventListener("hashchange", readLocation); window.addEventListener("popstate", readLocation); window.addEventListener("pageshow", readLocation);
    return () => { window.removeEventListener("hashchange", readLocation); window.removeEventListener("popstate", readLocation); window.removeEventListener("pageshow", readLocation); };
  }, [origin, accept]);
  useEffect(() => {
    mounted.current = true;
    const revision = ++generation.current;
    const apply = (session: Session) => { const current = isEnterpriseLogoutBlocked() ? null : session; setAuth(current ? { userId: current.user.id, email: current.user.email ?? "当前员工", token: current.access_token } : null); setChecking(false); };
    const { data } = onEnterpriseAuthStateChange((_event, session) => { if (!mounted.current) return; generation.current++; apply(session); });
    void supabase.auth.getSession().then(result => { if (mounted.current && revision === generation.current) apply(result.error ? null : result.data.session); }, () => { if (mounted.current && revision === generation.current) apply(null); });
    const clear = () => { setCode(null); setPasted(""); setPassword(""); };
    const hide = () => { if (document.hidden) clear(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", clear);
    return () => { mounted.current = false; data.subscription.unsubscribe(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", clear); };
  }, []);
  useEffect(() => {
    if (!code) return;
    let delay = 0; try { delay = Math.max(0, Math.min(45000, decodeOnsiteToken(code).expiresAtMs - Date.now())); } catch { /* Clear invalid input below. */ }
    const timer = setTimeout(() => { setCode(null); setNotice("现场码已过期或不可用。登录后可重新扫码；原操作编号不会丢弃。"); }, delay);
    return () => clearTimeout(timer);
  }, [code]);
  const consumed = useCallback(() => setCode(null), []);
  const signIn = async () => {
    if (busy) return; setBusy(true); setNotice(""); const attempt = ++generation.current;
    try {
      const result = await signInEnterpriseWithPassword({ email: email.trim().toLowerCase(), password });
      if (!mounted.current) return;
      if (result.error || !result.data.session) { if (attempt === generation.current) setNotice("登录失败，请核对员工邮箱和密码后重试。"); }
      else if (attempt === generation.current && !isEnterpriseLogoutBlocked()) { const s = result.data.session; setAuth({ userId: s.user.id, email: s.user.email ?? "当前员工", token: s.access_token }); setChecking(false); }
    } catch { if (mounted.current && attempt === generation.current) setNotice("暂时无法登录，请稍后再试。"); }
    finally { if (mounted.current) { setPassword(""); setBusy(false); } }
  };
  const signOut = async () => {
    if (busy) return; setBusy(true); const operation = signOutEnterpriseSession(); generation.current++; setAuth(null); setCode(null); setPasted(""); setPassword("");
    try { const result = await operation; if (result.error) { setNotice(result.localCleared ? "已清除本标签页登录，服务器退出请求未确认。其他设备的登录状态可能仍有效。" : result.error.message); } else setNotice("已退出。原账号的待确认编号仍保留在本标签页，不会自动提交。"); }
    catch { if (mounted.current) setNotice("页面已清除登录资料，但退出请求未确认，请重新核对账号会话。"); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <main className="mx-auto min-h-screen max-w-xl space-y-5 px-4 py-8 text-slate-900">
    <h1 className="text-2xl font-bold">现场扫码打卡</h1>
    <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6">请在本人手机上使用，不要在公共门店终端登录。现场码短时有效，登录或核对耗时较长时，请重新扫码。仅在线提交，以服务器确认时间为准。</p>
    {siteId && <p className="text-sm">当前企业：{siteId}</p>}
    {!origin ? <p role="alert">安全入口尚未配置，暂不能扫码打卡，请联系企业负责人。</p> : <>
      {checking ? <p role="status">正在核对企业账号…</p> : !auth ? <form className="space-y-4 rounded-2xl border bg-white p-5" onSubmit={e => { e.preventDefault(); void signIn(); }}>
        <h2 className="font-semibold">先登录本人员工账号</h2>
        <label className="block text-sm">员工邮箱<input className="mt-2 w-full rounded-xl border p-3" type="email" autoComplete="email" maxLength={254} value={email} disabled={busy} onChange={e => setEmail(e.target.value)}/></label>
        <label className="block text-sm">密码<input className="mt-2 w-full rounded-xl border p-3" type="password" autoComplete="current-password" maxLength={256} value={password} disabled={busy} onChange={e => setPassword(e.target.value)}/></label>
        <button className={button} disabled={busy || !email.trim() || !password}>登录后核对打卡</button>
        <Link href="/enterprise" prefetch={false} className="block text-sm underline">忘记密码／首次设置密码（完成后重新扫码）</Link>
      </form> : <section aria-label="当前登录员工" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4">
        <p className="break-all text-sm">本人账号：{auth.email}</p><button type="button" className={button} disabled={busy} onClick={() => void signOut()}>退出／更换账号</button>
      </section>}
      {notice && <p role="status" className="break-words text-sm leading-6">{notice}</p>}
      <section className="space-y-4 rounded-2xl border bg-white p-5" aria-label="读取门店现场码">
        <MerchantAttendanceOnsiteScanner onScan={accept} disabled={busy || checking}/>
        <details><summary className="cursor-pointer text-sm">无法使用摄像头？粘贴现场码链接</summary>
          <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); accept(pasted.trim()); }}>
            <label className="block text-sm">现场码链接<input className="mt-2 w-full rounded-xl border p-3 text-sm" autoComplete="off" spellCheck={false} maxLength={2100} value={pasted} disabled={busy} onChange={e => setPasted(e.target.value)}/></label>
            <button className={button} disabled={busy || !pasted.trim()}>读取现场码（不打卡）</button>
          </form>
        </details>
      </section>
      {auth && siteId && <EmployeeClock key={siteId + ":" + auth.userId + ":" + auth.token} siteId={siteId} auth={auth} code={code} codeRevision={codeRevision} consumed={consumed} scheduleEnabled={onsiteScheduleEnabled}/>}
      {auth && !siteId && <p className="text-sm">请先扫描门店现场码，确定所属企业。尚未提交任何打卡。</p>}
    </>}
    <p className="text-xs leading-6 text-slate-500">摄像头画面不保存、不上传；现场码仅用于本次服务器核验。待确认时仅保存本标签页的企业、账号标识和原操作编号等非秘密信息；刷新只查原结果，不会自动补打。关闭标签页可能丢失待确认编号，可请负责人核对历史记录。</p>
  </main>;
}
function EmployeeClock({ siteId, auth, code, codeRevision, consumed, scheduleEnabled }: { siteId: string; auth: Auth; code: string | null; codeRevision: number; consumed: () => void; scheduleEnabled: boolean }) {
  const apiFetch = useCallback((url: string, init: RequestInit = {}) => { const headers = new Headers(init.headers); headers.set("x-merchant-access-token", auth.token);
    return fetch(url, { ...init, headers, credentials: "omit", redirect: "error" }); }, [auth.token]);
  return <OperationalPunchHost scope={{ siteId, channel: "onsite", authUserId: auth.userId, terminalId: null, workerNo: null }} apiFetch={apiFetch} token={code} consumeToken={consumed}>
    <LegacyEmployeeClock siteId={siteId} auth={auth} code={code} codeRevision={codeRevision} consumed={consumed} scheduleEnabled={scheduleEnabled}/>
  </OperationalPunchHost>;
}
function LegacyEmployeeClock({ siteId, auth, code, codeRevision, consumed, scheduleEnabled }: { siteId: string; auth: Auth; code: string | null; codeRevision: number; consumed: () => void; scheduleEnabled: boolean }) {
  const apiFetch = useCallback((url: string, init: RequestInit = {}) => { const headers = new Headers(init.headers); headers.set("x-merchant-access-token", auth.token);
    return fetch(url, { ...init, headers, credentials: "omit", redirect: "error" }); }, [auth.token]);
  const client = useMemo(() => new AttendanceOnsiteClockClient({ siteId, authUserId: auth.userId, apiFetch, storage: () => sessionStorage }), [siteId, auth.userId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const scheduleClient = useMemo(() => new AttendanceOnsiteScheduleClient({ siteId, authUserId: auth.userId, apiFetch, enabled: scheduleEnabled, storage: () => sessionStorage,
    canStart: () => { const current = client.getSnapshot(); return ["ready", "confirmed"].includes(current.phase) && !current.pending; } }), [siteId, auth.userId, apiFetch, scheduleEnabled, client]);
  const scheduleState = useSyncExternalStore(scheduleClient.subscribe, scheduleClient.getSnapshot, scheduleClient.getSnapshot);
  const codeOwner = onsiteScheduleCodeOwner(state, scheduleState, scheduleEnabled);
  const scheduleConfirmed = useCallback(() => { void client.read(); }, [client]);
  const [now, setNow] = useState(() => Date.now());
  const remaining = state.code ? Math.max(0, Math.min(45, Math.ceil((state.code.expiresAtMs - now) / 1000))) : 0;
  useEffect(() => { void client.initialize(); const clear = () => client.clearCode(), hide = () => { if (document.hidden) clear(); };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", clear);
    return () => { client.dispose(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", clear); }; }, [client]);
  useEffect(() => { client.clearCode(); scheduleClient.clearCode(); }, [client, scheduleClient, codeRevision, codeOwner]);
  useEffect(() => {
    if (!code || ["loading", "saving"].includes(state.phase) || ["loading", "saving"].includes(scheduleState.phase)) return;
    if (codeOwner === "schedule") { client.clearCode(); scheduleClient.setCode(code); }
    else if (codeOwner === "old") { scheduleClient.clearCode(); client.setCode(code); }
    else { client.clearCode(); scheduleClient.clearCode(); }
    consumed();
  }, [client, scheduleClient, code, codeRevision, codeOwner, consumed, state.phase, scheduleState.phase]);
  useEffect(() => {
    if (!state.code) return;
    const tick = () => { const current = Date.now(); setNow(current); if (current >= state.code!.expiresAtMs) client.clearCode(); };
    const initial = setTimeout(tick, 0), timer = setInterval(tick, 1000); return () => { clearTimeout(initial); clearInterval(timer); };
  }, [client, state.code]);
  const busy = ["loading", "saving"].includes(state.phase), r = state.result;
  const scheduleBlocked = !!scheduleState.pending || ["loading", "saving", "storage_error"].includes(scheduleState.phase);
  const canPunch = !busy && !scheduleBlocked && !!state.code && remaining > 0 && !!r;
  const selectedClockIn = !state.pending && scheduleEnabled && r?.state.status === "off" && scheduleState.result?.selectionEnabled !== false;
  const punch = (action: Parameters<AttendanceOnsiteClockClient["punch"]>[0]) => { if (!scheduleClient.blocksOtherActions()) void client.punch(action); };
  return <section className="space-y-4 rounded-2xl border border-teal-200 bg-white p-5" aria-label="本人现场打卡确认">
    <h2 className="font-semibold">核对后确认动作</h2>
    <p role="status" className="break-words text-sm leading-6">{state.message}</p>
    <p className="text-sm">{codeOwner === "schedule" ? "现场码由下方选班确认区独占；读取排班不验证现场码。" : state.code ? `当前现场码剩余约 ${remaining} 秒（服务器最终核对有效期）` : "未持有可用现场码；可重新扫码，查询原结果无需扫码。"}</p>
    {r && <>
      <p>当前：{{ off: "未上班", working: "工作中", break: "休息中" }[r.state.status]}</p>
      {r.receipt && <p className="break-all text-sm">原操作收据：{r.receipt.id}<br/>服务器时间：{r.receipt.occurredAt}（UTC）</p>}
      {state.pending ? <button type="button" className={button} disabled={!canPunch} onClick={() => punch(null)}>核对后按原编号重试</button> : <div className="flex flex-wrap gap-3">
        {r.state.status === "off" && !selectedClockIn && <button type="button" className={button} disabled={!canPunch || !state.moduleEnabled} onClick={() => punch("clock_in")}>确认上班</button>}
        {r.state.status === "working" && <><button type="button" className={button} disabled={!canPunch || !state.moduleEnabled} onClick={() => punch("break_start")}>确认开始休息</button><button type="button" className={button} disabled={!canPunch} onClick={() => punch("clock_out")}>确认下班</button></>}
        {r.state.status === "break" && <button type="button" className={button} disabled={!canPunch} onClick={() => punch("break_end")}>确认结束休息</button>}
      </div>}
      {!state.moduleEnabled && <p className="text-sm">暂停新上班／休息；仍可按当前权限核对结果、结束已有休息或下班。</p>}
    </>}
    <button type="button" className={button} disabled={busy} onClick={() => void client.read()}>只读核对当前状态／原操作</button>
    <MerchantAttendanceOnsiteScheduleClock client={scheduleClient} legacyState={state} enabled={scheduleEnabled} active={state.phase !== "blocked"} onConfirmed={scheduleConfirmed}/>
  </section>;
}
