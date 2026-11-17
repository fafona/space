"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/components/I18nProvider";
import { createChatTranslationSession } from "@/lib/chatTranslation";
type Session=ReturnType<typeof createChatTranslationSession>;
const Context=createContext<{session:Session|null}|undefined>(undefined);
type Props={scope:string;enabled?:boolean;active?:boolean;children:ReactNode};
export function ChatTranslationProvider({scope,enabled=true,active=true,children}:Props) {
  const {locale}=useI18n();
  // Scope changes discard all private results, including same-text results from
  // a different identity/thread. Constructing a session performs no network IO.
  const context=useMemo(()=>({scope,session:enabled&&active?createChatTranslationSession(locale):null}),[scope,locale,enabled,active]);
  useEffect(()=>context.session?.retain(),[context]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function ChatTranslationBoundary(props:Props) {
  const parent=useContext(Context);
  return parent===undefined?<ChatTranslationProvider {...props}/>:props.children;
}
export function ChatTranslationToggle({enabled,onChange}:{enabled:boolean;onChange:(value:boolean)=>void}) {
  return <button type="button" role="switch" data-chat-translation-toggle aria-label="翻译聊天内容" aria-checked={enabled} title={enabled?"聊天翻译已开启；点击查看原文":"聊天翻译已关闭；点击开启"}
    onClick={()=>onChange(!enabled)} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-2 text-slate-600 hover:bg-slate-100">
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h12M9 3v2M5 5c0 5 5 8 8 9M13 5c0 5-5 8-10 9M14 21l4-10 4 10M15.5 18h5"/></svg>
    <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors ${enabled?"bg-teal-600":"bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled?"translate-x-[18px]":"translate-x-0.5"} left-0`}/></span>
  </button>;
}
export function TranslatedChatText({value,children,className}:{value:string;children?:(value:string)=>ReactNode;className?:string}) {
  const context=useContext(Context),session=context?.session??null,element=useRef<HTMLSpanElement>(null);
  const [result,setResult]=useState<{session:Session;text:string;value:string}|null>(null);
  useEffect(()=>{
    const node=element.current;if(!node||!session||!value)return;
    let release:(()=>void)|undefined,alive=true;
    const start=()=>{if(alive&&!release)release=session.subscribe(value,translated=>{if(alive)setResult({session,text:value,value:translated});});};
    const observer=typeof IntersectionObserver!=="undefined"?new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){start();observer?.disconnect();}},{rootMargin:"120px"}):null;
    if(observer)observer.observe(node);else start();
    return()=>{alive=false;observer?.disconnect();release?.();};
  },[session,value]);
  const displayed=result?.session===session&&result.text===value?result.value:value;
  return <span ref={element} className={className} data-no-translate="1" data-chat-translated={displayed!==value?"true":undefined} title={displayed!==value?value:undefined}>{children?children(displayed):displayed}</span>;
}
