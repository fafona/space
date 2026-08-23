import type { MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import { hasMerchantStaffPrincipalDenyHint } from "@/lib/merchantStaffPrincipal.server";
import { normalizeCanonicalPersonalAccountId } from "@/lib/personalAccountId";
import {
  loadOrdinaryAccountAuthorization,
  type OrdinaryAccountAuthorization,
  type OrdinaryAccountAuthorizationStoreClient,
} from "@/lib/ordinaryAccountAuthorization.server";

const BOOTSTRAP_RPC =
  "faolla_bootstrap_ordinary_account_authorization_v1";
const CREATE_RPC = "faolla_create_ordinary_account_authorization_v1";

export type ActiveOrdinaryAccountAuthorization = Extract<
  OrdinaryAccountAuthorization,
  { status: "resolved" }
>;

export type OrdinaryAccountPlatformIdentity =
  | {
      accountType: "merchant";
      accountId: string;
      merchantId: string;
      merchantIds: string[];
    }
  | {
      accountType: "personal";
      accountId: string;
      merchantId: null;
      merchantIds: [];
    };

export class OrdinaryAccountPrincipalError extends Error {
  readonly code:
    | "ordinary_account_principal_unavailable"
    | "ordinary_account_principal_unbound"
    | "ordinary_account_personal_disabled"
    | "ordinary_account_binding_conflict"
    | "ordinary_account_personal_binding_conflict"
    | "ordinary_account_principal_type_conflict"
    | "ordinary_account_system_site_forbidden"
    | "invalid_ordinary_personal_id"
    | "ordinary_account_merchant_selection_forbidden"
    | "merchant_staff_identity_forbidden";
  readonly status: 403 | 409 | 503;

  constructor(
    code:
      | "ordinary_account_principal_unavailable"
      | "ordinary_account_principal_unbound"
      | "ordinary_account_personal_disabled"
      | "ordinary_account_binding_conflict"
      | "ordinary_account_personal_binding_conflict"
      | "ordinary_account_principal_type_conflict"
      | "ordinary_account_system_site_forbidden"
      | "invalid_ordinary_personal_id"
      | "ordinary_account_merchant_selection_forbidden"
      | "merchant_staff_identity_forbidden",
    status: 403 | 409 | 503,
  ) {
    super(code);
    this.name = "OrdinaryAccountPrincipalError";
    this.code = code;
    this.status = status;
  }
}

function normalizeAuthUserId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMerchantId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

export function normalizeExplicitOrdinaryAccountId(
  accountType: "merchant" | "personal",
  value: unknown,
) {
  if (typeof value !== "string" || value !== value.trim()) return "";
  if (accountType === "merchant") return normalizeMerchantId(value);
  return normalizeCanonicalPersonalAccountId(value);
}

function isRpcEnvelope(value: unknown): value is {
  data: unknown;
  error: unknown;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "data" in value &&
      "error" in value,
  );
}

async function runIdempotentServiceMutationAck(
  client: OrdinaryAccountAuthorizationStoreClient,
  functionName: string,
  args: Record<string, unknown>,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result: unknown;
    try {
      result = await client.rpc(functionName, args);
    } catch {
      if (attempt === 0) continue;
      break;
    }
    if (isRpcEnvelope(result) && !result.error) return;
    lastError = isRpcEnvelope(result) ? result.error : null;
    const errorText = readServiceMutationErrorText(lastError);
    if (
      errorText.includes("ordinary_account_personal_disabled") ||
      errorText.includes("ordinary_account_staff_identity_forbidden") ||
      errorText.includes("merchant_enterprise_staff_identity_conflict") ||
      errorText.includes("ordinary_account_binding_conflict") ||
      errorText.includes("ordinary_account_personal_binding_conflict") ||
      errorText.includes("ordinary_account_principal_type_conflict") ||
      errorText.includes("ordinary_account_system_site_forbidden") ||
      errorText.includes("invalid_ordinary_personal_id")
    ) {
      break;
    }
    if (attempt === 0) continue;
  }
  const errorText = readServiceMutationErrorText(lastError);
  if (errorText.includes("ordinary_account_personal_disabled")) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_personal_disabled",
      403,
    );
  }
  if (
    errorText.includes("ordinary_account_staff_identity_forbidden") ||
    errorText.includes("merchant_enterprise_staff_identity_conflict")
  ) {
    throw new OrdinaryAccountPrincipalError(
      "merchant_staff_identity_forbidden",
      403,
    );
  }
  if (errorText.includes("ordinary_account_binding_conflict")) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_binding_conflict",
      409,
    );
  }
  if (errorText.includes("ordinary_account_personal_binding_conflict")) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_personal_binding_conflict",
      409,
    );
  }
  if (errorText.includes("ordinary_account_principal_type_conflict")) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_principal_type_conflict",
      409,
    );
  }
  if (errorText.includes("ordinary_account_system_site_forbidden")) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_system_site_forbidden",
      403,
    );
  }
  if (errorText.includes("invalid_ordinary_personal_id")) {
    throw new OrdinaryAccountPrincipalError(
      "invalid_ordinary_personal_id",
      409,
    );
  }
  throw new OrdinaryAccountPrincipalError(
    "ordinary_account_principal_unavailable",
    503,
  );
}

