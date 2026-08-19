import assert from "node:assert/strict";
import test from "node:test";
import {
  loadOrdinaryAccountAuthorization,
  loadOrdinaryAccountAuthoritativeCutoverReadiness,
  loadOrdinaryAccountAuthorizationReadiness,
  normalizeOrdinaryAccountAuthorization,
  normalizeOrdinaryAccountAuthoritativeCutoverReadiness,
  normalizeOrdinaryAccountAuthorizationReadiness,
  type OrdinaryAccountAuthorizationStoreClient,
} from "@/lib/ordinaryAccountAuthorization.server";

const AUTH_USER_ID = "a1000000-0000-4000-8000-000000000001";

function client(
  handler: (
    functionName: string,
    args: Record<string, unknown> | undefined,
  ) => unknown,
): OrdinaryAccountAuthorizationStoreClient {
  return {
    async rpc(functionName, args) {
      return handler(functionName, args);
    },
  };
}

function merchantPayload() {
  return {
    schemaVersion: 1,
    status: "resolved",
    accountType: "merchant",
    merchantIds: ["10000001", "10000002"],
    personalAccountId: null,
  };
}

function readinessPayload() {
  return {
    schemaVersion: 1,
    asOf: "2026-08-19T12:34:56.789Z",
    readyForCutover: false,
    merchant: {
      recordCount: 11,
      consistentBindingCount: 9,
      multiMerchantAuthUserCount: 1,
      aliasConflictCount: 1,
      emailOnlyCount: 1,
      unboundCount: 0,
      orphanBindingCount: 0,
      invalidMerchantIdCount: 0,
      metadataWithoutPositiveBindingAuthUserCount: 1,
      emailWithoutPositiveBindingAuthUserCount: 1,
      legacyWithoutPositiveBindingAuthUserCount: 2,
    },
    personal: {
      canonicalBindingCount: 0,
      canonicalActiveBindingCount: 0,
      canonicalDisabledBindingCount: 0,
      canonicalOrphanCount: 0,
      metadataPrincipalCount: 1,
      metadataWithoutCanonicalBindingCount: 1,
      canonicalWithoutMetadataCount: 0,
      duplicateMetadataIdGroupCount: 0,
      metadataDivergenceCount: 0,
      metadataTypeConflictCount: 0,
      metadataMissingIdCount: 0,
      unsafeMetadataIdCount: 0,
    },
    security: {
      crossAccountTypeOverlapCount: 0,
      accountIdentifierCollisionCount: 0,
      staffRegistryOverlapCount: 0,
    },
  };
}

function authoritativeCutoverReadinessPayload() {
  return {
    schemaVersion: 1,
    asOf: "2026-08-19T12:34:56.789Z",
    readyForCutover: true,
    merchant: {
      recordCount: 11,
      authoritativeBindingCount: 11,
      invalidBindingCount: 0,
    },
    personal: {
      canonicalBindingCount: 7,
      canonicalOrphanCount: 0,
      invalidCanonicalCount: 0,
      duplicateAuthUserCount: 0,
      duplicatePersonalAccountIdCount: 0,
    },
    security: {
      crossAccountTypeOverlapCount: 0,
      accountIdentifierCollisionCount: 0,
      staffRegistryOverlapCount: 0,
      systemSitePrincipalOverlapCount: 0,
    },
    invariants: {
      schemaReady: true,
      aclReady: true,
    },
  };
}

test("resolver loader uses only the Auth UUID and preserves all sorted merchant bindings", async () => {
  const calls: Array<{
    functionName: string;
    args: Record<string, unknown> | undefined;
  }> = [];
  const rpcClient = client((functionName, args) => {
    calls.push({ functionName, args });
    return {
      data: merchantPayload(),
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
    };
  });

  const first = await loadOrdinaryAccountAuthorization(
    rpcClient,
    AUTH_USER_ID.toUpperCase(),
  );
  const second = await loadOrdinaryAccountAuthorization(
    rpcClient,
    AUTH_USER_ID,
  );

  assert.deepEqual(first, merchantPayload());
  assert.deepEqual(second, merchantPayload());
  assert.deepEqual(calls, [
    {
      functionName: "faolla_resolve_ordinary_account_authorization_v1",
      args: { p_auth_user_id: AUTH_USER_ID },
    },
    {
      functionName: "faolla_resolve_ordinary_account_authorization_v1",
      args: { p_auth_user_id: AUTH_USER_ID },
    },
  ]);
});

