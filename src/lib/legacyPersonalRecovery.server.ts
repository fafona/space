import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  isPersonalAccountNumericId,
  normalizePlatformAccountNumericId,
} from "@/lib/platformAccounts";
import {
  isValidAuthEmail,
  normalizeAuthEmail,
} from "@/lib/authCredentialValidation";
import { hasMerchantStaffPrincipalDenyHint } from "@/lib/merchantStaffPrincipal.server";

export const LEGACY_PERSONAL_RECOVERY_ENABLED_ENV =
  "ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED";
export const LEGACY_PERSONAL_RECOVERY_CASE_ENV =
  "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON";
export const LEGACY_PERSONAL_RECOVERY_HMAC_ENV =
  "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET";
export const LEGACY_PERSONAL_RECOVERY_NONCE_COOKIE =
  "faolla-legacy-personal-recovery";
export const LEGACY_PERSONAL_RECOVERY_VERIFIED_METADATA_KEY =
  "faolla_legacy_personal_recovery_verified_v1";
export const LEGACY_PERSONAL_RECOVERY_APPROVAL_ATTEMPT_METADATA_KEY =
  "faolla_legacy_personal_recovery_approval_attempt_v1";
export const LEGACY_PERSONAL_RECOVERY_COMPLETED_METADATA_KEY =
  "faolla_legacy_personal_recovery_completed_v1";

const CREATE_AUTHORIZATION_RPC =
  "faolla_create_ordinary_account_authorization_v1";
const RESOLVE_AUTHORIZATION_RPC =
  "faolla_resolve_ordinary_account_authorization_v1";
const AUTHORITATIVE_READINESS_RPC =
  "faolla_get_ordinary_account_authoritative_cutover_readiness_v1";
const RECOVERY_OBSERVER_RPC =
  "faolla_observe_ordinary_account_recovery_v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CASE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const HMAC_SECRET_PATTERN = /^[0-9a-f]{64}$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const VERIFIED_MARKER_TTL_MS = 15 * 60 * 1000;
const NONCE_TTL_MS = 15 * 60 * 1000;
const MAX_CASE_FUTURE_MS = 31 * 24 * 60 * 60 * 1000;
const MIN_HMAC_SECRET_BYTES = 32;

export type LegacyPersonalRecoveryErrorCode =
  | "legacy_personal_recovery_disabled"
  | "legacy_personal_recovery_expired"
  | "legacy_personal_recovery_config_invalid"
  | "legacy_personal_recovery_identity_mismatch"
  | "legacy_personal_recovery_nonce_invalid"
  | "legacy_personal_recovery_rate_limited"
  | "legacy_personal_recovery_otp_invalid_or_expired"
  | "legacy_personal_recovery_otp_principal_mismatch"
  | "legacy_personal_recovery_staff_identity_forbidden"
  | "legacy_personal_recovery_operator_reauthorization_required"
  | "legacy_personal_recovery_verification_required"
  | "legacy_personal_recovery_metadata_drift"
  | "legacy_personal_recovery_candidate_conflict"
  | "legacy_personal_recovery_directory_conflict"
  | "legacy_personal_recovery_readiness_blocked"
  | "legacy_personal_recovery_rpc_failed"
  | "legacy_personal_recovery_upstream_unavailable";

export class LegacyPersonalRecoveryError extends Error {
  readonly code: LegacyPersonalRecoveryErrorCode;
  readonly status: number;

  constructor(code: LegacyPersonalRecoveryErrorCode, status: number) {
    super(code);
    this.name = "LegacyPersonalRecoveryError";
    this.code = code;
    this.status = status;
  }
}

export type LegacyPersonalRecoveryCase = {
  caseId: string;
  authUserId: string;
  personalAccountId: string;
  emailSha256: string;
  expiresAt: string;
  hmacSecret: string;
  caseHash: string;
};

export type LegacyPersonalRecoveryAuthUser = {
  id: string;
  email: string | null;
  appMetadata: Record<string, unknown> | null;
  userMetadata: Record<string, unknown> | null;
};

export type OrdinaryAuthorization =
  | {
      schemaVersion: 1;
      status: "unbound";
      accountType: null;
      merchantIds: [];
      personalAccountId: null;
    }
  | {
      schemaVersion: 1;
      status: "resolved";
      accountType: "merchant";
      merchantIds: string[];
      personalAccountId: null;
    }
  | {
      schemaVersion: 1;
      status: "resolved" | "disabled";
      accountType: "personal";
      merchantIds: [];
      personalAccountId: string;
    };

export type OrdinaryAuthoritativeReadiness = {
  schemaVersion: 1;
  asOf: string;
  readyForCutover: boolean;
  merchant: {
    recordCount: number;
    authoritativeBindingCount: number;
    invalidBindingCount: number;
  };
  personal: {
    canonicalBindingCount: number;
    canonicalOrphanCount: number;
    invalidCanonicalCount: number;
    duplicateAuthUserCount: number;
    duplicatePersonalAccountIdCount: number;
  };
  security: {
    crossAccountTypeOverlapCount: number;
    accountIdentifierCollisionCount: number;
    staffRegistryOverlapCount: number;
    systemSitePrincipalOverlapCount: number;
  };
  invariants: {
    schemaReady: boolean;
    aclReady: boolean;
  };
};

export type LegacyPersonalRecoveryDirectoryObservation = {
  schemaVersion: 1;
  merchantBindingCount: number;
  systemSiteBindingCount: number;
  staffBindingCount: number;
  employeeBindingCount: number;
  accountIdentifierCollisionCount: number;
  personalAuthBindingCount: number;
  personalIdBindingCount: number;
  personalOtherAuthBindingCount: number;
  exactCanonicalBindingCount: number;
};

type VerifiedMarker = {
  version: 1;
  caseId: string;
  caseHash: string;
  verificationHash: string;
  verifiedAt: string;
  expiresAt: string;
};

type CompletedMarker = {
  version: 1;
  caseId: string;
  caseHash: string;
  beforeReadinessHash: string;
  afterReadinessHash: string;
  auditHash: string;
  completedAt: string;
};

type ApprovalAttemptMarker = {
  version: 1;
  caseId: string;
  caseHash: string;
  verifiedMarkerHash: string;
  readinessHash: string;
  authorizationHash: string;
  authorizedAt: string;
};

export type LegacyPersonalRecoveryOtpDependencies = {
  now?: () => number;
  getAuthUser: (authUserId: string) => Promise<LegacyPersonalRecoveryAuthUser>;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (
    email: string,
    code: string,
  ) => Promise<LegacyPersonalRecoveryAuthUser | null>;
  updateAuthAppMetadata: (
    authUserId: string,
    appMetadata: Record<string, unknown>,
  ) => Promise<void>;
};

