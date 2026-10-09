import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceAdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";
const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId")), ownerId = attendanceSelfUuid(params.get("ownerId"));
// Real AdminPanel and read handlers, isolated synthetic identity/database only.
// No approval, admin write, production network, or attendance submission path.
const apiFetch = async (path: string, init?: RequestInit) => {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || (init?.method ?? "GET") !== "GET" || init?.body
    || !["/api/merchant-enterprise/attendance/admin", "/api/merchant-enterprise/attendance/owner-backlog"].includes(url.pathname))
    throw Error("synthetic_readonly_endpoint_required");
  return fetch(path, { ...init, credentials: "same-origin" });
};
function Demo() {
  const [mounted, setMounted] = useState(true);
  return <><header className="qa-toolbar">负责人待审积压 · 实际考勤配置组件、真实只读处理器与隔离 SQL；合成身份和开放开关，不代表真实登录或手机验收。
    <div className="qa-controls"><button onClick={() => setMounted(value => !value)}>{mounted ? "卸载测试负责人面板" : "重挂测试负责人面板"}</button></div>
  </header><main className="qa-main">{mounted && <MerchantAttendanceAdminPanel siteId={siteId} ownerId={ownerId}
    siteName="合成验收企业" correctionReviewEnabled={true} apiFetch={apiFetch}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
