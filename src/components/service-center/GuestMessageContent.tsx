"use client";
import { useEffect, useRef, useState } from "react";
import {guestChatAttachmentPath,parseChatAttachmentText} from "@/lib/chatAttachments";
import {normalizePublicAssetUrl} from "@/lib/publicAssetUrl";
import {TranslatedChatText} from "@/components/support/ChatTranslation";
import {renderSupportMessageText} from "@/components/support/SupportMessageContent";
export default function GuestMessageContent({text,siteId}:{text:string;siteId:string}) {
  const attachment=parseChatAttachmentText(text),[large,setLarge]=useState(false);
  const close=useRef<HTMLButtonElement>(null),opener=useRef<HTMLButtonElement>(null);
  const path=attachment?guestChatAttachmentPath(attachment.url,siteId):"",url=normalizePublicAssetUrl(path);
  useEffect(()=>{if(!large)return;const previous=opener.current;close.current?.focus();return()=>previous?.focus();},[large]);
  if(!attachment||!path)return <TranslatedChatText value={text} className="whitespace-pre-wrap break-words">{renderSupportMessageText}</TranslatedChatText>;
  return <div className="space-y-2">
    {attachment.image?<button ref={opener} type="button" aria-label="查看图片大图" onClick={()=>setLarge(true)} className="block max-w-full overflow-hidden rounded-xl"><img loading="lazy" src={url} alt={attachment.name} className="max-h-64 max-w-full object-contain"/></button>:<a href={url} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-white/80 p-3 text-slate-800"><svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"/></svg><span className="min-w-0 break-all text-sm" data-no-translate="1">{attachment.name}</span><span className="sr-only">打开文件</span></a>}
    {attachment.caption?<TranslatedChatText value={attachment.caption} className="whitespace-pre-wrap break-words">{renderSupportMessageText}</TranslatedChatText>:null}
    {large?<div role="dialog" aria-modal="true" aria-label="图片预览" className="fixed inset-0 z-[2147483300] flex items-center justify-center bg-slate-950/90 p-5" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setLarge(false);}if(event.key==="Tab"){event.preventDefault();close.current?.focus();}}} onClick={event=>{event.stopPropagation();setLarge(false);}}><button ref={close} type="button" aria-label="关闭图片预览" className="absolute right-5 top-5 h-11 w-11 rounded-full bg-white text-2xl text-slate-900">×</button><img src={url} alt={attachment.name} className="max-h-full max-w-full object-contain" onClick={event=>event.stopPropagation()}/></div>:null}
  </div>;
}
