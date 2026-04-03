import type { Session } from "@supabase/supabase-js";
import { legacySupabaseAuthStorageKey, resolvedSupabaseAuthStorageKey, supabase } from "@/lib/supabase";

type SessionTokens = {
  access_token: string;
  refresh_token: string;
};

export type BrowserSessionTokens = SessionTokens;

type BrowserSessionSnapshot = {
  currentSession: unknown;
  session: unknown;
};

type MerchantCookieSessionPayload = {
  authenticated?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresIn?: unknown;
  tokenType?: unknown;
  merchantId?: unknown;
  user?: Session["user"] | null;
};

let merchantSessionPayloadInFlight: Promise<MerchantCookieSessionPayload | null> | null = null;

function getBrowserStorages(): Storage[] {
  if (typeof window === "undefined") return [];
  const storages: Storage[] = [];
  for (const candidate of [window.sessionStorage]) {
    try {
      const probeKey = "__merchant_storage_probe__";
      candidate.setItem(probeKey, "1");
      candidate.removeItem(probeKey);
      storages.push(candidate);
    } catch {
      // Ignore unavailable browser storage.
    }
  }
  return storages;
}

function getLegacyPersistentBrowserStorages(): Storage[] {
  if (typeof window === "undefined") return [];
  const storages: Storage[] = [];
  for (const candidate of [window.localStorage]) {
    try {
      const probeKey = "__merchant_storage_probe__";
      candidate.setItem(probeKey, "1");
      candidate.removeItem(probeKey);
      storages.push(candidate);
    } catch {
      // Ignore unavailable browser storage.
    }
  }
  return storages;
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutTask = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("session_recovery_timeout"));
    }, Math.max(400, timeoutMs));
  });

  try {
    return await Promise.race([task, timeoutTask]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pollSession(timeoutMs: number): Promise<Session | null> {
  const deadline = Date.now() + Math.max(400, timeoutMs);
  while (Date.now() < deadline) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) return session;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 220);
    });
  }
  return null;
}

function isInvalidRefreshTokenMessage(message: string) {
  return /invalid refresh token|already used/i.test(String(message ?? ""));
}

function extractStoredSessionTokens(input: unknown): SessionTokens | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const containers: unknown[] = [record, record.currentSession, record.session];
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    const candidate = container as Record<string, unknown>;
    const access = typeof candidate.access_token === "string" ? candidate.access_token.trim() : "";
    const refresh = typeof candidate.refresh_token === "string" ? candidate.refresh_token.trim() : "";
    if (access && refresh) {
      return {
        access_token: access,
        refresh_token: refresh,
      };
    }
  }
  return null;
}

async function tryRecoverSessionFromStoredToken(timeoutMs: number): Promise<Session | null> {
  const storageKeys = [resolvedSupabaseAuthStorageKey, legacySupabaseAuthStorageKey].filter(
    (value, index, list) => value && list.indexOf(value) === index,
  );
  for (const storage of getBrowserStorages()) {
    for (const storageKey of storageKeys) {
      try {
        const raw = storage.getItem(storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as unknown;
        const tokens = extractStoredSessionTokens(parsed);
        if (!tokens) continue;
        const { data } = await withTimeout(supabase.auth.setSession(tokens), Math.max(3000, timeoutMs));
        if (data.session) return data.session;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (isInvalidRefreshTokenMessage(message)) {
          try {
            storage.removeItem(storageKey);
          } catch {
            // ignore browser storage cleanup failures
          }
        }
      }
    }
  }
  return null;
}

export function persistBrowserSupabaseSessionSnapshot(session: BrowserSessionSnapshot) {
  const storageKeys = [resolvedSupabaseAuthStorageKey, legacySupabaseAuthStorageKey].filter(
    (value, index, list) => value && list.indexOf(value) === index,
  );
  if (storageKeys.length === 0) return false;
  const storages = getBrowserStorages();
  if (storages.length === 0) return false;

  const snapshot = JSON.stringify(session);
  let stored = false;
  for (const storage of storages) {
    for (const storageKey of storageKeys) {
      try {
        storage.setItem(storageKey, snapshot);
        stored = true;
      } catch {
        // Ignore browser storage write failures and keep trying others.
      }
    }
  }
  for (const storage of getLegacyPersistentBrowserStorages()) {
    for (const storageKey of storageKeys) {
      try {
        storage.removeItem(storageKey);
      } catch {
        // Ignore browser storage cleanup failures.
      }
    }
  }
  return stored;
}

export async function establishBrowserSupabaseSession(
  tokens: BrowserSessionTokens,
  timeoutMs = 6000,
): Promise<Session | null> {
  const accessToken = String(tokens.access_token ?? "").trim();
  const refreshToken = String(tokens.refresh_token ?? "").trim();
  if (!accessToken || !refreshToken) return null;

  try {
    const { data, error } = await withTimeout(
      supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      }),
      Math.max(3000, timeoutMs),
    );
    if (!error && data.session) return data.session;
  } catch {
    // Fall through to storage and poll-based recovery.
  }

  return recoverBrowserSupabaseSession(Math.max(2200, timeoutMs - 1200));
}