test("normalizer accepts only the reserved personal numeric range and an unbound result", () => {
  assert.deepEqual(
    normalizeOrdinaryAccountAuthorization({
      schemaVersion: 1,
      status: "disabled",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010106",
    }),
    {
      schemaVersion: 1,
      status: "disabled",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010106",
    },
  );
  assert.deepEqual(
    normalizeOrdinaryAccountAuthorization({
      schemaVersion: 1,
      status: "resolved",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010105",
    }),
    {
      schemaVersion: 1,
      status: "resolved",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010105",
    },
  );
  assert.deepEqual(
    normalizeOrdinaryAccountAuthorization({
      schemaVersion: 1,
      status: "unbound",
      accountType: null,
      merchantIds: [],
      personalAccountId: null,
    }),
    {
      schemaVersion: 1,
      status: "unbound",
      accountType: null,
      merchantIds: [],
      personalAccountId: null,
    },
  );
});

test("authorization payload is exact and internally consistent", () => {
  const invalidPayloads = [
    { ...merchantPayload(), authUserId: AUTH_USER_ID },
    { ...merchantPayload(), merchantIds: ["10000002", "10000001"] },
    { ...merchantPayload(), merchantIds: ["10000001", "10000001"] },
    { ...merchantPayload(), merchantIds: ["merchant"] },
    { ...merchantPayload(), merchantIds: [] },
    {
      ...merchantPayload(),
      accountType: "personal",
      merchantIds: [],
      personalAccountId: null,
    },
    {
      ...merchantPayload(),
      accountType: "personal",
      merchantIds: [],
      personalAccountId: " leading-space",
    },
    {
      ...merchantPayload(),
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "\u00a0nonbreaking-edge",
    },
    {
      ...merchantPayload(),
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "byte-order-mark\ufeff",
    },
    {
      ...merchantPayload(),
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "unsafe\u0000id",
    },
    {
      ...merchantPayload(),
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "unsafe\u0085id",
    },
    {
      ...merchantPayload(),
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010104",
    },
    {
      ...merchantPayload(),
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "60000000",
    },
  ];

  invalidPayloads.forEach((payload) => {
    assert.throws(
      () => normalizeOrdinaryAccountAuthorization(payload),
      /ordinary_account_authorization_invalid_response/,
    );
  });
});

test("readiness loader calls the service-only aggregate RPC without identity input", async () => {
  const calls: Array<{
    functionName: string;
    args: Record<string, unknown> | undefined;
  }> = [];
  const result = await loadOrdinaryAccountAuthorizationReadiness(
    client((functionName, args) => {
      calls.push({ functionName, args });
      return { data: readinessPayload(), error: null };
    }),
  );

  assert.deepEqual(result, readinessPayload());
  assert.deepEqual(calls, [
    {
      functionName:
        "faolla_get_ordinary_account_authorization_readiness_v1",
      args: {},
    },
  ]);
});

test("readiness normalizer rejects PII fields, malformed counts, and non-UTC timestamps", () => {
  assert.throws(
    () =>
      normalizeOrdinaryAccountAuthorizationReadiness({
        ...readinessPayload(),
        authUserId: AUTH_USER_ID,
      }),
    /ordinary_account_authorization_invalid_response/,
  );
  assert.throws(
    () =>
      normalizeOrdinaryAccountAuthorizationReadiness({
        ...readinessPayload(),
        merchant: {
          ...readinessPayload().merchant,
          legacyWithoutPositiveBindingAuthUserCount: 0,
        },
      }),
    /ordinary_account_authorization_invalid_response/,
  );
  assert.throws(
    () =>
      normalizeOrdinaryAccountAuthorizationReadiness({
        ...readinessPayload(),
        personal: {
          ...readinessPayload().personal,
          metadataDivergenceCount: 0,
          metadataTypeConflictCount: 1,
        },
      }),
    /ordinary_account_authorization_invalid_response/,
  );
  assert.throws(
    () =>
      normalizeOrdinaryAccountAuthorizationReadiness({
        ...readinessPayload(),
        merchant: {
          ...readinessPayload().merchant,
          aliasConflictCount: -1,
        },
      }),
    /ordinary_account_authorization_invalid_response/,
  );
  assert.throws(
    () =>
      normalizeOrdinaryAccountAuthorizationReadiness({
        ...readinessPayload(),
        asOf: "2026-08-19T12:34:56+00:00",
      }),
    /ordinary_account_authorization_invalid_response/,
  );
  assert.throws(
    () =>
      normalizeOrdinaryAccountAuthorizationReadiness({
        ...readinessPayload(),
        readyForCutover: true,
      }),
    /ordinary_account_authorization_invalid_response/,
  );
  assert.throws(
    () =>
      normalizeOrdinaryAccountAuthorizationReadiness({
        ...readinessPayload(),
        personal: {
          ...readinessPayload().personal,
          canonicalBindingCount: 0,
          canonicalOrphanCount: 1,
        },
      }),
    /ordinary_account_authorization_invalid_response/,
  );
});