export type LegacyPersonalRecoveryApprovalDependencies = {
  now?: () => number;
  reauthorizeOperator: () => boolean;
  getAuthUser: (authUserId: string) => Promise<LegacyPersonalRecoveryAuthUser>;
  listAuthUsers: () => Promise<LegacyPersonalRecoveryAuthUser[]>;
  resolveAuthorization: (authUserId: string) => Promise<unknown>;
  loadReadiness: () => Promise<unknown>;
  inspectDirectory: (
    authUserId: string,
    personalAccountId: string,
  ) => Promise<unknown>;
  createAuthorization: (
    authUserId: string,
    accountType: "personal",
    personalAccountId: string,
  ) => Promise<unknown>;
  updateAuthAppMetadata: (
    authUserId: string,
    appMetadata: Record<string, unknown>,
  ) => Promise<void>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(source: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(source).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function exactRecord(value: unknown, keys: string[]) {
  const source = record(value);
  if (!source || !hasExactKeys(source, keys)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  return source;
}

function normalizeNonnegativeInteger(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  return value;
}

function normalizeIsoTimestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  return value;
}

function hmac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function canonicalCaseMaterial(input: {
  caseId: string;
  authUserId: string;
  personalAccountId: string;
  emailSha256: string;
  expiresAt: string;
}) {
  return [
    "faolla:legacy-personal-recovery:case:v1",
    input.caseId,
    input.authUserId,
    input.personalAccountId,
    input.emailSha256,
    input.expiresAt,
  ].join("\n");
}

function configError(): never {
  throw new LegacyPersonalRecoveryError(
    "legacy_personal_recovery_config_invalid",
    503,
  );
}

export function loadLegacyPersonalRecoveryCase(
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): LegacyPersonalRecoveryCase {
  if ((env[LEGACY_PERSONAL_RECOVERY_ENABLED_ENV] ?? "").trim() !== "true") {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_disabled",
      410,
    );
  }

  const rawCase = env[LEGACY_PERSONAL_RECOVERY_CASE_ENV] ?? "";
  const hmacSecret = env[LEGACY_PERSONAL_RECOVERY_HMAC_ENV] ?? "";
  if (
    !rawCase ||
    rawCase !== rawCase.trim() ||
    /[\r\n#]/.test(rawCase) ||
    !HMAC_SECRET_PATTERN.test(hmacSecret) ||
    Buffer.byteLength(hmacSecret, "utf8") < MIN_HMAC_SECRET_BYTES ||
    safeEqual(hmacSecret, rawCase) ||
    (env.SUPER_ADMIN_VERIFICATION_SECRET &&
      safeEqual(hmacSecret, env.SUPER_ADMIN_VERIFICATION_SECRET.trim()))
  ) {
    configError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCase);
  } catch {
    configError();
  }
  if (JSON.stringify(parsed) !== rawCase) {
    configError();
  }
  const source = record(parsed);
  if (
    !source ||
    !hasExactKeys(source, [
      "caseId",
      "authUserId",
      "personalAccountId",
      "emailSha256",
      "expiresAt",
    ])
  ) {
    configError();
  }

  const caseId = typeof source.caseId === "string" ? source.caseId : "";
  const authUserId =
    typeof source.authUserId === "string"
      ? source.authUserId.trim().toLowerCase()
      : "";
  const personalAccountId = normalizePlatformAccountNumericId(
    source.personalAccountId,
  );
  const emailSha256 =
    typeof source.emailSha256 === "string"
      ? source.emailSha256.trim().toLowerCase()
      : "";
  const expiresAt =
    typeof source.expiresAt === "string" ? source.expiresAt.trim() : "";
  const expiresAtMs = Date.parse(expiresAt);

  if (
    !CASE_ID_PATTERN.test(caseId) ||
    !UUID_PATTERN.test(authUserId) ||
    !isPersonalAccountNumericId(personalAccountId) ||
    !SHA256_PATTERN.test(emailSha256) ||
    !UTC_TIMESTAMP_PATTERN.test(expiresAt) ||
    Number.isNaN(expiresAtMs)
  ) {
    configError();
  }
  if (expiresAtMs <= now) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_expired",
      410,
    );
  }
  if (expiresAtMs - now > MAX_CASE_FUTURE_MS) {
    configError();
  }

  const caseHash = hmac(
    hmacSecret,
    canonicalCaseMaterial({
      caseId,
      authUserId,
      personalAccountId,
      emailSha256,
      expiresAt,
    }),
  );
  return {
    caseId,
    authUserId,
    personalAccountId,
    emailSha256,
    expiresAt,
    hmacSecret,
    caseHash,
  };
}

function assertSubmittedIdentity(
  recoveryCase: LegacyPersonalRecoveryCase,
  emailInput: unknown,
  personalAccountIdInput: unknown,
) {
  const email = normalizeAuthEmail(emailInput);
  const personalAccountId = normalizePlatformAccountNumericId(
    personalAccountIdInput,
  );
  const emailHash = isValidAuthEmail(email) ? sha256(email) : "0".repeat(64);
  const submittedIdHash = hmac(
    recoveryCase.hmacSecret,
    `faolla:legacy-personal-recovery:id:v1\n${personalAccountId}`,
  );
  const expectedIdHash = hmac(
    recoveryCase.hmacSecret,
    `faolla:legacy-personal-recovery:id:v1\n${recoveryCase.personalAccountId}`,
  );
  if (
    !safeEqual(emailHash, recoveryCase.emailSha256) ||
    !safeEqual(submittedIdHash, expectedIdHash)
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_identity_mismatch",
      401,
    );
  }
  return { email };
}

function assertAuthUserMatchesCase(
  recoveryCase: LegacyPersonalRecoveryCase,
  authUser: LegacyPersonalRecoveryAuthUser | null | undefined,
  mismatchCode:
    | "legacy_personal_recovery_identity_mismatch"
    | "legacy_personal_recovery_otp_principal_mismatch",
) {
  const authUserId = String(authUser?.id ?? "").trim().toLowerCase();
  const email = normalizeAuthEmail(authUser?.email);
  const emailHash = isValidAuthEmail(email) ? sha256(email) : "0".repeat(64);
  if (
    !safeEqual(authUserId, recoveryCase.authUserId) ||
    !safeEqual(emailHash, recoveryCase.emailSha256)
  ) {
    throw new LegacyPersonalRecoveryError(mismatchCode, 401);
  }
}

function assertAuthUserIsNotStaffPrincipal(
  authUser: LegacyPersonalRecoveryAuthUser,
) {
  if (
    hasMerchantStaffPrincipalDenyHint({
      id: authUser.id,
      app_metadata: authUser.appMetadata,
      user_metadata: authUser.userMetadata,
    })
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_staff_identity_forbidden",
      403,
    );
  }
}

function appMetadataOf(authUser: LegacyPersonalRecoveryAuthUser) {
  return record(authUser.appMetadata)
    ? { ...(authUser.appMetadata as Record<string, unknown>) }
    : {};
}

export function createLegacyPersonalRecoveryNonce(
  recoveryCase: LegacyPersonalRecoveryCase,
  now = Date.now(),
  random: (size: number) => Buffer = randomBytes,
) {
  const nonce = random(32).toString("base64url");
  const payload = `${now}.${nonce}`;
  const signature = hmac(
    recoveryCase.hmacSecret,
    `faolla:legacy-personal-recovery:nonce:v1\n${recoveryCase.caseHash}\n${payload}`,
  );
  return `${payload}.${signature}`;
}