export function hasStoredBrowserSupabaseSessionTokens(): boolean {
  const storageKeys = [resolvedSupabaseAuthStorageKey, legacySupabaseAuthStorageKey].filter(
    (value, index, list) => value && list.indexOf(value) === index,
  );
  for (const storage of getBrowserStorages()) {
    for (const storageKey of storageKeys) {
      try {
        const raw = storage.getItem(storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as unknown;
        if (extractStoredSessionTokens(parsed)) return true;
      } catch {
        // ignore malformed storage entries
      }
    }
  }
  return false;
}

export function clearStoredBrowserSupabaseSessionTokens() {
  const storageKeys = [resolvedSupabaseAuthStorageKey, legacySupabaseAuthStorageKey].filter(
    (value, index, list) => value && list.indexOf(value) === index,
  );
  for (const storage of [...getBrowserStorages(), ...getLegacyPersistentBrowserStorages()]) {
    for (const storageKey of storageKeys) {
      try {
        storage.removeItem(storageKey);
      } catch {
        // ignore browser storage cleanup failures
      }
    }
  }
}

function buildSyntheticSessionFromMerchantCookiePayload(payload: {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  tokenType?: string | null;
  user: Session["user"];
}): Session {
  const expiresIn = typeof payload.expiresIn === "number" && Number.isFinite(payload.expiresIn)
    ? Math.max(60, Math.round(payload.expiresIn))
    : 60 * 60;
  return {
    access_token: payload.accessToken,
    refresh_token: String(payload.refreshToken ?? "").trim(),
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: String(payload.tokenType ?? "").trim() || "bearer",
    user: payload.user,
  } as Session;
}

export async function readMerchantSessionPayload(timeoutMs = 4500): Promise<MerchantCookieSessionPayload | null> {
  if (typeof window === "undefined") return null;
  if (merchantSessionPayloadInFlight) return merchantSessionPayloadInFlight;
  let task: Promise<MerchantCookieSessionPayload | null> | null = null;
  task = (async () => {
    try {
      const response = await withTimeout(
        fetch("/api/auth/merchant-session", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
          },
        }),
        Math.max(1200, timeoutMs),
      );
      if (!response.ok) return null;
      return (await response.json().catch(() => null)) as MerchantCookieSessionPayload | null;
    } catch {
      return null;
    } finally {
      if (task && merchantSessionPayloadInFlight === task) {
        merchantSessionPayloadInFlight = null;
      }
    }
  })();
  merchantSessionPayloadInFlight = task;
  return task;
}

async function readMerchantCookieSessionPayload(timeoutMs: number) {
  const payload = await readMerchantSessionPayload(timeoutMs);
  const authenticated = payload?.authenticated === true;
  const accessToken = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
  const refreshToken = typeof payload?.refreshToken === "string" ? payload.refreshToken.trim() : "";
  const tokenType = typeof payload?.tokenType === "string" ? payload.tokenType.trim() : "bearer";
  const expiresIn =
    typeof payload?.expiresIn === "number" && Number.isFinite(payload.expiresIn) ? payload.expiresIn : null;
  const user = payload?.user ?? null;
  if (!authenticated || !accessToken || !user) return null;
  return {
    accessToken,
    refreshToken,
    expiresIn,
    tokenType,
    user,
  };
}

export async function recoverBrowserSupabaseSessionViaMerchantCookies(timeoutMs = 4500): Promise<Session | null> {
  const payload = await readMerchantCookieSessionPayload(timeoutMs);
  if (!payload) return null;

  const syntheticSession = buildSyntheticSessionFromMerchantCookiePayload(payload);
  if (payload.refreshToken) {
    persistBrowserSupabaseSessionSnapshot({
      currentSession: syntheticSession,
      session: syntheticSession,
    });
    try {
      const { data } = await withTimeout(
        supabase.auth.setSession({
          access_token: payload.accessToken,
          refresh_token: payload.refreshToken,
        }),
        Math.max(1800, timeoutMs),
      );
      if (data.session) return data.session;
    } catch {
      // Fall back to the validated cookie-backed session shape below.
    }
  }

  return syntheticSession;
}

