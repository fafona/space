import type { Session } from "@supabase/supabase-js";
import {
  establishBrowserSupabaseSession,
  readMerchantSessionMerchantIds,
  syncMerchantSessionCookies,
  type MerchantCookieSessionPayload,
} from "@/lib/authSessionRecovery";

export type AccountSwitchAccountType = "personal" | "merchant";

export type AccountSwitchEntry = {
  key: string;
  accountType: AccountSwitchAccountType;
  accountId: string;
  merchantId: string;
  merchantIds: string[];
  email: string;
  displayName: string;
  avatarUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  updatedAt: number;
  lastUsedAt: number;
};

const ACCOUNT_SWITCH_STORAGE_KEY = "faolla.accountSwitch.v1";
const MAX_ACCOUNT_SWITCH_ENTRIES = 8;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    const key = "__faolla_account_switch_probe__";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getAccountSwitchEntryKey(
  accountType: AccountSwitchAccountType | string | null | undefined,
  accountId: string | null | undefined,
  merchantId?: string | null,
) {
  const type = accountType === "personal" ? "personal" : "merchant";
  const id = type === "merchant" ? trimText(merchantId) || trimText(accountId) : trimText(accountId);
  return id ? `${type}:${id}` : "";
}

function normalizeEntry(input: unknown): AccountSwitchEntry | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const accountType = record.accountType === "personal" ? "personal" : record.accountType === "merchant" ? "merchant" : null;
  if (!accountType) return null;
  const accountId = trimText(record.accountId);
  const merchantId = trimText(record.merchantId);
  const key = getAccountSwitchEntryKey(accountType, accountId, merchantId);
  const accessToken = trimText(record.accessToken);
  const refreshToken = trimText(record.refreshToken);
  if (!key || !accessToken || !refreshToken) return null;
  const merchantIds = Array.isArray(record.merchantIds)
    ? record.merchantIds.map(trimText).filter(Boolean)
    : [];
  return {
    key,
    accountType,
    accountId,
    merchantId,
    merchantIds,
    email: trimText(record.email),
    displayName: trimText(record.displayName),
    avatarUrl: trimText(record.avatarUrl),
    accessToken,
    refreshToken,
    expiresIn: readNumber(record.expiresIn),
    updatedAt: readNumber(record.updatedAt) ?? Date.now(),
    lastUsedAt: readNumber(record.lastUsedAt) ?? readNumber(record.updatedAt) ?? Date.now(),
  };
}

export function readAccountSwitchEntries() {
  const storage = getStorage();
  if (!storage) return [] as AccountSwitchEntry[];
  try {
    const raw = storage.getItem(ACCOUNT_SWITCH_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeEntry)
      .filter((entry): entry is AccountSwitchEntry => Boolean(entry))
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      .slice(0, MAX_ACCOUNT_SWITCH_ENTRIES);
  } catch {
    return [];
  }
}

function writeAccountSwitchEntries(entries: AccountSwitchEntry[]) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(
      ACCOUNT_SWITCH_STORAGE_KEY,
      JSON.stringify(
        entries
          .filter((entry) => entry.key && entry.accessToken && entry.refreshToken)
          .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
          .slice(0, MAX_ACCOUNT_SWITCH_ENTRIES),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

export function removeAccountSwitchEntry(key: string) {
  const normalizedKey = trimText(key);
  if (!normalizedKey) return readAccountSwitchEntries();
  const nextEntries = readAccountSwitchEntries().filter((entry) => entry.key !== normalizedKey);
  writeAccountSwitchEntries(nextEntries);
  return nextEntries;
}

function saveAccountSwitchEntry(entry: AccountSwitchEntry) {
  const entries = readAccountSwitchEntries().filter((item) => item.key !== entry.key);
  entries.unshift(entry);
  writeAccountSwitchEntries(entries);
  return readAccountSwitchEntries();
}

function buildAccountSwitchEntryFromPayload(
  payload: MerchantCookieSessionPayload | null | undefined,
  metadata?: { displayName?: string; avatarUrl?: string },
  tokens?: { accessToken?: string; refreshToken?: string; expiresIn?: number },
) {
  if (!payload || payload.authenticated !== true || !payload.user) return null;
  const accountType = payload.accountType === "personal" ? "personal" : payload.accountType === "merchant" ? "merchant" : null;
  if (!accountType) return null;
  const merchantIds = readMerchantSessionMerchantIds(payload);
  const accountId = trimText(payload.accountId) || (accountType === "personal" ? "" : trimText(payload.merchantId) || merchantIds[0] || "");
  const merchantId = accountType === "merchant" ? trimText(payload.merchantId) || merchantIds[0] || accountId : "";
  const key = getAccountSwitchEntryKey(accountType, accountId, merchantId);
  const accessToken = trimText(tokens?.accessToken) || trimText(payload.accessToken);
  const refreshToken = trimText(tokens?.refreshToken) || trimText(payload.refreshToken);
  if (!key || !accessToken || !refreshToken) return null;
  const email = trimText(payload.user.email);
  const now = Date.now();
  return {
    key,
    accountType,
    accountId,
    merchantId,
    merchantIds,
    email,
    displayName: trimText(metadata?.displayName) || email || accountId || merchantId || "未命名账号",
    avatarUrl: trimText(metadata?.avatarUrl),
    accessToken,
    refreshToken,
    expiresIn: readNumber(tokens?.expiresIn) ?? readNumber(payload.expiresIn),
    updatedAt: now,
    lastUsedAt: now,
  } satisfies AccountSwitchEntry;
}

async function readAccountSwitchSessionPayload(timeoutMs = 4200): Promise<MerchantCookieSessionPayload | null> {
  if (typeof window === "undefined") return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("account_switch_session_timeout"));
    }, Math.max(1200, timeoutMs));
  });
  try {
    const response = await Promise.race([
      fetch("/api/auth/merchant-session?accountSwitch=1", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
        headers: {
          accept: "application/json",
        },
      }),
      timeout,
    ]);
    if (!response.ok) return null;
    return (await response.json().catch(() => null)) as MerchantCookieSessionPayload | null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function recordCurrentAccountSwitchSession(metadata?: { displayName?: string; avatarUrl?: string }) {
  const payload = await readAccountSwitchSessionPayload(4200).catch(() => null);
  const entry = buildAccountSwitchEntryFromPayload(payload, metadata);
  if (!entry) return readAccountSwitchEntries();
  return saveAccountSwitchEntry(entry);
}

export async function restoreAccountSwitchEntry(entry: AccountSwitchEntry) {
  const session = await establishBrowserSupabaseSession(
    {
      access_token: entry.accessToken,
      refresh_token: entry.refreshToken,
    },
    8000,
  );
  if (!session) {
    throw new Error("这个账号的登录状态已失效，请重新输入密码登录。");
  }
  const payload = await syncMerchantSessionCookies(
    session as Pick<Session, "access_token" | "refresh_token" | "expires_in">,
    8000,
  );
  if (!payload || payload.authenticated !== true) {
    throw new Error("账号切换失败，请重新输入密码登录。");
  }
  const nextEntry = buildAccountSwitchEntryFromPayload(payload, {
    displayName: entry.displayName,
    avatarUrl: entry.avatarUrl,
  }, {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
  });
  if (nextEntry) saveAccountSwitchEntry(nextEntry);
  return payload;
}

export function getAccountSwitchHomeHref(input: {
  accountType?: unknown;
  accountId?: unknown;
  merchantId?: unknown;
  merchantIds?: unknown;
}) {
  const accountType = input.accountType === "personal" ? "personal" : "merchant";
  if (accountType === "personal") return "/me";
  return "/admin";
}
