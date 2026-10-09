"use client";
import { useCallback,useEffect,useMemo,useRef,useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceReviewRoutingClient } from "@/lib/merchantAttendanceReviewRoutingClient";
import type { ReviewRoutingFamily } from "@/lib/merchantAttendanceReviewRouting";
const currentAuth=()=>true;
// Use only beside an original successfully read/submitted application. No scan,
// automatic GET, parallel application writer or delegate identity is exposed.
export default function MerchantAttendanceReviewRoutingSelf({siteId,authUserId,family,requestId,apiFetch,isCurrentAuth=currentAuth}:{siteId:string;authUserId:string;family:ReviewRoutingFamily;requestId:string;apiFetch:AttendanceApiFetch;isCurrentAuth?:()=>boolean}){
  /* eslint-disable react-hooks/refs -- Synchronously revoke obsolete Auth/scope before effect cleanup; refs never provide displayed data. */
  const marker=useMemo(()=>({siteId,authUserId,family,requestId,apiFetch,isCurrentAuth}),[siteId,authUserId,family,requestId,apiFetch,isCurrentAuth]),liveMarker=useRef(marker),mounted=useRef(false);liveMarker.current=marker;
  const live=useCallback(()=>mounted.current&&liveMarker.current===marker&&isCurrentAuth()===true,[marker,isCurrentAuth]),client=useMemo(()=>new AttendanceReviewRoutingClient({...marker,enabled:false,isCurrentAuth:live,storage:()=>{if(!live())throw Error("scope_changed");return sessionStorage;}}),[marker,live]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);useEffect(()=>{mounted.current=true;void client.initialize();const hide=()=>{if(document.hidden)client.pause();else void client.initialize();};document.addEventListener("visibilitychange",hide);return()=>{mounted.current=false;client.pause();document.removeEventListener("visibilitychange",hide);};},[client]);const d=state.result?.data;
  return <div className="min-w-0 space-y-2 rounded-xl border p-3 text-sm" aria-label="本人申请办理去向"><button type="button" className="rounded-xl border px-3 py-2 disabled:opacity-40" disabled={state.phase==="loading"||!!state.pending} onClick={()=>{if(live()&&!document.hidden)void client.self(family,requestId);}}>读取办理去向</button>{d?.kind==="self"?<p>{d.route==="owner"?"由负责人协调办理":d.route==="delegate"?"已交有授权的办理人处理":d.route==="needs_assignment"?"等待负责人明确分派":"尚未登记办理责任"}{d.handoverNeeded?"，需要负责人协调接手。":"。"}</p>:<p role="status">{state.message}</p>}</div>;
  /* eslint-enable react-hooks/refs */
}
