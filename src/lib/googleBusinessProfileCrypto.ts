import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type EncryptedGoogleBusinessProfileSecret = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
};

type GoogleBusinessProfileOAuthState = {
  version: 1;
  siteId: string;
  nonce: string;
  expiresAt: number;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function readKeyMaterial() {
  return (
    readEnv("GOOGLE_BUSINESS_PROFILE_TOKEN_KEY") ||
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY")
  );
}

function deriveKey(purpose: string) {
  const material = readKeyMaterial();
  if (!material) throw new Error("google_business_profile_encryption_key_missing");
  return createHash("sha256").update(`faolla-google-business-profile:${purpose}:${material}`, "utf8").digest();
}

function toBase64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

export function isGoogleBusinessProfileCryptoConfigured() {
  return Boolean(readKeyMaterial());
}

export function encryptGoogleBusinessProfileSecret(value: string): EncryptedGoogleBusinessProfileSecret {
  const plaintext = String(value ?? "");
  if (!plaintext) throw new Error("google_business_profile_secret_empty");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("token-v1"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: toBase64Url(iv),
    authTag: toBase64Url(cipher.getAuthTag()),
    ciphertext: toBase64Url(ciphertext),
  };
}

export function decryptGoogleBusinessProfileSecret(value: EncryptedGoogleBusinessProfileSecret) {
  if (value?.version !== 1 || value.algorithm !== "aes-256-gcm") {
    throw new Error("google_business_profile_secret_format_invalid");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey("token-v1"), fromBase64Url(value.iv));
    decipher.setAuthTag(fromBase64Url(value.authTag));
    return Buffer.concat([
      decipher.update(fromBase64Url(value.ciphertext)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("google_business_profile_secret_decrypt_failed");
  }
}

export function createGoogleBusinessProfileOAuthState(siteId: string, ttlMs = 10 * 60 * 1000) {
  const payload: GoogleBusinessProfileOAuthState = {
    version: 1,
    siteId: String(siteId ?? "").trim(),
    nonce: randomBytes(18).toString("base64url"),
    expiresAt: Date.now() + Math.max(60_000, ttlMs),
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", deriveKey("oauth-state-v1")).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyGoogleBusinessProfileOAuthState(value: string): GoogleBusinessProfileOAuthState | null {
  const [encoded, signature, extra] = String(value ?? "").split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", deriveKey("oauth-state-v1")).update(encoded).digest();
  let provided: Buffer;
  try {
    provided = fromBase64Url(signature);
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(encoded).toString("utf8")) as Partial<GoogleBusinessProfileOAuthState>;
    if (
      payload.version !== 1 ||
      !/^\d{8}$/.test(String(payload.siteId ?? "")) ||
      typeof payload.nonce !== "string" ||
      payload.nonce.length < 12 ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < Date.now()
    ) {
      return null;
    }
    return payload as GoogleBusinessProfileOAuthState;
  } catch {
    return null;
  }
}
