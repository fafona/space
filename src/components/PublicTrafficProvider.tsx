"use client";
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { isTrafficAction, trafficResourceKey, type TrafficModule, type TrafficTokenEntry } from "@/lib/accountTraffic";
import { enqueueTraffic, trafficClientAllowed } from "@/lib/accountTrafficClient";

type Track = (module: TrafficModule, objectId: string, action: string, once?: boolean) => void;
const PublicTrafficContext = createContext<Track | null>(null);
export function usePublicTraffic() { return useContext(PublicTrafficContext); }

/** Server-verified resources for public contact-card / poll landing pages. */
export function SignedPublicTrafficProvider({ tokens, cardId, children }: {
  tokens: TrafficTokenEntry[]; cardId: string; children: ReactNode;
}) {
  const seen = useRef(new Set<string>());
  const track = useCallback<Track>((module, objectId, action, once = false) => {
    try {
      const key = trafficResourceKey(module, objectId);
      const token = tokens.find((entry) => entry.key === key)?.token;
      const marker = `${key}:${action}`;
      if (!token || !trafficClientAllowed() || !isTrafficAction(module, action) || (once && seen.current.has(marker))) return;
      if (once) seen.current.add(marker);
      enqueueTraffic(token, action);
    } catch { /* Keep analytics isolated from public interactions. */ }
  }, [tokens]);
  useEffect(() => {
    const view = () => { if (document.visibilityState === "visible") track("card", cardId, "view", true); };
    view();
    document.addEventListener("visibilitychange", view);
    return () => document.removeEventListener("visibilitychange", view);
  }, [track, cardId]);
  return <PublicTrafficContext.Provider value={track}><div className="contents" onClickCapture={(event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[data-traffic-action]") : null;
    const action = anchor?.getAttribute("data-traffic-action");
    if (action) track("card", cardId, action);
  }}>{children}</div></PublicTrafficContext.Provider>;
}

export default function PublicTrafficProvider({ siteId, pageId, viewport, children }: {
  siteId: string; pageId: string; viewport: "desktop" | "mobile"; children: ReactNode;
}) {
  const scope = `${siteId}:${pageId}:${viewport}`;
  const state = useRef({ scope, tokens: new Map<string, string>(), pending: [] as { key: string; action: string }[], seen: new Set<string>(), loaded: false });
  const lastPageView = useRef("");
  const resolving = useRef(new Map<string, Promise<string>>());
  const resolveMissing = useCallback((key: string, action: string) => {
    const cacheKey = `${scope}:${key}`;
    let pending = resolving.current.get(cacheKey);
    if (!pending && resolving.current.size < 300) {
      pending = fetch("/api/traffic/context", { method: "POST", credentials: "omit", signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId, pageId, viewport, resourceKey: key }) })
        .then(async (response) => response.ok ? (await response.json()).tokens?.find((entry: TrafficTokenEntry) => entry.key === key)?.token || "" : "")
        .catch(() => "") as Promise<string>;
      resolving.current.set(cacheKey, pending);
    }
    void pending?.then((token) => { if (token && state.current.scope === scope) { state.current.tokens.set(key, token); enqueueTraffic(token, action); } });
  }, [scope, siteId, pageId, viewport]);
  const track = useCallback<Track>((module, objectId, action, once = false) => {
    try {
    if (!trafficClientAllowed()) return;
    // A new render scope cannot use tokens from the preceding page/merchant.
    if (state.current.scope !== scope) state.current = { scope, tokens: new Map(), pending: [], seen: new Set(), loaded: false };
    const current = state.current;
    const key = trafficResourceKey(module, objectId);
    const dedupeKey = `${key}:${action}`;
    if (once && current.seen.has(dedupeKey)) return;
    if (once) current.seen.add(dedupeKey);
    const token = current.tokens.get(key);
    if (token) enqueueTraffic(token, action);
    else if (!current.loaded && current.pending.length < 30) current.pending.push({ key, action });
    else if (current.loaded && current.tokens.size) resolveMissing(key, action);
    } catch { /* Analytics must not interrupt the caller's business operation. */ }
  }, [scope, resolveMissing]);

  useEffect(() => {
    if (!trafficClientAllowed() || !/^\d{8}$/.test(siteId)) return;
    const controller = new AbortController();
    // Defer this nonessential request until after the first content paint.
    const timer = setTimeout(async () => {
      const deadline = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch("/api/traffic/context", { method: "POST", credentials: "omit", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId, pageId, viewport }) });
        if (!response.ok) return;
        const body = await response.json() as { tokens?: TrafficTokenEntry[] };
        if (controller.signal.aborted) return;
        if (state.current.scope !== scope) state.current = { scope, tokens: new Map(), pending: [], seen: new Set(), loaded: false };
        const current = state.current;
        current.tokens = new Map((body.tokens ?? []).map((item) => [item.key, item.token]));
        current.loaded = true;
        for (const event of current.pending.splice(0)) { const token = current.tokens.get(event.key); if (token) enqueueTraffic(token, event.action); else if (current.tokens.size) resolveMissing(event.key, event.action); }
        const pageKey = `${siteId}:${pageId}`;
        if (lastPageView.current !== pageKey && current.tokens.has(trafficResourceKey("website", pageId))) {
          const view = () => { if (document.visibilityState === "visible") { lastPageView.current = pageKey; track("website", pageId, "view", true); document.removeEventListener("visibilitychange", view); } };
          view();
          if (document.visibilityState !== "visible") document.addEventListener("visibilitychange", view, { signal: controller.signal });
        }
      } catch { /* Collection failures must never block or blank the page. */ }
      finally { clearTimeout(deadline); }
    }, 1000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [siteId, pageId, viewport, scope, track, resolveMissing]);

  return <PublicTrafficContext.Provider value={track}>{children}</PublicTrafficContext.Provider>;
}

/** Once per rendered public page, after a module actually enters the viewport. */
export function usePublicTrafficExposure(ref: RefObject<HTMLElement | null>, module: TrafficModule, objectId: string) {
  const track = usePublicTraffic();
  useEffect(() => {
    if (!track || !ref.current || !objectId || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver((entries) => {
      if (document.visibilityState === "visible" && entries.some((entry) => entry.isIntersecting)) {
        track(module, objectId, "exposure", true); observer.disconnect();
      }
    }, { threshold: 0.1 });
    const element = ref.current;
    const recheck = () => { if (document.visibilityState === "visible") { observer.unobserve(element); observer.observe(element); } };
    observer.observe(element);
    document.addEventListener("visibilitychange", recheck);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", recheck); };
  }, [track, ref, module, objectId]);
}
