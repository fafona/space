export type PersonalCustomerProfile = {
  accountId: string;
  userId: string;
  name: string;
  phone: string;
  email: string;
  loginEmail: string;
};

type PersonalCustomerSessionPayload = {
  authenticated?: unknown;
  accountType?: unknown;
  accountId?: unknown;
  user?: {
    id?: string | null;
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
    app_metadata?: Record<string, unknown> | null;
  } | null;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readMetadataString(metadata: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!metadata) return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function readPersonalCustomerProfileFromSession(
  payload: PersonalCustomerSessionPayload | null | undefined,
): PersonalCustomerProfile {
  const user = payload?.user ?? null;
  const userMetadata = readRecord(user?.user_metadata);
  const appMetadata = readRecord(user?.app_metadata);
  const profile = readRecord(userMetadata?.personal_profile) ?? {};
  const read = (...keys: string[]) =>
    readMetadataString(profile, ...keys) || readMetadataString(userMetadata, ...keys) || readMetadataString(appMetadata, ...keys);
  const loginEmail = trimText(user?.email).toLowerCase();
  const email = (read("email", "contact_email", "contactEmail") || loginEmail).toLowerCase();
  const name =
    read("displayName", "display_name", "username", "name") ||
    (email.includes("@") ? email.split("@")[0] ?? "" : "") ||
    trimText(payload?.accountId);

  return {
    accountId: /^\d{8}$/.test(trimText(payload?.accountId)) ? trimText(payload?.accountId) : "",
    userId: trimText(user?.id),
    name,
    phone: read("phone", "contact_phone", "contactPhone"),
    email,
    loginEmail,
  };
}

export function hasPersonalCustomerProfileIdentity(profile: PersonalCustomerProfile | null | undefined) {
  return Boolean(profile?.accountId || profile?.userId || profile?.email || profile?.loginEmail);
}
