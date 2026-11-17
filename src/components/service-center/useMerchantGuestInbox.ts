"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuestChatPayload, GuestChatThread } from "@/lib/guestChat";
import type { MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";

type Options = {
  siteId: string;
  active: boolean;
  apiClient?: MerchantBusinessApiClient;
  onAuthorizationInvalid?: () => void;
};

export function useMerchantGuestInbox({ siteId, active, apiClient, onAuthorizationInvalid }: Options) {
  const scope = useMemo(() => ({ siteId, apiClient }), [siteId, apiClient]);
  const [state, setState] = useState({ scope, threads: [] as GuestChatThread[], nextOffset: null as number | null, error: "", loading: false });
  const pending = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const invalidate = useCallback(() => { ++revision.current; pending.current?.abort(); pending.current = null; }, []);
  const authCallback = useRef(onAuthorizationInvalid);
  authCallback.current = onAuthorizationInvalid;
  const load = useCallback(async (offset = 0) => {
    if (!active || !/^\d{8}$/.test(siteId) || pending.current || document.visibilityState !== "visible") return;
    const controller = new AbortController(), version = revision.current;
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setState(old => ({ ...(old.scope === scope ? old : { scope, threads: [], nextOffset: null, error: "" }), loading: true }));
    try {
      const response = await (apiClient ?? fetch)(`/api/merchant-guest-chat?siteId=${encodeURIComponent(siteId)}&offset=${offset}`, {
        cache: "no-store", credentials: "same-origin", signal: controller.signal,
      });
      const data = await response.json().catch(() => null) as GuestChatPayload & { message?: string } | null;
      if (version !== revision.current) return;
      if (response.status === 401 || response.status === 403) {
        setState({ scope, threads: [], nextOffset: null, error: "会话权限已失效，请刷新核对。", loading: false });
        authCallback.current?.();
        return;
      }
      if (!response.ok || !data?.ok) throw new Error(data?.message || "部分会话暂时无法读取，请刷新重试。");
      setState(old => ({ scope, threads: [...new Map([
        ...(old.scope === scope ? old.threads : []), ...(data.threads ?? []),
      ].map(thread => [thread.id, thread])).values()], nextOffset: offset ? data.nextOffset ?? null : old.scope === scope && old.threads.length > (data.threads?.length ?? 0) ? old.nextOffset : data.nextOffset ?? null, error: "", loading: false }));
    } catch (error) {
      if (version === revision.current) setState(old => ({ ...old, scope, loading: false, error: error instanceof Error && error.name !== "AbortError" ? error.message : "会话读取超时，请刷新重试。" }));
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) pending.current = null;
    }
  }, [active, apiClient, scope, siteId]);
  useEffect(() => {
    invalidate();
    setState(old => old.scope === scope ? old : { scope, threads: [], nextOffset: null, error: "", loading: false });
    if (!active) return;
    void load();
    const resume = () => { if (document.visibilityState === "visible") void load(); };
    const timer = setInterval(resume, 15000);
    document.addEventListener("visibilitychange", resume);
    return () => { invalidate(); clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, [active, invalidate, load, scope]);
  const updateThread = useCallback((thread: GuestChatThread) => {
    if (thread.siteId !== siteId) return;
    setState(old => old.scope === scope ? { ...old, threads: [...new Map([...old.threads, thread].map(row => [row.id, row])).values()] } : old);
  }, [scope, siteId]);
  const current = state.scope === scope ? state : { threads: [], nextOffset: null, error: "", loading: false };
  return { ...current, refresh: load, updateThread, loadMore: () => current.nextOffset !== null ? load(current.nextOffset) : Promise.resolve() };
}