export function verifyLegacyPersonalRecoveryNonce(
  recoveryCase: LegacyPersonalRecoveryCase,
  value: unknown,
  now = Date.now(),
) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const parts = candidate.split(".");
  if (parts.length !== 3 || candidate.length > 512) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_nonce_invalid",
      401,
    );
  }
  const issuedAt = Number(parts[0]);
  const nonce = parts[1] ?? "";
  const signature = parts[2] ?? "";
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + 30_000 ||
    now - issuedAt > NONCE_TTL_MS ||
    !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
    !SHA256_PATTERN.test(signature)
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_nonce_invalid",
      401,
    );
  }
  const expected = hmac(
    recoveryCase.hmacSecret,
    `faolla:legacy-personal-recovery:nonce:v1\n${recoveryCase.caseHash}\n${issuedAt}.${nonce}`,
  );
  if (!safeEqual(signature, expected)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_nonce_invalid",
      401,
    );
  }
}

function verifiedMarkerHash(
  recoveryCase: LegacyPersonalRecoveryCase,
  verifiedAt: string,
  expiresAt: string,
) {
  return hmac(
    recoveryCase.hmacSecret,
    [
      "faolla:legacy-personal-recovery:verified:v1",
      recoveryCase.caseHash,
      recoveryCase.authUserId,
      recoveryCase.personalAccountId,
      recoveryCase.emailSha256,
      verifiedAt,
      expiresAt,
    ].join("\n"),
  );
}

function buildVerifiedMarker(
  recoveryCase: LegacyPersonalRecoveryCase,
  now: number,
): VerifiedMarker {
  const verifiedAt = new Date(now).toISOString();
  const expiresAt = new Date(
    Math.min(now + VERIFIED_MARKER_TTL_MS, Date.parse(recoveryCase.expiresAt)),
  ).toISOString();
  return {
    version: 1,
    caseId: recoveryCase.caseId,
    caseHash: recoveryCase.caseHash,
    verificationHash: verifiedMarkerHash(
      recoveryCase,
      verifiedAt,
      expiresAt,
    ),
    verifiedAt,
    expiresAt,
  };
}

function readVerifiedMarker(
  recoveryCase: LegacyPersonalRecoveryCase,
  authUser: LegacyPersonalRecoveryAuthUser,
  now: number,
) {
  const source = record(
    authUser.appMetadata?.[LEGACY_PERSONAL_RECOVERY_VERIFIED_METADATA_KEY],
  );
  if (
    !source ||
    !hasExactKeys(source, [
      "version",
      "caseId",
      "caseHash",
      "verificationHash",
      "verifiedAt",
      "expiresAt",
    ]) ||
    source.version !== 1 ||
    source.caseId !== recoveryCase.caseId ||
    source.caseHash !== recoveryCase.caseHash ||
    typeof source.verificationHash !== "string" ||
    !SHA256_PATTERN.test(source.verificationHash) ||
    typeof source.verifiedAt !== "string" ||
    typeof source.expiresAt !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(source.verifiedAt) ||
    !UTC_TIMESTAMP_PATTERN.test(source.expiresAt)
  ) {
    return null;
  }
  const verifiedAtMs = Date.parse(source.verifiedAt);
  const expiresAtMs = Date.parse(source.expiresAt);
  if (
    Number.isNaN(verifiedAtMs) ||
    Number.isNaN(expiresAtMs) ||
    verifiedAtMs > now + 30_000 ||
    expiresAtMs <= now ||
    expiresAtMs - verifiedAtMs > VERIFIED_MARKER_TTL_MS ||
    expiresAtMs > Date.parse(recoveryCase.expiresAt)
  ) {
    return null;
  }
  const expected = verifiedMarkerHash(
    recoveryCase,
    source.verifiedAt,
    source.expiresAt,
  );
  return safeEqual(source.verificationHash, expected)
    ? (source as VerifiedMarker)
    : null;
}

function readinessFingerprint(
  recoveryCase: LegacyPersonalRecoveryCase,
  readiness: OrdinaryAuthoritativeReadiness,
) {
  const stable = {
    schemaVersion: readiness.schemaVersion,
    readyForCutover: readiness.readyForCutover,
    merchant: readiness.merchant,
    personal: readiness.personal,
    security: readiness.security,
    invariants: readiness.invariants,
  };
  return hmac(
    recoveryCase.hmacSecret,
    `faolla:legacy-personal-recovery:readiness:v1\n${recoveryCase.caseHash}\n${JSON.stringify(stable)}`,
  );
}

function approvalAttemptAuthorizationHash(
  recoveryCase: LegacyPersonalRecoveryCase,
  verifiedMarkerHash: string,
  readinessHash: string,
  authorizedAt: string,
) {
  return hmac(
    recoveryCase.hmacSecret,
    [
      "faolla:legacy-personal-recovery:approval-attempt:v1",
      recoveryCase.caseHash,
      verifiedMarkerHash,
      readinessHash,
      authorizedAt,
    ].join("\n"),
  );
}

function buildApprovalAttemptMarker(
  recoveryCase: LegacyPersonalRecoveryCase,
  verifiedMarker: VerifiedMarker,
  readiness: OrdinaryAuthoritativeReadiness,
  authorizedAt: string,
): ApprovalAttemptMarker {
  const readinessHash = readinessFingerprint(recoveryCase, readiness);
  return {
    version: 1,
    caseId: recoveryCase.caseId,
    caseHash: recoveryCase.caseHash,
    verifiedMarkerHash: verifiedMarker.verificationHash,
    readinessHash,
    authorizationHash: approvalAttemptAuthorizationHash(
      recoveryCase,
      verifiedMarker.verificationHash,
      readinessHash,
      authorizedAt,
    ),
    authorizedAt,
  };
}

function readApprovalAttemptMarker(
  recoveryCase: LegacyPersonalRecoveryCase,
  authUser: LegacyPersonalRecoveryAuthUser,
) {
  const source = record(
    authUser.appMetadata?.[
      LEGACY_PERSONAL_RECOVERY_APPROVAL_ATTEMPT_METADATA_KEY
    ],
  );
  if (
    !source ||
    !hasExactKeys(source, [
      "version",
      "caseId",
      "caseHash",
      "verifiedMarkerHash",
      "readinessHash",
      "authorizationHash",
      "authorizedAt",
    ]) ||
    source.version !== 1 ||
    source.caseId !== recoveryCase.caseId ||
    source.caseHash !== recoveryCase.caseHash ||
    typeof source.verifiedMarkerHash !== "string" ||
    typeof source.readinessHash !== "string" ||
    typeof source.authorizationHash !== "string" ||
    typeof source.authorizedAt !== "string" ||
    !SHA256_PATTERN.test(source.verifiedMarkerHash) ||
    !SHA256_PATTERN.test(source.readinessHash) ||
    !SHA256_PATTERN.test(source.authorizationHash) ||
    !UTC_TIMESTAMP_PATTERN.test(source.authorizedAt) ||
    Number.isNaN(Date.parse(source.authorizedAt)) ||
    Date.parse(source.authorizedAt) > Date.parse(recoveryCase.expiresAt)
  ) {
    return null;
  }
  const expected = approvalAttemptAuthorizationHash(
    recoveryCase,
    source.verifiedMarkerHash,
    source.readinessHash,
    source.authorizedAt,
  );
  return safeEqual(source.authorizationHash, expected)
    ? (source as ApprovalAttemptMarker)
    : null;
}