export async function recoverBrowserSupabaseSession(timeoutMs = 4500): Promise<Session | null> {
  const direct = await pollSession(timeoutMs);
  if (direct) return direct;
  const fromStored = await tryRecoverSessionFromStoredToken(timeoutMs);
  if (fromStored) return fromStored;
  const fromMerchantCookies = await recoverBrowserSupabaseSessionViaMerchantCookies(timeoutMs);
  if (fromMerchantCookies) return fromMerchantCookies;
  return pollSession(1200);
}

export async function recoverBrowserSupabaseSessionWithRefresh(timeoutMs = 4500): Promise<Session | null> {
  const recovered = await recoverBrowserSupabaseSession(timeoutMs);
  if (recovered) return recovered;

  try {
    const { data } = await withTimeout(
      supabase.auth.refreshSession(),
      Math.max(3200, Math.min(9000, timeoutMs + 2000)),
    );
    if (data.session) return data.session;
  } catch {
    // Ignore refresh failures and fall back to one final short poll.
  }

  return pollSession(1200);
}

export async function syncMerchantSessionCookies(
  session: Pick<Session, "access_token" | "refresh_token" | "expires_in"> | null | undefined,
  timeoutMs = 3200,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const accessToken = String(session?.access_token ?? "").trim();
  const refreshToken = String(session?.refresh_token ?? "").trim();
  const expiresIn =
    typeof session?.expires_in === "number" && Number.isFinite(session.expires_in) ? session.expires_in : undefined;
  if (!accessToken) return false;

  try {
    const response = await withTimeout(
      fetch("/api/auth/merchant-session", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          accessToken,
          refreshToken,
          expiresIn,
        }),
      }),
      Math.max(1200, timeoutMs),
    );
    return response.ok;
  } catch {
    return false;
  }
}

type MerchantSessionKeepAliveOptions = {
  intervalMs?: number;
  refreshWindowMs?: number;
  timeoutMs?: number;
};

export function startMerchantSessionKeepAlive(options?: MerchantSessionKeepAliveOptions) {
  if (typeof window === "undefined") return () => {};

  const intervalMs = Math.max(60_000, Math.min(15 * 60_000, options?.intervalMs ?? 8 * 60_000));
  const refreshWindowMs = Math.max(30_000, Math.min(intervalMs, options?.refreshWindowMs ?? 12 * 60_000));
  const timeoutMs = Math.max(1800, Math.min(9000, options?.timeoutMs ?? 4200));
  let disposed = false;
  let inFlight: Promise<Session | null> | null = null;

  const tick = async (forceRefresh: boolean) => {
    if (disposed) return null;
    if (inFlight) return inFlight;
    const task = (async () => {
      try {
        let currentSession: Session | null = null;
        try {
          const {
            data: { session },
          } = await withTimeout(supabase.auth.getSession(), timeoutMs);
          currentSession = session ?? null;
        } catch {
          currentSession = null;
        }

        const expiresAtMs =
          typeof currentSession?.expires_at === "number" && Number.isFinite(currentSession.expires_at)
            ? currentSession.expires_at * 1000
            : 0;
        const shouldRefresh =
          forceRefresh ||
          !currentSession ||
          !currentSession.refresh_token ||
          !expiresAtMs ||
          expiresAtMs - Date.now() <= refreshWindowMs;

        const activeSession = shouldRefresh
          ? await recoverBrowserSupabaseSessionWithRefresh(timeoutMs)
          : currentSession;
        if (!activeSession) return null;
        await syncMerchantSessionCookies(activeSession, timeoutMs);
        return activeSession;
      } catch {
        return null;
      }
    })();

    inFlight = task;
    try {
      return await task;
    } finally {
      if (inFlight === task) {
        inFlight = null;
      }
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    void tick(true);
  };
  const onFocus = () => {
    void tick(true);
  };

  const intervalId = window.setInterval(() => {
    if (document.visibilityState === "hidden") return;
    void tick(false);
  }, intervalMs);

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onFocus);
  void tick(false);

  return () => {
    disposed = true;
    window.clearInterval(intervalId);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onFocus);
  };
}

export function isTransientAuthValidationError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { message?: unknown; name?: unknown; status?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  const name = typeof record.name === "string" ? record.name : "";
  if (name === "AbortError") return true;
  if (Number(record.status) === 0) return true;
  return /supabase_unavailable:|network|fetch|load failed|timeout|cooldown|temporarily|connection/i.test(message);
}
