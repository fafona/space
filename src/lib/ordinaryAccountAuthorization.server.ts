const RESOLVER_RPC = "faolla_resolve_ordinary_account_authorization_v1";
const READINESS_RPC =
  "faolla_get_ordinary_account_authorization_readiness_v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MERCHANT_ID_PATTERN = /^\d{8}$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type OrdinaryAccountAuthorizationStoreClient = {
  // Supabase RPC results remain untrusted until the strict normalizers below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (functionName: string, args?: Record<string, unknown>) => any;
};

export type OrdinaryAccountAuthorization =
  | {
      schemaVersion: 1;
      status: "resolved";
      accountType: "merchant";
      merchantIds: string[];
      personalAccountId: null;
    }
  | {
      schemaVersion: 1;
      status: "resolved";
      accountType: "personal";
      merchantIds: [];
      personalAccountId: string;
    }
  | {
      schemaVersion: 1;
      status: "disabled";
      accountType: "personal";
      merchantIds: [];
      personalAccountId: string;
    }
  | {
      schemaVersion: 1;
      status: "unbound";
      accountType: null;
      merchantIds: [];
      personalAccountId: null;
    };

export type OrdinaryAccountAuthorizationReadiness = {
  schemaVersion: 1;
  asOf: string;
  readyForCutover: boolean;
  merchant: {
    recordCount: number;
    consistentBindingCount: number;
    multiMerchantAuthUserCount: number;
    aliasConflictCount: number;
    emailOnlyCount: number;
    unboundCount: number;
    orphanBindingCount: number;
    invalidMerchantIdCount: number;
    metadataWithoutPositiveBindingAuthUserCount: number;
    emailWithoutPositiveBindingAuthUserCount: number;
    legacyWithoutPositiveBindingAuthUserCount: number;
  };
  personal: {
    canonicalBindingCount: number;
    canonicalActiveBindingCount: number;
    canonicalDisabledBindingCount: number;
    canonicalOrphanCount: number;
    metadataPrincipalCount: number;
    metadataWithoutCanonicalBindingCount: number;
    canonicalWithoutMetadataCount: number;
    duplicateMetadataIdGroupCount: number;
    metadataDivergenceCount: number;
    metadataTypeConflictCount: number;
    metadataMissingIdCount: number;
    unsafeMetadataIdCount: number;
  };
  security: {
    crossAccountTypeOverlapCount: number;
    accountIdentifierCollisionCount: number;
    staffRegistryOverlapCount: number;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorText(error: unknown) {
  const source = record(error);
  return [source?.code, source?.message, source?.details]
    .filter((value): value is string => typeof value === "string")
    .join(":")
    .slice(0, 2000)
    .toLowerCase();
}

function hasExactKeys(source: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(source).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function invalidResponse(): never {
  throw new Error("ordinary_account_authorization_invalid_response");
}

function exactRecord(value: unknown, keys: string[]) {
  const source = record(value);
  if (!source || !hasExactKeys(source, keys)) invalidResponse();
  return source;
}

function normalizeNonnegativeInteger(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    invalidResponse();
  }
  return value;
}

function normalizePersonalAccountId(value: unknown) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    Array.from(value).length < 1 ||
    Array.from(value).length > 128 ||
    new TextEncoder().encode(value).byteLength > 512 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    invalidResponse();
  }
  return value;
}

function normalizeMerchantIds(value: unknown) {
  if (!Array.isArray(value)) invalidResponse();
  const merchantIds = value.map((merchantId) => {
    if (
      typeof merchantId !== "string" ||
      !MERCHANT_ID_PATTERN.test(merchantId)
    ) {
      invalidResponse();
    }
    return merchantId;
  });
  const sorted = [...merchantIds].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    merchantIds.some((merchantId, index) => merchantId !== sorted[index]) ||
    new Set(merchantIds).size !== merchantIds.length
  ) {
    invalidResponse();
  }
  return merchantIds;
}

