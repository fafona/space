import { createHash, randomBytes } from "node:crypto";

import { normalizeAuthEmail } from "@/lib/authCredentialValidation";

type RecoveryGrantRpcClient = {
  rpc: (
    functionName: string,
    args: { p_input: Record<string, unknown> },
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

type RecoverySessionActivationEvidence =
  | { kind: "typed_recovery"; tokenHash: string; proofToken: "" }
  | { kind: "requested_intent"; tokenHash: ""; proofToken: string };

export class PasswordRecoveryGrantError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code = "reset_password_session_unavailable", status = 503) {
    super(code);
    this.name = "PasswordRecoveryGrantError";
    this.code = code;
    this.status = status;
  }
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorText(value: unknown) {
  if (!value || typeof value !== "object") return String(value ?? "").toLowerCase();
  const error = value as { code?: unknown; message?: unknown; details?: unknown };
  return [error.code, error.message, error.details]
    .filter((item): item is string => typeof item === "string")
    .join(":")
    .toLowerCase();
}

function throwRpcError(error: unknown): never {
  const message = errorText(error);
  if (message.includes("in_progress") || message.includes("already_used")) {
    throw new PasswordRecoveryGrantError("reset_password_recovery_in_progress", 409);
  }
  if (message.includes("invalid_or_expired") || message.includes("grant_invalid")) {
    throw new PasswordRecoveryGrantError(
      "reset_password_recovery_session_expired",
      401,
    );
  }
  throw new PasswordRecoveryGrantError();
}

export function createPasswordRecoveryProofToken() {
  return randomBytes(32).toString("base64url");
}

export function resolveRecoverySessionActivationEvidence(input: {
  tokenHash: unknown;
  type: unknown;
  recoveryIntent: unknown;
}): RecoverySessionActivationEvidence | null {
  const tokenHash = typeof input.tokenHash === "string" ? input.tokenHash.trim() : "";
  const recoveryType = typeof input.type === "string" ? input.type.trim().toLowerCase() : "";
  const proofToken =
    typeof input.recoveryIntent === "string"
      ? input.recoveryIntent.trim()
      : "";

  // A token hash is authoritative only when GoTrue verifies it specifically as
  // a recovery token. Explicit invite, magic-link, email OTP, password, or
  // OAuth labels must never be reinterpreted as recovery.
  if (tokenHash) {
    if (recoveryType && recoveryType !== "recovery") return null;
    return { kind: "typed_recovery", tokenHash, proofToken: "" };
  }

  // Access-token and PKCE-code flows are authorized by the unguessable intent
  // carried only in the reset email callback. A pre-existing browser cookie is
  // deliberately not activation evidence.
  if (recoveryType && recoveryType !== "recovery") return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(proofToken)) return null;
  return { kind: "requested_intent", tokenHash: "", proofToken };
}

export function hashPasswordRecoveryProofToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashPasswordRecoveryEmail(email: string) {
  return createHash("sha256")
    .update(normalizeAuthEmail(email), "utf8")
    .digest("hex");
}

export function fingerprintRecoveredPassword(proofToken: string, password: string) {
  return createHash("sha256")
    .update("faolla:password-recovery:v1\0", "utf8")
    .update(proofToken, "utf8")
    .update("\0", "utf8")
    .update(password, "utf8")
    .digest("hex");
}

export async function createPasswordRecoveryIntent(
  service: RecoveryGrantRpcClient,
  input: { proofToken: string; email: string; source: "reset_email" | "reset_code" },
) {
  const result = await service.rpc("faolla_create_password_recovery_intent_v1", {
    p_input: {
      token_hash: hashPasswordRecoveryProofToken(input.proofToken),
      email_hash: hashPasswordRecoveryEmail(input.email),
      source: input.source,
    },
  });
  if (result.error) throwRpcError(result.error);
  const data = recordValue(result.data);
  if (data?.created !== true || data.state !== "requested") {
    throw new PasswordRecoveryGrantError();
  }
}

