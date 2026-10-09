import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import OwnerPanel from "../../src/components/enterprise/MerchantAttendanceTimesheetPanel";
import ScopedPanel from "../../src/components/enterprise/MerchantAttendanceScopedTimesheetPanel";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function App() {
  const [actor, setActor] = useState<"owner" | "a" | "b" | "manager">("owner"), [open, setOpen] = useState(true);
  const apiFetch = useCallback((url: string, init?: RequestInit) => { const headers = new Headers(init?.headers); headers.set("x-attendance-test-actor", actor); return fetch(url, { ...init, headers }); }, [actor]);
  return <><header className="qa-toolbar">隔离合成数据 · 原报表实际入口 → 合并核对 → 实际处理器及 SQL · 不连接生产<div className="qa-controls">
    {([['owner', '合成负责人'], ['a', '合成员工甲'], ['b', '合成员工乙'], ['manager', '合成主管']] as const).map(([value, label]) => <button key={value} onClick={() => { setActor(value); setOpen(true); }}>{label}</button>)}</div></header>
    <main className="qa-main">{open && (actor === "owner" ? <OwnerPanel key={actor} siteId="99990001" ownerId={id(99)} apiFetch={apiFetch} onClose={() => setOpen(false)}/>
      : <ScopedPanel key={actor} siteId="99990001" actorId={id(actor === "manager" ? 103 : actor === "a" ? 101 : 102)} access={actor === "manager" ? "manager" : "self"} apiFetch={apiFetch} onClose={() => setOpen(false)}/>)}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<App/>);