function readServiceMutationErrorText(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const source = error as Record<string, unknown>;
  return [source.code, source.message, source.details]
    .filter((value): value is string => typeof value === "string")
    .join(":")
    .slice(0, 2000)
    .toLowerCase();
}

export function isOrdinaryAccountPrincipalError(
  error: unknown,
): error is OrdinaryAccountPrincipalError {
  return error instanceof OrdinaryAccountPrincipalError;
}

export async function loadActiveOrdinaryAccountAuthorization(
  client: OrdinaryAccountAuthorizationStoreClient | null,
  user: MerchantAuthUserSummary | null | undefined,
): Promise<ActiveOrdinaryAccountAuthorization> {
  if (hasMerchantStaffPrincipalDenyHint(user)) {
    throw new OrdinaryAccountPrincipalError(
      "merchant_staff_identity_forbidden",
      403,
    );
  }
  const authUserId = normalizeAuthUserId(user?.id);
  if (!client || !authUserId) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_principal_unavailable",
      503,
    );
  }

  let authorization: OrdinaryAccountAuthorization;
  try {
    authorization = await loadOrdinaryAccountAuthorization(
      client,
      authUserId,
    );
  } catch (error) {
    if (
      isOrdinaryAccountPrincipalError(error) &&
      error.code !== "ordinary_account_principal_unavailable"
    ) {
      throw error;
    }
    if (
      error instanceof Error &&
      (error.message === "ordinary_account_staff_identity_forbidden" ||
        error.message === "merchant_enterprise_staff_identity_conflict")
    ) {
      throw new OrdinaryAccountPrincipalError(
        "merchant_staff_identity_forbidden",
        403,
      );
    }
    if (
      error instanceof Error &&
      error.message === "ordinary_account_merchant_binding_conflict"
    ) {
      throw new OrdinaryAccountPrincipalError(
        "ordinary_account_binding_conflict",
        409,
      );
    }
    if (
      error instanceof Error &&
      error.message === "ordinary_account_personal_binding_conflict"
    ) {
      throw new OrdinaryAccountPrincipalError(
        "ordinary_account_personal_binding_conflict",
        409,
      );
    }
    if (
      error instanceof Error &&
      error.message === "ordinary_account_principal_type_conflict"
    ) {
      throw new OrdinaryAccountPrincipalError(
        "ordinary_account_principal_type_conflict",
        409,
      );
    }
    if (
      error instanceof Error &&
      error.message === "ordinary_account_system_site_forbidden"
    ) {
      throw new OrdinaryAccountPrincipalError(
        "ordinary_account_system_site_forbidden",
        403,
      );
    }
    if (
      error instanceof Error &&
      error.message === "invalid_ordinary_personal_id"
    ) {
      throw new OrdinaryAccountPrincipalError(
        "invalid_ordinary_personal_id",
        409,
      );
    }
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_principal_unavailable",
      503,
    );
  }
  if (authorization.status === "resolved") return authorization;
  if (authorization.status === "disabled") {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_personal_disabled",
      403,
    );
  }
  throw new OrdinaryAccountPrincipalError(
    "ordinary_account_principal_unbound",
    403,
  );
}

export async function bootstrapActiveOrdinaryAccountAuthorization(
  client: OrdinaryAccountAuthorizationStoreClient | null,
  user: MerchantAuthUserSummary | null | undefined,
  accountType: "merchant" | "personal",
) {
  if (hasMerchantStaffPrincipalDenyHint(user)) {
    throw new OrdinaryAccountPrincipalError(
      "merchant_staff_identity_forbidden",
      403,
    );
  }
  const authUserId = normalizeAuthUserId(user?.id);
  if (!client || !authUserId) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_principal_unavailable",
      503,
    );
  }

  try {
    await runIdempotentServiceMutationAck(client, BOOTSTRAP_RPC, {
        p_auth_user_id: authUserId,
        p_account_type: accountType,
    });
  } catch (error) {
    if (
      isOrdinaryAccountPrincipalError(error) &&
      error.code !== "ordinary_account_principal_unavailable"
    ) {
      throw error;
    }
    // Both acknowledgement responses may be lost after a successful commit.
    // A fresh resolver read is the only safe way to distinguish that case.
    try {
      const committed = await loadActiveOrdinaryAccountAuthorization(client, user);
      if (committed.accountType === accountType) return committed;
    } catch {
      // Preserve the original deterministic/unavailable mutation result.
    }
    throw error;
  }

  // Treat the bootstrap result as an acknowledgement only. A separate read
  // through the 035 resolver is the sole authorization result returned to the
  // application.
  const authorization = await loadActiveOrdinaryAccountAuthorization(
    client,
    user,
  );
  if (authorization.accountType !== accountType) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_principal_unavailable",
      503,
    );
  }
  return authorization;
}

