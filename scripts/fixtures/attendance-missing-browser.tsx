import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import MissingLauncher from "../../src/components/enterprise/MerchantAttendanceMissingLauncher";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function App() {
  const [actor, setActor] = useState<"owner" | "a" | "b">("owner");
  const apiFetch = useCallback((url: string, init?: RequestInit) => { const headers = new Headers(init?.headers); headers.set("x-attendance-test-actor", actor); return fetch(url, { ...init, headers }); }, [actor]);
  return <><header className="qa-toolbar">仅隔离合成数据 · 实际整段漏卡组件／处理器／SQL · 认证为合成上下文，不是生产登录<div className="qa-controls">
    <button onClick={() => setActor("owner")}>合成负责人</button><button onClick={() => setActor("a")}>合成员工甲</button><button onClick={() => setActor("b")}>合成员工乙</button>
    </div></header><main className="qa-main">{actor === "owner"
      ? <AdminPanel key={actor} siteId="99990001" ownerId={id(99)} apiFetch={apiFetch}/>
      : <MissingLauncher key={actor} siteId="99990001" actorId={id(actor === "a" ? 101 : 102)} access="self" apiFetch={apiFetch}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<App/>);
