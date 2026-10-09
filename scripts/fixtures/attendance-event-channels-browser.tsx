import {createRoot} from "react-dom/client";
import History from "../../src/components/enterprise/MerchantAttendanceHistoryPanel";
import Correction from "../../src/components/enterprise/MerchantAttendanceCorrectionWorkspace";
import Review from "../../src/components/enterprise/MerchantAttendanceCorrectionReviewPanel";
import Report from "../../src/components/enterprise/MerchantAttendanceUnifiedTimesheetPanel";
const query=new URLSearchParams(location.search),mode=query.get("mode")??"history";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const apiFetch:typeof fetch=(input,init)=>fetch(input,init),noop=()=>undefined;
const siteId="99990001",ownerId=id(99),employeeId=id(105),workerId=id(205);
createRoot(document.getElementById("qa-root")!).render(<>
  <header className="qa-toolbar">打卡来源核对 · 真实组件／只读接口／隔离 SQL · 合成身份，不连接生产</header>
  <main className="qa-main">
    {mode==="history"&&<History siteId={siteId} employeeId={employeeId} apiFetch={apiFetch}/>}
    {mode==="correction"&&<Correction siteId={siteId} employeeId={employeeId} apiFetch={apiFetch} onClose={noop}/>}
    {mode==="review"&&<Review siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} onClose={noop} decisionsEnabled={false}/>}
    {mode==="report"&&<Report query={{siteId,access:"owner",workerId,fromDate:query.get("from")!,throughDate:query.get("through")!}} actorId={ownerId} apiFetch={apiFetch} onClose={noop}/>}
  </main>
</>);
