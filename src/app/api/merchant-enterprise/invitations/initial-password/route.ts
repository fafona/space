import { createHash } from "node:crypto";

import type { User } from "@supabase/supabase-js";
import {
  isAuthRateLimitError,
  isValidAuthPassword,
  normalizeAuthEmail,
  readAuthPassword,
} from "@/lib/authCredentialValidation";
import { isDefinitiveAuthMutationRejection } from "@/lib/authMutationOutcome.server";
import {
  MerchantEnterpriseAccessError,
  resolveValidatedMerchantEnterpriseAuthUser,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  hashMerchantEnterpriseInvitationToken,
  merchantEnterpriseInvitationTokenMatchesHash,
} from "@/lib/merchantEnterpriseInvitationSecret.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  hasImmutableMerchantStaffPrincipal,
  MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY,
  MERCHANT_STAFF_PRINCIPAL_TYPE,
} from "@/lib/merchantStaffPrincipal.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const MERCHANT_ENTERPRISE_INITIAL_PASSWORD_MIN_LENGTH = 8;
export const MERCHANT_ENTERPRISE_INITIAL_PASSWORD_MAX_LENGTH = 128;

const REQUEST_MAX_LENGTH = 4096;
const REQUEST_KEYS = [
  "invitationToken",
  "invitationVersion",
  "newPassword",
  "operationId",
  "siteId",
] as const;
const STAFF_EMAIL_HASH_METADATA_KEY = "merchant_staff_email_hash";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type InitialPasswordAuthUser = Pick<User, "id" | "email" | "app_metadata">;

type InitialPasswordInvitationLookup = {
  siteId: string;
  authUserId: string;
  invitationVersion: number;
  tokenHash: string;
  nowIso: string;
};

type InitialPasswordRoleLookup = {
  siteId: string;
  roleId: string;
};

type InitialPasswordIdentityLookup = {
  authUserId: string;
  emailHash: string;
};

type InitialPasswordAuthUpdate = {
  password: string;
  app_metadata: Record<string, unknown>;
};

type InitialPasswordSetupClaimInput = {
  siteId: string;
  authUserId: string;
  invitationVersion: number;
  tokenHash: string;
  operationId: string;
  passwordFingerprint: string;
};

type InitialPasswordDataResult = {
  data: unknown;
  error: unknown;
};

type InitialPasswordAuthResult = {
  user: InitialPasswordAuthUser | null;
  error: unknown;
};

export type MerchantEnterpriseInitialPasswordDependencies = {
  resolveAuthUser: (request: Request) => Promise<InitialPasswordAuthUser | null>;
  loadInvitation: (
    input: InitialPasswordInvitationLookup,
  ) => PromiseLike<InitialPasswordDataResult>;
  loadStaffIdentity: (
    input: InitialPasswordIdentityLookup,
  ) => PromiseLike<InitialPasswordDataResult>;
  loadRole: (
    input: InitialPasswordRoleLookup,
  ) => PromiseLike<InitialPasswordDataResult>;
  getAuthUserById: (authUserId: string) => PromiseLike<InitialPasswordAuthResult>;
  updateAuthUserById: (
    authUserId: string,
    attributes: InitialPasswordAuthUpdate,
  ) => PromiseLike<InitialPasswordAuthResult>;
  claimInitialPasswordSetup: (
    input: InitialPasswordSetupClaimInput,
  ) => PromiseLike<InitialPasswordDataResult>;
  completeInitialPasswordSetup: (
    input: InitialPasswordSetupClaimInput,
  ) => PromiseLike<InitialPasswordDataResult>;
  releaseInitialPasswordSetup: (
    input: InitialPasswordSetupClaimInput,
  ) => PromiseLike<InitialPasswordDataResult>;
  now: () => Date;
};

class InitialPasswordRouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "InitialPasswordRouteError";
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function responseHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  } as const;
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(),
  });
}