function completionAuditHash(
  recoveryCase: LegacyPersonalRecoveryCase,
  completedAt: string,
  beforeReadinessHash: string,
  afterReadinessHash: string,
) {
  return hmac(
    recoveryCase.hmacSecret,
    [
      "faolla:legacy-personal-recovery:completed:v1",
      recoveryCase.caseHash,
      beforeReadinessHash,
      afterReadinessHash,
      completedAt,
    ].join("\n"),
  );
}

function buildCompletedMarker(
  recoveryCase: LegacyPersonalRecoveryCase,
  completedAt: string,
  beforeReadinessHash: string,
  afterReadinessHash: string,
): CompletedMarker {
  return {
    version: 1,
    caseId: recoveryCase.caseId,
    caseHash: recoveryCase.caseHash,
    beforeReadinessHash,
    afterReadinessHash,
    auditHash: completionAuditHash(
      recoveryCase,
      completedAt,
      beforeReadinessHash,
      afterReadinessHash,
    ),
    completedAt,
  };
}

function readCompletedMarker(
  recoveryCase: LegacyPersonalRecoveryCase,
  authUser: LegacyPersonalRecoveryAuthUser,
) {
  const source = record(
    authUser.appMetadata?.[LEGACY_PERSONAL_RECOVERY_COMPLETED_METADATA_KEY],
  );
  if (
    !source ||
    !hasExactKeys(source, [
      "version",
      "caseId",
      "caseHash",
      "beforeReadinessHash",
      "afterReadinessHash",
      "auditHash",
      "completedAt",
    ]) ||
    source.version !== 1 ||
    source.caseId !== recoveryCase.caseId ||
    source.caseHash !== recoveryCase.caseHash ||
    typeof source.beforeReadinessHash !== "string" ||
    typeof source.afterReadinessHash !== "string" ||
    typeof source.auditHash !== "string" ||
    typeof source.completedAt !== "string" ||
    !SHA256_PATTERN.test(source.beforeReadinessHash) ||
    !SHA256_PATTERN.test(source.afterReadinessHash) ||
    !SHA256_PATTERN.test(source.auditHash) ||
    !UTC_TIMESTAMP_PATTERN.test(source.completedAt) ||
    Number.isNaN(Date.parse(source.completedAt))
  ) {
    return null;
  }
  const expected = completionAuditHash(
    recoveryCase,
    source.completedAt,
    source.beforeReadinessHash,
    source.afterReadinessHash,
  );
  return safeEqual(source.auditHash, expected)
    ? (source as CompletedMarker)
    : null;
}

export async function requestLegacyPersonalRecoveryOtp(
  recoveryCase: LegacyPersonalRecoveryCase,
  input: { email: unknown; personalAccountId: unknown },
  dependencies: LegacyPersonalRecoveryOtpDependencies,
) {
  const { email } = assertSubmittedIdentity(
    recoveryCase,
    input.email,
    input.personalAccountId,
  );
  const authUser = await dependencies.getAuthUser(recoveryCase.authUserId);
  assertAuthUserMatchesCase(
    recoveryCase,
    authUser,
    "legacy_personal_recovery_identity_mismatch",
  );
  assertAuthUserIsNotStaffPrincipal(authUser);
  if (!hasConsistentTargetMetadata(authUser, recoveryCase)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_metadata_drift",
      409,
    );
  }
  await dependencies.sendOtp(email);
  return { ok: true as const };
}

export async function verifyLegacyPersonalRecoveryOtp(
  recoveryCase: LegacyPersonalRecoveryCase,
  input: {
    email: unknown;
    personalAccountId: unknown;
    code: string;
    nonceCookie: unknown;
  },
  dependencies: LegacyPersonalRecoveryOtpDependencies,
) {
  const requestNow = dependencies.now?.() ?? Date.now();
  const { email } = assertSubmittedIdentity(
    recoveryCase,
    input.email,
    input.personalAccountId,
  );
  verifyLegacyPersonalRecoveryNonce(
    recoveryCase,
    input.nonceCookie,
    requestNow,
  );
  // A successful verify may have committed the service-owned marker before
  // the HTTP response was lost. The still-valid signed nonce plus the exact
  // fixed identity make that retry idempotent; without the nonce this branch
  // remains unreachable.
  const previouslyVerifiedUser = await dependencies.getAuthUser(
    recoveryCase.authUserId,
  );
  assertAuthUserMatchesCase(
    recoveryCase,
    previouslyVerifiedUser,
    "legacy_personal_recovery_otp_principal_mismatch",
  );
  assertAuthUserIsNotStaffPrincipal(previouslyVerifiedUser);
  if (!hasConsistentTargetMetadata(previouslyVerifiedUser, recoveryCase)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_metadata_drift",
      409,
    );
  }
  const retryNow = dependencies.now?.() ?? Date.now();
  assertRecoveryCaseStillActive(recoveryCase, retryNow);
  verifyLegacyPersonalRecoveryNonce(
    recoveryCase,
    input.nonceCookie,
    retryNow,
  );
  if (readVerifiedMarker(recoveryCase, previouslyVerifiedUser, retryNow)) {
    return { ok: true as const, verified: true as const };
  }
  const otpUser = await dependencies.verifyOtp(email, input.code);
  if (!otpUser) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_otp_invalid_or_expired",
      401,
    );
  }
  assertAuthUserMatchesCase(
    recoveryCase,
    otpUser,
    "legacy_personal_recovery_otp_principal_mismatch",
  );
  assertAuthUserIsNotStaffPrincipal(otpUser);

  const canonicalUser = await dependencies.getAuthUser(recoveryCase.authUserId);
  assertAuthUserMatchesCase(
    recoveryCase,
    canonicalUser,
    "legacy_personal_recovery_otp_principal_mismatch",
  );
  assertAuthUserIsNotStaffPrincipal(canonicalUser);
  if (!hasConsistentTargetMetadata(canonicalUser, recoveryCase)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_metadata_drift",
      409,
    );
  }
  const verifiedNow = dependencies.now?.() ?? Date.now();
  assertRecoveryCaseStillActive(recoveryCase, verifiedNow);
  verifyLegacyPersonalRecoveryNonce(
    recoveryCase,
    input.nonceCookie,
    verifiedNow,
  );
  const appMetadata = appMetadataOf(canonicalUser);
  appMetadata[LEGACY_PERSONAL_RECOVERY_VERIFIED_METADATA_KEY] =
    buildVerifiedMarker(recoveryCase, verifiedNow);
  await dependencies.updateAuthAppMetadata(
    recoveryCase.authUserId,
    appMetadata,
  );
  return { ok: true as const, verified: true as const };
}

