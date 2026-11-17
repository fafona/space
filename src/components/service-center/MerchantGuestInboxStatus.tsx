"use client";

import type { useMerchantGuestInbox } from "./useMerchantGuestInbox";

export default function MerchantGuestInboxStatus({ inbox }: { inbox: ReturnType<typeof useMerchantGuestInbox> }) {
  return <>
    {inbox.error ? <div role="alert" className="m-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{inbox.error}<button type="button" className="ml-2 underline" disabled={inbox.loading} onClick={() => void inbox.refresh()}>刷新会话</button></div> : null}
    {inbox.loading ? <p role="status" className="p-3 text-xs text-slate-500">正在读取会话…</p> : null}
    {inbox.nextOffset !== null ? <button type="button" className="m-2 rounded-xl border px-3 py-2 text-xs" disabled={inbox.loading} onClick={() => void inbox.loadMore()}>更多会话</button> : null}
  </>;
}
