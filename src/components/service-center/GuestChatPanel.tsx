"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GUEST_CHAT_UUID, type GuestChatMessage, type GuestChatPayload, type GuestChatThread } from "@/lib/guestChat";
import { guestChatLabel, localizedGuestChatName } from "@/lib/guestChatPresentation";
import { useI18n } from "@/components/I18nProvider";
import GuestAvatar from "./GuestAvatar";
import { ChatTranslationBoundary } from "@/components/support/ChatTranslation";
import { buildChatAttachmentText, CHAT_ATTACHMENT_MAX_BYTES, guestChatAttachmentPath, parseChatAttachmentText } from "@/lib/chatAttachments";
import GuestMessageContent from "./GuestMessageContent";
import type { MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import { readPersonalGuestIdentity, readPersonalGuestPeerThreads } from "@/lib/personalGuestSession";
import { serviceButton } from "./serviceCenterClient";
import ChatComposer from "./ChatComposer";

type Props={siteId:string;siteName?:string;active:boolean;merchant?:boolean;canSend?:boolean;apiClient?:MerchantBusinessApiClient;onAuthorizationInvalid?:()=>void;conversationId?:string;inboxThread?:GuestChatThread;onThreadUpdated?:(thread:GuestChatThread)=>void;onBack?:()=>void};
class RequestError extends Error {constructor(message:string,readonly status:number){super(message);}}
export default function GuestChatPanel(props:Props){
  return <ChatTranslationBoundary scope={`${props.siteId}:${props.conversationId??"visitor"}`} active={props.active}><GuestChatPanelBody {...props}/></ChatTranslationBoundary>;
}
function GuestChatPanelBody({siteId,siteName="本店",active,merchant=false,canSend=true,apiClient,onAuthorizationInvalid,conversationId,inboxThread,onThreadUpdated,onBack}:Props){
  const {locale}=useI18n();
  const [threads,setThreads]=useState<GuestChatThread[]>([]),[selected,setSelected]=useState("");
  const [thread,setThread]=useState<GuestChatThread|null>(null),[messages,setMessages]=useState<GuestChatMessage[]>([]);
  const [guest,setGuest]=useState<GuestChatPayload["guest"]>(null),[draft,setDraft]=useState("");
  const [draftOwner,setDraftOwner]=useState("");
  const [before,setBefore]=useState<string|null>(null),[nextOffset,setNextOffset]=useState<number|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const [readError,setReadError]=useState("");
  const [mobileThread,setMobileThread]=useState(!merchant),[legacy,setLegacy]=useState<Array<{id:string;text:string}>>([]);
  const pending=useRef<{text:string;id:string}|null>(null),busyRef=useRef(false),generation=useRef(0),readKey=useRef("");
  const scroller=useRef<HTMLDivElement>(null),loadNumber=useRef(0);
  const loadedOlder=useRef(false);
  const uploadController=useRef<AbortController|null>(null);
  const merchantDrafts=useRef(new Map<string,{draft:string;pending:{text:string;id:string}|null}>());
  const embedded=merchant&&conversationId!==undefined;
  const selectionReady=!embedded||conversationId===selected;
  const endpoint=merchant?"/api/merchant-guest-chat":"/api/guest-chat";
  const storageKey=`faolla:guest-chat-draft:v1:${siteId}`;
  const select=useCallback((id:string)=>{
    if(merchant&&selected)merchantDrafts.current.set(selected,{draft,pending:pending.current});
    uploadController.current?.abort();++generation.current;setSelected(id);setMessages([]);setThread(null);setBefore(null);loadedOlder.current=false;setMobileThread(true);setError("");setReadError("");
    if(merchant){const saved=merchantDrafts.current.get(id);setDraft(saved?.draft??"");pending.current=saved?.pending??null;}
  },[draft,merchant,selected]);
  const request=useCallback(async(params:Record<string,unknown>,post=false)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000),version=generation.current;
    try{
      const path=post?endpoint:endpoint+"?"+new URLSearchParams(Object.entries(params).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>[k,String(v)]));
      const response=await (apiClient??fetch)(path,{method:post?"POST":"GET",credentials:"same-origin",cache:"no-store",signal:controller.signal,headers:{accept:"application/json",...(post?{"content-type":"application/json"}:{})},...(post?{body:JSON.stringify(params)}:{})});
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.ok){if((response.status===401||response.status===403)&&version===generation.current){setMessages([]);setThreads([]);setThread(null);setGuest(null);onAuthorizationInvalid?.();}throw new RequestError(result?.message||"会话暂时无法读取，请重试。",response.status);}
      return result as GuestChatPayload;
    }finally{clearTimeout(timer);}
  },[endpoint,apiClient,onAuthorizationInvalid]);
  useEffect(()=>{uploadController.current?.abort();++generation.current;setMessages([]);setThreads([]);setThread(null);setSelected("");setGuest(null);setError("");setReadError("");setBefore(null);setMobileThread(!merchant);readKey.current="";pending.current=null;
    loadedOlder.current=false;merchantDrafts.current.clear();
    if(!merchant){try{const old=JSON.parse(localStorage.getItem(storageKey)||"null");setDraft(typeof old?.draft==="string"?old.draft.slice(0,5000):"");if(typeof old?.requestId==="string"&&GUEST_CHAT_UUID.test(old.requestId)&&typeof old?.draft==="string")pending.current={text:old.draft,id:old.requestId};}catch{setDraft("");}setDraftOwner(storageKey);
      const localIdentity=readPersonalGuestIdentity();
      setLegacy(localIdentity?readPersonalGuestPeerThreads(localIdentity).filter(t=>t.merchantAId===siteId||t.merchantBId===siteId).flatMap(t=>t.messages.map(m=>({id:m.id,text:m.text}))):[]);
    }else {setDraft("");setDraftOwner("");}
  },[siteId,merchant,storageKey,apiClient]);
  useEffect(()=>{if(embedded&&conversationId!==selected)select(conversationId??"");},[conversationId,embedded,select,selected]);
  const load=useCallback(async(history=false,offset=0)=>{
    if(!selectionReady||embedded&&!selected)return;
    const version=generation.current,number=++loadNumber.current;
    try{
      const result=await request({siteId,...(merchant?selected?{threadId:selected}:{offset}:{}),...(history&&before?{before}:{})});
      if(version!==generation.current||number!==loadNumber.current)return;
      if(merchant&&!selected){setThreads(old=>offset?[...new Map([...old,...(result.threads??[])].map(t=>[t.id,t])).values()]:result.threads??[]);setNextOffset(result.nextOffset??null);}
      else {setGuest(result.guest??null);setThread(result.thread??null);
        if(merchant&&result.thread){setThreads(old=>old.map(t=>t.id===result.thread!.id?result.thread!:t));onThreadUpdated?.(result.thread);}
        setMessages(old=>result.thread?[...new Map([...old,...(result.messages??[])].map(m=>[m.id,m])).values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0):[]);
        if(history||!loadedOlder.current)setBefore(result.before??null);if(history)loadedOlder.current=true;
      }
      setReadError("");
    }catch(e){if(version===generation.current&&number===loadNumber.current)setReadError(e instanceof Error?e.message:"会话读取失败。");}
    finally{if(version===generation.current&&number===loadNumber.current)setLoading(false);}
  },[siteId,merchant,selected,request,before,embedded,selectionReady,onThreadUpdated]);
  const loadRef=useRef(load);useEffect(()=>{loadRef.current=load;},[load]);
  useEffect(()=>{
    ++generation.current;readKey.current="";if(!active)return;
    setLoading(true);void loadRef.current();
    const resume=()=>{if(document.visibilityState==="visible")void loadRef.current();};
    const interval=setInterval(resume,15000);document.addEventListener("visibilitychange",resume);
    return()=>{uploadController.current?.abort();++generation.current;clearInterval(interval);document.removeEventListener("visibilitychange",resume);};
  },[active,siteId,merchant,selected,apiClient]);
  useEffect(()=>{if(!merchant&&draftOwner===storageKey){try{localStorage.setItem(storageKey,JSON.stringify({draft,requestId:pending.current?.text===draft?pending.current.id:null}));}catch{/* Do not claim local persistence when storage is unavailable. */}}},[draft,merchant,storageKey,draftOwner]);
  useEffect(()=>{scroller.current?.scrollTo({top:scroller.current.scrollHeight});},[messages.at(-1)?.id]);
  useEffect(()=>{
    if(!active||!selectionReady||!mobileThread||!thread||!messages.length||document.visibilityState!=="visible")return;
    const through=messages.at(-1)!.id,key=thread.id+":"+through;if(readKey.current===key)return;readKey.current=key;
    const version=generation.current;
    void request({action:"read",siteId,threadId:thread.id,through},true).then(()=>{if(version===generation.current){setThreads(old=>old.map(t=>t.id===thread.id?{...t,unread:0}:t));if(merchant)onThreadUpdated?.({...thread,unread:0});}}).catch(()=>{if(version===generation.current)readKey.current="";});
  },[active,selectionReady,mobileThread,thread,messages,siteId,request,merchant,onThreadUpdated]);
  const send=async()=>{
    const text=draft.trim();if(!text||busyRef.current||!active||!selectionReady||!canSend||merchant&&!selected)return;
    busyRef.current=true;setBusy(true);setError("");
    const version=generation.current;
    if(!pending.current||pending.current.text!==draft)pending.current={text:draft,id:crypto.randomUUID()};
    const messageId=pending.current.id;
    if(!merchant)try{localStorage.setItem(storageKey,JSON.stringify({draft,requestId:messageId}));}catch{/* Server acknowledgement remains mandatory. */}
    try{
      if(!merchant&&!guest){const session=await request({action:"session",siteId},true);if(version!==generation.current)return;setGuest(session.guest??null);}
      await request({action:"send",siteId,messageId,text,...(merchant?{threadId:selected}:{})},true);
      if(version!==generation.current)return;
      setDraft("");pending.current=null;if(!merchant)try{localStorage.removeItem(storageKey);}catch{}
      await loadRef.current();
    }catch(e){if(version===generation.current)setError(e instanceof RequestError&&e.status===429?e.message:"发送尚未确认，输入内容已保留。请先刷新核对；原文重试不会重复发送。");}
    finally{busyRef.current=false;setBusy(false);}
  };
  const uploadAttachment=async(file:File)=>{
    if(busyRef.current||!active||!selectionReady||!canSend||merchant&&!selected)return;
    if(parseChatAttachmentText(draft)){setError("请先发送或移除当前附件，再添加下一个。");return;}
    if(!file.size||file.size>CHAT_ATTACHMENT_MAX_BYTES){setError("请选择不超过 8 MB 的文件。");return;}
    const controller=new AbortController(),version=generation.current;
    uploadController.current=controller;busyRef.current=true;setBusy(true);setError("");
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      if(!merchant&&!guest){const session=await request({action:"session",siteId},true);if(version!==generation.current)return;setGuest(session.guest??null);}
      const form=new FormData();form.set("file",file);
      const query=new URLSearchParams({siteId,...(merchant?{threadId:selected}:{})});
      const response=await(apiClient??fetch)(`${endpoint}/attachments?${query}`,{method:"POST",credentials:"same-origin",cache:"no-store",signal:controller.signal,headers:{accept:"application/json"},body:form});
      const result=await response.json().catch(()=>null);
      if(version!==generation.current||controller.signal.aborted)return;
      if(!response.ok||!result?.ok){if(response.status===401||response.status===403){setMessages([]);setThreads([]);setThread(null);setGuest(null);onAuthorizationInvalid?.();}throw new Error(result?.message||"附件上传未确认，请重试。");}
      const path=guestChatAttachmentPath(result.url??"",siteId);
      if(!path||typeof result.name!=="string"||typeof result.image!=="boolean")throw new Error("附件上传未确认，请重试。");
      const next=buildChatAttachmentText(result.name,path,result.image,draft);
      if(next.length>5000)throw new Error("附件已上传；请缩短消息后重新选择附件。");
      setDraft(next);pending.current=null;
    }catch(e){if(version===generation.current)setError(e instanceof Error&&e.name!=="AbortError"?e.message:"附件上传未确认，原输入已保留，请重试。");}
    finally{clearTimeout(timer);if(uploadController.current===controller)uploadController.current=null;busyRef.current=false;setBusy(false);}
  };
  const selectedNumber=(selectionReady?thread?.guestNumber:"")||inboxThread?.guestNumber||threads.find(t=>t.id===selected)?.guestNumber||"";
  const displayName=merchant?localizedGuestChatName(selectedNumber,locale):siteName;
  const showList=embedded?false:merchant?!selected:!mobileThread;
  return <div data-guest-chat data-service-conversations className="flex h-full min-h-0 flex-col gap-2 text-slate-900">
    {!merchant?<p data-guest-chat-notice className="shrink-0 px-1 text-xs leading-5 text-slate-500"><span data-no-translate="1">{guest?localizedGuestChatName(guest.guestNumber,locale):guestChatLabel(locale)}</span> · 消息发送给本店，回复可在此查看。清除浏览器数据后无法找回游客会话。</p>:null}
    {error||readError?<p role="alert" className="shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error||readError}<button type="button" className="ml-2 underline" onClick={()=>{setError("");void loadRef.current();}}>刷新核对</button></p>:null}
    <div className={`grid min-h-0 flex-1 overflow-hidden ${embedded?"bg-white":"rounded-2xl border border-slate-200 bg-white"} ${merchant&&!embedded?"md:grid-cols-[280px_minmax(0,1fr)]":""}`}>
      {!embedded?<aside aria-label="会话对象列表" className={`${showList?"flex":"hidden"} min-h-0 flex-col ${merchant?"md:flex md:border-r md:border-slate-200":""}`}>
        <div className="flex items-center justify-between border-b p-4"><h3 className="font-semibold">{merchant?"游客会话":"聊天列表"}</h3><button type="button" className={serviceButton} disabled={busy||loading} onClick={()=>void loadRef.current()}>刷新会话</button></div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="选择会话">
          {merchant?threads.map(t=><button type="button" key={t.id} data-guest-thread={t.id} className={`mb-1 w-full rounded-xl p-3 text-left ${selected===t.id?"bg-teal-50":"hover:bg-slate-50"}`} onClick={()=>select(t.id)}><span className="flex items-center gap-2"><GuestAvatar/><b data-no-translate="1" className="min-w-0 flex-1 truncate">{localizedGuestChatName(t.guestNumber,locale)}</b>{t.unread?<span className="rounded-full bg-rose-600 px-2 text-xs text-white">{t.unread}</span>:null}</span><span data-no-translate="1" className="mt-1 block truncate text-xs text-slate-500">{t.lastMessage?.text}</span></button>):<button type="button" data-conversation-id={siteId} aria-pressed="true" className="w-full rounded-xl bg-teal-50 p-4 text-left" onClick={()=>setMobileThread(true)}>{siteName}</button>}
          {merchant&&!threads.length&&!loading?<p className="p-4 text-sm text-slate-500">暂无游客消息。</p>:null}
          {merchant&&nextOffset!==null?<button type="button" className={serviceButton} disabled={loading} onClick={()=>void loadRef.current(false,nextOffset)}>更多游客会话</button>:null}
        </nav>
      </aside>:null}
      <section aria-label="当前会话" className={`${showList?"hidden":"flex"} min-h-0 min-w-0 flex-col ${merchant?"md:flex":""}`}>
        <header data-chat-thread-header className="flex min-h-[64px] shrink-0 items-center gap-3 border-b px-3 py-3"><button type="button" className={serviceButton+(merchant?" md:hidden":"")} aria-label="返回会话列表" onClick={()=>{if(onBack){onBack();return;}if(merchant)select("");setMobileThread(false);}}>←</button>{embedded?<GuestAvatar/>:null}<h3 data-no-translate="1" className="min-w-0 flex-1 truncate text-sm font-semibold">{displayName}</h3></header>
        <div ref={scroller} aria-label="聊天记录" className={`min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 ${embedded?"bg-[linear-gradient(135deg,#def9ee_0%,#eff7ff_46%,#dee7f4_100%)]":"bg-slate-50/70"}`}>
          {before?<button type="button" className={serviceButton} disabled={loading} onClick={()=>void loadRef.current(true)}>读取历史消息</button>:null}
          {loading?<p role="status">正在读取会话…</p>:!messages.length?<p className="py-8 text-center text-sm text-slate-500">{merchant&&!selected?"请选择左侧游客会话。":"暂无消息。"}</p>:null}
          {(selectionReady?messages:[]).map(m=><div key={m.id} data-no-translate="1" className={`flex ${m.sender===(merchant?"merchant":"guest")?"justify-end":"justify-start"}`}><div className={`max-w-[85%] break-words rounded-2xl px-4 py-3 text-sm ${m.sender===(merchant?"merchant":"guest")?"bg-teal-100":"border border-slate-200 bg-white"}`}><GuestMessageContent text={m.text} siteId={siteId}/><time className="mt-1 block text-[10px] text-slate-500">{m.createdAt.replace("T"," ").slice(0,19)}</time></div></div>)}
          {!merchant&&legacy.length?<details className="rounded-xl border p-3 text-xs"><summary>以前仅保存在本机的记录（未送达）</summary>{legacy.map(m=><p key={m.id} data-no-translate="1" className="mt-2 whitespace-pre-wrap break-words">{m.text}</p>)}<p className="mt-2 text-slate-500">这些旧内容不会自动补发。</p></details>:null}
        </div>
        <ChatComposer value={selectionReady?draft:""} onChange={setDraft} onSend={send} busy={busy}
          disabled={!active||!selectionReady||!canSend||merchant&&!selected} placeholder={!canSend?"当前角色只能查看会话":"输入消息…"}
          onSelectFile={file=>void uploadAttachment(file)}/>
      </section>
    </div>
  </div>;
}
