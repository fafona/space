"use client";
import {useEffect,useMemo,useState,useSyncExternalStore} from "react";
import {AttendanceAuditClient} from "@/lib/merchantAttendanceAuditClient";
import {attendanceHistoryDateQuery} from "@/lib/merchantAttendanceHistoryClient";
import {attendanceManagementMessage} from "@/lib/merchantAttendanceManagementClient";
import type {AttendanceAuditSource,AttendanceAuditValue} from "@/lib/merchantAttendanceAudit";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
import MerchantAttendanceAuditExport from "./MerchantAttendanceAuditExport";
const button="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-40";
const input="mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const kinds={settings:"考勤设置",location:"工作地点",worker:"考勤人员",grant_put:"保存主管授权",grant_remove:"撤销主管授权"};
const fields:Record<string,string>={id:"目标编号",timeZone:"时区",enabled:"企业考勤启用",webClockEnabled:"普通网页打卡",webBreakPaid:"休息带薪标记",
  name:"地点名称",active:"启用",employeeId:"关联员工编号",workerNo:"工号",displayName:"人员名称",locationId:"地点编号",startsOn:"在职起始日期",
  workerIds:"授权人员编号",locationIds:"授权地点编号",validFrom:"生效时间（UTC）",validUntil:"失效时间（UTC）"};
