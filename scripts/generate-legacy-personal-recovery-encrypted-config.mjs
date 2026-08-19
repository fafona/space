#!/usr/bin/env node

import {
  constants as cryptoConstants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RECOVERY_CONFIG_INPUT_MAGIC =
  "FAOLLA_LEGACY_PERSONAL_RECOVERY_CONFIG_INPUT_V1";
export const RECOVERY_CONFIG_ENVELOPE_VERSION = 1;
export const RECOVERY_CONFIG_AAD =
  "faolla:ordinary-legacy-personal-recovery:config:v1";

const AUTH_LIST_PAGE_SIZE = 200;
const AUTH_LIST_MAX_PAGES = 100;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_STDIN_BYTES = 32 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PERSONAL_ACCOUNT_ID_PATTERN = /^\d{8}$/;
const PERSONAL_ACCOUNT_ID_MIN = 50_010_105;
const PERSONAL_ACCOUNT_ID_MAX = 59_999_999;
const CASE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ACCOUNT_TYPE_KEYS = ["account_type", "accountType"];
const PERSONAL_ID_KEYS = ["personal_id", "personalId"];
const MERCHANT_ID_KEYS = ["merchant_id", "merchantId", "merchantID"];
const GENERIC_ID_KEYS = ["account_id", "accountId", "login_id", "loginId"];
const CLAIM_KEYS = [
  ...ACCOUNT_TYPE_KEYS,
  ...PERSONAL_ID_KEYS,
  ...MERCHANT_ID_KEYS,
  ...GENERIC_ID_KEYS,
  "principal_type",
];

export class LegacyPersonalRecoveryOpsError extends Error {
  constructor(code) {
    super(code);
    this.name = "LegacyPersonalRecoveryOpsError";
    this.code = code;
  }
}

function fail(code) {
  throw new LegacyPersonalRecoveryOpsError(code);
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function hasExactKeys(source, expected) {
  const actual = Object.keys(source).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function exactRecord(value, keys, code = "upstream_response_invalid") {
  const source = record(value);
  if (!source || !hasExactKeys(source, keys)) fail(code);
  return source;
}

function normalizeNonnegativeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("upstream_response_invalid");
  }
  return value;
}

function normalizeAuthEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidAuthEmail(value) {
  return (
    value.length > 0 &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeHexEqual(left, right) {
  if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isPersonalAccountId(value) {
  if (typeof value !== "string" || !PERSONAL_ACCOUNT_ID_PATTERN.test(value)) {
    return false;
  }
  const numeric = Number(value);
  return numeric >= PERSONAL_ACCOUNT_ID_MIN && numeric <= PERSONAL_ACCOUNT_ID_MAX;
}

function metadataRecord(value) {
  if (value === null || value === undefined) return null;
  const source = record(value);
  if (!source) fail("auth_directory_invalid");
  return source;
}

function normalizeAuthUser(value) {
  const source = record(value);
  const id = typeof source?.id === "string" ? source.id.trim().toLowerCase() : "";
  if (!UUID_PATTERN.test(id)) fail("auth_directory_invalid");
  const email = normalizeAuthEmail(source.email);
  if (!isValidAuthEmail(email)) fail("auth_directory_invalid");
  return {
    id,
    email,
    appMetadata: metadataRecord(source.app_metadata),
    userMetadata: metadataRecord(source.user_metadata),
  };
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .map((key) => [key, canonicalJsonValue(source[key])]),
  );
}

function relevantMetadata(user) {
  const read = (metadata) =>
    Object.fromEntries(
      CLAIM_KEYS.filter((key) => metadata?.[key] !== undefined).map((key) => [
        key,
        canonicalJsonValue(metadata[key]),
      ]),
    );
  return {
    app: read(user.appMetadata),
    user: read(user.userMetadata),
  };
}

function authDirectoryDigest(users) {
  const evidence = users
    .map((user) => ({
      id: user.id,
      emailSha256: sha256(user.email),
      metadata: relevantMetadata(user),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return sha256(JSON.stringify(evidence));
}

function metadataEntries(user, keys) {
  return [user.userMetadata, user.appMetadata].flatMap((metadata) =>
    keys
      .filter((key) => metadata?.[key] !== undefined)
      .map((key) => ({ key, value: metadata[key] })),
  );
}

function metadataClaimsPersonalId(user, personalAccountId) {
  return metadataEntries(user, [
    ...PERSONAL_ID_KEYS,
    ...GENERIC_ID_KEYS,
    ...MERCHANT_ID_KEYS,
  ]).some(({ value }) => {
    if (typeof value === "string") return value.trim() === personalAccountId;
    return Number.isSafeInteger(value) && String(value) === personalAccountId;
  });
}

function hasConsistentPersonalMetadata(user, personalAccountId) {
  const typeEntries = metadataEntries(user, ACCOUNT_TYPE_KEYS);
  const personalEntries = metadataEntries(user, PERSONAL_ID_KEYS);
  const genericEntries = metadataEntries(user, GENERIC_ID_KEYS);
  const merchantEntries = metadataEntries(user, MERCHANT_ID_KEYS);
  const allEntries = [
    ...typeEntries,
    ...personalEntries,
    ...genericEntries,
    ...merchantEntries,
  ];
  if (
    allEntries.some(
      ({ value }) => typeof value !== "string" || value !== value.trim(),
    )
  ) {
    return false;
  }
  return (
    typeEntries.length > 0 &&
    typeEntries.every(({ value }) => value === "personal") &&
    personalEntries.length > 0 &&
    personalEntries.every(({ value }) => value === personalAccountId) &&
    genericEntries.every(({ value }) => value === personalAccountId) &&
    merchantEntries.length === 0
  );
}

function hasStaffMetadataHint(user) {
  return [user.userMetadata, user.appMetadata].some(
    (metadata) =>
      typeof metadata?.principal_type === "string" &&
      metadata.principal_type.trim().toLowerCase() === "merchant_staff",
  );
}

export function selectUniqueLegacyCandidate(
  users,
  emailSha256,
  personalAccountId,
) {
  if (!Array.isArray(users)) fail("auth_directory_invalid");
  const emailClaimants = users.filter((user) =>
    safeHexEqual(sha256(user.email), emailSha256),
  );
  if (emailClaimants.length !== 1) fail("candidate_not_unique");
  const candidate = emailClaimants[0];
  const otherClaimants = users.filter(
    (user) =>
      user.id !== candidate.id &&
      (safeHexEqual(sha256(user.email), emailSha256) ||
        metadataClaimsPersonalId(user, personalAccountId)),
  );
  if (otherClaimants.length > 0) fail("candidate_other_claimant");
  if (!hasConsistentPersonalMetadata(candidate, personalAccountId)) {
    fail("candidate_metadata_invalid");
  }
  if (hasStaffMetadataHint(candidate)) fail("candidate_staff_forbidden");
  return candidate;
}

function parseCanonicalBase64(value, code) {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length > 24 * 1024 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    fail(code);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) fail(code);
  return decoded;
}

export function parseGeneratorInput(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_STDIN_BYTES) {
    fail("input_invalid");
  }
  const lines = raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : [];
  if (lines.length !== 4 || lines.some((line) => line.includes("\r"))) {
    fail("input_invalid");
  }
  const [magic, emailSha256, personalAccountId, publicKeyBase64] = lines;
  if (
    magic !== RECOVERY_CONFIG_INPUT_MAGIC ||
    !SHA256_PATTERN.test(emailSha256) ||
    !isPersonalAccountId(personalAccountId)
  ) {
    fail("input_invalid");
  }
  const publicKeyBytes = parseCanonicalBase64(publicKeyBase64, "public_key_invalid");
  const publicKeyPem = publicKeyBytes.toString("utf8");
  publicKeyBytes.fill(0);
  if (
    !/^-----BEGIN (?:RSA )?PUBLIC KEY-----\n[\s\S]+\n-----END (?:RSA )?PUBLIC KEY-----\n?$/.test(
      publicKeyPem,
    ) ||
    /PRIVATE KEY/.test(publicKeyPem)
  ) {
    fail("public_key_invalid");
  }
  return { emailSha256, personalAccountId, publicKeyPem };
}

export function parseProductionEnv(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 1024 * 1024) {
    fail("production_config_invalid");
  }
  const wanted = new Set(["SUPABASE_INTERNAL_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const found = new Map();
  for (const originalLine of raw.split("\n")) {
    const line = originalLine.endsWith("\r")
      ? originalLine.slice(0, -1)
      : originalLine;
    if (!line || /^\s*#/.test(line)) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || !wanted.has(match[1])) continue;
    if (found.has(match[1])) fail("production_config_invalid");
    found.set(match[1], match[2]);
  }
  const baseUrlValue = found.get("SUPABASE_INTERNAL_URL") ?? "";
  const serviceRoleKey = found.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (
    !baseUrlValue ||
    !serviceRoleKey ||
    serviceRoleKey.length > 16 * 1024 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(serviceRoleKey)
  ) {
    fail("production_config_invalid");
  }
  let baseUrl;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    fail("production_config_invalid");
  }
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  if (
    (baseUrl.protocol !== "https:" &&
      !(baseUrl.protocol === "http:" && loopback.has(baseUrl.hostname))) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    fail("production_config_invalid");
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    serviceRoleKey,
  };
}

async function readJsonResponse(response, code) {
  let text;
  try {
    text = await response.text();
  } catch {
    fail(code);
  }
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) fail(code);
  try {
    return JSON.parse(text);
  } catch {
    fail(code);
  }
}

async function requestJson(fetchImpl, url, options, code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: controller.signal });
  } catch {
    fail(code);
  } finally {
    clearTimeout(timer);
  }
  if (!response || response.status !== 200) fail(code);
  return { response, data: await readJsonResponse(response, code) };
}

export function createProductionSupabaseOpsApi({
  baseUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") fail("production_config_invalid");
  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    accept: "application/json",
  };
  const postgrestHeaders = {
    ...headers,
    "accept-profile": "public",
    "content-profile": "public",
  };
  const endpoint = (path) => `${baseUrl}${path}`;

  return {
    async listAuthUsers() {
      const users = [];
      const seenIds = new Set();
      let expectedTotal = null;
      for (let page = 1; page <= AUTH_LIST_MAX_PAGES; page += 1) {
        const url = new URL(endpoint("/auth/v1/admin/users"));
        url.searchParams.set("page", String(page));
        url.searchParams.set("per_page", String(AUTH_LIST_PAGE_SIZE));
        const { response, data } = await requestJson(
          fetchImpl,
          url,
          { method: "GET", headers },
          "auth_directory_unavailable",
        );
        const totalHeader = response.headers.get("x-total-count");
        if (!/^\d+$/.test(totalHeader ?? "")) fail("auth_pagination_invalid");
        const total = Number(totalHeader);
        if (
          !Number.isSafeInteger(total) ||
          total < 0 ||
          total > AUTH_LIST_PAGE_SIZE * AUTH_LIST_MAX_PAGES
        ) {
          fail("auth_pagination_invalid");
        }
        if (expectedTotal === null) expectedTotal = total;
        if (expectedTotal !== total) fail("auth_pagination_invalid");
        const source = record(data);
        if (!source || !Array.isArray(source.users)) {
          fail("auth_directory_invalid");
        }
        const expectedPageCount = Math.max(
          0,
          Math.min(
            AUTH_LIST_PAGE_SIZE,
            total - (page - 1) * AUTH_LIST_PAGE_SIZE,
          ),
        );
        if (source.users.length !== expectedPageCount) {
          fail("auth_pagination_invalid");
        }
        for (const rawUser of source.users) {
          const user = normalizeAuthUser(rawUser);
          if (seenIds.has(user.id)) fail("auth_pagination_invalid");
          seenIds.add(user.id);
          users.push(user);
        }
        const expectedPages = total === 0 ? 1 : Math.ceil(total / AUTH_LIST_PAGE_SIZE);
        if (page === expectedPages) {
          if (users.length !== total) fail("auth_pagination_invalid");
          return users;
        }
      }
      fail("auth_pagination_invalid");
    },

    async callRpc(functionName, args = {}) {
      if (!/^[a-z0-9_]+$/.test(functionName)) fail("upstream_response_invalid");
      const { data } = await requestJson(
        fetchImpl,
        endpoint(`/rest/v1/rpc/${functionName}`),
        {
          method: "POST",
          headers: { ...postgrestHeaders, "content-type": "application/json" },
          body: JSON.stringify(args),
        },
        "database_unavailable",
      );
      return data;
    },

  };
}

export function normalizeOrdinaryAuthorization(value) {
  const source = exactRecord(value, [
    "schemaVersion",
    "status",
    "accountType",
    "merchantIds",
    "personalAccountId",
  ]);
  if (source.schemaVersion !== 1 || !Array.isArray(source.merchantIds)) {
    fail("upstream_response_invalid");
  }
  if (
    source.status !== "unbound" ||
    source.accountType !== null ||
    source.merchantIds.length !== 0 ||
    source.personalAccountId !== null
  ) {
    fail("resolver_conflict");
  }
  return {
    schemaVersion: 1,
    status: "unbound",
    accountType: null,
    merchantIds: [],
    personalAccountId: null,
  };
}

export function normalizeAuthoritativeReadiness(value) {
  const source = exactRecord(value, [
    "schemaVersion",
    "asOf",
    "readyForCutover",
    "merchant",
    "personal",
    "security",
    "invariants",
  ]);
  const merchant = exactRecord(source.merchant, [
    "recordCount",
    "authoritativeBindingCount",
    "invalidBindingCount",
  ]);
  const personal = exactRecord(source.personal, [
    "canonicalBindingCount",
    "canonicalOrphanCount",
    "invalidCanonicalCount",
    "duplicateAuthUserCount",
    "duplicatePersonalAccountIdCount",
  ]);
  const security = exactRecord(source.security, [
    "crossAccountTypeOverlapCount",
    "accountIdentifierCollisionCount",
    "staffRegistryOverlapCount",
    "systemSitePrincipalOverlapCount",
  ]);
  const invariants = exactRecord(source.invariants, ["schemaReady", "aclReady"]);
  if (
    source.schemaVersion !== 1 ||
    typeof source.asOf !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(source.asOf) ||
    Number.isNaN(Date.parse(source.asOf)) ||
    typeof source.readyForCutover !== "boolean" ||
    typeof invariants.schemaReady !== "boolean" ||
    typeof invariants.aclReady !== "boolean"
  ) {
    fail("upstream_response_invalid");
  }
  const normalized = {
    schemaVersion: 1,
    asOf: source.asOf,
    readyForCutover: source.readyForCutover,
    merchant: {
      recordCount: normalizeNonnegativeInteger(merchant.recordCount),
      authoritativeBindingCount: normalizeNonnegativeInteger(
        merchant.authoritativeBindingCount,
      ),
      invalidBindingCount: normalizeNonnegativeInteger(
        merchant.invalidBindingCount,
      ),
    },
    personal: {
      canonicalBindingCount: normalizeNonnegativeInteger(
        personal.canonicalBindingCount,
      ),
      canonicalOrphanCount: normalizeNonnegativeInteger(
        personal.canonicalOrphanCount,
      ),
      invalidCanonicalCount: normalizeNonnegativeInteger(
        personal.invalidCanonicalCount,
      ),
      duplicateAuthUserCount: normalizeNonnegativeInteger(
        personal.duplicateAuthUserCount,
      ),
      duplicatePersonalAccountIdCount: normalizeNonnegativeInteger(
        personal.duplicatePersonalAccountIdCount,
      ),
    },
    security: {
      crossAccountTypeOverlapCount: normalizeNonnegativeInteger(
        security.crossAccountTypeOverlapCount,
      ),
      accountIdentifierCollisionCount: normalizeNonnegativeInteger(
        security.accountIdentifierCollisionCount,
      ),
      staffRegistryOverlapCount: normalizeNonnegativeInteger(
        security.staffRegistryOverlapCount,
      ),
      systemSitePrincipalOverlapCount: normalizeNonnegativeInteger(
        security.systemSitePrincipalOverlapCount,
      ),
    },
    invariants: {
      schemaReady: invariants.schemaReady,
      aclReady: invariants.aclReady,
    },
  };
  if (
    normalized.merchant.authoritativeBindingCount >
      normalized.merchant.recordCount ||
    normalized.merchant.invalidBindingCount > normalized.merchant.recordCount ||
    normalized.merchant.authoritativeBindingCount +
        normalized.merchant.invalidBindingCount !==
      normalized.merchant.recordCount ||
    normalized.personal.canonicalOrphanCount >
      normalized.personal.canonicalBindingCount ||
    normalized.personal.invalidCanonicalCount >
      normalized.personal.canonicalBindingCount ||
    normalized.personal.duplicateAuthUserCount >
      normalized.personal.canonicalBindingCount ||
    normalized.personal.duplicatePersonalAccountIdCount >
      normalized.personal.canonicalBindingCount
  ) {
    fail("upstream_response_invalid");
  }
  const expectedReady =
    normalized.merchant.invalidBindingCount === 0 &&
    normalized.personal.canonicalOrphanCount === 0 &&
    normalized.personal.invalidCanonicalCount === 0 &&
    normalized.personal.duplicateAuthUserCount === 0 &&
    normalized.personal.duplicatePersonalAccountIdCount === 0 &&
    normalized.security.crossAccountTypeOverlapCount === 0 &&
    normalized.security.accountIdentifierCollisionCount === 0 &&
    normalized.security.staffRegistryOverlapCount === 0 &&
    normalized.security.systemSitePrincipalOverlapCount === 0 &&
    normalized.invariants.schemaReady &&
    normalized.invariants.aclReady;
  if (normalized.readyForCutover !== expectedReady) {
    fail("upstream_response_invalid");
  }
  if (!normalized.readyForCutover) fail("readiness_blocked");
  return normalized;
}

export function normalizeRecoveryObservation(value) {
  const source = exactRecord(value, [
    "schemaVersion",
    "merchantBindingCount",
    "systemSiteBindingCount",
    "staffBindingCount",
    "employeeBindingCount",
    "accountIdentifierCollisionCount",
    "personalAuthBindingCount",
    "personalIdBindingCount",
    "personalOtherAuthBindingCount",
    "exactCanonicalBindingCount",
  ]);
  if (source.schemaVersion !== 1) fail("upstream_response_invalid");
  const observation = {
    schemaVersion: 1,
    merchantBindingCount: normalizeNonnegativeInteger(
      source.merchantBindingCount,
    ),
    systemSiteBindingCount: normalizeNonnegativeInteger(
      source.systemSiteBindingCount,
    ),
    staffBindingCount: normalizeNonnegativeInteger(source.staffBindingCount),
    employeeBindingCount: normalizeNonnegativeInteger(
      source.employeeBindingCount,
    ),
    accountIdentifierCollisionCount: normalizeNonnegativeInteger(
      source.accountIdentifierCollisionCount,
    ),
    personalAuthBindingCount: normalizeNonnegativeInteger(
      source.personalAuthBindingCount,
    ),
    personalIdBindingCount: normalizeNonnegativeInteger(
      source.personalIdBindingCount,
    ),
    personalOtherAuthBindingCount: normalizeNonnegativeInteger(
      source.personalOtherAuthBindingCount,
    ),
    exactCanonicalBindingCount: normalizeNonnegativeInteger(
      source.exactCanonicalBindingCount,
    ),
  };
  if (
    observation.personalOtherAuthBindingCount >
      observation.personalIdBindingCount ||
    observation.exactCanonicalBindingCount >
      observation.personalAuthBindingCount ||
    observation.exactCanonicalBindingCount >
      observation.personalIdBindingCount
  ) {
    fail("upstream_response_invalid");
  }
  if (
    Object.entries(observation).some(
      ([key, count]) => key !== "schemaVersion" && count !== 0,
    )
  ) {
    fail("directory_conflict");
  }
  return observation;
}

async function inspectDirectory(api, authUserId, personalAccountId) {
  return normalizeRecoveryObservation(
    await api.callRpc("faolla_observe_ordinary_account_recovery_v1", {
      p_auth_user_id: authUserId,
      p_personal_account_id: personalAccountId,
    }),
  );
}

function readinessFingerprint(readiness) {
  return sha256(
    JSON.stringify({
      schemaVersion: readiness.schemaVersion,
      readyForCutover: readiness.readyForCutover,
      merchant: readiness.merchant,
      personal: readiness.personal,
      security: readiness.security,
      invariants: readiness.invariants,
    }),
  );
}

async function collectVerifiedSnapshot(api, emailSha256, personalAccountId) {
  const readiness = normalizeAuthoritativeReadiness(
    await api.callRpc(
      "faolla_get_ordinary_account_authoritative_cutover_readiness_v1",
      {},
    ),
  );
  const users = await api.listAuthUsers();
  const candidate = selectUniqueLegacyCandidate(
    users,
    emailSha256,
    personalAccountId,
  );
  const [authorization, directory] = await Promise.all([
    api
      .callRpc("faolla_resolve_ordinary_account_authorization_v1", {
        p_auth_user_id: candidate.id,
      })
      .then(normalizeOrdinaryAuthorization),
    inspectDirectory(api, candidate.id, personalAccountId),
  ]);
  return {
    authUserId: candidate.id,
    authDirectoryDigest: authDirectoryDigest(users),
    readinessDigest: readinessFingerprint(readiness),
    authorization,
    directory,
  };
}

export async function discoverVerifiedLegacyCandidate(
  api,
  emailSha256,
  personalAccountId,
) {
  const first = await collectVerifiedSnapshot(
    api,
    emailSha256,
    personalAccountId,
  );
  const second = await collectVerifiedSnapshot(
    api,
    emailSha256,
    personalAccountId,
  );
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    fail("observation_drift");
  }
  return { authUserId: first.authUserId };
}