export function normalizeOrdinaryAuthorization(
  value: unknown,
): OrdinaryAuthorization {
  const source = exactRecord(value, [
    "schemaVersion",
    "status",
    "accountType",
    "merchantIds",
    "personalAccountId",
  ]);
  if (source.schemaVersion !== 1 || !Array.isArray(source.merchantIds)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  const merchantIds = source.merchantIds.map((merchantId) => {
    if (typeof merchantId !== "string" || !/^\d{8}$/.test(merchantId)) {
      throw new LegacyPersonalRecoveryError(
        "legacy_personal_recovery_upstream_unavailable",
        503,
      );
    }
    return merchantId;
  });
  const sorted = [...merchantIds].sort();
  if (
    merchantIds.some((merchantId, index) => merchantId !== sorted[index]) ||
    new Set(merchantIds).size !== merchantIds.length
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  if (
    source.status === "unbound" &&
    source.accountType === null &&
    merchantIds.length === 0 &&
    source.personalAccountId === null
  ) {
    return {
      schemaVersion: 1,
      status: "unbound",
      accountType: null,
      merchantIds: [],
      personalAccountId: null,
    };
  }
  if (
    source.status === "resolved" &&
    source.accountType === "merchant" &&
    merchantIds.length > 0 &&
    source.personalAccountId === null
  ) {
    return {
      schemaVersion: 1,
      status: "resolved",
      accountType: "merchant",
      merchantIds,
      personalAccountId: null,
    };
  }
  if (
    (source.status === "resolved" || source.status === "disabled") &&
    source.accountType === "personal" &&
    merchantIds.length === 0 &&
    isPersonalAccountNumericId(source.personalAccountId)
  ) {
    return {
      schemaVersion: 1,
      status: source.status,
      accountType: "personal",
      merchantIds: [],
      personalAccountId: String(source.personalAccountId),
    };
  }
  throw new LegacyPersonalRecoveryError(
    "legacy_personal_recovery_upstream_unavailable",
    503,
  );
}

export function normalizeOrdinaryAuthoritativeReadiness(
  value: unknown,
): OrdinaryAuthoritativeReadiness {
  const source = exactRecord(value, [
    "schemaVersion",
    "asOf",
    "readyForCutover",
    "merchant",
    "personal",
    "security",
    "invariants",
  ]);
  const merchantSource = exactRecord(source.merchant, [
    "recordCount",
    "authoritativeBindingCount",
    "invalidBindingCount",
  ]);
  const personalSource = exactRecord(source.personal, [
    "canonicalBindingCount",
    "canonicalOrphanCount",
    "invalidCanonicalCount",
    "duplicateAuthUserCount",
    "duplicatePersonalAccountIdCount",
  ]);
  const securitySource = exactRecord(source.security, [
    "crossAccountTypeOverlapCount",
    "accountIdentifierCollisionCount",
    "staffRegistryOverlapCount",
    "systemSitePrincipalOverlapCount",
  ]);
  const invariantsSource = exactRecord(source.invariants, [
    "schemaReady",
    "aclReady",
  ]);
  if (
    source.schemaVersion !== 1 ||
    typeof source.readyForCutover !== "boolean" ||
    typeof invariantsSource.schemaReady !== "boolean" ||
    typeof invariantsSource.aclReady !== "boolean"
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  const readiness: OrdinaryAuthoritativeReadiness = {
    schemaVersion: 1,
    asOf: normalizeIsoTimestamp(source.asOf),
    readyForCutover: source.readyForCutover,
    merchant: {
      recordCount: normalizeNonnegativeInteger(merchantSource.recordCount),
      authoritativeBindingCount: normalizeNonnegativeInteger(
        merchantSource.authoritativeBindingCount,
      ),
      invalidBindingCount: normalizeNonnegativeInteger(
        merchantSource.invalidBindingCount,
      ),
    },
    personal: {
      canonicalBindingCount: normalizeNonnegativeInteger(
        personalSource.canonicalBindingCount,
      ),
      canonicalOrphanCount: normalizeNonnegativeInteger(
        personalSource.canonicalOrphanCount,
      ),
      invalidCanonicalCount: normalizeNonnegativeInteger(
        personalSource.invalidCanonicalCount,
      ),
      duplicateAuthUserCount: normalizeNonnegativeInteger(
        personalSource.duplicateAuthUserCount,
      ),
      duplicatePersonalAccountIdCount: normalizeNonnegativeInteger(
        personalSource.duplicatePersonalAccountIdCount,
      ),
    },
    security: {
      crossAccountTypeOverlapCount: normalizeNonnegativeInteger(
        securitySource.crossAccountTypeOverlapCount,
      ),
      accountIdentifierCollisionCount: normalizeNonnegativeInteger(
        securitySource.accountIdentifierCollisionCount,
      ),
      staffRegistryOverlapCount: normalizeNonnegativeInteger(
        securitySource.staffRegistryOverlapCount,
      ),
      systemSitePrincipalOverlapCount: normalizeNonnegativeInteger(
        securitySource.systemSitePrincipalOverlapCount,
      ),
    },
    invariants: {
      schemaReady: invariantsSource.schemaReady,
      aclReady: invariantsSource.aclReady,
    },
  };
  if (
    readiness.merchant.authoritativeBindingCount >
      readiness.merchant.recordCount ||
    readiness.merchant.invalidBindingCount > readiness.merchant.recordCount ||
    readiness.personal.canonicalOrphanCount >
      readiness.personal.canonicalBindingCount ||
    readiness.personal.invalidCanonicalCount >
      readiness.personal.canonicalBindingCount ||
    readiness.personal.duplicateAuthUserCount >
      readiness.personal.canonicalBindingCount ||
    readiness.personal.duplicatePersonalAccountIdCount >
      readiness.personal.canonicalBindingCount
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  const expectedReady =
    readiness.merchant.invalidBindingCount === 0 &&
    readiness.personal.canonicalOrphanCount === 0 &&
    readiness.personal.invalidCanonicalCount === 0 &&
    readiness.personal.duplicateAuthUserCount === 0 &&
    readiness.personal.duplicatePersonalAccountIdCount === 0 &&
    readiness.security.crossAccountTypeOverlapCount === 0 &&
    readiness.security.accountIdentifierCollisionCount === 0 &&
    readiness.security.staffRegistryOverlapCount === 0 &&
    readiness.security.systemSitePrincipalOverlapCount === 0 &&
    readiness.invariants.schemaReady &&
    readiness.invariants.aclReady;
  if (readiness.readyForCutover !== expectedReady) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  return readiness;
}

function normalizeDirectoryObservation(
  value: unknown,
): LegacyPersonalRecoveryDirectoryObservation {
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
  if (source.schemaVersion !== 1) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  const observation = {
    schemaVersion: 1 as const,
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
      observation.personalIdBindingCount ||
    observation.exactCanonicalBindingCount +
        observation.personalOtherAuthBindingCount >
      observation.personalIdBindingCount
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  return observation;
}

const ACCOUNT_TYPE_KEYS = ["account_type", "accountType"] as const;
const PERSONAL_ID_KEYS = ["personal_id", "personalId"] as const;
const MERCHANT_ID_KEYS = ["merchant_id", "merchantId", "merchantID"] as const;
const GENERIC_ID_KEYS = ["account_id", "accountId", "login_id", "loginId"] as const;

function metadataString(
  metadata: Record<string, unknown> | null,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function firstMetadataString(
  metadata: Record<string, unknown> | null,
  keys: readonly string[],
) {
  for (const key of keys) {
    const value = metadataString(metadata, key);
    if (value) return value;
  }
  return "";
}

function legacyAccountType(user: LegacyPersonalRecoveryAuthUser) {
  const typeCandidate =
    firstMetadataString(user.userMetadata, ACCOUNT_TYPE_KEYS) ||
    firstMetadataString(user.appMetadata, ACCOUNT_TYPE_KEYS);
  if (typeCandidate === "merchant" || typeCandidate === "personal") {
    return typeCandidate;
  }
  const personalHint =
    firstMetadataString(user.userMetadata, PERSONAL_ID_KEYS) ||
    firstMetadataString(user.appMetadata, PERSONAL_ID_KEYS);
  if (personalHint) return "personal";
  const merchantHint =
    firstMetadataString(user.userMetadata, MERCHANT_ID_KEYS) ||
    firstMetadataString(user.appMetadata, MERCHANT_ID_KEYS);
  return merchantHint ? "merchant" : "";
}

function legacyAccountId(user: LegacyPersonalRecoveryAuthUser) {
  const allKeys = [
    ...GENERIC_ID_KEYS.slice(0, 2),
    ...PERSONAL_ID_KEYS,
    ...MERCHANT_ID_KEYS,
    ...GENERIC_ID_KEYS.slice(2),
  ];
  return (
    firstMetadataString(user.userMetadata, allKeys) ||
    firstMetadataString(user.appMetadata, allKeys)
  );
}

function metadataValues(
  user: LegacyPersonalRecoveryAuthUser,
  keys: readonly string[],
) {
  return [user.userMetadata, user.appMetadata]
    .flatMap((metadata) =>
      keys.map((key) => ({ present: metadata?.[key] !== undefined, value: metadata?.[key] })),
    )
    .filter((entry) => entry.present);
}

function hasConsistentTargetMetadata(
  user: LegacyPersonalRecoveryAuthUser,
  recoveryCase: LegacyPersonalRecoveryCase,
) {
  const typeEntries = metadataValues(user, ACCOUNT_TYPE_KEYS);
  const personalEntries = metadataValues(user, PERSONAL_ID_KEYS);
  const genericEntries = metadataValues(user, GENERIC_ID_KEYS);
  const merchantEntries = metadataValues(user, MERCHANT_ID_KEYS);
  const allRecognizedEntries = [
    ...typeEntries,
    ...personalEntries,
    ...genericEntries,
    ...merchantEntries,
  ];
  if (
    allRecognizedEntries.some(
      (entry) =>
        typeof entry.value !== "string" || entry.value !== entry.value.trim(),
    )
  ) {
    return false;
  }
  return (
    typeEntries.length > 0 &&
    typeEntries.every((entry) => entry.value === "personal") &&
    personalEntries.length > 0 &&
    personalEntries.every(
      (entry) => entry.value === recoveryCase.personalAccountId,
    ) &&
    genericEntries.every(
      (entry) => entry.value === recoveryCase.personalAccountId,
    ) &&
    merchantEntries.length === 0 &&
    legacyAccountType(user) === "personal" &&
    legacyAccountId(user) === recoveryCase.personalAccountId
  );
}

function assertUniqueLegacyCandidate(
  users: LegacyPersonalRecoveryAuthUser[],
  recoveryCase: LegacyPersonalRecoveryCase,
) {
  const uniqueUsers = new Map<string, LegacyPersonalRecoveryAuthUser>();
  for (const user of users) {
    const id = String(user.id ?? "").trim().toLowerCase();
    if (!UUID_PATTERN.test(id) || uniqueUsers.has(id)) {
      throw new LegacyPersonalRecoveryError(
        "legacy_personal_recovery_candidate_conflict",
        409,
      );
    }
    uniqueUsers.set(id, user);
  }
  // Read the complete Auth directory, but scope uniqueness to identities that
  // can collide with this fixed case. Unrelated canonical/legacy personal
  // users are valid and must not make a one-case recovery impossible.
  const candidates = [...uniqueUsers.values()].filter((user) => {
    const idMatches =
      String(user.id ?? "").trim().toLowerCase() === recoveryCase.authUserId;
    const normalizedEmail = normalizeAuthEmail(user.email);
    const emailMatches =
      isValidAuthEmail(normalizedEmail) &&
      safeEqual(sha256(normalizedEmail), recoveryCase.emailSha256);
    const personalIdMatches = metadataValues(user, [
      ...PERSONAL_ID_KEYS,
      ...GENERIC_ID_KEYS,
      ...MERCHANT_ID_KEYS,
    ]).some(
      (entry) =>
        typeof entry.value === "string" &&
        entry.value.trim() === recoveryCase.personalAccountId,
    );
    return idMatches || emailMatches || personalIdMatches;
  });
  if (
    candidates.length !== 1 ||
    candidates[0]?.id.trim().toLowerCase() !== recoveryCase.authUserId
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_candidate_conflict",
      409,
    );
  }
  const candidate = candidates[0];
  assertAuthUserMatchesCase(
    recoveryCase,
    candidate,
    "legacy_personal_recovery_identity_mismatch",
  );
  if (!hasConsistentTargetMetadata(candidate, recoveryCase)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_metadata_drift",
      409,
    );
  }
}

function assertReadinessSafe(readiness: OrdinaryAuthoritativeReadiness) {
  if (!readiness.readyForCutover) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_readiness_blocked",
      409,
    );
  }
}

function assertDirectorySafe(
  directory: LegacyPersonalRecoveryDirectoryObservation,
  mode: "unbound" | "bound",
) {
  const commonConflict =
    directory.merchantBindingCount !== 0 ||
    directory.systemSiteBindingCount !== 0 ||
    directory.staffBindingCount !== 0 ||
    directory.employeeBindingCount !== 0 ||
    directory.accountIdentifierCollisionCount !== 0;
  const personalConflict =
    mode === "unbound"
      ? directory.personalAuthBindingCount !== 0 ||
        directory.personalIdBindingCount !== 0 ||
        directory.personalOtherAuthBindingCount !== 0 ||
        directory.exactCanonicalBindingCount !== 0
      : directory.personalAuthBindingCount !== 1 ||
        directory.personalIdBindingCount !== 1 ||
        directory.personalOtherAuthBindingCount !== 0 ||
        directory.exactCanonicalBindingCount !== 1;
  if (commonConflict || personalConflict) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_directory_conflict",
      409,
    );
  }
}

