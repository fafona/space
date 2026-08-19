import fs from "node:fs";
import path from "node:path";

const REQUIRED_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const STRICT_MODE = process.argv.includes("--strict");

function parseEnvFile(filePath) {
  const parsed = {};
  if (!fs.existsSync(filePath)) return parsed;

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index <= 0) continue;

    const key = trimmed.slice(0, index).trim();
    if (!key) continue;

    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  return parsed;
}

function formatMissingMessage(keys) {
  return `Missing required env vars: ${keys.join(", ")}`;
}

const cwd = process.cwd();
const fileEnv = {
  ...parseEnvFile(path.join(cwd, ".env")),
  ...parseEnvFile(path.join(cwd, ".env.local")),
};
const mergedEnv = {
  ...fileEnv,
  ...process.env,
};
const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !(mergedEnv[key] || "").toString().trim());

function validateSupabaseUrl(rawValue) {
  const value = (rawValue || "").toString().trim();
  if (!value) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL must be a valid URL.";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "NEXT_PUBLIC_SUPABASE_URL must use http or https.";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "faolla.com" || hostname === "www.faolla.com" || hostname.endsWith(".faolla.com")) {
    return "NEXT_PUBLIC_SUPABASE_URL must point to Supabase, not a Faolla frontend domain.";
  }

  return null;
}

function validateLegacyPersonalRecovery(env, now = Date.now()) {
  const enabled = (env.ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED || "false").toString().trim();
  if (enabled !== "true" && enabled !== "false") {
    return ["ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED must be true or false."];
  }
  if (enabled !== "true") return [];

  const rawCase = (env.ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON || "").toString();
  const hmacSecret = (env.ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET || "").toString();
  const superAdminSecret = (env.SUPER_ADMIN_VERIFICATION_SECRET || "").toString().trim();
  if (
    !rawCase ||
    rawCase !== rawCase.trim() ||
    /[\r\n#]/.test(rawCase) ||
    !/^[0-9a-f]{64}$/.test(hmacSecret) ||
    hmacSecret === rawCase ||
    (superAdminSecret && hmacSecret === superAdminSecret)
  ) {
    return ["Enabled ordinary legacy personal recovery requires an independent case and HMAC secret."];
  }

  let recoveryCase;
  try {
    recoveryCase = JSON.parse(rawCase);
  } catch {
    return ["ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON is invalid."];
  }
  if (JSON.stringify(recoveryCase) !== rawCase) {
    return ["ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON must be compact single-line JSON."];
  }
  const expectedKeys = ["authUserId", "caseId", "emailSha256", "expiresAt", "personalAccountId"];
  const actualKeys =
    recoveryCase && typeof recoveryCase === "object" && !Array.isArray(recoveryCase)
      ? Object.keys(recoveryCase).sort()
      : [];
  const exactKeys =
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]);
  const stringFields =
    exactKeys &&
    expectedKeys.every((key) => typeof recoveryCase[key] === "string");
  const caseId = stringFields ? recoveryCase.caseId : "";
  const authUserId = stringFields ? recoveryCase.authUserId : "";
  const personalId = stringFields ? recoveryCase.personalAccountId : "";
  const emailSha256 = stringFields ? recoveryCase.emailSha256 : "";
  const expiresAt = stringFields ? recoveryCase.expiresAt : "";
  const expiresAtMs = Date.parse(expiresAt);
  const personalIdNumber = Number(personalId);
  if (
    !stringFields ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(caseId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      authUserId,
    ) ||
    !/^\d{8}$/.test(personalId) ||
    personalIdNumber < 50_010_105 ||
    personalIdNumber > 59_999_999 ||
    !/^[0-9a-f]{64}$/.test(emailSha256) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= now ||
    expiresAtMs - now > 31 * 24 * 60 * 60 * 1000
  ) {
    return ["Enabled ordinary legacy personal recovery configuration is invalid or expired."];
  }
  return [];
}

const invalidMessages = [];
const supabaseUrlIssue = validateSupabaseUrl(mergedEnv.NEXT_PUBLIC_SUPABASE_URL);
if (supabaseUrlIssue) invalidMessages.push(supabaseUrlIssue);
invalidMessages.push(...validateLegacyPersonalRecovery(mergedEnv));

if (missingKeys.length === 0 && invalidMessages.length === 0) {
  console.log("[env-check] OK");
  process.exit(0);
}

const missingMessage = formatMissingMessage(missingKeys);
if (STRICT_MODE) {
  if (missingKeys.length > 0) {
    console.error(`[env-check] ${missingMessage}`);
    console.error("[env-check] Copy .env.example to .env.local and fill values before build.");
  }
  for (const message of invalidMessages) {
    console.error(`[env-check] ${message}`);
  }
  process.exit(1);
}

if (missingKeys.length > 0) console.warn(`[env-check] ${missingMessage}`);
for (const message of invalidMessages) {
  console.warn(`[env-check] ${message}`);
}
console.warn("[env-check] Dev mode can continue with fallback backend, but remote features may not work.");
process.exit(0);