function errorResponse(code: string, status: number) {
  return jsonResponse({ ok: false, error: code }, status);
}

function fail(error: unknown) {
  if (error instanceof InitialPasswordRouteError) {
    return errorResponse(error.code, error.status);
  }
  if (error instanceof MerchantEnterpriseAccessError) {
    return errorResponse(error.code, error.status);
  }
  return errorResponse("employee_initial_password_setup_failed", 503);
}

function requireExplicitInviteSession(request: Request) {
  const headerName = "x-merchant-access-token";
  if (
    !request.headers.has(headerName) ||
    !text(request.headers.get(headerName), 16_384)
  ) {
    throw new InitialPasswordRouteError("unauthorized", 401);
  }
}

async function parseRequest(request: Request) {
  const contentType = text(request.headers.get("content-type"), 128)
    .split(";", 1)[0]
    ?.toLowerCase();
  const contentLengthHeader = text(request.headers.get("content-length"), 32);
  if (
    contentType !== "application/json" ||
    (contentLengthHeader &&
      (!/^[0-9]+$/.test(contentLengthHeader) ||
        Number(contentLengthHeader) > REQUEST_MAX_LENGTH))
  ) {
    throw new InitialPasswordRouteError(
      "invalid_employee_initial_password_request",
      400,
    );
  }

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > REQUEST_MAX_LENGTH) {
    throw new InitialPasswordRouteError(
      "invalid_employee_initial_password_request",
      400,
    );
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = recordValue(JSON.parse(rawBody));
  } catch {
    body = null;
  }
  const keys = Object.keys(body ?? {}).sort();
  if (
    !body ||
    keys.length !== REQUEST_KEYS.length ||
    keys.some((key, index) => key !== REQUEST_KEYS[index])
  ) {
    throw new InitialPasswordRouteError(
      "invalid_employee_initial_password_request",
      400,
    );
  }

  const siteId = text(body.siteId, 80);
  if (!isMerchantNumericId(siteId)) {
    throw new InitialPasswordRouteError("invalid_site_id", 400);
  }

  const invitationToken = text(body.invitationToken, 256);
  const invitationVersion = Number(body.invitationVersion);
  if (
    typeof body.invitationVersion !== "number" ||
    !Number.isSafeInteger(invitationVersion) ||
    invitationVersion <= 0
  ) {
    throw new InitialPasswordRouteError(
      "invalid_employee_invitation_credentials",
      400,
    );
  }
  let tokenHash = "";
  try {
    tokenHash = hashMerchantEnterpriseInvitationToken(invitationToken);
  } catch {
    throw new InitialPasswordRouteError(
      "invalid_employee_invitation_credentials",
      400,
    );
  }

  const newPassword = readAuthPassword(body.newPassword);
  if (
    !isValidAuthPassword(newPassword) ||
    newPassword.length < MERCHANT_ENTERPRISE_INITIAL_PASSWORD_MIN_LENGTH ||
    newPassword.length > MERCHANT_ENTERPRISE_INITIAL_PASSWORD_MAX_LENGTH
  ) {
    throw new InitialPasswordRouteError("invalid_employee_password", 400);
  }

  const operationId = text(body.operationId, 80).toLowerCase();
  if (!UUID_V4_PATTERN.test(operationId)) {
    throw new InitialPasswordRouteError(
      "invalid_employee_initial_password_operation",
      400,
    );
  }

  return {
    siteId,
    invitationToken,
    invitationVersion,
    tokenHash,
    newPassword,
    operationId,
  };
}

function normalizedEmailHash(email: string) {
  return createHash("sha256").update(email, "utf8").digest("hex");
}

function initialPasswordFingerprint(invitationToken: string, password: string) {
  return createHash("sha256")
    .update("faolla:merchant-employee-initial-password:v1\0", "utf8")
    .update(invitationToken, "utf8")
    .update("\0", "utf8")
    .update(password, "utf8")
    .digest("hex");
}