test("authoritative cutover readiness uses only binding, security, schema and ACL blockers", async () => {
  const calls: Array<{
    functionName: string;
    args: Record<string, unknown> | undefined;
  }> = [];
  const payload = authoritativeCutoverReadinessPayload();
  const result = await loadOrdinaryAccountAuthoritativeCutoverReadiness(
    client((functionName, args) => {
      calls.push({ functionName, args });
      return { data: payload, error: null };
    }),
  );

  assert.deepEqual(result, payload);
  assert.deepEqual(calls, [
    {
      functionName:
        "faolla_get_ordinary_account_authoritative_cutover_readiness_v1",
      args: {},
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /email|metadata|raw_/i);
});

test("authoritative cutover readiness fails closed on blockers, extra fields and inconsistent flags", () => {
  const blocked = {
    ...authoritativeCutoverReadinessPayload(),
    readyForCutover: false,
    merchant: {
      ...authoritativeCutoverReadinessPayload().merchant,
      invalidBindingCount: 1,
    },
  };
  assert.deepEqual(
    normalizeOrdinaryAccountAuthoritativeCutoverReadiness(blocked),
    blocked,
  );
  const systemSiteBlocked = {
    ...authoritativeCutoverReadinessPayload(),
    readyForCutover: false,
    security: {
      ...authoritativeCutoverReadinessPayload().security,
      systemSitePrincipalOverlapCount: 1,
    },
  };
  assert.deepEqual(
    normalizeOrdinaryAccountAuthoritativeCutoverReadiness(systemSiteBlocked),
    systemSiteBlocked,
  );

  for (const invalid of [
    {
      ...authoritativeCutoverReadinessPayload(),
      emailOnlyCount: 1,
    },
    {
      ...authoritativeCutoverReadinessPayload(),
      readyForCutover: true,
      invariants: { schemaReady: false, aclReady: true },
    },
    {
      ...authoritativeCutoverReadinessPayload(),
      merchant: {
        ...authoritativeCutoverReadinessPayload().merchant,
        invalidBindingCount: -1,
      },
    },
  ]) {
    assert.throws(
      () => normalizeOrdinaryAccountAuthoritativeCutoverReadiness(invalid),
      /ordinary_account_authorization_invalid_response/,
    );
  }
});

test("invalid Auth UUID is rejected before any RPC call", async () => {
  let callCount = 0;
  await assert.rejects(
    loadOrdinaryAccountAuthorization(
      client(() => {
        callCount += 1;
        return { data: merchantPayload(), error: null };
      }),
      ` ${AUTH_USER_ID}`,
    ),
    /invalid_ordinary_account_authorization_query/,
  );
  assert.equal(callCount, 0);
});

test("database authorization and exact missing-schema failures map to bounded codes", async () => {
  await assert.rejects(
    loadOrdinaryAccountAuthorization(
      client(() => ({
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find faolla_resolve_ordinary_account_authorization_v1 in the schema cache",
        },
      })),
      AUTH_USER_ID,
    ),
    /ordinary_account_authorization_schema_unavailable/,
  );

  await assert.rejects(
    loadOrdinaryAccountAuthoritativeCutoverReadiness(
      client(() => ({
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find faolla_get_ordinary_account_authoritative_cutover_readiness_v1 in the schema cache",
        },
      })),
    ),
    /ordinary_account_authorization_schema_unavailable/,
  );

  await assert.rejects(
    loadOrdinaryAccountAuthorization(
      client(() => ({
        data: null,
        error: { message: "ordinary_account_staff_identity_forbidden" },
      })),
      AUTH_USER_ID,
    ),
    /ordinary_account_staff_identity_forbidden/,
  );

  await assert.rejects(
    loadOrdinaryAccountAuthorization(
      client(() => ({
        data: null,
        error: { code: "PGRST202", message: "some unrelated function" },
      })),
      AUTH_USER_ID,
    ),
    /ordinary_account_authorization_read_failed/,
  );
});

test("malformed transport envelopes and rejected RPC calls fail closed", async () => {
  await assert.rejects(
    loadOrdinaryAccountAuthorization(
      client(() => null),
      AUTH_USER_ID,
    ),
    /ordinary_account_authorization_invalid_response/,
  );
  await assert.rejects(
    loadOrdinaryAccountAuthorization(
      client(() => Promise.reject(new Error("network down"))),
      AUTH_USER_ID,
    ),
    /ordinary_account_authorization_read_failed/,
  );
});
