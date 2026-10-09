"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendancePeriodClosureV2Client, type PeriodClosureV2ClientState } from "@/lib/merchantAttendancePeriodClosureV2Client";
import { periodClosureAllowsMutation, periodClosureCanSendPreview } from "@/lib/merchantAttendancePeriodClosureClient";
import type { PeriodClosureStorage } from "@/lib/merchantAttendancePeriodClosureClient";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { PeriodClosureCommand, PeriodClosureSummary } from "@/lib/merchantAttendancePeriodClosure";
import type { PeriodClosureV2Cursor, PeriodClosureV2ListItem, PeriodClosureV2Result } from "@/lib/merchantAttendancePeriodClosureV2";
import { deliverAttendancePrint } from "@/lib/merchantAttendancePrintBrowser";
import { buildPeriodClosureOutput, confirmPeriodClosureAction, PeriodClosureSavedReport } from "./MerchantAttendancePeriodClosureWorkspace";
import type { PeriodClosureLauncherProps, PeriodClosureNotificationTarget } from "./MerchantAttendancePeriodClosureLauncher";

type Props = PeriodClosureLauncherProps & { onClose: () => void };
type Navigation = Pick<Props, "siteId" | "access" | "workerId" | "fromDate" | "throughDate">;
type Action = PeriodClosureCommand["action"];
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white p-2 text-sm";
const actions: Record<Action, string> = { send: "保存版本并发起核对", confirm: "确认本保存版本", dispute: "提出周期争议", respond: "回复周期争议", seal: "封存本人已确认版本", reopen: "说明理由并重开" };
const states: Record<PeriodClosureSummary["state"], string> = { open: "已重开，准备中", review: "待本人核对", confirmed: "本人已明确确认", disputed: "有争议待处理", sealed: "已封存" };
export function periodClosureNotificationMatches(result: PeriodClosureV2Result | null, target: PeriodClosureNotificationTarget) {
  if (!result || result.kind === "list") return false;
  const period = result.kind === "preview" ? result.preview.period : result.period;
  if (!period || period.periodId !== target.periodId || period.workerId !== target.workerId || period.employeeId !== target.employeeId
    || period.employeeAuthUserId !== target.employeeAuthUserId || period.fromDate !== target.fromDate || period.throughDate !== target.throughDate) return false;
  if (result.kind === "preview") { const a = result.preview.artifact;
    return a.worker.workerId === target.workerId && a.worker.employeeId === target.employeeId && a.worker.employeeAuthUserId === target.employeeAuthUserId
      && a.period.fromDate === target.fromDate && a.period.throughDate === target.throughDate; }
  return true;
}

/** A render-time scope change can precede layout cleanup. Every storage
 * boundary must reject the old controller, including a previously captured
 * storage handle about to acknowledge a delayed response. */
export function periodClosureV2Ports(apiFetch: AttendanceApiFetch, storage: () => PeriodClosureStorage, isCurrent: () => boolean) {
  const check = () => { if (!isCurrent()) throw Error("identity_changed"); };
  const target = () => { check(); const value = storage(); check(); return value; };
  return {
    storage: (): PeriodClosureStorage => { check(); return {
      getItem: key => { const value = target().getItem(key); check(); return value; },
      setItem: (key, value) => { target().setItem(key, value); check(); },
      removeItem: key => { target().removeItem(key); check(); },
    }; },
    apiFetch: (async (path, init) => { check(); const response = await apiFetch(path, init);
      if (!isCurrent()) { void response.body?.cancel().catch(() => {}); throw Error("identity_changed"); } return response;
    }) satisfies AttendanceApiFetch,
  };
}

/** Page reads, recovered receipts and fixed-version reads are not fresh write
 * authority, even when their saved version happens to be the current version. */
