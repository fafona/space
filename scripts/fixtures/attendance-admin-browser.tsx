import { StrictMode, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import MerchantAttendanceAdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import { parseAttendanceAdminCommand, type AttendanceAdminResult, type AttendanceAdminSettings, type AttendanceAdminLocation, type AttendanceAdminWorker } from "../../src/lib/merchantAttendanceAdmin";
import {parseAttendanceAuditQuery,type AttendanceAuditResult} from "../../src/lib/merchantAttendanceAudit";
import {parseAttendanceAuditExportQuery} from "../../src/lib/merchantAttendanceAuditExport";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
let version=0,posts=0,gets=0,mode="normal",revision=0,moduleEnabled=true;
let settings:AttendanceAdminSettings|null=null;
const locations=new Map<string,AttendanceAdminLocation>(),workers=new Map<string,AttendanceAdminWorker>();
const receipts=new Map<string,AttendanceAdminResult["receipt"]>();
const audit=new Map<string,Extract<AttendanceAuditResult,{mode:"detail"}>>();
const listeners=new Set<()=>void>();
const notify=()=>{revision++;for(const fn of listeners)fn();};
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
const employees=Array.from({length:28},(_,i)=>({id:id(100+i),displayName:`合成员工 ${i+1}`}));
async function apiFetch(url:string,init:RequestInit={}) {
  const query=new URL(url,"http://127.0.0.1:3131");
  const auditRequest=query.pathname==="/api/merchant-enterprise/attendance/audit";
  const exportRequest=query.pathname==="/api/merchant-enterprise/attendance/audit-export";
  if(!auditRequest&&!exportRequest&&query.pathname!=="/api/merchant-enterprise/attendance/admin")throw Error("synthetic_route_only");
  if((auditRequest||exportRequest)&&init.method&&init.method!=="GET")throw Error("synthetic_audit_read_only");
  const write=init.method==="POST";if(write)posts++;else gets++;notify();
  if(mode==="offline")throw Error("synthetic_offline");
  if(mode==="denied")return Response.json({ok:false,error:"attendance_access_denied"},{status:403});
  if(exportRequest){
    const q=parseAttendanceAuditExportQuery(query.toString());if(q.siteId!=="99990001")throw Error("synthetic_site_only");
    const asOf=new Date().toISOString().replace("Z","000Z");
    const rows=q.source==="scope"?[]:[...audit.values()].filter(r=>r.item.recordedAt>=q.fromAt&&r.item.recordedAt<q.toAt&&r.item.recordedAt<asOf)
      .sort((a,b)=>b.item.recordedAt.localeCompare(a.item.recordedAt)||b.item.operationId.localeCompare(a.item.operationId))
      .map(({item,before,after})=>({item,before,after}));
    const result={...q,schemaVersion:1,asOf,count:rows.length,rows};
    if(rows.length>250||new TextEncoder().encode(JSON.stringify(result)).length>1572864)
      return Response.json({ok:false,error:"attendance_export_too_large"},{status:413});
    return Response.json({ok:true,moduleEnabled,...result});
  }
  if(auditRequest){
    const q=parseAttendanceAuditQuery(query.toString());if(q.siteId!=="99990001")throw Error("synthetic_site_only");
    if(q.mode==="detail"){
      const entry=q.source==="config"?audit.get(q.operationId):null;
      return entry?Response.json({ok:true,moduleEnabled,...entry}):Response.json({ok:false,error:"attendance_audit_not_found"},{status:404});
    }
    const asOf=q.asOf??new Date().toISOString().replace("Z","000Z");
    const items=q.source==="scope"?[]:[...audit.values()].map(r=>r.item).filter(r=>r.recordedAt>=q.fromAt&&r.recordedAt<q.toAt&&r.recordedAt<asOf
      &&(!q.cursorAt||r.recordedAt<q.cursorAt||(r.recordedAt===q.cursorAt&&r.operationId<q.cursorId!)))
      .sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)||b.operationId.localeCompare(a.operationId));
    return Response.json({ok:true,moduleEnabled,siteId:q.siteId,source:q.source,mode:q.mode,asOf,items:items.slice(0,25),
      nextCursor:items.length>25?{recordedAt:items[24].recordedAt,operationId:items[24].operationId}:null});
  }
  let operationId=query.searchParams.get("operationId");
  const view=(write?"settings":query.searchParams.get("view")??"settings") as AttendanceAdminResult["view"];
  if(write) {
    if(!moduleEnabled)return Response.json({ok:false,error:"attendance_platform_paused"},{status:403});
    const {command}=parseAttendanceAdminCommand(JSON.parse(init.body as string));operationId=command.operationId;
    if(!receipts.has(operationId)) {
      if(command.expectedVersion!==version)return Response.json({ok:false,error:"attendance_version_conflict"},{status:409});
      const previous=command.kind==="settings"?settings:command.kind==="location"?locations.get(command.values.id):workers.get(command.values.id);
      const before=previous?{...previous,...(command.kind==="worker"?{startsOn:null}:{})}:null;
      if(command.kind==="settings")settings=command.values;
      if(command.kind==="location")locations.set(command.values.id,command.values);
      if(command.kind==="worker")workers.set(command.values.id,command.values);
      version++;receipts.set(operationId,{operationId,version,kind:command.kind,targetId:command.kind==="settings"?null:command.values.id});notify();
      audit.set(operationId,{siteId:"99990001",mode:"detail",source:"config",before,after:{...command.values},item:{operationId,version,
        kind:command.kind,targetId:command.kind==="settings"?null:command.values.id,employeeId:null,actorRef:"a".repeat(32),byCurrentOwner:true,
        recordedAt:new Date().toISOString().replace("Z","000Z")}});
    }
    if(mode==="lost")throw Error("synthetic_committed_response_lost");
  }
  const cursor=query.searchParams.get("cursor")??"",search=query.searchParams.get("search")??"";
  const items=(view==="locations"?[...locations.values()]:view==="workers"?[...workers.values()]:view==="employees"?employees.filter(e=>![...workers.values()].some(w=>w.employeeId===e.id)):[])
    .filter(i=>i.id>cursor&&("name" in i?i.name:i.displayName).includes(search)).sort((a,b)=>a.id.localeCompare(b.id));
  return Response.json({ok:true,moduleEnabled,siteId:"99990001",version,settings,view,items:items.slice(0,25),nextCursor:items.length>25?items[24].id:null,receipt:operationId?receipts.get(operationId)??null:null});
}
function Fixture() {
  useSyncExternalStore(subscribe,()=>revision);const [mount,setMount]=useState(0);
  return <><div className="qa-toolbar"><strong>考勤管理 · 隔离合成数据 · 禁止生产连接</strong><div className="qa-controls">
    <label>网络情况<select aria-label="网络情况" value={mode} onChange={e=>{mode=e.target.value;notify();}}><option value="normal">正常</option><option value="lost">保存成功但响应丢失</option><option value="offline">断网</option><option value="denied">权限拒绝</option></select></label>
    <button onClick={()=>setMount(n=>n+1)}>重新挂载页面</button><span>GET {gets} · POST {posts} · 配置版本 {version} · 审计 {receipts.size}</span>
    <label><input type="checkbox" checked={moduleEnabled} onChange={e=>{moduleEnabled=e.target.checked;notify();}} />平台考勤开关（合成）</label>
  </div></div><main className="qa-main"><MerchantAttendanceAdminPanel key={mount} siteId="99990001" ownerId={id(5)} siteName="合成示例企业" apiFetch={apiFetch} /></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Fixture /></StrictMode>);
