import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MERCHANT_ENTERPRISE_INVITATION_KEYRING_ENV =
  "MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON";
export const MERCHANT_ENTERPRISE_INVITATION_ACTIVE_KEY_ID_ENV =
  "MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID";

const INVITATION_TOKEN_DOMAIN = "faolla.enterprise.invitation-token.v1";
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type MerchantEnterpriseInvitationSecretKeyring = {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
};

export type MerchantEnterpriseInvitationTokenInput = {
  eventId: string;
  siteId: string;
  employeeId: string;
  invitationVersion: number;
  keyId?: string;
};

export class MerchantEnterpriseInvitationSecretError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "MerchantEnterpriseInvitationSecretError";
    this.code = code;
  }
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeKey(value: unknown) {
  const encoded = trimText(value);
  if (
    !encoded ||
    encoded.length > 172 ||
    !/^(?:[A-Za-z0-9+/_-]{2,}={0,2})$/.test(encoded)
  ) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_keyring_invalid",
    );
  }
  const withoutPadding = encoded.replace(/=+$/, "");
  const normalized = withoutPadding.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  let key: Buffer;
  try {
    key = Buffer.from(`${normalized}${padding}`, "base64");
  } catch {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_keyring_invalid",
    );
  }
  const canonical = key.toString("base64url");
  if (canonical !== withoutPadding.replace(/\+/g, "-").replace(/\//g, "_")) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_keyring_invalid",
    );
  }
  if (key.length < 32 || key.length > 64) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_keyring_invalid",
    );
  }
  return key;
}

export function resolveMerchantEnterpriseInvitationSecretKeyring(
  environment: Record<string, string | undefined> = process.env,
): MerchantEnterpriseInvitationSecretKeyring {
  const activeKeyId = trimText(
    environment[MERCHANT_ENTERPRISE_INVITATION_ACTIVE_KEY_ID_ENV],
  );
  if (!KEY_ID_PATTERN.test(activeKeyId)) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_active_key_invalid",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      trimText(environment[MERCHANT_ENTERPRISE_INVITATION_KEYRING_ENV]),
    );
  } catch {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_keyring_invalid",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_keyring_invalid",
    );
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 8) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_keyring_invalid",
    );
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of entries) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new MerchantEnterpriseInvitationSecretError(
        "invitation_hmac_keyring_invalid",
      );
    }
    keys.set(keyId, decodeKey(encoded));
  }
  if (!keys.has(activeKeyId)) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_active_key_missing",
    );
  }
  return { activeKeyId, keys };
}

function normalizeTokenInput(input: MerchantEnterpriseInvitationTokenInput) {
  const eventId = trimText(input.eventId).toLowerCase();
  const siteId = trimText(input.siteId);
  const employeeId = trimText(input.employeeId).toLowerCase();
  const invitationVersion = Number(input.invitationVersion);
  const keyId = trimText(input.keyId);
  if (
    !UUID_PATTERN.test(eventId) ||
    !/^\d{8}$/.test(siteId) ||
    !UUID_PATTERN.test(employeeId) ||
    !Number.isSafeInteger(invitationVersion) ||
    invitationVersion <= 0 ||
    (keyId && !KEY_ID_PATTERN.test(keyId))
  ) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invalid_invitation_token_derivation_input",
    );
  }
  return { eventId, siteId, employeeId, invitationVersion, keyId };
}

export function hashMerchantEnterpriseInvitationToken(token: unknown) {
  const normalized = trimText(token);
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invalid_invitation_token",
    );
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function deriveMerchantEnterpriseInvitationToken(
  input: MerchantEnterpriseInvitationTokenInput,
  keyring: MerchantEnterpriseInvitationSecretKeyring,
) {
  const normalized = normalizeTokenInput(input);
  const keyId = normalized.keyId || keyring.activeKeyId;
  const key = keyring.keys.get(keyId);
  if (!key) {
    throw new MerchantEnterpriseInvitationSecretError(
      "invitation_hmac_key_unavailable",
    );
  }
  const message = [
    INVITATION_TOKEN_DOMAIN,
    keyId,
    normalized.eventId,
    normalized.siteId,
    normalized.employeeId,
    String(normalized.invitationVersion),
  ].join("\n");
  const token = createHmac("sha256", key).update(message, "utf8").digest("base64url");
  return {
    keyId,
    token,
    tokenHash: hashMerchantEnterpriseInvitationToken(token),
  };
}

export function merchantEnterpriseInvitationTokenMatchesHash(
  token: unknown,
  expectedHash: unknown,
) {
  const normalizedExpectedHash = trimText(expectedHash).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedExpectedHash)) return false;
  let actualHash: string;
  try {
    actualHash = hashMerchantEnterpriseInvitationToken(token);
  } catch {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(normalizedExpectedHash, "hex"),
  );
}