function normalizeSetupClaim(
  value: unknown,
  expected: InitialPasswordSetupClaimInput,
) {
  const row = recordValue(value);
  const state = text(row?.state, 32).toLowerCase();
  if (
    !row ||
    (state !== "claimed" && state !== "completed") ||
    row.resumed !== true && row.resumed !== false ||
    text(row.employee_id, 80).toLowerCase() === "" ||
    text(row.auth_user_id, 80).toLowerCase() !== expected.authUserId ||
    text(row.merchant_id, 80) !== expected.siteId ||
    Number(row.invitation_version) !== expected.invitationVersion ||
    text(row.operation_id, 80).toLowerCase() !== expected.operationId ||
    text(row.password_fingerprint, 64).toLowerCase() !==
      expected.passwordFingerprint
  ) {
    throw new InitialPasswordRouteError(
      "employee_initial_password_store_unavailable",
      503,
    );
  }
  return { state, resumed: row.resumed === true };
}

function throwSetupStoreError(error: unknown): never {
  const message = text(
    error && typeof error === "object" ? (error as { message?: unknown }).message : error,
    512,
  ).toLowerCase();
  if (message.includes("employee_initial_password_setup_in_progress")) {
    throw new InitialPasswordRouteError(
      "employee_initial_password_setup_in_progress",
      409,
    );
  }
  if (message.includes("employee_password_already_initialized")) {
    throw new InitialPasswordRouteError(
      "employee_password_already_initialized",
      409,
    );
  }
  if (message.includes("employee_initial_password_not_required")) {
    throw new InitialPasswordRouteError("employee_password_state_unknown", 409);
  }
  if (
    message.includes("employee_invitation_") ||
    message.includes("merchant_employee_not_invited") ||
    message.includes("merchant_access_denied")
  ) {
    throw new InitialPasswordRouteError(
      "employee_invitation_invalid_or_expired",
      410,
    );
  }
  throw new InitialPasswordRouteError(
    "employee_initial_password_store_unavailable",
    503,
  );
}

function normalizeExactStaffUser(
  value: InitialPasswordAuthUser | null | undefined,
  expected?: { authUserId: string; email: string; emailHash: string },
) {
  const authUserId = text(value?.id, 80).toLowerCase();
  const email = normalizeAuthEmail(value?.email);
  const appMetadata = recordValue(value?.app_metadata);
  const emailHash = text(
    appMetadata?.[STAFF_EMAIL_HASH_METADATA_KEY],
    64,
  ).toLowerCase();
  if (
    !UUID_PATTERN.test(authUserId) ||
    !email ||
    !appMetadata ||
    !hasImmutableMerchantStaffPrincipal({
      id: authUserId,
      app_metadata: appMetadata,
    }) ||
    emailHash !== normalizedEmailHash(email) ||
    (expected &&
      (authUserId !== expected.authUserId ||
        email !== expected.email ||
        emailHash !== expected.emailHash))
  ) {
    throw new InitialPasswordRouteError(
      "employee_invitation_invalid_or_expired",
      410,
    );
  }
  return { authUserId, email, emailHash, appMetadata };
}

