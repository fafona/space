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

export const LEGACY_ACCOUNT_SWITCH_STORAGE_KEY = "faolla.accountSwitch.v1";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clearLegacyAccountSwitchStorage() {
  if (typeof window === "undefined") return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.removeItem(LEGACY_ACCOUNT_SWITCH_STORAGE_KEY);
    } catch {
      // Best-effort emergency cleanup for browser storage that is unavailable.
    }
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

export function readAccountSwitchEntries() {
  clearLegacyAccountSwitchStorage();
  return [] as AccountSwitchEntry[];
}

export function removeAccountSwitchEntry(key: string) {
  void key;
  clearLegacyAccountSwitchStorage();
  return [] as AccountSwitchEntry[];
}

export async function recordCurrentAccountSwitchSession(metadata?: {
  displayName?: string;
  avatarUrl?: string;
}) {
  void metadata;
  clearLegacyAccountSwitchStorage();
  return [] as AccountSwitchEntry[];
}

export async function restoreAccountSwitchEntry(entry: AccountSwitchEntry): Promise<never> {
  void entry;
  clearLegacyAccountSwitchStorage();
  throw new Error("account_switch_reauthentication_required");
}

export function getAccountSwitchHomeHref(input: {
  accountType?: unknown;
  accountId?: unknown;
  merchantId?: unknown;
  merchantIds?: unknown;
}) {
  return input.accountType === "personal" ? "/me" : "/admin";
}
