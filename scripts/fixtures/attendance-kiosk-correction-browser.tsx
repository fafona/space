import {createRoot} from "react-dom/client";
import MerchantAttendanceCorrectionWorkspace from "../../src/components/enterprise/MerchantAttendanceCorrectionWorkspace";
// Literal synthetic identity; all responses intercepted by the local SQL runner.
const apiFetch:typeof fetch=(input,init)=>fetch(input,init);
createRoot(document.getElementById("qa-root")!).render(<>
  <header className="qa-toolbar">终端来源补正 · 本地合成员工／隔离 SQL · 不连接生产，不测试 PIN 或真实设备身份</header>
  <main className="qa-main"><MerchantAttendanceCorrectionWorkspace siteId="99990001" employeeId="00000000-0000-4000-8000-000000000101" apiFetch={apiFetch} onClose={()=>undefined}/></main>
</>);