export function periodClosureV2Controls(state: PeriodClosureV2ClientState, navigation: Navigation, shown: boolean, enabled: boolean, reason: string) {
  const { result, query, pending, phase } = state;
  const selected = state.navigation ?? navigation;
  const matchesNavigation = !!query && query.siteId === navigation.siteId && query.access === navigation.access
    && selected.workerId === navigation.workerId && query.workerId === selected.workerId && query.fromDate === selected.fromDate && query.throughDate === selected.throughDate
    && (!state.navigation?.periodId || query.periodId === state.navigation.periodId);
  const ready = shown && phase === "ready" && !pending && matchesNavigation;
  const detail = result?.kind === "detail" ? result : null;
  const period = detail?.period ?? null;
  const freshDetail = ready && !!state.navigation && query?.mode === "detail" && query.version === null && !!detail && detail.operation === null;
  const preview = ready && !!state.navigation && query?.mode === "preview" && result?.kind === "preview" ? result.preview : null;
  const newActions = enabled && !!result?.moduleEnabled;
  const currentVersion = !!detail && detail.artifactVersion === period?.currentVersion;
  const validReason = reason === reason.trim() && [...reason].length >= 1 && [...reason].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(reason);
  const owner = navigation.access === "owner";
  const allowed: Record<Action, boolean> = {
    send: !!(owner && preview && newActions && validReason && periodClosureCanSendPreview(preview.blockers)),
    confirm: !!(!owner && freshDetail && newActions && validReason && currentVersion && detail?.artifact && period && ["review", "disputed"].includes(period.state) && detail.sourceChanged === false),
    dispute: !!(!owner && freshDetail && newActions && validReason && currentVersion),
    respond: !!(owner && freshDetail && newActions && validReason && currentVersion && period?.unresolvedDispute),
    seal: !!(owner && freshDetail && newActions && validReason && currentVersion && detail?.artifact && period?.state === "confirmed" && !period.sealed && !period.unresolvedDispute && detail.sourceChanged === false),
    reopen: !!(owner && freshDetail && validReason && currentVersion && period?.sealed && periodClosureAllowsMutation("reopen", enabled, !!result?.moduleEnabled)),
  };
  return { matchesNavigation, allowed,
    busy: phase === "loading" || phase === "saving",
    canRead: shown && phase !== "loading" && phase !== "saving" && !pending,
    canEditReason: !!((preview || freshDetail) && (newActions || owner && period?.sealed)),
    canOutput: !!(ready && state.navigation && detail?.artifact && detail.artifactVersion !== null && query?.mode === "detail"),
  };
}