export async function activatePasswordRecoveryGrant(
  service: RecoveryGrantRpcClient,
  input: {
    proofToken: string;
    email: string;
    authUserId: string;
    sessionId: string;
    proofKind: "requested_intent" | "typed_recovery";
  },
) {
  const result = await service.rpc("faolla_activate_password_recovery_grant_v1", {
    p_input: {
      token_hash: hashPasswordRecoveryProofToken(input.proofToken),
      email_hash: hashPasswordRecoveryEmail(input.email),
      auth_user_id: input.authUserId,
      session_id: input.sessionId,
      proof_kind: input.proofKind,
    },
  });
  if (result.error) throwRpcError(result.error);
  const data = recordValue(result.data);
  if (
    data?.state !== "ready" ||
    String(data.auth_user_id ?? "").toLowerCase() !== input.authUserId.toLowerCase() ||
    String(data.session_id ?? "") !== input.sessionId
  ) {
    throw new PasswordRecoveryGrantError();
  }
}

export async function validatePasswordRecoveryGrant(
  service: RecoveryGrantRpcClient,
  input: { proofToken: string; authUserId: string; sessionId: string },
) {
  const result = await service.rpc("faolla_validate_password_recovery_grant_v1", {
    p_input: {
      token_hash: hashPasswordRecoveryProofToken(input.proofToken),
      auth_user_id: input.authUserId,
      session_id: input.sessionId,
    },
  });
  if (result.error) throwRpcError(result.error);
  return recordValue(result.data)?.valid === true;
}

export async function claimPasswordRecoveryGrant(
  service: RecoveryGrantRpcClient,
  input: {
    proofToken: string;
    authUserId: string;
    sessionId: string;
    password: string;
  },
) {
  const passwordFingerprint = fingerprintRecoveredPassword(
    input.proofToken,
    input.password,
  );
  const result = await service.rpc("faolla_claim_password_recovery_grant_v1", {
    p_input: {
      token_hash: hashPasswordRecoveryProofToken(input.proofToken),
      auth_user_id: input.authUserId,
      session_id: input.sessionId,
      password_fingerprint: passwordFingerprint,
    },
  });
  if (result.error) throwRpcError(result.error);
  const data = recordValue(result.data);
  const state = data?.state;
  if (
    (state !== "claimed" && state !== "completed") ||
    (data?.resumed !== true && data?.resumed !== false)
  ) {
    throw new PasswordRecoveryGrantError();
  }
  return { state, resumed: data.resumed === true, passwordFingerprint } as const;
}

export async function completePasswordRecoveryGrant(
  service: RecoveryGrantRpcClient,
  input: {
    proofToken: string;
    authUserId: string;
    sessionId: string;
    passwordFingerprint: string;
  },
) {
  const result = await service.rpc("faolla_complete_password_recovery_grant_v1", {
    p_input: {
      token_hash: hashPasswordRecoveryProofToken(input.proofToken),
      auth_user_id: input.authUserId,
      session_id: input.sessionId,
      password_fingerprint: input.passwordFingerprint,
    },
  });
  if (result.error) throwRpcError(result.error);
  if (recordValue(result.data)?.state !== "completed") {
    throw new PasswordRecoveryGrantError();
  }
}

export async function releasePasswordRecoveryGrant(
  service: RecoveryGrantRpcClient,
  input: {
    proofToken: string;
    authUserId: string;
    sessionId: string;
    passwordFingerprint: string;
  },
) {
  const result = await service.rpc("faolla_release_password_recovery_grant_v1", {
    p_input: {
      token_hash: hashPasswordRecoveryProofToken(input.proofToken),
      auth_user_id: input.authUserId,
      session_id: input.sessionId,
      password_fingerprint: input.passwordFingerprint,
    },
  });
  if (result.error) throwRpcError(result.error);
  if (recordValue(result.data)?.released !== true) {
    throw new PasswordRecoveryGrantError();
  }
}