function isExpectedResolvedPersonal(
  authorization: OrdinaryAuthorization,
  recoveryCase: LegacyPersonalRecoveryCase,
) {
  return (
    authorization.status === "resolved" &&
    authorization.accountType === "personal" &&
    authorization.personalAccountId === recoveryCase.personalAccountId
  );
}

function assertRecoveryCaseStillActive(
  recoveryCase: LegacyPersonalRecoveryCase,
  now: number,
) {
  if (Date.parse(recoveryCase.expiresAt) <= now) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_expired",
      410,
    );
  }
}

function assertOperatorReauthorized(
  dependencies: LegacyPersonalRecoveryApprovalDependencies,
) {
  if (!dependencies.reauthorizeOperator()) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_operator_reauthorization_required",
      401,
    );
  }
}

function assertFreshVerifiedTarget(
  recoveryCase: LegacyPersonalRecoveryCase,
  authUser: LegacyPersonalRecoveryAuthUser,
  now: number,
) {
  assertRecoveryCaseStillActive(recoveryCase, now);
  assertAuthUserMatchesCase(
    recoveryCase,
    authUser,
    "legacy_personal_recovery_identity_mismatch",
  );
  assertAuthUserIsNotStaffPrincipal(authUser);
  if (!hasConsistentTargetMetadata(authUser, recoveryCase)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_metadata_drift",
      409,
    );
  }
  const verifiedMarker = readVerifiedMarker(recoveryCase, authUser, now);
  if (!verifiedMarker) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_verification_required",
      409,
    );
  }
  return verifiedMarker;
}