export default function MerchantAttendancePeriodClosureV2Workspace(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED === "1";
  const key = `${props.siteId}:${props.access}:${props.actorId}:${props.workerId}:${props.fromDate}:${props.throughDate}:${JSON.stringify(props.expectedNotificationTarget ?? null)}`;
  /* eslint-disable react-hooks/refs -- synchronously revoke old authority before layout cleanup, not rendered data */
  const live = useRef({ key, apiFetch: props.apiFetch, auth: props.isCurrentAuth, enabled, token: 0 });
  if (live.current.key !== key || live.current.apiFetch !== props.apiFetch || live.current.auth !== props.isCurrentAuth || live.current.enabled !== enabled) {
    live.current = { key, apiFetch: props.apiFetch, auth: props.isCurrentAuth, enabled, token: live.current.token + 1 };
  }
  const token = live.current.token;
  const isCurrent = useCallback(() => live.current.token === token && props.isCurrentAuth?.() !== false, [token, props.isCurrentAuth]);
  /* eslint-enable react-hooks/refs */
  const [scope, setScope] = useState({ key, apiFetch: props.apiFetch, enabled, epoch: 0 });
  if (scope.key !== key || scope.apiFetch !== props.apiFetch || scope.enabled !== enabled) {
    setScope({ key, apiFetch: props.apiFetch, enabled, epoch: scope.epoch + 1 }); return null;
  }
  return <Prepared key={scope.epoch} {...props} enabled={enabled} isCurrent={isCurrent}/>;
}
function Prepared(props: Props & { enabled: boolean; isCurrent: () => boolean }) {
  const { siteId, access, actorId, workerId, fromDate, throughDate, apiFetch, enabled, isCurrent } = props;
  const client = useMemo(() => { try { return new AttendancePeriodClosureV2Client({ siteId, access, actorId, workerId, fromDate, throughDate, enabled,
    ...periodClosureV2Ports(apiFetch, () => sessionStorage, isCurrent) }); } catch { return null; } },
    [siteId, access, actorId, workerId, fromDate, throughDate, apiFetch, enabled, isCurrent]);
  return client ? <Screen {...props} client={client}/> : <section aria-label="周期核对与封存"><p role="alert">当前身份或周期范围无法核对；未发出请求。</p><button type="button" className={button} onClick={props.onClose}>返回合并核对</button></section>;
}
function Screen(props: Props & { enabled: boolean; client: AttendancePeriodClosureV2Client; isCurrent: () => boolean }) {
  const { access, enabled, fromDate, throughDate, onClose, registerLeaveGuard, client, isCurrent } = props;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(() => typeof document === "undefined" || !document.hidden);
  const epoch = useRef(0), dirty = useRef(false), printController = useRef<AbortController | null>(null);
  const clear = useCallback(() => { dirty.current = false; setReason(""); }, []);
  const invalidate = useCallback(() => { epoch.current++; printController.current?.abort(); printController.current = null; client.pause(); }, [client]);
  const leave = useCallback(() => {
    const generation = epoch.current, snapshot = client.getSnapshot();
    if (!isCurrent()) return false;
    if ((dirty.current || client.hasLeaveRisk()) && !window.confirm("离开会清除未提交理由；已发送操作不撤销，原编号保留。继续？")) return false;
    if (!isCurrent() || generation !== epoch.current || snapshot !== client.getSnapshot()) return false;
    invalidate(); clear(); return true;
  }, [client, clear, invalidate, isCurrent]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => {
    const hide = () => flushSync(() => { invalidate(); clear(); setShown(false); });
    const show = () => { if (isCurrent() && !document.hidden) { flushSync(() => setShown(true)); void client.initialize(); } };
    const visibility = () => document.hidden ? hide() : show();
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    if (document.hidden) { invalidate(); clear(); setShown(false); } else if (isCurrent()) void client.initialize();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { invalidate(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clear, invalidate, isCurrent]);
  const notificationMismatch = !!props.expectedNotificationTarget && !!state.result && !periodClosureNotificationMatches(state.result, props.expectedNotificationTarget);
  const result = shown && !notificationMismatch ? state.result : null, pending = shown ? state.pending : null;
  const controls = periodClosureV2Controls(notificationMismatch ? { ...state, result: null } : state, props, shown, enabled, reason);
  const period = result?.kind === "detail" ? result.period : null;
  const artifact = result?.kind === "preview" ? result.preview.artifact : result?.kind === "detail" ? result.artifact : null;
  const read = (action: () => void, recovering = false) => {
    const generation = epoch.current, snapshot = client.getSnapshot();
    if (!isCurrent() || !shown || document.hidden || controls.busy || snapshot !== state || !!snapshot.pending && !recovering) return;
    if (dirty.current && !window.confirm("读取或翻页会清除未提交理由，继续？")) return;
    if (!isCurrent() || generation !== epoch.current || snapshot !== client.getSnapshot() || document.hidden) return;
    epoch.current++; printController.current?.abort(); printController.current = null; clear(); action();
  };
  const submit = (action: Action) => {
    const generation = epoch.current, snapshot = client.getSnapshot();
    const message = action === "confirm" ? "确认已核对所示保存版本？不代表工资结清、放弃争议或认可后续变化。" : action === "seal" ? "封存本人已确认的指定版本，并限制本员工该范围的新补正／漏卡提交和批准；正常打卡、下班不受阻。确认？"
      : action === "reopen" ? "按此理由重开？旧封存与确认保留，新版本须重新核对；不解开原企业补正锁或延长期限。" : `确认“${actions[action]}”？只对当前版本保存明确操作，不直接修改工时。`;
    confirmPeriodClosureAction(() => window.confirm(message),
      () => isCurrent() && shown && !document.hidden && generation === epoch.current && snapshot === client.getSnapshot() && periodClosureV2Controls(snapshot, props, shown, enabled, reason).allowed[action],
      () => { clear(); void client.submit(action, reason); });
  };
  const output = (kind: "csv" | "print") => {
    if (result?.kind !== "detail" || !result.artifact || result.artifactVersion === null) return;
    const { period, artifactVersion, artifact } = result, generation = epoch.current, snapshot = client.getSnapshot();
    confirmPeriodClosureAction(() => window.confirm("重新核验独立导出权限后输出这个保存版本。下载或打印后平台不能收回副本；不是当前动态报表或工资表。继续？"),
      () => isCurrent() && shown && !document.hidden && epoch.current === generation && client.getSnapshot() === snapshot && periodClosureV2Controls(snapshot, props, shown, enabled, reason).canOutput,
      () => {
        printController.current?.abort(); const lifetime = new AbortController(); printController.current = lifetime;
        void client.exportVersion(period.periodId, artifactVersion, artifact.sourceFingerprint, async (saved, signal, authorized) => {
          const file = buildPeriodClosureOutput(saved, period.periodId, artifactVersion);
          const current = () => isCurrent() && authorized() && epoch.current === generation && !lifetime.signal.aborted;
          if (!current()) throw Error("output_expired");
          if (kind === "print") {
            const started = performance.now(); signal.addEventListener("abort", () => lifetime.abort(), { once: true });
            await deliverAttendancePrint({ ...file, kind: "unified", signal: lifetime.signal, authorized: current, remainingMs: () => Math.max(0, 60000 - (performance.now() - started)) });
          } else {
            const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv;charset=utf-8" })), anchor = document.createElement("a");
            try { if (!current()) throw Error("output_expired"); anchor.href = url; anchor.download = file.filename; anchor.hidden = true; document.body.append(anchor); anchor.click(); }
            finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
          }
        });
      });
  };
  return <section aria-label="周期核对与封存" data-period-closure data-period-closure-v2 className="min-w-0 space-y-4 rounded-2xl border border-indigo-300 bg-white p-3 sm:p-5">
    <header className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-bold">周期核对、争议与封存</h2><button type="button" className={button} onClick={() => { if (leave()) onClose(); }}>返回合并核对</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">双方核对同一保存版本，包含原始记录、最新批准补正及整段漏卡。沉默、已读或负责人回复不代替本人确认。不计算工资或法律签名；缺记录不等于缺勤。{access === "owner" ? "封存及重开仅当前负责人操作。" : "本人只能核对和提出争议，不能代负责人封存或重开。"}</p>
    <p className="text-sm">导航范围 {fromDate} → {throughDate}，单次最多 31 日。已有周期沿同一编号连续追加修订和版本；新版本必须重新核对，旧档案不改写、不删除。</p>
    <p data-period-closure-timezone-rule className="rounded-xl bg-indigo-50 p-3 text-sm leading-6">已有周期继续使用首次保存的时区和每日 UTC 边界；修改企业时区不会重新划分旧周期。预览按固定边界核对当前资料，不会重算旧版报表。商户归档正文仍共用 64 MiB 额度，本入口不扩容。</p>
    {result && !controls.matchesNavigation && <p role="alert" className="text-sm text-amber-900">这是其他人员／日期范围的原号恢复收据，只供核对；请明确读取当前范围后再开始新操作或导出。</p>}
    {!enabled && <p className="text-sm text-amber-900">新操作入口关闭；原编号和已有保存版本仍须独立授权核对，不保证当前服务器一定可恢复。</p>}
    <p role="status" className="text-sm">{shown ? state.message : "资料已隐藏，返回后请明确重新读取。"}</p>
    {shown && ["blocked", "unconfirmed"].includes(state.phase) && <p role="alert" className="text-sm text-amber-900">{state.message}</p>}
    {pending && <div data-period-closure-pending className="min-w-0 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="break-all">待确认操作 {pending.command.operationId} · 周期 {pending.command.periodId}。原内容保留，不能被另一操作覆盖；核对只发出读取请求，不自动重发，不阻断正常打卡。</p>
      <button type="button" className={button} disabled={controls.busy} onClick={() => read(() => { void client.recover(); }, true)}>核对原周期编号</button>
      {state.definitiveRejection && <><p>服务器已明确拒绝本次写入（{state.definitiveRejection}）；仅这次未成功尝试可以由你明确结束。未查到收据不等于失败。</p><button type="button" className={button} disabled={controls.busy} onClick={() => {
        const generation = epoch.current, snapshot = client.getSnapshot();
        confirmPeriodClosureAction(() => window.confirm("仅结束这次服务器明确拒绝的本地尝试，不撤销已保存事实；之后须重新读取，不会直接重发。继续？"),
          () => isCurrent() && shown && !document.hidden && generation === epoch.current && snapshot === client.getSnapshot() && !!snapshot.pending && !!snapshot.definitiveRejection && !controls.busy,
          () => { clear(); void client.endAttempt(); });
      }}>结束这次未成功尝试</button></>}
    </div>}
    {props.expectedNotificationTarget && <div className="space-y-2 rounded-xl border p-3 text-sm"><p>消息只指向保存的原周期与人员双身份；必须重新读取当前详情，原待确认编号优先，不自动回复或确认。</p>
      {notificationMismatch && <p role="alert">当前结果与消息保存的周期或身份不一致；来源正文和操作已隐藏，未改用新身份，也未删除原号。</p>}
      <button type="button" className={button} disabled={!controls.canRead} onClick={() => read(() => { void client.detail(props.expectedNotificationTarget!.periodId, null); })}>读取消息原周期当前详情</button></div>}
    <div className="flex flex-wrap gap-2">{!props.expectedNotificationTarget && <button type="button" className={button} disabled={!controls.canRead} onClick={() => read(() => { void client.list(); })}>读取周期列表</button>}
      {access === "owner" && <button type="button" className={button} disabled={!controls.canRead || !enabled || !!props.expectedNotificationTarget && (!result || notificationMismatch)} onClick={() => read(() => { void client.preview(props.expectedNotificationTarget?.periodId ?? (controls.matchesNavigation ? period?.periodId ?? state.query?.periodId ?? null : null)); })}>预览完整周期资料</button>}</div>
    {result && (result.kind === "list" || result.kind === "history" || result.kind === "versions") && <PeriodClosureV2Pages result={result}
      canRead={controls.canRead && controls.matchesNavigation}
      list={cursor => read(() => { void client.list(cursor); })}
      select={item => read(() => { void client.selectPeriod(item); })}
      history={(periodId, cursor) => read(() => { void client.history(periodId, cursor); })}
      versions={(periodId, cursor) => read(() => { void client.versions(periodId, cursor); })}
      detail={(periodId, version) => read(() => { void client.detail(periodId, version); })}/>}
    {result?.kind === "preview" && <div data-period-closure-preview className="space-y-2"><h3 className="font-bold">本次预览尚未保存</h3>{result.preview.blockers.length ? <><p className="text-sm">{periodClosureCanSendPreview(result.preview.blockers) ? "完整但仍有待处理资料，可以先发给本人核对；这些问题解决前不能封存。" : result.preview.blockers.includes("unresolved_outage") ? "相关故障恢复尚未核完，暂不能送审或封存；请先完成双方核对，再重新预览。" : "周期尚未结束，暂不能保存并发起核对；不会将未完周期当作完整封存。"}</p><ul aria-label="周期处理限制" className="list-disc pl-5 text-sm">{result.preview.blockers.map(code => <li className="break-all" key={code}>{code}</li>)}</ul></> : <p className="text-sm">本次预览未发现阻断项；保存时服务器仍会重新核对，不自动沿用旧确认。</p>}</div>}
    {result?.kind === "detail" && <div data-period-closure-detail className="space-y-3"><h3 className="font-bold">{result.period.workerName} · {states[result.period.state]}</h3><p className="break-all text-xs">周期 {result.period.periodId} · 操作修订 {result.period.revision} · 当前来源版 {result.period.currentVersion} · 正在查看 {result.artifactVersion ?? "无正文"}</p>
      <p className="text-sm">{result.period.sealed ? "封存版保留；后续争议不改旧确认。" : "尚未封存。"}{result.period.unresolvedDispute ? "有未解决争议，不能封存。" : ""}</p>
      <p className="text-sm">{result.sourceChanged === true ? "当前来源已变化；旧确认不适用于新资料，须重新保存版本核对。" : result.sourceChanged === false ? "本次服务器已核对当前来源。" : "当前来源未重新核查；不声称保存版仍等于现实资料。"}</p>
      {result.operation && <div data-period-closure-receipt className="min-w-0 rounded-xl border p-3 text-sm"><p>原操作收据：{actions[result.operation.action]} · 修订 {result.operation.revision} · 来源版 {result.operation.version}</p><p className="break-all">{result.operation.operationId} · {result.operation.recordedAt}</p><p className="break-words">{result.operation.reason}</p></div>}
      <p className="text-xs">详情不自动读取全历史。核对原号、查看固定旧版或导出后，请重新核对当前版本再开始新操作。</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!controls.canRead || !controls.matchesNavigation} onClick={() => read(() => { void client.detail(result.period.periodId); })}>重新核对当前版本</button>
        <button type="button" className={button} disabled={!controls.canRead || !controls.matchesNavigation} onClick={() => read(() => { void client.history(result.period.periodId); })}>读取操作历史第一页</button>
        <button type="button" className={button} disabled={!controls.canRead || !controls.matchesNavigation} onClick={() => read(() => { void client.versions(result.period.periodId); })}>读取保存版本第一页</button></div>
    </div>}
    {artifact && <PeriodClosureSavedReport artifact={artifact} key={artifact.sourceFingerprint}/>}
    {result && (result.kind === "preview" || result.kind === "detail") && <div className="space-y-3 rounded-xl border p-3"><label className="block text-sm">操作理由／本人争议<textarea aria-label="周期操作理由" rows={3} className={input} maxLength={500} value={reason} disabled={!controls.canEditReason} onChange={event => { epoch.current++; printController.current?.abort(); dirty.current = true; setReason(event.target.value); }}/></label>
      <p className="text-xs">1–500 字，公开给本周期双方；说明不直接更改工时。事实错误仍按原补正／漏卡申请处理。</p><div className="flex flex-wrap gap-2">
        {access === "owner" ? <>{result.kind === "preview" && <button type="button" className={button} disabled={!controls.allowed.send} onClick={() => submit("send")}>{actions.send}</button>}{period && (["respond", "seal", "reopen"] as const).map(action => <button type="button" key={action} className={button} disabled={!controls.allowed[action]} onClick={() => submit(action)}>{actions[action]}</button>)}</>
          : period && (["confirm", "dispute"] as const).map(action => <button type="button" key={action} className={button} disabled={!controls.allowed[action]} onClick={() => submit(action)}>{actions[action]}</button>)}
      </div></div>}
    {result?.kind === "detail" && artifact && result.artifactVersion !== null && <section aria-label="保存版本导出与打印" className="space-y-2"><p className="text-sm">独立核验导出权限，只输出所选保存版本；不是上方旧动态导出。</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!controls.canOutput} onClick={() => output("csv")}>下载本保存版本 CSV</button><button type="button" className={button} disabled={!controls.canOutput} onClick={() => output("print")}>打印本保存版本</button></div></section>}
  </section>;
}