function valueText(value:AttendanceAuditValue|null,key:string){
  if(value===null)return "无（当时不存在）";
  const v=value[key];if(v===null)return key==="validUntil"?"无固定到期时间":key==="startsOn"?"当时快照未记录":"未设置";
  if(Array.isArray(v))return `${v.length} 项\n${v.join("\n")}`;
  return typeof v==="boolean"?v?"是":"否":v;
}
type Props={siteId:string;ownerId:string;apiFetch:AttendanceApiFetch};
export default function MerchantAttendanceAuditPanel(props:Props){return <AuditScreen key={`${props.siteId}:${props.ownerId}`} {...props}/>;}
function AuditScreen({siteId,apiFetch}:Props){
  const client=useMemo(()=>new AttendanceAuditClient({siteId,apiFetch}),[siteId,apiFetch]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  const [start,setStart]=useState(()=>new Date(Date.now()-6*86400000).toISOString().slice(0,10));
  const [end,setEnd]=useState(()=>new Date().toISOString().slice(0,10));
  const [zone,setZone]=useState("UTC"),[displayZone,setDisplayZone]=useState("UTC"),[source,setSource]=useState<AttendanceAuditSource>("config"),[error,setError]=useState("");
  useEffect(()=>{const visible=()=>{if(document.visibilityState==="hidden")client.invalidate();else void client.refresh();};
    document.addEventListener("visibilitychange",visible);return()=>{document.removeEventListener("visibilitychange",visible);client.invalidate();};},[client]);
  const busy=state.phase==="loading";
  return <section className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-5" aria-label="考勤变更记录">
    <header><h3 className="text-lg font-bold">考勤配置与授权变更记录</h3><p className="mt-1 text-sm leading-6 text-slate-500">仅当前负责人可看。这里只读核对，不修改、撤销或删除历史记录。</p></header>
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={e=>{e.preventDefault();try{
      const q=attendanceHistoryDateQuery(siteId,start,end,zone);setError("");setDisplayZone(zone);
      void client.load({siteId,mode:"list",source,fromAt:q.fromAt,toAt:q.toAt,asOf:null,cursorAt:null,cursorId:null});
    }catch(e){client.invalidate(true);setError(attendanceManagementMessage(e));}}}>
      <label className="text-sm">开始日期<input type="date" className={input} value={start} onChange={e=>setStart(e.target.value)} required/></label>
      <label className="text-sm">结束日期（含当天）<input type="date" className={input} value={end} onChange={e=>setEnd(e.target.value)} required/></label>
      <label className="text-sm">记录类型<select className={input} value={source} onChange={e=>setSource(e.target.value as AttendanceAuditSource)}><option value="config">考勤设置／地点／人员</option><option value="scope">主管授权／撤销</option></select></label>
      <label className="text-sm">查询／显示时区<input className={input} value={zone} onChange={e=>setZone(e.target.value)} required maxLength={100}/></label>
      <div className="flex items-end"><button type="submit" className={button} disabled={busy}>查询变更记录</button></div>
    </form>
    <p className="text-xs leading-5 text-slate-500">最多 30 个自然日，每页 25 条；UTC 为默认查询时区。前后快照只在展开单条记录时读取，不加载全企业历史。</p>
    <MerchantAttendanceAuditExport siteId={siteId} start={start} end={end} zone={zone} source={source} apiFetch={apiFetch} onDenied={client.invalidate}/>
    <div role="status" className={`rounded-xl border p-3 text-sm ${error||state.phase==="blocked"?"border-rose-200 bg-rose-50":"border-blue-100 bg-blue-50"}`}>{error||state.message}
      {state.result&&!state.result.moduleEnabled&&<p>平台暂停新考勤，已有变更记录仍按负责人当前权限可查。</p>}</div>
    {state.result&&<><p className="text-xs text-slate-500">当前结果：{state.result.source==="config"?"配置记录":"授权记录"} · {displayZone}。版本分别按企业配置或各主管授权计数，不能跨类型比较。</p>
      <div className="space-y-3">{state.result.items.map(item=><article key={item.operationId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">{kinds[item.kind]} · 版本 {item.version}</h4><span className="text-sm">{new Intl.DateTimeFormat("zh-CN",{timeZone:displayZone,dateStyle:"medium",timeStyle:"medium",hourCycle:"h23"}).format(new Date(item.recordedAt))}</span></div>
        <p className="mt-2 break-all text-xs leading-5 text-slate-500">操作人：{item.byCurrentOwner?"当前登录负责人":"其他历史负责人"} · 企业内标识 {item.actorRef}<br/>操作编号：{item.operationId}{item.employeeId&&<><br/>授权对象员工编号：{item.employeeId}</>}</p>
        <button type="button" className={`${button} mt-3`} disabled={!!state.detailLoading} onClick={()=>state.detail?.item.operationId===item.operationId?client.closeDetail():void client.detail(item)}>{state.detailLoading===item.operationId?"正在读取…":state.detail?.item.operationId===item.operationId?"收起对比":"查看修改前后"}</button>
        {state.detail?.item.operationId===item.operationId&&<div className="mt-4 space-y-2" aria-label="修改前后对比">
          <p className="text-xs text-slate-500">以下来自当时保存的快照，不使用今天的配置补造旧值。黄色为不同或无法直接比较的值。</p>
          {[...new Set([...Object.keys(state.detail.before??{}),...Object.keys(state.detail.after??{})])].map(key=>{
            const before=state.detail!.before,after=state.detail!.after,changed=JSON.stringify(before?.[key])!==JSON.stringify(after?.[key]);
            return <div key={key} className={`rounded-lg border p-3 ${changed?"border-amber-200 bg-amber-50":"border-slate-200 bg-white"}`}><p className="text-sm font-semibold">{fields[key]??key}</p>
              <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2"><div><p className="font-semibold">修改前</p><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-sans">{valueText(before,key)}</pre></div><div><p className="font-semibold">修改后</p><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-sans">{valueText(after,key)}</pre></div></div></div>;
          })}
          <p className="break-all text-xs text-slate-500">原始 UTC：{item.recordedAt}。人员／地点编号按历史保存，不用当前名称冒充历史名称。</p>
        </div>}
      </article>)}</div></>}
    <div className="flex flex-wrap gap-3"><button className={button} disabled={busy||!state.query||!!error} onClick={()=>void client.refresh(true)}>重新查询首页</button><button className={button} disabled={busy||!state.result?.nextCursor||!!error} onClick={()=>void client.next()}>下一页</button></div>
    <p className="text-xs leading-5 text-slate-500">操作人标识是企业内稳定关联标识，不是姓名或原始认证账号。列表不是正式导出快照；新增或延迟提交的记录请重查首页。</p>
  </section>;
}