function normalizePendingInvitation(
  value: unknown,
  expected: {
    siteId: string;
    authUserId: string;
    email: string;
    invitationVersion: number;
    invitationToken: string;
    now: Date;
  },
) {
  const row = recordValue(value);
  const id = text(row?.id, 80).toLowerCase();
  const siteId = text(row?.merchant_id, 80);
  const authUserId = text(row?.auth_user_id, 80).toLowerCase();
  const email = normalizeAuthEmail(row?.email);
  const roleId = text(row?.role_id, 80).toLowerCase();
  const status = text(row?.status, 40).toLowerCase();
  const invitationVersion = Number(row?.invitation_version);
  const invitationTokenHash = text(row?.invitation_token_hash, 64).toLowerCase();
  const expiresAt = text(row?.invitation_expires_at, 80);
  const expiresAtMs = Date.parse(expiresAt);
  if (
    !row ||
    !UUID_PATTERN.test(id) ||
    siteId !== expected.siteId ||
    authUserId !== expected.authUserId ||
    email !== expected.email ||
    !UUID_PATTERN.test(roleId) ||
    status !== "invited" ||
    row.accepted_at !== null ||
    !Number.isSafeInteger(invitationVersion) ||
    invitationVersion !== expected.invitationVersion ||
    !merchantEnterpriseInvitationTokenMatchesHash(
      expected.invitationToken,
      invitationTokenHash,
    ) ||
    row.invitation_revoked_at !== null ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= expected.now.getTime()
  ) {
    throw new InitialPasswordRouteError(
      "employee_invitation_invalid_or_expired",
      410,
    );
  }
  return {
    id,
    siteId,
    authUserId,
    email,
    roleId,
    invitationVersion,
    invitationTokenHash,
    expiresAt,
  };
}

function normalizeActiveRole(
  value: unknown,
  expected: { siteId: string; roleId: string },
) {
  const row = recordValue(value);
  const roleId = text(row?.id, 80).toLowerCase();
  const siteId = text(row?.merchant_id, 80);
  const status = text(row?.status, 40).toLowerCase();
  if (
    !row ||
    roleId !== expected.roleId ||
    siteId !== expected.siteId ||
    status !== "active"
  ) {
    throw new InitialPasswordRouteError(
      "employee_invitation_invalid_or_expired",
      410,
    );
  }
  return { roleId, siteId };
}

function assertExactStaffIdentity(
  value: unknown,
  expected: { authUserId: string; emailHash: string },
) {
  const row = recordValue(value);
  if (
    text(row?.auth_user_id, 80).toLowerCase() !== expected.authUserId ||
    text(row?.email_hash, 64).toLowerCase() !== expected.emailHash ||
    text(row?.principal_type, 80).toLowerCase() !== MERCHANT_STAFF_PRINCIPAL_TYPE
  ) {
    throw new InitialPasswordRouteError(
      "employee_invitation_invalid_or_expired",
      410,
    );
  }
}

function requireKnownUninitializedPasswordState(
  appMetadata: Record<string, unknown>,
) {
  const state = appMetadata[MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY];
  if (state === true) {
    throw new InitialPasswordRouteError(
      "employee_password_already_initialized",
      409,
    );
  }
  if (state !== false) {
    throw new InitialPasswordRouteError("employee_password_state_unknown", 409);
  }
}

function validNow(dependencies: MerchantEnterpriseInitialPasswordDependencies) {
  const now = dependencies.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new InitialPasswordRouteError(
      "employee_initial_password_setup_failed",
      503,
    );
  }
  return now;
}