type PageResult = Extract<PeriodClosureV2Result, { kind: "list" | "history" | "versions" }>;
/** Only the current server page is rendered; this view never enumerates all
 * revisions or synthesizes version options from the lifetime counter. */
export function PeriodClosureV2Pages({ result, canRead, list, select, history, versions, detail }: {
  result: PageResult; canRead: boolean;
  list: (cursor: PeriodClosureV2Cursor | null) => void;
  select: (item: PeriodClosureV2ListItem) => void;
  history: (periodId: string, cursor: PeriodClosureV2Cursor | null) => void;
  versions: (periodId: string, cursor: PeriodClosureV2Cursor | null) => void;
  detail: (periodId: string, version: number | null) => void;
}) {
  if (result.kind === "list") return <section aria-label="保存周期列表" className="min-w-0 space-y-3">
    <p className="text-sm">显示与导航日期相交的保存周期，每页最多 25 条，仅按需读取。空列表不是没有出勤；选择一条后按该周期保存的完整日期核对。</p>
    {!result.items.length && <p className="text-sm">本页没有可显示的周期。</p>}
    <ul className="space-y-2">{result.items.map(item => <li key={item.periodId} className="min-w-0 rounded-xl border p-3 text-sm"><p>{item.workerName} · {item.fromDate} → {item.throughDate} · {states[item.state]}</p><p className="break-all text-xs">{item.periodId} · 当前来源版 {item.currentVersion} · 操作修订 {item.revision}</p><button type="button" className={button} disabled={!canRead} onClick={() => select(item)}>读取保存版本</button></li>)}</ul>
    <nav aria-label="周期列表服务器分页" className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!canRead} onClick={() => list(null)}>刷新列表第一页</button><button type="button" className={button} disabled={!canRead || !result.nextCursor} onClick={() => { if (result.nextCursor) list(result.nextCursor); }}>读取下一页周期</button></nav>
    <p className="text-xs">{result.nextCursor ? "尚有更多周期；不会自动读取。" : "本次列表已到末页。"}</p>
  </section>;
  const { period } = result;
  return <section aria-label={result.kind === "history" ? "周期操作历史" : "保存版本列表"} className="min-w-0 space-y-3">
    <h3 className="font-bold">{period.workerName} · {result.kind === "history" ? "操作历史" : "保存版本"}</h3>
    <p className="break-all text-sm">周期 {period.periodId} · {period.fromDate} → {period.throughDate}</p>
    <p className="text-sm">{result.kind === "history" ? "每页最多 50 条操作，按修订号从新到旧读取。" : "每页最多 20 个保存版本，按版本号从新到旧读取；选择后才读取该版正文。"}翻页保持本次读取水位；新追加记录请刷新第一页查看，不自动读取全历史。</p>
    {result.kind === "history" ? <ol className="space-y-2">{result.items.map(entry => <li key={entry.operationId} className="min-w-0 break-words rounded-lg border p-3 text-sm"><strong>{actions[entry.action]} · 修订 {entry.revision} · 来源版 {entry.version}</strong><p>{entry.reason}</p><p className="break-all text-xs">{entry.operationId} · {entry.actorId} · {entry.recordedAt}</p></li>)}</ol>
      : <ol className="space-y-2">{result.items.map(version => <li key={version.version} className="min-w-0 rounded-lg border p-3 text-sm"><p>来源版本 {version.version} · {version.recordedAt}</p><p className="break-all text-xs">保存操作 {version.operationId} · 正文 {version.artifactBytes} 字节 · 固定指纹 {version.sourceFingerprint}</p><button type="button" className={button} disabled={!canRead} onClick={() => detail(period.periodId, version.version)}>查看保存版本 {version.version}</button></li>)}</ol>}
    {!result.items.length && <p className="text-sm">本页没有可显示的记录。</p>}
    <nav aria-label={result.kind === "history" ? "周期历史服务器分页" : "保存版本服务器分页"} className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!canRead} onClick={() => result.kind === "history" ? history(period.periodId, null) : versions(period.periodId, null)}>刷新{result.kind === "history" ? "操作历史" : "保存版本"}第一页</button>
      <button type="button" className={button} disabled={!canRead || !result.nextCursor} onClick={() => { if (result.nextCursor) { if (result.kind === "history") history(period.periodId, result.nextCursor); else versions(period.periodId, result.nextCursor); } }}>读取下一页{result.kind === "history" ? "操作历史" : "保存版本"}</button>
      <button type="button" className={button} disabled={!canRead} onClick={() => detail(period.periodId, null)}>重新核对当前版本</button>
    </nav>
    <p className="text-xs">{result.nextCursor ? "尚有更多记录；本页不是完整历史。" : "本次分页已到末页。"}分页记录或旧版正文不授予新操作权限。</p>
  </section>;
}
