import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceSelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";
const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId")), employeeId = attendanceSelfUuid(params.get("employeeId"));
const historyPath = "/api/merchant-enterprise/attendance/self-revision-history";
// Only the existing clock denial is synthetic: the fixture worker is inactive,
// so ordinary clock status cannot be used as this history feature's identity gate.
// Context and the new list use real handlers/SDK/isolated SQL; no mutations here.
const apiFetch = async (path: string, init?: RequestInit) => {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || (init?.method ?? "GET") !== "GET" || init?.body) throw Error("synthetic_readonly_shell_required");
  if (url.pathname === "/api/merchant-enterprise/attendance/self") {
    if (url.searchParams.toString() !== new URLSearchParams({ siteId }).toString()) throw Error("synthetic_status_query_forbidden");
    return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
  }
  if (![historyPath, "/api/merchant-enterprise/attendance/corrections/context"].includes(url.pathname)) throw Error("synthetic_readonly_endpoint_forbidden");
  return fetch(path, { ...init, credentials: "same-origin" });
};
function Demo() {
  const [mounted, setMounted] = useState(true);
  return <><header className="qa-toolbar">本人跨班次修订 · 实际我的考勤组件；旧打卡身份响应为合成拒绝，禁止打卡。身份核对与新列表使用真实处理器与隔离 SQL；非完整登录／真实 Auth／手机验收。
    <div className="qa-controls"><button onClick={() => setMounted(value => !value)}>{mounted ? "卸载测试本人面板" : "重挂测试本人面板"}</button></div>
  </header><main className="qa-main">{mounted && <MerchantAttendanceSelfPanel siteId={siteId} employeeId={employeeId} employeeName="合成修订员工"
    siteName="合成验收企业" canClock={false} apiFetch={apiFetch}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
