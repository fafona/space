import { createRoot } from "react-dom/client";
import MerchantAttendanceOnsiteDisplay from "@/components/enterprise/MerchantAttendanceOnsiteDisplay";
import MerchantAttendanceOnsitePhone from "@/components/enterprise/MerchantAttendanceOnsitePhone";
const origin = "https://www.faolla.com";
const mode = window.location.pathname === "/enterprise/attendance-scan" ? "phone" : "display";
createRoot(document.getElementById("qa-root")!).render(<>
  <div className="qa-toolbar">现场扫码隔离验收 · 合成企业与账号 · 禁止生产网络／数据写入</div>
  {mode === "phone" ? <MerchantAttendanceOnsitePhone scanOrigin={origin}/> : <MerchantAttendanceOnsiteDisplay scanOrigin={origin} recoveryUrl={origin + "/enterprise"}/>}
</>);
