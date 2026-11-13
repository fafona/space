import type { MerchantMembershipProfileDraft, PersonalMembershipCard } from "@/lib/merchantMemberships";
import type { PersonalFavoriteSite } from "@/lib/personalFavorites";

export type ServiceIdentity = {
  authenticated: boolean; accountId: string; profile: MerchantMembershipProfileDraft;
  favoriteSites: PersonalFavoriteSite[]; memberships: PersonalMembershipCard[];
};
export type ServicePanelProps = {
  active: boolean; siteId: string; siteName: string; identity: ServiceIdentity | null;
  refreshIdentity: () => Promise<void>;
};
let pendingRenewal: Promise<Response> | null = null;
export class ServiceRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ServiceRequestError"; }
}
export async function serviceRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, options.method && options.method !== "GET" ? 15000 : 10000);
  const init = { cache: "no-store" as const, credentials: "same-origin" as const, ...options, signal: controller.signal,
    headers: { accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } };
  try {
    let response = await fetch(path, init);
    if (response.status === 401 && (!options.method || options.method === "GET") && !path.startsWith("/api/auth/") && !controller.signal.aborted) {
      // Reuse the canonical renewal. Only reads can retry; never automatically replay a write.
      pendingRenewal ??= fetch("/api/auth/merchant-session", { credentials: "same-origin", cache: "no-store", signal: controller.signal }).finally(() => { pendingRenewal = null; });
      const renewed = await pendingRenewal;
      if (renewed.ok && !controller.signal.aborted) response = await fetch(path, init);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok === false) throw new ServiceRequestError(response.status === 401
      ? "登录状态已过期，请重新登录。" : data?.message || "暂时无法读取，请稍后重试。", response.status);
    return data as T;
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
export const serviceButton = "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50";
export const serviceInput = "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900";
export const serviceCard = "rounded-2xl border border-slate-200 bg-white p-4";
export const SERVICE_IDENTITY_CHANGED = "faolla:service-identity-changed";
