import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import ScheduleLauncher from "../../src/components/enterprise/MerchantAttendanceScheduleLauncher";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function App() {
  const [actor, setActor] = useState<"owner" | "a" | "b">("owner"), [open, setOpen] = useState(true);
  const apiFetch = useCallback((url: string, init?: RequestInit) => { const headers = new Headers(init?.headers); headers.set("x-attendance-test-actor", actor); return fetch(url, { ...init, headers }); }, [actor]);
  return <><header className="qa-toolbar">仅隔离合成数据 · 实际排班组件／处理器／SQL · 认证为合成上下文，不是生产登录<div className="qa-controls">
    <button onClick={() => { setActor("owner"); setOpen(true); }}>合成负责人</button><button onClick={() => { setActor("a"); setOpen(true); }}>合成员工甲</button><button onClick={() => { setActor("b"); setOpen(true); }}>合成员工乙</button>
    <button onClick={() => setOpen(true)}>重新打开排班</button></div></header><main className="qa-main">{open && (actor === "owner"
      ? <AdminPanel key={actor} siteId="99990001" ownerId={id(99)} apiFetch={apiFetch}/>
      : <ScheduleLauncher key={actor} siteId="99990001" actorId={id(actor === "a" ? 101 : 102)} access="self" apiFetch={apiFetch}/>)}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<App/>);
