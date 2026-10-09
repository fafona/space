import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceSelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";
const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId")), employeeId = attendanceSelfUuid(params.get("employeeId"));
// The existing clock403 is synthetic: inactive worker history is still readable.
// New requests and079 identity context use default handlers/SDK/isolated SQL.
const apiFetch = async (path: string, init?: RequestInit) => {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || (init?.method ?? "GET") !== "GET" || init?.body) throw Error("synthetic_readonly_shell_required");
  if (url.pathname === "/api/merchant-enterprise/attendance/self") {
    if (url.searchParams.toString() !== new URLSearchParams({ siteId }).toString()) throw Error("synthetic_clock_query_forbidden");
    return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
  }
  if (!["/api/merchant-enterprise/attendance/self-requests", "/api/merchant-enterprise/attendance/corrections/context"].includes(url.pathname)) throw Error("synthetic_readonly_endpoint_required");
  return fetch(path, { ...init, credentials: "same-origin" });
};
function Demo() {
  const [mounted, setMounted] = useState(true);
  return <><header className="qa-toolbar">本人统一申请记录 · 实际我的考勤组件、只读处理器与隔离 SQL；旧打卡状态为合成拒绝，禁止打卡。非真实登录／手机验收。
    <div className="qa-controls"><button onClick={() => setMounted(value => !value)}>{mounted ? "卸载测试本人面板" : "重挂测试本人面板"}</button></div>
  </header><main className="qa-main">{mounted && <MerchantAttendanceSelfPanel siteId={siteId} employeeId={employeeId} employeeName="合成申请员工"
    siteName="合成验收企业" canClock={false} apiFetch={apiFetch}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