function createDefaultDependencies(): MerchantEnterpriseInitialPasswordDependencies {
  let service: ReturnType<typeof createServerSupabaseServiceClient> | undefined;
  const getService = () => {
    if (service) return service;
    const created = createServerSupabaseServiceClient();
    if (!created) {
      throw new InitialPasswordRouteError("enterprise_store_unavailable", 503);
    }
    service = created;
    return created;
  };

  return {
    resolveAuthUser: resolveValidatedMerchantEnterpriseAuthUser,
    loadInvitation: async (input) => {
      const result = await getService()
        .from("merchant_enterprise_employees")
        .select(
          "id,merchant_id,auth_user_id,email,role_id,status,accepted_at,invitation_version,invitation_token_hash,invitation_expires_at,invitation_revoked_at",
        )
        .eq("merchant_id", input.siteId)
        .eq("auth_user_id", input.authUserId)
        .eq("invitation_version", input.invitationVersion)
        .eq("invitation_token_hash", input.tokenHash)
        .eq("status", "invited")
        .is("accepted_at", null)
        .is("invitation_revoked_at", null)
        .gt("invitation_expires_at", input.nowIso)
        .limit(1)
        .maybeSingle();
      return { data: result.data, error: result.error };
    },
    loadRole: async (input) => {
      const result = await getService()
        .from("merchant_enterprise_roles")
        .select("id,merchant_id,status")
        .eq("merchant_id", input.siteId)
        .eq("id", input.roleId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      return { data: result.data, error: result.error };
    },
    loadStaffIdentity: async (input) => {
      const result = await getService()
        .from("merchant_enterprise_staff_identities")
        .select("auth_user_id,email_hash,principal_type")
        .eq("auth_user_id", input.authUserId)
        .eq("email_hash", input.emailHash)
        .eq("principal_type", MERCHANT_STAFF_PRINCIPAL_TYPE)
        .limit(1)
        .maybeSingle();
      return { data: result.data, error: result.error };
    },
    getAuthUserById: async (authUserId) => {
      const result = await getService().auth.admin.getUserById(authUserId);
      return { user: result.data.user, error: result.error };
    },
    updateAuthUserById: async (authUserId, attributes) => {
      const result = await getService().auth.admin.updateUserById(
        authUserId,
        attributes,
      );
      return { user: result.data.user, error: result.error };
    },
    claimInitialPasswordSetup: async (input) => {
      const result = await getService().rpc(
        "faolla_claim_merchant_employee_initial_password_setup_v1",
        {
          p_input: {
            merchant_id: input.siteId,
            auth_user_id: input.authUserId,
            invitation_version: input.invitationVersion,
            token_hash: input.tokenHash,
            operation_id: input.operationId,
            password_fingerprint: input.passwordFingerprint,
          },
        },
      );
      return { data: result.data, error: result.error };
    },
    completeInitialPasswordSetup: async (input) => {
      const result = await getService().rpc(
        "faolla_complete_merchant_employee_initial_password_setup_v1",
        {
          p_input: {
            merchant_id: input.siteId,
            auth_user_id: input.authUserId,
            invitation_version: input.invitationVersion,
            token_hash: input.tokenHash,
            operation_id: input.operationId,
            password_fingerprint: input.passwordFingerprint,
          },
        },
      );
      return { data: result.data, error: result.error };
    },
    releaseInitialPasswordSetup: async (input) => {
      const result = await getService().rpc(
        "faolla_release_merchant_employee_initial_password_setup_v1",
        {
          p_input: {
            merchant_id: input.siteId,
            auth_user_id: input.authUserId,
            invitation_version: input.invitationVersion,
            token_hash: input.tokenHash,
            operation_id: input.operationId,
            password_fingerprint: input.passwordFingerprint,
          },
        },
      );
      return { data: result.data, error: result.error };
    },
    now: () => new Date(),
  };
}

export function createMerchantEnterpriseInitialPasswordHandler(
  dependencies: MerchantEnterpriseInitialPasswordDependencies,
) {
  return async function handleMerchantEnterpriseInitialPassword(request: Request) {
    if (!isTrustedSameOriginMutationRequest(request)) {
      return errorResponse("forbidden_origin", 403);
    }

    try {
      requireExplicitInviteSession(request);
      const input = await parseRequest(request);
      const sessionUser = normalizeExactStaffUser(
        await dependencies.resolveAuthUser(request),
      );

      const firstNow = validNow(dependencies);
      const firstInvitationResult = await Promise.resolve(
        dependencies.loadInvitation({
          siteId: input.siteId,
          authUserId: sessionUser.authUserId,
          invitationVersion: input.invitationVersion,
          tokenHash: input.tokenHash,
          nowIso: firstNow.toISOString(),
        }),
      );
      if (firstInvitationResult.error) {
        throw new InitialPasswordRouteError(
          "employee_initial_password_store_unavailable",
          503,
        );
      }
      const firstInvitation = normalizePendingInvitation(
        firstInvitationResult.data,
        {
          siteId: input.siteId,
          authUserId: sessionUser.authUserId,
          email: sessionUser.email,
          invitationVersion: input.invitationVersion,
          invitationToken: input.invitationToken,
          now: firstNow,
        },
      );

      const firstRoleResult = await Promise.resolve(
        dependencies.loadRole({
          siteId: input.siteId,
          roleId: firstInvitation.roleId,
        }),
      );
      if (firstRoleResult.error) {
        throw new InitialPasswordRouteError(
          "employee_initial_password_store_unavailable",
          503,
        );
      }
      normalizeActiveRole(firstRoleResult.data, {
        siteId: input.siteId,
        roleId: firstInvitation.roleId,
      });

      const identityResult = await Promise.resolve(
        dependencies.loadStaffIdentity({
          authUserId: sessionUser.authUserId,
          emailHash: sessionUser.emailHash,
        }),
      );
      if (identityResult.error) {
        throw new InitialPasswordRouteError(
          "employee_initial_password_store_unavailable",
          503,
        );
      }
      assertExactStaffIdentity(identityResult.data, {
        authUserId: sessionUser.authUserId,
        emailHash: sessionUser.emailHash,
      });

      // Auth and Postgres cannot share one transaction. Re-read the invitation
      // before claiming the one setup operation. The acceptance RPC also locks
      // this employee and refuses to activate it until this claim is complete.
      const finalNow = validNow(dependencies);
      const finalInvitationResult = await Promise.resolve(
        dependencies.loadInvitation({
          siteId: input.siteId,
          authUserId: sessionUser.authUserId,
          invitationVersion: input.invitationVersion,
          tokenHash: input.tokenHash,
          nowIso: finalNow.toISOString(),
        }),
      );
      if (finalInvitationResult.error) {
        throw new InitialPasswordRouteError(
          "employee_initial_password_store_unavailable",
          503,
        );
      }
      const finalInvitation = normalizePendingInvitation(
        finalInvitationResult.data,
        {
          siteId: input.siteId,
          authUserId: sessionUser.authUserId,
          email: sessionUser.email,
          invitationVersion: input.invitationVersion,
          invitationToken: input.invitationToken,
          now: finalNow,
        },
      );
      if (
        finalInvitation.id !== firstInvitation.id ||
        finalInvitation.roleId !== firstInvitation.roleId ||
        finalInvitation.invitationVersion !== firstInvitation.invitationVersion ||
        finalInvitation.invitationTokenHash !== firstInvitation.invitationTokenHash ||
        finalInvitation.expiresAt !== firstInvitation.expiresAt
      ) {
        throw new InitialPasswordRouteError(
          "employee_invitation_invalid_or_expired",
          410,
        );
      }

      const finalRoleResult = await Promise.resolve(
        dependencies.loadRole({
          siteId: input.siteId,
          roleId: finalInvitation.roleId,
        }),
      );
      if (finalRoleResult.error) {
        throw new InitialPasswordRouteError(
          "employee_initial_password_store_unavailable",
          503,
        );
      }
      normalizeActiveRole(finalRoleResult.data, {
        siteId: input.siteId,
        roleId: finalInvitation.roleId,
      });

      const setupClaimInput = {
        siteId: input.siteId,
        authUserId: sessionUser.authUserId,
        invitationVersion: input.invitationVersion,
        tokenHash: input.tokenHash,
        operationId: input.operationId,
        passwordFingerprint: initialPasswordFingerprint(
          input.invitationToken,
          input.newPassword,
        ),
      };
      const claimResult = await Promise.resolve(
        dependencies.claimInitialPasswordSetup(setupClaimInput),
      );
      if (claimResult.error) throwSetupStoreError(claimResult.error);
      const claim = normalizeSetupClaim(claimResult.data, setupClaimInput);
      const releaseClaim = async () => {
        const releasedResult = await Promise.resolve(
          dependencies.releaseInitialPasswordSetup(setupClaimInput),
        );
        if (releasedResult.error) throwSetupStoreError(releasedResult.error);
        const released = recordValue(releasedResult.data);
        if (released?.released !== true) {
          throw new InitialPasswordRouteError(
            "employee_initial_password_store_unavailable",
            503,
          );
        }
      };

      const currentAuthResult = await Promise.resolve(
        dependencies.getAuthUserById(sessionUser.authUserId),
      );
      if (currentAuthResult.error) {
        if (!claim.resumed) await releaseClaim();
        throw new InitialPasswordRouteError(
          "employee_initial_password_auth_unavailable",
          503,
        );
      }
      const currentAuthUser = normalizeExactStaffUser(currentAuthResult.user, {
        authUserId: sessionUser.authUserId,
        email: sessionUser.email,
        emailHash: sessionUser.emailHash,
      });
      const passwordState =
        currentAuthUser.appMetadata[
          MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY
        ];

      if (claim.state === "completed") {
        if (passwordState !== true) {
          throw new InitialPasswordRouteError(
            "employee_initial_password_setup_failed",
            503,
          );
        }
        return jsonResponse({ ok: true }, 200);
      }

      if (passwordState !== false) {
        if (claim.resumed && passwordState === true) {
          const completedResult = await Promise.resolve(
            dependencies.completeInitialPasswordSetup(setupClaimInput),
          );
          if (completedResult.error) throwSetupStoreError(completedResult.error);
          const completed = normalizeSetupClaim(
            completedResult.data,
            setupClaimInput,
          );
          if (completed.state !== "completed") {
            throw new InitialPasswordRouteError(
              "employee_initial_password_store_unavailable",
              503,
            );
          }
          return jsonResponse({ ok: true }, 200);
        }

        if (!claim.resumed) {
          await releaseClaim();
        }
        requireKnownUninitializedPasswordState(currentAuthUser.appMetadata);
      }

      const updatedResult = await Promise.resolve(
        dependencies.updateAuthUserById(sessionUser.authUserId, {
          password: input.newPassword,
          app_metadata: {
            ...currentAuthUser.appMetadata,
            [MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY]: true,
          },
        }),
      );
      if (updatedResult.error) {
        const definitiveRejection = isDefinitiveAuthMutationRejection(
          updatedResult.error,
        );
        if (definitiveRejection) await releaseClaim();
        if (isAuthRateLimitError(updatedResult.error)) {
          throw new InitialPasswordRouteError("auth_rate_limited", 429);
        }
        throw new InitialPasswordRouteError(
          definitiveRejection
            ? "invalid_employee_password"
            : "employee_initial_password_setup_failed",
          definitiveRejection ? 400 : 503,
        );
      }
      const updatedUser = normalizeExactStaffUser(updatedResult.user, {
        authUserId: sessionUser.authUserId,
        email: sessionUser.email,
        emailHash: sessionUser.emailHash,
      });
      if (
        updatedUser.appMetadata[
          MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY
        ] !== true
      ) {
        throw new InitialPasswordRouteError(
          "employee_initial_password_setup_failed",
          503,
        );
      }

      const completedResult = await Promise.resolve(
        dependencies.completeInitialPasswordSetup(setupClaimInput),
      );
      if (completedResult.error) throwSetupStoreError(completedResult.error);
      const completed = normalizeSetupClaim(
        completedResult.data,
        setupClaimInput,
      );
      if (completed.state !== "completed") {
        throw new InitialPasswordRouteError(
          "employee_initial_password_store_unavailable",
          503,
        );
      }

      return jsonResponse({ ok: true }, 200);
    } catch (error) {
      return fail(error);
    }
  };
}

export async function POST(request: Request) {
  return createMerchantEnterpriseInitialPasswordHandler(
    createDefaultDependencies(),
  )(request);
}