export function normalizeOrdinaryAccountAuthorization(
  value: unknown,
): OrdinaryAccountAuthorization {
  const source = exactRecord(value, [
    "schemaVersion",
    "status",
    "accountType",
    "merchantIds",
    "personalAccountId",
  ]);
  if (source.schemaVersion !== 1) invalidResponse();
  const merchantIds = normalizeMerchantIds(source.merchantIds);

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
    merchantIds.length === 0
  ) {
    return {
      schemaVersion: 1,
      status: source.status,
      accountType: "personal",
      merchantIds: [],
      personalAccountId: normalizePersonalAccountId(
        source.personalAccountId,
      ),
    };
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

  invalidResponse();
}

function normalizeMerchantReadiness(value: unknown) {
  const source = exactRecord(value, [
    "recordCount",
    "consistentBindingCount",
    "multiMerchantAuthUserCount",
    "aliasConflictCount",
    "emailOnlyCount",
    "unboundCount",
    "orphanBindingCount",
    "invalidMerchantIdCount",
    "metadataWithoutPositiveBindingAuthUserCount",
    "emailWithoutPositiveBindingAuthUserCount",
    "legacyWithoutPositiveBindingAuthUserCount",
  ]);
  return {
    recordCount: normalizeNonnegativeInteger(source.recordCount),
    consistentBindingCount: normalizeNonnegativeInteger(
      source.consistentBindingCount,
    ),
    multiMerchantAuthUserCount: normalizeNonnegativeInteger(
      source.multiMerchantAuthUserCount,
    ),
    aliasConflictCount: normalizeNonnegativeInteger(
      source.aliasConflictCount,
    ),
    emailOnlyCount: normalizeNonnegativeInteger(source.emailOnlyCount),
    unboundCount: normalizeNonnegativeInteger(source.unboundCount),
    orphanBindingCount: normalizeNonnegativeInteger(
      source.orphanBindingCount,
    ),
    invalidMerchantIdCount: normalizeNonnegativeInteger(
      source.invalidMerchantIdCount,
    ),
    metadataWithoutPositiveBindingAuthUserCount:
      normalizeNonnegativeInteger(
        source.metadataWithoutPositiveBindingAuthUserCount,
      ),
    emailWithoutPositiveBindingAuthUserCount: normalizeNonnegativeInteger(
      source.emailWithoutPositiveBindingAuthUserCount,
    ),
    legacyWithoutPositiveBindingAuthUserCount: normalizeNonnegativeInteger(
      source.legacyWithoutPositiveBindingAuthUserCount,
    ),
  };
}

function normalizePersonalReadiness(value: unknown) {
  const source = exactRecord(value, [
    "canonicalBindingCount",
    "canonicalActiveBindingCount",
    "canonicalDisabledBindingCount",
    "canonicalOrphanCount",
    "metadataPrincipalCount",
    "metadataWithoutCanonicalBindingCount",
    "canonicalWithoutMetadataCount",
    "duplicateMetadataIdGroupCount",
    "metadataDivergenceCount",
    "metadataTypeConflictCount",
    "metadataMissingIdCount",
    "unsafeMetadataIdCount",
  ]);
  return {
    canonicalBindingCount: normalizeNonnegativeInteger(
      source.canonicalBindingCount,
    ),
    canonicalActiveBindingCount: normalizeNonnegativeInteger(
      source.canonicalActiveBindingCount,
    ),
    canonicalDisabledBindingCount: normalizeNonnegativeInteger(
      source.canonicalDisabledBindingCount,
    ),
    canonicalOrphanCount: normalizeNonnegativeInteger(
      source.canonicalOrphanCount,
    ),
    metadataPrincipalCount: normalizeNonnegativeInteger(
      source.metadataPrincipalCount,
    ),
    metadataWithoutCanonicalBindingCount: normalizeNonnegativeInteger(
      source.metadataWithoutCanonicalBindingCount,
    ),
    canonicalWithoutMetadataCount: normalizeNonnegativeInteger(
      source.canonicalWithoutMetadataCount,
    ),
    duplicateMetadataIdGroupCount: normalizeNonnegativeInteger(
      source.duplicateMetadataIdGroupCount,
    ),
    metadataDivergenceCount: normalizeNonnegativeInteger(
      source.metadataDivergenceCount,
    ),
    metadataTypeConflictCount: normalizeNonnegativeInteger(
      source.metadataTypeConflictCount,
    ),
    metadataMissingIdCount: normalizeNonnegativeInteger(
      source.metadataMissingIdCount,
    ),
    unsafeMetadataIdCount: normalizeNonnegativeInteger(
      source.unsafeMetadataIdCount,
    ),
  };
}

