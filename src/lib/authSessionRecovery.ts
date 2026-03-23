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

function getBrowserStorages(): Storage[] {
  if (typeof window === "undefined") return [];
  const storages: Storage[] = [];
  for (const candidate of [window.localStorage, window.sessionStorage]) {
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

export async function recoverBrowserSupabaseSession(timeoutMs = 4500): Promise<Session | null> {
  const direct = await pollSession(timeoutMs);
  if (direct) return direct;
  const fromStored = await tryRecoverSessionFromStoredToken(timeoutMs);
  if (fromStored) return fromStored;
  return pollSession(1200);
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
