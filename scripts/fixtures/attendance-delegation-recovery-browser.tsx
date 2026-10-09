// Inert entry for the root-owned browser acceptance. Auth/membership transport
// is synthetic; both rendered pages and the navigation href are production UI.
import { createRoot } from "react-dom/client";
import EnterpriseSelectorClient from "../../src/app/enterprise/EnterpriseSelectorClient";
import RecoveryRoute from "../../src/app/enterprise/attendance-recovery/page";

const recovery = window.location.pathname === "/enterprise/attendance-recovery";
if (!recovery && window.location.pathname !== "/enterprise") throw Error("unexpected_recovery_fixture_path");
createRoot(document.getElementById("qa-root")!).render(<>
  <aside className="qa-disclaimer">隔离验收：真实企业选择与恢复页面；登录及企业列表初始化为合成；原号读取接真实处理链。</aside>
  {recovery ? <RecoveryRoute/> : <EnterpriseSelectorClient/>}
</>);