function normalizeSecurityReadiness(value: unknown) {
  const source = exactRecord(value, [
    "crossAccountTypeOverlapCount",
    "accountIdentifierCollisionCount",
    "staffRegistryOverlapCount",
  ]);
  return {
    crossAccountTypeOverlapCount: normalizeNonnegativeInteger(
      source.crossAccountTypeOverlapCount,
    ),
    accountIdentifierCollisionCount: normalizeNonnegativeInteger(
      source.accountIdentifierCollisionCount,
    ),
    staffRegistryOverlapCount: normalizeNonnegativeInteger(
      source.staffRegistryOverlapCount,
    ),
  };
}

export function normalizeOrdinaryAccountAuthorizationReadiness(
  value: unknown,
): OrdinaryAccountAuthorizationReadiness {
  const source = exactRecord(value, [
    "schemaVersion",
    "asOf",
    "readyForCutover",
    "merchant",
    "personal",
    "security",
  ]);
  if (
    source.schemaVersion !== 1 ||
    typeof source.asOf !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(source.asOf) ||
    Number.isNaN(Date.parse(source.asOf)) ||
    typeof source.readyForCutover !== "boolean"
  ) {
    invalidResponse();
  }
  const merchant = normalizeMerchantReadiness(source.merchant);
  const personal = normalizePersonalReadiness(source.personal);
  const security = normalizeSecurityReadiness(source.security);
  if (
    merchant.consistentBindingCount > merchant.recordCount ||
    merchant.multiMerchantAuthUserCount > merchant.consistentBindingCount ||
    merchant.aliasConflictCount > merchant.recordCount ||
    merchant.emailOnlyCount > merchant.recordCount ||
    merchant.unboundCount > merchant.recordCount ||
    merchant.orphanBindingCount > merchant.recordCount ||
    merchant.invalidMerchantIdCount > merchant.recordCount ||
    merchant.metadataWithoutPositiveBindingAuthUserCount >
      merchant.legacyWithoutPositiveBindingAuthUserCount ||
    merchant.emailWithoutPositiveBindingAuthUserCount >
      merchant.legacyWithoutPositiveBindingAuthUserCount ||
    merchant.legacyWithoutPositiveBindingAuthUserCount >
      merchant.metadataWithoutPositiveBindingAuthUserCount +
        merchant.emailWithoutPositiveBindingAuthUserCount ||
    personal.canonicalActiveBindingCount +
        personal.canonicalDisabledBindingCount !==
      personal.canonicalBindingCount ||
    personal.canonicalOrphanCount > personal.canonicalBindingCount ||
    personal.canonicalWithoutMetadataCount > personal.canonicalBindingCount ||
    personal.metadataWithoutCanonicalBindingCount >
      personal.metadataPrincipalCount ||
    personal.duplicateMetadataIdGroupCount >
      personal.metadataPrincipalCount ||
    personal.metadataTypeConflictCount >
      personal.metadataDivergenceCount ||
    personal.metadataDivergenceCount >
      personal.metadataPrincipalCount + personal.metadataTypeConflictCount ||
    personal.metadataMissingIdCount > personal.metadataPrincipalCount ||
    personal.unsafeMetadataIdCount > personal.metadataPrincipalCount ||
    security.accountIdentifierCollisionCount >
      personal.canonicalBindingCount
  ) {
    invalidResponse();
  }
  const expectedReadyForCutover = [
    merchant.aliasConflictCount,
    merchant.emailOnlyCount,
    merchant.unboundCount,
    merchant.orphanBindingCount,
    merchant.invalidMerchantIdCount,
    merchant.metadataWithoutPositiveBindingAuthUserCount,
    merchant.emailWithoutPositiveBindingAuthUserCount,
    merchant.legacyWithoutPositiveBindingAuthUserCount,
    personal.canonicalOrphanCount,
    personal.metadataWithoutCanonicalBindingCount,
    personal.duplicateMetadataIdGroupCount,
    personal.metadataDivergenceCount,
    personal.metadataTypeConflictCount,
    personal.metadataMissingIdCount,
    personal.unsafeMetadataIdCount,
    security.crossAccountTypeOverlapCount,
    security.accountIdentifierCollisionCount,
    security.staffRegistryOverlapCount,
  ].every((count) => count === 0);
  if (source.readyForCutover !== expectedReadyForCutover) {
    invalidResponse();
  }
  return {
    schemaVersion: 1,
    asOf: source.asOf,
    readyForCutover: source.readyForCutover,
    merchant,
    personal,
    security,
  };
}

