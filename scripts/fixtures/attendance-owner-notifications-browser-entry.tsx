// Actual new Launcher / Panel / original V2 Workspace; synthetic Auth and API.
// This is not the authenticated Page, enterprise host or a real database.
import { StrictMode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Launcher from "../../src/components/enterprise/MerchantAttendanceOwnerNotificationsLauncher";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";

declare const __OWNER_NOTIFICATIONS_SEED__: { siteId: string; actorId: string; otherActorId: string; endpoints: string[] };
declare global { interface Window { __ownerNotificationsHarness: {
  configure(other: boolean): void; holdNext(): void; release(): void;
  snapshot(): { calls: number; held: boolean; enabled: boolean };
}; } }
const seed = __OWNER_NOTIFICATIONS_SEED__;
function Harness() {
  const [identity, setIdentity] = useState({ other: false, token: 0 }), calls = useRef(0), hold = useRef(false), held = useRef(false), release = useRef<(() => void) | null>(null);
  const enabled = new URLSearchParams(location.search).get("disabled") !== "1";
  const live = useRef({ other: false, token: 0 });
  const { other, token } = identity, actorId = other ? seed.otherActorId : seed.actorId;
  const isCurrentAuth = useMemo(() => () => live.current.token === token && live.current.other === other, [token, other]);
  const configure = useCallback((value: boolean) => {
    if (live.current.other === value) return;
    const next = { other: value, token: live.current.token + 1 };
    // Revoke old requests synchronously, including A -> B -> A transitions.
    live.current = next;
    flushSync(() => setIdentity(next));
  }, []);
  useLayoutEffect(() => { window.__ownerNotificationsHarness = { configure, holdNext: () => { hold.current = true; }, release: () => release.current?.(),
    snapshot: () => ({ calls: calls.current, held: held.current, enabled }) }; }, [configure, enabled]);
  const apiFetch = useMemo<AttendanceApiFetch>(() => async (path, init = {}) => {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin || !seed.endpoints.includes(url.pathname) || !["GET", "POST"].includes(init.method ?? "")) throw Error("qa_unknown_request");
    const delayed = hold.current; hold.current = false; calls.current++;
    const response = await fetch(url.href, { ...init, credentials: "omit", redirect: "error", headers: { ...init.headers, "x-owner-notifications-qa-auth": actorId } });
    if (!delayed) return response;
    const bytes = new Uint8Array(await response.arrayBuffer()); let canceled = false;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, 1)); held.current = true;
      release.current = () => { held.current = false; release.current = null; if (!canceled) { controller.enqueue(bytes.slice(1)); controller.close(); } };
    }, cancel() { canceled = true; } }), { status: response.status, headers: response.headers });
  }, [actorId]);
  return <main className="qa-main space-y-3"><header className="rounded border bg-amber-50 p-3"><h1 className="text-lg font-bold">负责人收件 · 隔离合成浏览器验收</h1>
    <p className="text-sm">实际收件及原周期组件；身份与 API 为合成协议，未测试真实登录、企业父页或数据库。全部请求仅本地。</p></header>
    <Launcher key={token} siteId={seed.siteId} actorId={actorId} authUserId={actorId} isCurrentAuth={isCurrentAuth} apiFetch={apiFetch} enabled={enabled} periodsEnabled planExceptionsEnabled/>
  </main>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Harness/></StrictMode>);
