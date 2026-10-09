import {StrictMode,useState} from "react";
import {createRoot} from "react-dom/client";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import {createTimesheetClientFixture} from "./attendance-timesheet-client-model";
import {timesheetOwner,timesheetQuery} from "./attendance-timesheet-model";
const f=createTimesheetClientFixture();
function Demo(){
  const [enabled,setEnabled]=useState(false),[mount,setMount]=useState(0),[count,setCount]=useState("");
  return <><header className="qa-toolbar">周期工时隔离验收 · 仅合成数据 · 内存传输 · 无生产连接或业务写入
    <div className="qa-controls"><label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>开放候选工时报表</label>
      <select aria-label="模拟报表场景" onChange={e=>f.mode(e.target.value)}>{[["normal","批准减少一小时"],["original","仅原始"],["open","未结束休息"],["empty","空记录"],["paused","暂停新考勤"],["denied","权限撤销"],["large","超量"],["tampered","错误合计"],["offline","离线"],["held","延迟响应"]].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select>
      <button onClick={()=>f.release()}>释放延迟响应</button><button onClick={()=>setMount(n=>n+1)}>重新进入界面</button>
      <button onClick={()=>setCount(JSON.stringify({reads:f.calls.length,reports:f.calls.filter(c=>c.url.includes("/timesheet?")).length,writes:f.calls.filter(c=>c.method!=="GET").length}))}>读取查询计数</button><output aria-label="查询计数">{count}</output>
      <button onClick={()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event("visibilitychange"));}}>模拟切到后台</button>
      <button onClick={()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});document.dispatchEvent(new Event("visibilitychange"));}}>模拟返回前台</button>
    </div></header><main className="qa-main"><AdminPanel key={mount} siteId={timesheetQuery.siteId} ownerId={timesheetOwner} apiFetch={f.apiFetch} timesheetEnabled={enabled}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Demo/></StrictMode>);