function normalizeAuthUserId(value: unknown) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !UUID_PATTERN.test(value)
  ) {
    throw new Error("invalid_ordinary_account_authorization_query");
  }
  return value.toLowerCase();
}

function throwStoreError(error: unknown): never {
  const message = errorText(error);
  if (
    (message.includes("42883") || message.includes("pgrst202")) &&
    (message.includes(RESOLVER_RPC) || message.includes(READINESS_RPC))
  ) {
    throw new Error("ordinary_account_authorization_schema_unavailable");
  }
  const knownCode = [
    "invalid_ordinary_account_authorization_query",
    "ordinary_account_auth_user_not_found",
    "ordinary_account_staff_identity_forbidden",
    "ordinary_account_merchant_binding_conflict",
    "ordinary_account_principal_type_conflict",
  ].find((code) => message.includes(code));
  if (knownCode) throw new Error(knownCode);
  throw new Error("ordinary_account_authorization_read_failed");
}

async function readRpcEnvelope(
  task: PromiseLike<unknown>,
  normalizer: (value: unknown) => unknown,
) {
  let result: unknown;
  try {
    result = await task;
  } catch (error) {
    throwStoreError(error);
  }
  const envelope = record(result);
  if (!envelope || !("data" in envelope) || !("error" in envelope)) {
    invalidResponse();
  }
  if (envelope.error) throwStoreError(envelope.error);
  return normalizer(envelope.data);
}

export async function loadOrdinaryAccountAuthorization(
  client: OrdinaryAccountAuthorizationStoreClient,
  authUserId: string,
): Promise<OrdinaryAccountAuthorization> {
  const normalizedAuthUserId = normalizeAuthUserId(authUserId);
  return (await readRpcEnvelope(
    Promise.resolve().then(() =>
      client.rpc(RESOLVER_RPC, {
        p_auth_user_id: normalizedAuthUserId,
      }),
    ),
    normalizeOrdinaryAccountAuthorization,
  )) as OrdinaryAccountAuthorization;
}

export async function loadOrdinaryAccountAuthorizationReadiness(
  client: OrdinaryAccountAuthorizationStoreClient,
): Promise<OrdinaryAccountAuthorizationReadiness> {
  return (await readRpcEnvelope(
    Promise.resolve().then(() => client.rpc(READINESS_RPC, {})),
    normalizeOrdinaryAccountAuthorizationReadiness,
  )) as OrdinaryAccountAuthorizationReadiness;
}
