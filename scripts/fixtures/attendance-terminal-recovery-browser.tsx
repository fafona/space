import {createRoot} from "react-dom/client";
import Clock from "../../src/components/enterprise/MerchantAttendancePinClock";
import Device from "../../src/components/enterprise/MerchantAttendanceTerminalDevice";
import Recovery from "../../src/components/enterprise/MerchantAttendanceTerminalRecovery";
import History from "../../src/components/enterprise/MerchantAttendanceHistoryPanel";
import Records from "../../src/components/enterprise/MerchantAttendanceRecordsPanel";
import Selector from "../../src/app/enterprise/EnterpriseSelectorClient";
const apiFetch:typeof fetch=(url,init)=>fetch(url,init),q=new URLSearchParams(location.search),mode=q.get("mode")??"clock";
const url=q.has("no-link")?null:"https://www.faolla.com/enterprise";
createRoot(document.getElementById("qa-root")!).render(<>
  <header className="qa-toolbar">终端失效查询 · 合成账号／隔离 SQL · 公用终端与本人设备独立上下文 · 无生产连接</header>
  <div className="qa-main">{location.pathname==="/enterprise"?<Selector/>:<>
    {mode==="clock"&&<Clock recoveryUrl={url}/>}
    {mode==="device"&&<Device recoveryUrl={url}/>}
    {mode==="help"&&<Recovery url={url}/>}
    {mode==="history"&&<History siteId="99990001" employeeId="00000000-0000-4000-8000-000000000102" apiFetch={apiFetch}/>}
    {mode==="records"&&<Records siteId="99990001" actorId="00000000-0000-4000-8000-000000000099" access="owner" apiFetch={apiFetch}/>}
  </>}</div>
</>);
