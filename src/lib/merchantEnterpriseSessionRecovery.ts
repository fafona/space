type CookieIdentity = { status: "authenticated"; userId: string } | { status: "rejected" } | { status: "unavailable" };

const SESSION_UNAVAILABLE = "登录服务暂时不可用，请稍后重试。";

/** Cookie-mode reads only. Explicit employee tokens and all mutations retain
 * their original authority and are never replayed or changed to owner cookies. */
export function createMerchantEnterpriseSessionRecovery(options: {
  fetch: typeof fetch;
  getAuthUserId: () => string | null;
  renewalTimeoutMs?: number;
}) {
  let renewing: Promise<CookieIdentity> | null = null;
  const renew = () => {
    if (renewing) return renewing;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.renewalTimeoutMs ?? 6000);
    const task = (async (): Promise<CookieIdentity> => {
      try {
        const response = await options.fetch("/api/auth/merchant-session?reauth=1", {
          method: "GET", credentials: "include", cache: "no-store",
          headers: { accept: "application/json" }, signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) return { status: "rejected" };
        if (!response.ok) return { status: "unavailable" };
        const payload = await response.json() as { authenticated?: unknown; user?: { id?: unknown } } | null;
        const userId = typeof payload?.user?.id === "string" ? payload.user.id.trim() : "";
        return payload?.authenticated === true && userId
          ? { status: "authenticated", userId } : { status: "unavailable" };
      } catch {
        return { status: "unavailable" };
      } finally {
        clearTimeout(timeout);
      }
    })();
    renewing = task;
    void task.finally(() => { if (renewing === task) renewing = null; });
    return task;
  };

  return async (path: string, init: RequestInit): Promise<Response> => {
    const expectedUserId = options.getAuthUserId();
    const response = await options.fetch(path, init);
    const headers = new Headers(init.headers);
    if (response.status !== 401 || (init.method ?? "GET").toUpperCase() !== "GET"
      || !path.startsWith("/api/merchant-enterprise/") || init.body != null
      || init.credentials === "omit" || headers.has("x-merchant-access-token") || headers.has("authorization")) return response;
    init.signal?.throwIfAborted();
    const identity = await renew();
    init.signal?.throwIfAborted();
    // A stale request must not continue after a tenant/auth lifecycle change.
    if (options.getAuthUserId() !== expectedUserId) return response;
    if (identity.status === "unavailable") throw new Error(SESSION_UNAVAILABLE);
    if (identity.status === "rejected" || (expectedUserId && identity.userId !== expectedUserId)) return response;
    // One read retry only. The endpoint still performs all original permission
    // checks. No refresh tokens enter JS and no failed write is replayed.
    const retryHeaders = new Headers(init.headers);
    retryHeaders.set("x-merchant-expected-auth-user-id", identity.userId);
    return options.fetch(path, { ...init, headers: retryHeaders });
  };
}