function normalizePublicKey(publicKeyPem) {
  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    fail("public_key_invalid");
  }
  if (
    key.type !== "public" ||
    key.asymmetricKeyType !== "rsa" ||
    !Number.isSafeInteger(key.asymmetricKeyDetails?.modulusLength) ||
    key.asymmetricKeyDetails.modulusLength < 2048
  ) {
    fail("public_key_invalid");
  }
  return key;
}

export function createEncryptedRecoveryConfig({
  authUserId,
  personalAccountId,
  emailSha256,
  publicKeyPem,
  now = Date.now(),
  randomBytesImpl = randomBytes,
}) {
  if (
    !UUID_PATTERN.test(authUserId) ||
    !isPersonalAccountId(personalAccountId) ||
    !SHA256_PATTERN.test(emailSha256) ||
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    fail("input_invalid");
  }
  const publicKey = normalizePublicKey(publicKeyPem);
  const caseId = `legacy_personal_${new Date(now)
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace("000Z", "Z")}_${randomBytesImpl(8).toString("hex")}`;
  const expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (!CASE_ID_PATTERN.test(caseId) || !UTC_TIMESTAMP_PATTERN.test(expiresAt)) {
    fail("encryption_failed");
  }
  const caseJson = JSON.stringify({
    caseId,
    authUserId: authUserId.toLowerCase(),
    personalAccountId,
    emailSha256,
    expiresAt,
  });
  const hmacSecretBuffer = randomBytesImpl(32);
  const hmacSecret = hmacSecretBuffer.toString("hex");
  hmacSecretBuffer.fill(0);
  const plaintext = Buffer.from(
    JSON.stringify({ schemaVersion: 1, caseJson, hmacSecret }),
    "utf8",
  );
  const contentKey = randomBytesImpl(32);
  const iv = randomBytesImpl(12);
  const aad = Buffer.from(RECOVERY_CONFIG_AAD, "utf8");
  let ciphertext;
  let authTag;
  let wrappedKey;
  try {
    const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
    cipher.setAAD(aad);
    ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    authTag = cipher.getAuthTag();
    wrappedKey = publicEncrypt(
      {
        key: publicKey,
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      contentKey,
    );
  } catch {
    fail("encryption_failed");
  } finally {
    plaintext.fill(0);
    contentKey.fill(0);
  }
  return JSON.stringify({
    schemaVersion: RECOVERY_CONFIG_ENVELOPE_VERSION,
    keyEncryption: "RSA-OAEP-256",
    contentEncryption: "A256GCM",
    aad: aad.toString("base64"),
    wrappedKey: wrappedKey.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

export function parseEncryptedRecoveryEnvelope(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 64 * 1024) {
    fail("encrypted_envelope_invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    fail("encrypted_envelope_invalid");
  }
  const source = exactRecord(
    parsed,
    [
      "schemaVersion",
      "keyEncryption",
      "contentEncryption",
      "aad",
      "wrappedKey",
      "iv",
      "authTag",
      "ciphertext",
    ],
    "encrypted_envelope_invalid",
  );
  if (
    source.schemaVersion !== RECOVERY_CONFIG_ENVELOPE_VERSION ||
    source.keyEncryption !== "RSA-OAEP-256" ||
    source.contentEncryption !== "A256GCM"
  ) {
    fail("encrypted_envelope_invalid");
  }
  const aad = parseCanonicalBase64(source.aad, "encrypted_envelope_invalid");
  const wrappedKey = parseCanonicalBase64(
    source.wrappedKey,
    "encrypted_envelope_invalid",
  );
  const iv = parseCanonicalBase64(source.iv, "encrypted_envelope_invalid");
  const authTag = parseCanonicalBase64(
    source.authTag,
    "encrypted_envelope_invalid",
  );
  const ciphertext = parseCanonicalBase64(
    source.ciphertext,
    "encrypted_envelope_invalid",
  );
  if (
    aad.toString("utf8") !== RECOVERY_CONFIG_AAD ||
    iv.length !== 12 ||
    authTag.length !== 16 ||
    ciphertext.length < 64
  ) {
    fail("encrypted_envelope_invalid");
  }
  return { aad, wrappedKey, iv, authTag, ciphertext };
}

export function decryptRecoveryConfig(rawEnvelope, privateKeyPem) {
  const envelope = parseEncryptedRecoveryEnvelope(rawEnvelope);
  let privateKey;
  let contentKey;
  let plaintext;
  try {
    privateKey = createPrivateKey(privateKeyPem);
    if (
      privateKey.type !== "private" ||
      privateKey.asymmetricKeyType !== "rsa" ||
      !Number.isSafeInteger(privateKey.asymmetricKeyDetails?.modulusLength) ||
      privateKey.asymmetricKeyDetails.modulusLength < 2048
    ) {
      fail("private_key_invalid");
    }
    contentKey = privateDecrypt(
      {
        key: privateKey,
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      envelope.wrappedKey,
    );
    if (contentKey.length !== 32) fail("encrypted_envelope_invalid");
    const decipher = createDecipheriv("aes-256-gcm", contentKey, envelope.iv);
    decipher.setAAD(envelope.aad);
    decipher.setAuthTag(envelope.authTag);
    plaintext = Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ]);
    const payload = exactRecord(
      JSON.parse(plaintext.toString("utf8")),
      ["schemaVersion", "caseJson", "hmacSecret"],
      "encrypted_envelope_invalid",
    );
    if (
      payload.schemaVersion !== 1 ||
      typeof payload.caseJson !== "string" ||
      typeof payload.hmacSecret !== "string" ||
      !SHA256_PATTERN.test(payload.hmacSecret)
    ) {
      fail("encrypted_envelope_invalid");
    }
    const recoveryCase = exactRecord(
      JSON.parse(payload.caseJson),
      ["caseId", "authUserId", "personalAccountId", "emailSha256", "expiresAt"],
      "encrypted_envelope_invalid",
    );
    if (
      JSON.stringify(recoveryCase) !== payload.caseJson ||
      typeof recoveryCase.caseId !== "string" ||
      !CASE_ID_PATTERN.test(recoveryCase.caseId) ||
      typeof recoveryCase.authUserId !== "string" ||
      !UUID_PATTERN.test(recoveryCase.authUserId) ||
      typeof recoveryCase.personalAccountId !== "string" ||
      !isPersonalAccountId(recoveryCase.personalAccountId) ||
      typeof recoveryCase.emailSha256 !== "string" ||
      !SHA256_PATTERN.test(recoveryCase.emailSha256) ||
      typeof recoveryCase.expiresAt !== "string" ||
      !UTC_TIMESTAMP_PATTERN.test(recoveryCase.expiresAt) ||
      Number.isNaN(Date.parse(recoveryCase.expiresAt))
    ) {
      fail("encrypted_envelope_invalid");
    }
    return { caseJson: payload.caseJson, hmacSecret: payload.hmacSecret };
  } catch (error) {
    if (error instanceof LegacyPersonalRecoveryOpsError) throw error;
    fail("encrypted_envelope_invalid");
  } finally {
    contentKey?.fill(0);
    plaintext?.fill(0);
    envelope.aad.fill(0);
    envelope.wrappedKey.fill(0);
    envelope.iv.fill(0);
    envelope.authTag.fill(0);
    envelope.ciphertext.fill(0);
  }
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_STDIN_BYTES) fail("input_invalid");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runGenerator({
  inputRaw,
  envRaw,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  randomBytesImpl = randomBytes,
}) {
  const input = parseGeneratorInput(inputRaw);
  const config = parseProductionEnv(envRaw);
  const api = createProductionSupabaseOpsApi({ ...config, fetchImpl });
  const candidate = await discoverVerifiedLegacyCandidate(
    api,
    input.emailSha256,
    input.personalAccountId,
  );
  return createEncryptedRecoveryConfig({
    authUserId: candidate.authUserId,
    personalAccountId: input.personalAccountId,
    emailSha256: input.emailSha256,
    publicKeyPem: input.publicKeyPem,
    now,
    randomBytesImpl,
  });
}

async function main() {
  if (process.argv.length !== 2) fail("secret_argv_forbidden");
  const [inputRaw, envRaw] = await Promise.all([
    readStdin(),
    readFile(resolve(process.cwd(), ".env.local"), "utf8").catch(() =>
      fail("production_config_invalid"),
    ),
  ]);
  const encrypted = await runGenerator({ inputRaw, envRaw });
  process.stdout.write(`${encrypted}\n`);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    const code =
      error instanceof LegacyPersonalRecoveryOpsError
        ? error.code
        : "internal_error";
    process.stderr.write(
      `[legacy-personal-recovery-config] result=${code}\n`,
    );
    process.exitCode = 1;
  });
}
