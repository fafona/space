// Actual Phone, scanner/paste, EmployeeClock and clients. Only authentication
// is replaced by the in-memory esbuild fixture; business handlers use real SQL.
import { createRoot } from "react-dom/client";
import Phone from "../../src/components/enterprise/MerchantAttendanceOnsitePhone";
createRoot(document.getElementById("qa-root")!).render(<>
  <header className="qa-toolbar">现场选班隔离验收 · 实际手机页面／处理器／SQL · 合成登录 · 非真实摄像头或生产</header>
  <Phone scanOrigin="https://www.faolla.com"/>
</>);
