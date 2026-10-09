// Actual parent and both clients. The runner provides an owned synthetic device
// cookie at the handler boundary; no employee login, PIN or lease is injected.
import { createRoot } from "react-dom/client";
import PinClock from "../../src/components/enterprise/MerchantAttendancePinClock";
createRoot(document.getElementById("qa-root")!).render(<>
  <header className="qa-toolbar">隔离 PIN 选班验收 · 实际父页面／PIN KDF／处理器／SQL · 合成配对设备，非生产终端</header>
  <PinClock/>
</>);