async function assertCompletedState(
  recoveryCase: LegacyPersonalRecoveryCase,
  dependencies: LegacyPersonalRecoveryApprovalDependencies,
) {
  const [authorizationValue, readinessValue, directoryValue] =
    await Promise.all([
      dependencies.resolveAuthorization(recoveryCase.authUserId),
      dependencies.loadReadiness(),
      dependencies.inspectDirectory(
        recoveryCase.authUserId,
        recoveryCase.personalAccountId,
      ),
    ]);
  const authorization = normalizeOrdinaryAuthorization(authorizationValue);
  const readiness = normalizeOrdinaryAuthoritativeReadiness(readinessValue);
  const directory = normalizeDirectoryObservation(directoryValue);
  if (!isExpectedResolvedPersonal(authorization, recoveryCase)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_directory_conflict",
      409,
    );
  }
  assertReadinessSafe(readiness);
  assertDirectorySafe(directory, "bound");
}

export async function approveLegacyPersonalRecovery(
  recoveryCase: LegacyPersonalRecoveryCase,
  dependencies: LegacyPersonalRecoveryApprovalDependencies,
) {
  const initialNow = dependencies.now?.() ?? Date.now();
  assertRecoveryCaseStillActive(recoveryCase, initialNow);
  const authUser = await dependencies.getAuthUser(recoveryCase.authUserId);
  assertAuthUserMatchesCase(
    recoveryCase,
    authUser,
    "legacy_personal_recovery_identity_mismatch",
  );

  const completedMarker = readCompletedMarker(recoveryCase, authUser);
  if (completedMarker) {
    await assertCompletedState(recoveryCase, dependencies);
    return { ok: true as const, state: "completed" as const, created: false };
  }
  const initialVerifiedMarker = readVerifiedMarker(
    recoveryCase,
    authUser,
    initialNow,
  );
  const initialApprovalAttempt = readApprovalAttemptMarker(
    recoveryCase,
    authUser,
  );
  if (!initialVerifiedMarker && !initialApprovalAttempt) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_verification_required",
      409,
    );
  }

  const users = await dependencies.listAuthUsers();
  assertUniqueLegacyCandidate(users, recoveryCase);

  const [authorizationValue, readinessValue, directoryValue] =
    await Promise.all([
      dependencies.resolveAuthorization(recoveryCase.authUserId),
      dependencies.loadReadiness(),
      dependencies.inspectDirectory(
        recoveryCase.authUserId,
        recoveryCase.personalAccountId,
      ),
    ]);
  const authorization = normalizeOrdinaryAuthorization(authorizationValue);
  const readinessBefore = normalizeOrdinaryAuthoritativeReadiness(
    readinessValue,
  );
  const directoryBefore = normalizeDirectoryObservation(directoryValue);
  assertReadinessSafe(readinessBefore);

  if (authorization.status === "unbound") {
    assertDirectorySafe(directoryBefore, "unbound");
  } else if (isExpectedResolvedPersonal(authorization, recoveryCase)) {
    assertDirectorySafe(directoryBefore, "bound");
  } else {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_directory_conflict",
      409,
    );
  }

  // A signed attempt is completion-only. An unbound principal always needs a
  // currently fresh verified marker before an attempt can be (re)armed.
  let activeAttempt = initialApprovalAttempt;
  if (!activeAttempt || authorization.status === "unbound") {
    const attemptUser = await dependencies.getAuthUser(
      recoveryCase.authUserId,
    );
    const attemptNow = dependencies.now?.() ?? Date.now();
    const verifiedMarker = assertFreshVerifiedTarget(
      recoveryCase,
      attemptUser,
      attemptNow,
    );
    const attemptMarker = buildApprovalAttemptMarker(
      recoveryCase,
      verifiedMarker,
      readinessBefore,
      new Date(attemptNow).toISOString(),
    );
    const attemptMetadata = appMetadataOf(attemptUser);
    attemptMetadata[LEGACY_PERSONAL_RECOVERY_APPROVAL_ATTEMPT_METADATA_KEY] =
      attemptMarker;
    assertOperatorReauthorized(dependencies);
    await dependencies.updateAuthAppMetadata(
      recoveryCase.authUserId,
      attemptMetadata,
    );
    activeAttempt = attemptMarker;
  }

  // Re-run all authoritative database observations after arming the attempt.
  // The final Auth reread and clock check below are the last awaited work
  // before the create-only RPC.
  const [armedAuthorizationValue, armedReadinessValue, armedDirectoryValue] =
    await Promise.all([
      dependencies.resolveAuthorization(recoveryCase.authUserId),
      dependencies.loadReadiness(),
      dependencies.inspectDirectory(
        recoveryCase.authUserId,
        recoveryCase.personalAccountId,
      ),
    ]);
  const armedAuthorization = normalizeOrdinaryAuthorization(
    armedAuthorizationValue,
  );
  const armedReadiness = normalizeOrdinaryAuthoritativeReadiness(
    armedReadinessValue,
  );
  const armedDirectory = normalizeDirectoryObservation(armedDirectoryValue);
  assertReadinessSafe(armedReadiness);
  if (armedAuthorization.status === "unbound") {
    assertDirectorySafe(armedDirectory, "unbound");
  } else if (isExpectedResolvedPersonal(armedAuthorization, recoveryCase)) {
    assertDirectorySafe(armedDirectory, "bound");
  } else {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_directory_conflict",
      409,
    );
  }

  const armedUser = await dependencies.getAuthUser(recoveryCase.authUserId);
  const armedNow = dependencies.now?.() ?? Date.now();
  assertRecoveryCaseStillActive(recoveryCase, armedNow);
  assertAuthUserMatchesCase(
    recoveryCase,
    armedUser,
    "legacy_personal_recovery_identity_mismatch",
  );
  assertAuthUserIsNotStaffPrincipal(armedUser);
  if (!hasConsistentTargetMetadata(armedUser, recoveryCase)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_metadata_drift",
      409,
    );
  }
  const armedAttempt = readApprovalAttemptMarker(recoveryCase, armedUser);
  if (
    !armedAttempt ||
    !activeAttempt ||
    armedAttempt.authorizationHash !== activeAttempt.authorizationHash
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_verification_required",
      409,
    );
  }

  let created = false;
  if (armedAuthorization.status === "unbound") {
    const armedVerifiedMarker = readVerifiedMarker(
      recoveryCase,
      armedUser,
      armedNow,
    );
    if (
      !armedVerifiedMarker ||
      armedAttempt.verifiedMarkerHash !==
        armedVerifiedMarker.verificationHash
    ) {
      throw new LegacyPersonalRecoveryError(
        "legacy_personal_recovery_verification_required",
        409,
      );
    }
    // Revalidate the signed super-admin session and trusted-device binding at
    // the mutation boundary. This synchronous check and the marker checks
    // above are the final work before the fixed create-only RPC.
    assertOperatorReauthorized(dependencies);
    let createdValue: unknown;
    try {
      // No awaited work belongs between the fresh marker check above and this
      // one fixed 036 create-only call.
      createdValue = await dependencies.createAuthorization(
        recoveryCase.authUserId,
        "personal",
        recoveryCase.personalAccountId,
      );
    } catch {
      throw new LegacyPersonalRecoveryError(
        "legacy_personal_recovery_rpc_failed",
        503,
      );
    }
    const createdAuthorization = normalizeOrdinaryAuthorization(createdValue);
    if (!isExpectedResolvedPersonal(createdAuthorization, recoveryCase)) {
      throw new LegacyPersonalRecoveryError(
        "legacy_personal_recovery_rpc_failed",
        503,
      );
    }
    created = true;
  }

  const [finalAuthorizationValue, readinessAfterValue, directoryAfterValue] =
    await Promise.all([
      dependencies.resolveAuthorization(recoveryCase.authUserId),
      dependencies.loadReadiness(),
      dependencies.inspectDirectory(
        recoveryCase.authUserId,
        recoveryCase.personalAccountId,
      ),
    ]);
  const finalAuthorization = normalizeOrdinaryAuthorization(
    finalAuthorizationValue,
  );
  const readinessAfter = normalizeOrdinaryAuthoritativeReadiness(
    readinessAfterValue,
  );
  const directoryAfter = normalizeDirectoryObservation(directoryAfterValue);
  if (!isExpectedResolvedPersonal(finalAuthorization, recoveryCase)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_rpc_failed",
      503,
    );
  }
  assertReadinessSafe(readinessAfter);
  assertDirectorySafe(directoryAfter, "bound");
  const expectedCanonicalCount =
    armedReadiness.personal.canonicalBindingCount + (created ? 1 : 0);
  if (
    readinessAfter.personal.canonicalBindingCount !== expectedCanonicalCount
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_readiness_blocked",
      409,
    );
  }

  const latestUser = await dependencies.getAuthUser(recoveryCase.authUserId);
  assertAuthUserMatchesCase(
    recoveryCase,
    latestUser,
    "legacy_personal_recovery_identity_mismatch",
  );
  assertAuthUserIsNotStaffPrincipal(latestUser);
  if (!hasConsistentTargetMetadata(latestUser, recoveryCase)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_metadata_drift",
      409,
    );
  }
  const completionAttempt = readApprovalAttemptMarker(
    recoveryCase,
    latestUser,
  );
  if (
    !completionAttempt ||
    completionAttempt.authorizationHash !== armedAttempt.authorizationHash
  ) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_verification_required",
      409,
    );
  }
  const completionNow = dependencies.now?.() ?? Date.now();
  const completedAt = new Date(completionNow).toISOString();
  const appMetadata = appMetadataOf(latestUser);
  appMetadata[LEGACY_PERSONAL_RECOVERY_VERIFIED_METADATA_KEY] = null;
  appMetadata[LEGACY_PERSONAL_RECOVERY_APPROVAL_ATTEMPT_METADATA_KEY] = null;
  appMetadata[LEGACY_PERSONAL_RECOVERY_COMPLETED_METADATA_KEY] =
    buildCompletedMarker(
      recoveryCase,
      completedAt,
      readinessFingerprint(recoveryCase, armedReadiness),
      readinessFingerprint(recoveryCase, readinessAfter),
    );
  // A response-loss retry may enter here with an already-bound canonical row;
  // require a current operator session immediately before completing the
  // service-owned audit marker as well.
  assertOperatorReauthorized(dependencies);
  await dependencies.updateAuthAppMetadata(
    recoveryCase.authUserId,
    appMetadata,
  );

  const auditedUser = await dependencies.getAuthUser(recoveryCase.authUserId);
  assertAuthUserMatchesCase(
    recoveryCase,
    auditedUser,
    "legacy_personal_recovery_identity_mismatch",
  );
  if (!readCompletedMarker(recoveryCase, auditedUser)) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  return { ok: true as const, state: "completed" as const, created };
}

