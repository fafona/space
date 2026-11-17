"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export const chatAttachmentButton = "grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-slate-600 hover:bg-slate-200 focus-within:outline-2 focus-within:outline-teal-700";
export function ChatAttachmentIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/><path d="m6 15 8-8"/></svg>;
}

export default function ChatComposer({ value, onChange, onSend, disabled = false, busy = false, attachment, placeholder = "输入消息…" }: {
  value: string; onChange: (value: string) => void; onSend: () => void | Promise<void>;
  disabled?: boolean; busy?: boolean; attachment?: ReactNode; placeholder?: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(112, Math.max(44, element.scrollHeight))}px`;
  }, [value]);
  return <form data-chat-composer className="flex shrink-0 items-end gap-2 border-t border-slate-200 bg-slate-50 p-3" onSubmit={event => { event.preventDefault(); void onSend(); }}>
    {attachment}
    {/* Also cap by this document's viewport: the isolated account frame can be
        much shorter than the host page when the phone keyboard is open. */}
    <textarea ref={input} aria-label="输入消息" rows={1} maxLength={5000} disabled={disabled} placeholder={placeholder}
      className="block max-h-[min(112px,25dvh)] min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border border-slate-200 bg-white px-4 py-2.5 text-base leading-6 text-slate-900 outline-none focus:border-teal-600 sm:text-sm"
      value={value} onChange={event => onChange(event.target.value)} />
    <button type="submit" aria-label={busy ? "处理中…" : "发送"} title={busy ? "处理中…" : "发送"}
      disabled={disabled || busy || !value.trim()}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-300">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="m4 3 17 9-17 9 3-8 8-1-8-1Z"/></svg>
    </button>
  </form>;
}
