import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceLocationNoticePanel from "../../src/components/enterprise/MerchantAttendanceLocationNoticePanel";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";
const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId")), locationId = attendanceSelfUuid(params.get("locationId")), ownerId = attendanceSelfUuid(params.get("ownerId"));
const apiFetch = (url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "same-origin" });
function Demo() {
  const [mounted, setMounted] = useState(true);
  return <><header className="qa-toolbar">只读告知确认情况 · 隔离合成身份与资料 · 非真实登录／邮件／手机验收
    <div className="qa-controls"><button onClick={() => setMounted(value => !value)}>{mounted ? "卸载测试面板" : "重挂测试面板"}</button></div>
  </header><main className="qa-main">{mounted && <MerchantAttendanceLocationNoticePanel
    query={{ siteId, access: "owner", locationId, expectedWorkerId: null, operationId: null }} actorId={ownerId} apiFetch={apiFetch}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
