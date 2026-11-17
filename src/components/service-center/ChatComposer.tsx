"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { buildChatAttachmentText, CHAT_ATTACHMENT_ACCEPT, guestChatAttachmentPath, parseChatAttachmentText } from "@/lib/chatAttachments";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

export const chatAttachmentButton = "grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-slate-600 hover:bg-slate-200 focus-within:outline-2 focus-within:outline-teal-700";
export function ChatAttachmentIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/><path d="m6 15 8-8"/></svg>;
}

export default function ChatComposer({ value, onChange, onSend, disabled = false, busy = false, attachment, onSelectFile, placeholder = "输入消息…" }: {
  value: string; onChange: (value: string) => void; onSend: () => void | Promise<void>;
  disabled?: boolean; busy?: boolean; attachment?: ReactNode; placeholder?: string; onSelectFile?:(file:File)=>void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput=useRef<HTMLInputElement>(null),imageInput=useRef<HTMLInputElement>(null);
  const [toolsOpen,setToolsOpen]=useState(false),[emojiOpen,setEmojiOpen]=useState(false);
  const pendingAttachment=parseChatAttachmentText(value);
  const displayed=onSelectFile&&pendingAttachment?pendingAttachment.caption:value;
  const changeText=(next:string)=>onChange(onSelectFile&&pendingAttachment?buildChatAttachmentText(pendingAttachment.name,pendingAttachment.url,pendingAttachment.image,next):next);
  const insertEmoji=(emoji:string)=>{
    const start=input.current?.selectionStart??displayed.length,end=input.current?.selectionEnd??start;
    const next=displayed.slice(0,start)+emoji+displayed.slice(end);if(next.length>4500)return;
    changeText(next);setEmojiOpen(false);requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(start+emoji.length,start+emoji.length);});
  };
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(112, Math.max(44, element.scrollHeight))}px`;
  }, [displayed]);
  return <form data-chat-composer className="relative shrink-0 border-t border-slate-200 bg-[#edf5f2] p-2" onKeyDown={event=>{if(event.key==="Escape"&&(toolsOpen||emojiOpen)){event.preventDefault();event.stopPropagation();setToolsOpen(false);setEmojiOpen(false);}}} onSubmit={event => { event.preventDefault();setToolsOpen(false);setEmojiOpen(false); void onSend(); }}>
    {pendingAttachment&&onSelectFile?<div data-chat-attachment-preview className="absolute bottom-full left-2 right-2 mb-1 flex h-14 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 shadow-sm">
      {pendingAttachment.image&&guestChatAttachmentPath(pendingAttachment.url)?<img alt="待发送图片" src={normalizePublicAssetUrl(guestChatAttachmentPath(pendingAttachment.url))} className="h-10 w-10 rounded-lg object-cover"/>:null}
      <span data-no-translate="1" className="min-w-0 flex-1 truncate text-xs">{pendingAttachment.name}</span><button type="button" aria-label="移除待发送附件" className="h-10 w-10 rounded-full text-slate-500 hover:bg-slate-100" disabled={busy} onClick={()=>onChange(pendingAttachment.caption)}>×</button>
    </div>:null}
    <div className="flex min-w-0 items-end gap-1 rounded-[26px] bg-white p-1 shadow-sm ring-1 ring-slate-200/70 focus-within:ring-teal-500">
    {onSelectFile?<>
      <div className="relative shrink-0" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setToolsOpen(false);setEmojiOpen(false);}}}>
        <button type="button" aria-label="添加附件" disabled={disabled||busy} className={chatAttachmentButton} onClick={()=>{setEmojiOpen(false);setToolsOpen(!toolsOpen);}}><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg></button>
        <label className="sr-only" title="图片 / 文件"><span>图片 / 文件</span><input ref={fileInput} type="file" aria-label="图片 / 文件" accept={CHAT_ATTACHMENT_ACCEPT} disabled={disabled||busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";setToolsOpen(false);if(file)onSelectFile(file);}}/></label>
        <input ref={imageInput} type="file" className="sr-only" aria-label="选择图片" accept="image/jpeg,image/png,image/webp,image/gif" disabled={disabled||busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";setToolsOpen(false);if(file)onSelectFile(file);}}/>
        {toolsOpen?<div className="absolute bottom-full left-0 z-30 mb-2 w-40 rounded-2xl border border-slate-200 bg-white p-1 text-sm shadow-lg"><button type="button" className="block w-full rounded-xl px-4 py-3 text-left hover:bg-slate-100" onClick={()=>imageInput.current?.click()}>图片</button><button type="button" className="block w-full rounded-xl px-4 py-3 text-left hover:bg-slate-100" onClick={()=>fileInput.current?.click()}>文件</button></div>:null}
      </div>
      <div className="relative shrink-0"><button type="button" aria-label="选择表情" className={chatAttachmentButton} disabled={disabled||busy} onClick={()=>{setToolsOpen(false);setEmojiOpen(!emojiOpen);}}><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8 14a4.5 4.5 0 0 0 8 0M9 9h.01M15 9h.01"/></svg></button>
        {emojiOpen?<div data-no-translate="1" className="absolute bottom-full left-[-44px] z-30 mb-2 grid max-h-[min(240px,35dvh)] w-[min(280px,calc(100vw-40px))] grid-cols-6 gap-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">{['😀','😊','😂','😍','🥳','😎','👍','👏','🙏','❤️','🎉','✅','👋','🤝','💪','🤔','😢','😮','🙌','🔥','⭐','🎂','🌹','☕'].map(emoji=><button key={emoji} type="button" aria-label={emoji} className="h-10 rounded-lg text-2xl hover:bg-slate-100" onClick={()=>insertEmoji(emoji)}>{emoji}</button>)}</div>:null}
      </div>
    </>:attachment}
    {/* Also cap by this document's viewport: the isolated account frame can be
        much shorter than the host page when the phone keyboard is open. */}
    <textarea ref={input} aria-label="输入消息" rows={1} maxLength={pendingAttachment?4500:5000} disabled={disabled||busy} placeholder={placeholder}
      className="block max-h-[min(112px,25dvh)] min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border-0 bg-transparent px-2 py-2.5 text-base leading-6 text-slate-900 outline-none sm:text-sm"
      value={displayed} onChange={event => changeText(event.target.value)} />
    <button type="submit" aria-label={busy ? "处理中…" : "发送"} title={busy ? "处理中…" : "发送"}
      disabled={disabled || busy || !value.trim()}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-300">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="m4 3 17 9-17 9 3-8 8-1-8-1Z"/></svg>
    </button>
    </div>
  </form>;
}