export async function getLegacyPersonalRecoveryStatus(
  recoveryCase: LegacyPersonalRecoveryCase,
  dependencies: Pick<
    LegacyPersonalRecoveryApprovalDependencies,
    "getAuthUser" | "now"
  >,
) {
  const now = dependencies.now?.() ?? Date.now();
  const authUser = await dependencies.getAuthUser(recoveryCase.authUserId);
  assertAuthUserMatchesCase(
    recoveryCase,
    authUser,
    "legacy_personal_recovery_identity_mismatch",
  );
  if (readCompletedMarker(recoveryCase, authUser)) {
    return {
      ok: true as const,
      state: "completed" as const,
      readyForApproval: false,
    };
  }
  const verified = readVerifiedMarker(recoveryCase, authUser, now);
  const approvalAttempt = readApprovalAttemptMarker(recoveryCase, authUser);
  return {
    ok: true as const,
    state: verified
      ? ("ready_for_approval" as const)
      : approvalAttempt
        ? ("approval_attempt_pending" as const)
        : ("awaiting_user_verification" as const),
    readyForApproval: Boolean(verified || approvalAttempt),
  };
}

export const LEGACY_PERSONAL_RECOVERY_RPC_NAMES = {
  create: CREATE_AUTHORIZATION_RPC,
  resolve: RESOLVE_AUTHORIZATION_RPC,
  readiness: AUTHORITATIVE_READINESS_RPC,
  observer: RECOVERY_OBSERVER_RPC,
} as const;
