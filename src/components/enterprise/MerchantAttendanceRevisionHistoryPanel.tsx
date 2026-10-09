"use client";
import {useEffect,useMemo,useState,useSyncExternalStore} from "react";
import {AttendanceRevisionHistoryClient} from "@/lib/merchantAttendanceRevisionHistoryClient";
import {parseRevisionHistoryQuery,type RevisionHistoryQuery,type RevisionHistoryStatus,type RevisionHistoryItem} from "@/lib/merchantAttendanceRevisionHistory";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
const button="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40",input="mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm";
const labels:Record<RevisionHistoryStatus,string>={all:"全部状态",submitted:"待审批",approved:"已批准",rejected:"已驳回",withdrawn:"已撤回"};
type Props={siteId:string;actorId:string;apiFetch:AttendanceApiFetch;onSelect:(item:RevisionHistoryItem)=>void;onClose:()=>void}&({access:"owner"}|{access:"self";workerId:string;rootRequestId:string});
function initial(props:Props):RevisionHistoryQuery{
  const common={siteId:props.siteId,asOf:null,cursorAt:null,cursorId:null};
  if(props.access==="self")return {...common,access:"self",scope:"root-history",expectedWorkerId:props.workerId,rootRequestId:props.rootRequestId,status:"all"};
  const now=new Date(),from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),to=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
  return {...common,access:"owner",scope:"submission-period",fromAt:from.toISOString().replace('.000Z','.000000Z'),toAt:to.toISOString().replace('.000Z','.000000Z'),status:"submitted"};
}
export default function MerchantAttendanceRevisionHistoryPanel(props:Props){return <Screen key={`${props.siteId}:${props.actorId}:${props.access}:${props.access==="self"?props.workerId+props.rootRequestId:""}`} {...props}/>;}
function Screen(props:Props){
  const {siteId,actorId,access,apiFetch,onSelect,onClose}=props,[seed]=useState(()=>initial(props));
  const client=useMemo(()=>new AttendanceRevisionHistoryClient({siteId,actorId,access,apiFetch}),[siteId,actorId,access,apiFetch]);
  const s=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),[status,setStatus]=useState<RevisionHistoryStatus>(seed.status);
  const [from,setFrom]=useState(seed.access==="owner"?seed.fromAt.slice(0,10):""),[through,setThrough]=useState(seed.access==="owner"?new Date(Date.parse(seed.toAt)-86400000).toISOString().slice(0,10):""),[error,setError]=useState("");
  useEffect(()=>{if(document.visibilityState!=="hidden")void client.initialize(seed);const visible=()=>{setError("");if(document.visibilityState==="hidden")client.pause();else void client.refresh();};document.addEventListener("visibilitychange",visible);return()=>{document.removeEventListener("visibilitychange",visible);client.pause();};},[client,seed]);
  function search(){try{
    const base={...seed,status,asOf:null,cursorAt:null,cursorId:null};let query:RevisionHistoryQuery;
    if(base.access==="owner"){
      const start=new Date(from+'T00:00:00Z'),end=new Date(through+'T00:00:00Z');if(start.toISOString().slice(0,10)!==from||end.toISOString().slice(0,10)!==through)throw Error('date');
      query=parseRevisionHistoryQuery({...base,fromAt:start.toISOString().replace('.000Z','.000000Z'),toAt:new Date(end.getTime()+86400000).toISOString().replace('.000Z','.000000Z')});
    }else query=parseRevisionHistoryQuery(base);setError("");void client.initialize(query);
  }catch{client.pause();setError("请选择有效日期，起止范围最多 31 个 UTC 日；没有请求或修改记录。");}}
  const busy=s.phase==="loading",r=s.result;
  return <section aria-label={access==="owner"?"负责人修订待办与历史":"本人班次修订历史"} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">{access==="owner"?"修订待办与已处理记录":"本班次全部修订历史"}</h3><button type="button" className={button} onClick={()=>{client.pause();onClose();}}>返回修订详情</button></header>
    <p className="text-xs leading-6 text-slate-600">{access==="owner"?"按申请提交日期查询，不是打卡日期；每次最多 31 个 UTC 日，可更改日期查看更早申请。":"仅此本人班次，包含待审、已批准、驳回及撤回；不代表所有班次。"} 每页最多核对 50 个候选，不加载全量记录。姓名和工号为当前标签，不是历史身份快照。</p>
    <form aria-label="筛选修订列表" className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={e=>{e.preventDefault();search();}}>
      {access==="owner"&&<><label className="min-w-0 text-sm">提交起始日（UTC）<input aria-label="提交起始日（UTC）" className={input} type="date" value={from} min="2000-01-01" max="2100-12-31" required onChange={e=>setFrom(e.target.value)}/></label><label className="min-w-0 text-sm">提交截止日（UTC，含当天）<input aria-label="提交截止日（UTC，含当天）" className={input} type="date" value={through} min="2000-01-01" max="2100-12-31" required onChange={e=>setThrough(e.target.value)}/></label></>}
      <label className="min-w-0 text-sm">申请状态<select aria-label="申请状态" className={input} value={status} onChange={e=>setStatus(e.target.value as RevisionHistoryStatus)}>{Object.entries(labels).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      <button className={button} disabled={busy}>查询修订列表</button>
    </form>
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm ${error||s.phase==="blocked"?"bg-rose-50 text-rose-900":"bg-blue-50 text-blue-950"}`}>{error||s.message}</p>
    {r&&<>
      {!r.moduleEnabled&&<p className="rounded-xl bg-amber-50 p-3 text-sm">平台已暂停新增考勤；列表仍按当前权限只读，不能据此发起新审批。</p>}
      <p className="break-all text-xs">当前查询：{labels[s.query!.status]}{s.query!.access==="owner"?` · ${s.query!.fromAt.slice(0,10)} 至 ${new Date(Date.parse(s.query!.toAt)-86400000).toISOString().slice(0,10)}（UTC 提交日）`:" · 本班次"}<br/>状态截点（UTC）：{r.asOf} · 第 {s.page} 页 · 本页扫描 {r.scanned} 个候选／匹配 {r.items.length} 项</p>
      <ul className="space-y-3">{r.items.map(item=><li key={item.requestId} className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><p className="min-w-0 break-words font-semibold">{item.workerName} · {item.workerNo}</p><span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{labels[item.status]}</span></div>
        <p className="break-all text-xs leading-6">提交版本 {item.submittedRevision} · 提交（UTC）：{item.submittedAt}<br/>声明时段（UTC）：{item.proposedStartAt} → {item.proposedEndAt}<br/>申请编号：{item.requestId}{item.closedAt&&<><br/>处理／撤回（UTC）：{item.closedAt}</>}</p>
        <button type="button" className={button} onClick={()=>{client.pause();onSelect(item);}}>查看修订详情</button></li>)}</ul>
    </>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>{setError("");void client.refresh();}}>刷新回首页</button><button type="button" className={button} disabled={busy||!r?.nextCursor} onClick={()=>void client.next()}>下一页候选</button></div>
    <p className="text-xs leading-6 text-slate-500">翻页保持同一状态截点；新提交、审批或撤回需要刷新后显示。此列表不显示当前核定工时、不代表工资或冻结报表，也不能直接批准。进入详情重新核验最新状态。无自动刷新、不保存名单到浏览器存储。</p>
  </section>;
}
