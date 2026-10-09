import {createRoot} from "react-dom/client";
import Clock from "../../src/components/enterprise/MerchantAttendancePinClock";
import Correction from "../../src/components/enterprise/MerchantAttendanceCorrectionWorkspace";
import Review from "../../src/components/enterprise/MerchantAttendanceCorrectionReviewPanel";
import RevisionApproval from "../../src/components/enterprise/MerchantAttendanceRevisionApprovalPanel";
import Report from "../../src/components/enterprise/MerchantAttendanceUnifiedTimesheetPanel";
// Navigation/auth below are synthetic; all business panels, handlers and SQL are real.
const query=new URLSearchParams(location.search),mode=query.get("mode")??"clock";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const apiFetch:typeof fetch=(input,init)=>fetch(input,init),noop=()=>undefined;
const siteId="99990001",ownerId=id(99),employeeId=id(104),workerId=id(204);
createRoot(document.getElementById("qa-root")!).render(<>
  <header className="qa-toolbar">PIN 完整链路 · 真实业务组件／隔离 SQL · 合成身份切换，不连接生产</header>
  <main className="qa-main">
    {mode==="clock"&&<Clock/>}
    {mode==="correction"&&<Correction siteId={siteId} employeeId={employeeId} apiFetch={apiFetch} onClose={noop}/>}
    {mode==="review"&&<Review siteId={siteId} ownerId={ownerId} decisionsEnabled apiFetch={apiFetch} onClose={noop}/>}
    {mode==="revision-approval"&&<RevisionApproval siteId={siteId} ownerId={ownerId} initialRequestId={query.get("request")} apiFetch={apiFetch} onClose={noop}/>}
    {mode==="report"&&<Report query={{siteId,access:"owner",workerId,fromDate:query.get("from")!,throughDate:query.get("through")!}} actorId={ownerId} apiFetch={apiFetch} onClose={noop}/>}
  </main>
</>);