export async function createActiveOrdinaryAccountAuthorization(
  client: OrdinaryAccountAuthorizationStoreClient | null,
  user: MerchantAuthUserSummary | null | undefined,
  accountType: "merchant" | "personal",
  accountId: string,
) {
  if (hasMerchantStaffPrincipalDenyHint(user)) {
    throw new OrdinaryAccountPrincipalError(
      "merchant_staff_identity_forbidden",
      403,
    );
  }
  const authUserId = normalizeAuthUserId(user?.id);
  const normalizedAccountId = normalizeExplicitOrdinaryAccountId(
    accountType,
    accountId,
  );
  if (!client || !authUserId || !normalizedAccountId) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_principal_unavailable",
      503,
    );
  }

  try {
    await runIdempotentServiceMutationAck(client, CREATE_RPC, {
      p_auth_user_id: authUserId,
      p_account_type: accountType,
      p_account_id: normalizedAccountId,
    });
  } catch (error) {
    if (
      isOrdinaryAccountPrincipalError(error) &&
      error.code !== "ordinary_account_principal_unavailable"
    ) {
      throw error;
    }
    try {
      const committed = await loadActiveOrdinaryAccountAuthorization(client, user);
      const matches =
        committed.accountType === accountType &&
        (committed.accountType === "merchant"
          ? committed.merchantIds.includes(normalizedAccountId)
          : committed.personalAccountId === normalizedAccountId);
      if (matches) return committed;
    } catch {
      // Preserve the original mutation result when commit state is unknown.
    }
    throw error;
  }

  // The create response is only an acknowledgement. The 035 resolver must
  // independently confirm the exact explicit binding before the app uses it.
  const authorization = await loadActiveOrdinaryAccountAuthorization(
    client,
    user,
  );
  const matchesRequestedBinding =
    authorization.accountType === accountType &&
    (authorization.accountType === "merchant"
      ? authorization.merchantIds.includes(normalizedAccountId)
      : authorization.personalAccountId === normalizedAccountId);
  if (!matchesRequestedBinding) {
    throw new OrdinaryAccountPrincipalError(
      "ordinary_account_principal_unavailable",
      503,
    );
  }
  return authorization;
}

export function selectAuthorizedMerchantId(
  authorization: Extract<
    ActiveOrdinaryAccountAuthorization,
    { accountType: "merchant" }
  >,
  ...hints: unknown[]
) {
  for (const hint of hints.flat(Infinity)) {
    const merchantId = normalizeMerchantId(hint);
    if (merchantId && authorization.merchantIds.includes(merchantId)) {
      return merchantId;
    }
  }
  return authorization.merchantIds[0];
}

export function buildOrdinaryAccountPlatformIdentity(
  authorization: ActiveOrdinaryAccountAuthorization,
  options: {
    preferredAccountId?: string | null;
    preferredMerchantId?: string | null;
    preferredMerchantIds?: string[] | null;
    strictPreferredMerchantId?: boolean;
  } = {},
): OrdinaryAccountPlatformIdentity {
  if (authorization.accountType === "personal") {
    if (
      options.strictPreferredMerchantId &&
      typeof options.preferredMerchantId === "string" &&
      options.preferredMerchantId.trim()
    ) {
      throw new OrdinaryAccountPrincipalError(
        "ordinary_account_merchant_selection_forbidden",
        403,
      );
    }
    return {
      accountType: "personal",
      accountId: authorization.personalAccountId,
      merchantId: null,
      merchantIds: [],
    };
  }

  if (options.strictPreferredMerchantId) {
    const requestedMerchantId = normalizeMerchantId(
      options.preferredMerchantId,
    );
    if (
      !requestedMerchantId ||
      !authorization.merchantIds.includes(requestedMerchantId)
    ) {
      throw new OrdinaryAccountPrincipalError(
        "ordinary_account_merchant_selection_forbidden",
        403,
      );
    }
  }

  const merchantId = selectAuthorizedMerchantId(
    authorization,
    options.preferredMerchantId,
    options.preferredAccountId,
    options.preferredMerchantIds ?? [],
  );
  return {
    accountType: "merchant",
    accountId: merchantId,
    merchantId,
    merchantIds: [...authorization.merchantIds],
  };
}

export async function resolveOrdinaryAccountPlatformIdentity(
  client: OrdinaryAccountAuthorizationStoreClient | null,
  user: MerchantAuthUserSummary | null | undefined,
  options: {
    preferredAccountId?: string | null;
    preferredMerchantId?: string | null;
    preferredMerchantIds?: string[] | null;
    strictPreferredMerchantId?: boolean;
  } = {},
): Promise<OrdinaryAccountPlatformIdentity> {
  const authorization = await loadActiveOrdinaryAccountAuthorization(
    client,
    user,
  );
  return buildOrdinaryAccountPlatformIdentity(authorization, options);
}
