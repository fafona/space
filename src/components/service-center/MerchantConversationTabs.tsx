"use client";
import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
const Guests=dynamic(()=>import("./GuestChatPanel"),{ssr:false,loading:()=> <p role="status" className="p-4">正在打开游客会话…</p>});
// Keep the original account UI mounted: switching inboxes never discards drafts.
export default function MerchantConversationTabs({siteId,children,apiClient,canSend=true,onAuthorizationInvalid}:{siteId:string;children:ReactNode;apiClient?:MerchantBusinessApiClient;canSend?:boolean;onAuthorizationInvalid?:()=>void}){
  const [guest,setGuest]=useState(false),[visited,setVisited]=useState(false);
  const [unread,setUnread]=useState(false);
  useEffect(()=>{
    if(!/^\d{8}$/.test(siteId))return;
    let stopped=false,pending=false,controller:AbortController|null=null;
    setUnread(false);
    const check=async()=>{
      if(pending||stopped||document.visibilityState!=="visible")return;
      pending=true;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),9000);
      try{
        const response=await(apiClient??fetch)("/api/merchant-guest-chat?siteId="+encodeURIComponent(siteId),{cache:"no-store",credentials:"same-origin",signal:controller.signal});
        if(stopped)return;
        if(response.status===401||response.status===403){setUnread(false);onAuthorizationInvalid?.();return;}
        const data=await response.json();if(!stopped&&response.ok&&data.ok)setUnread(data.threads?.some((t:{unread:number})=>t.unread>0)??false);
      }catch{/* The inbox exposes a retryable error, never a fake empty success. */}
      finally{pending=false;clearTimeout(timeout);}
    };
    void check();const timer=setInterval(()=>void check(),15000);document.addEventListener("visibilitychange",check);
    return()=>{stopped=true;controller?.abort();clearInterval(timer);document.removeEventListener("visibilitychange",check);};
  },[siteId,apiClient,onAuthorizationInvalid]);
  if(!/^\d{8}$/.test(siteId))return children;
  return <div data-merchant-conversation-tabs className="flex h-full min-h-0 w-full flex-col"><div className="flex shrink-0 gap-2 border-b border-slate-200 bg-white p-3" role="tablist" aria-label="会话类型">
    <button type="button" role="tab" aria-selected={!guest} className={`rounded-xl px-4 py-2 text-sm font-semibold ${!guest?"bg-slate-900 text-white":"bg-slate-100 text-slate-700"}`} onClick={()=>setGuest(false)}>账号会话</button>
    <button type="button" role="tab" aria-selected={guest} className={`rounded-xl px-4 py-2 text-sm font-semibold ${guest?"bg-teal-700 text-white":"bg-teal-50 text-teal-800"}`} onClick={()=>{setVisited(true);setGuest(true);}}>游客会话{unread?<span aria-label="有新游客消息" className="ml-2 inline-block h-2 w-2 rounded-full bg-rose-500"/>:null}</button>
  </div><div hidden={guest} className="min-h-0 flex-1">{children}</div>{visited?<div hidden={!guest} className="h-[min(720px,78dvh)] min-h-0 flex-1 p-2"><Guests key={siteId} siteId={siteId} active={guest} merchant apiClient={apiClient} canSend={canSend} onAuthorizationInvalid={onAuthorizationInvalid}/></div>:null}</div>;
}
