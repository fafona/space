export type DomTranslationStatus = {
  locale: string;
  state: "idle" | "pending" | "incomplete";
  pendingCount: number;
  failedCount: number;
};

const EMPTY_STATUS: DomTranslationStatus = { locale: "", state: "idle", pendingCount: 0, failedCount: 0 };
let status = EMPTY_STATUS;
let owner: symbol | null = null;
const listeners = new Set<() => void>();
const retryListeners = new Set<(locale: string) => void>();

export const getDomTranslationStatus = () => status;
export const getDomTranslationServerStatus = () => EMPTY_STATUS;
export function subscribeDomTranslationStatus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function subscribeDomTranslationRetry(listener: (locale: string) => void) {
  retryListeners.add(listener);
  return () => { retryListeners.delete(listener); };
}
export function requestDomTranslationRetry(locale: string) {
  if (status.locale !== locale || status.pendingCount || !status.failedCount) return;
  retryListeners.forEach(listener => listener(locale));
}

/** Per-page/locale ownership prevents an abandoned translation from reporting
 * success or failure into a newer page. Only counters, never customer text,
 * are exposed to React; concurrent DOM batches share one aggregate status. */
export function createDomTranslationReporter(locale: string) {
  const token = Symbol();
  owner = token;
  const batches = new Map<symbol, Set<string>>();
  const failed = new Set<string>();
  let disposed = false;
  const publish = () => {
    if (disposed || owner !== token) return;
    const pending = new Set<string>();
    batches.forEach(texts => texts.forEach(text => pending.add(text)));
    const next: DomTranslationStatus = { locale, pendingCount: pending.size, failedCount: failed.size,
      state: pending.size ? "pending" : failed.size ? "incomplete" : "idle" };
    if (Object.keys(next).every(key => next[key as keyof DomTranslationStatus] === status[key as keyof DomTranslationStatus])) return;
    status = next;
    listeners.forEach(listener => listener());
  };
  publish();
  return {
    begin(texts: Iterable<string>) {
      const id = Symbol();
      if (disposed || owner !== token) return id;
      const batch = new Set(texts);
      batch.forEach(text => failed.delete(text));
      batches.set(id, batch);
      publish();
      return id;
    },
    finish(id: symbol, isCached: (text: string) => boolean) {
      if (disposed || owner !== token) return;
      const batch = batches.get(id);
      if (!batch) return;
      batches.delete(id);
      batch.forEach(text => { if (isCached(text)) failed.delete(text); else failed.add(text); });
      publish();
    },
    resetFailures() { if (!disposed && owner === token) { failed.clear(); publish(); } },
    dispose() {
      disposed = true;
      batches.clear();
      failed.clear();
      if (owner !== token) return;
      owner = null;
      status = EMPTY_STATUS;
      listeners.forEach(listener => listener());
    },
  };
}
