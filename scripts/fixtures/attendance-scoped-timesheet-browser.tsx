import {StrictMode,useState} from "react";
import {createRoot} from "react-dom/client";
import Launcher from "../../src/components/enterprise/MerchantAttendanceScopedTimesheetLauncher";
import {createScopedClientFixture,scopedActor} from "./attendance-scoped-timesheet-client-model";
const f=createScopedClientFixture();
function Demo(){
  const [access,setAccess]=useState<"self"|"manager">("self"),[enabled,setEnabled]=useState(false),[count,setCount]=useState("");
  return <><header className="qa-toolbar">受限工时报表隔离验收 · 仅合成数据 · 无生产连接或业务写入<div className="qa-controls">
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>开放受限报表</label>
    <select aria-label="当前视角" value={access} onChange={e=>setAccess(e.target.value as typeof access)}><option value="self">员工本人</option><option value="manager">主管范围</option></select>
    <select aria-label="模拟场景" onChange={e=>f.mode(e.target.value)}>{["normal","denied","rebound","revision","tampered","large","held","paused","open","expiring"].map(x=><option key={x}>{x}</option>)}</select>
    <button onClick={()=>f.release()}>释放响应</button>
    <button onClick={()=>setCount(JSON.stringify({reads:f.calls.length,reports:f.calls.filter(c=>c.url.includes("/scoped-timesheet?")).length,writes:f.calls.filter(c=>c.method!=="GET").length}))}>读取计数</button><output aria-label="请求计数">{count}</output>
    <button onClick={()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event("visibilitychange"));}}>模拟后台</button>
    <button onClick={()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});document.dispatchEvent(new Event("visibilitychange"));}}>模拟前台</button>
  </div></header><main className="qa-main"><Launcher siteId="99990009" actorId={scopedActor(access)} access={access} apiFetch={f.apiFetch} enabled={enabled}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Demo/></StrictMode>);
