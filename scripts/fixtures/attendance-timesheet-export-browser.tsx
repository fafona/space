import {useCallback,useMemo,useState} from "react";
import {createRoot} from "react-dom/client";
import MerchantAttendanceTimesheetExport from "../../src/components/enterprise/MerchantAttendanceTimesheetExport";
import {timesheetExportCommand,timesheetExportWire} from "./attendance-timesheet-export-model";
import {timesheetId as id} from "./attendance-timesheet-model";
import {parseTimesheetExportCommand,parseTimesheetExportSource,buildTimesheetExportCsv,timesheetExportFilename} from "../../src/lib/merchantAttendanceTimesheetExport";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
import {ATTENDANCE_REPORT_SOURCE_VERSION} from "../../src/lib/merchantAttendanceTimesheet";
const exportSource=(command:ReturnType<typeof timesheetExportCommand>)=>{const wire=timesheetExportWire(command);wire.report.sourceVersion=ATTENDANCE_REPORT_SOURCE_VERSION;return parseTimesheetExportSource(wire,command,ATTENDANCE_REPORT_SOURCE_VERSION);};
class ExportMock{
  mode="normal";calls=0;denials=0;held:(()=>void)[]=[];ids:string[]=[];
  setMode(value:string){this.mode=value;}
  record(id:string){this.calls++;this.ids.push(id);return this.mode;}
  deny(){this.denials++;}
  hold(){return new Promise<void>(r=>this.held.push(r));}
  release(){this.held.splice(0).forEach(r=>r());}
  counts(){return JSON.stringify({calls:this.calls,denials:this.denials,ids:this.ids});}
}
function Harness(){
  const [access,setAccess]=useState<"owner"|"self"|"manager">("owner"),[enabled,setEnabled]=useState(false),[mounted,setMounted]=useState(true),[counts,setCounts]=useState("{}"),[revision,setRevision]=useState(0);
  const mock=useMemo(()=>new ExportMock(),[]);
  const onDenied=useCallback(()=>{mock.deny();setMounted(false);},[mock]);
  const apiFetch=useMemo<AttendanceApiFetch>(()=>async(url,init)=>{
    if(url!=="/api/merchant-enterprise/attendance/timesheet-export"||init?.method!=="POST")throw Error("unexpected_request");
    const command=parseTimesheetExportCommand(JSON.parse(String(init.body))),mode=mock.record(command.operationId);
    if(mode==="held")await mock.hold();
    if(mode==="denied")return Response.json({ok:false,error:"attendance_export_denied"},{status:403});
    if(mode==="lost")throw Error("synthetic_connection_lost");
    const r=exportSource(command);
    const replay=mode==="replay";
    return Response.json({ok:true,moduleEnabled:true,receipt:r.receipt,replayed:replay,csv:replay?null:buildTimesheetExportCsv(r.report!,r.receipt),filename:replay?null:timesheetExportFilename(command),
      viewerEmployeeId:replay||command.query.access==="owner"?null:command.query.access==="self"?id(2):id(90),accessValidUntil:mode==="expired"?r.receipt.asOf:null});
  },[mock]);
  const report=exportSource(timesheetExportCommand(access)).report!;
  const available=(value:"visible"|"hidden")=>{Object.defineProperty(document,"visibilityState",{configurable:true,value});document.dispatchEvent(new Event("visibilitychange"));};
  return <><header className="qa-toolbar">隔离工时报表导出验收 · 合成人员 · 禁止连接生产 · 文件下载仅浏览器测试
    <div className="qa-controls"><label>开放导出<input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/></label>
      <label>当前视角<select value={access} onChange={e=>setAccess(e.target.value as typeof access)}>{["owner","self","manager"].map(v=><option key={v}>{v}</option>)}</select></label>
      <label>模拟场景<select onChange={e=>mock.setMode(e.target.value)}>{["normal","held","denied","lost","replay","expired"].map(v=><option key={v}>{v}</option>)}</select></label>
      <button onClick={()=>setCounts(mock.counts())}>读取计数</button><button onClick={()=>mock.release()}>释放响应</button>
      <button onClick={()=>setMounted(v=>!v)}>切换挂载</button><button onClick={()=>setRevision(v=>v+1)}>切换查询结果</button><button onClick={()=>available("hidden")}>模拟后台</button><button onClick={()=>available("visible")}>模拟前台</button></div>
    <output aria-label="请求计数">{counts}</output></header>
    <main className="qa-main">{mounted&&<MerchantAttendanceTimesheetExport key={revision} report={report} actorId={access==="owner"?id(1):access==="self"?id(2):id(90)} apiFetch={apiFetch} enabled={enabled} onDenied={onDenied}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
