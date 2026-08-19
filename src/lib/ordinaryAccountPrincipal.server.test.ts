import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapActiveOrdinaryAccountAuthorization,
  createActiveOrdinaryAccountAuthorization,
  loadActiveOrdinaryAccountAuthorization,
  OrdinaryAccountPrincipalError,
  resolveOrdinaryAccountPlatformIdentity,
} from "@/lib/ordinaryAccountPrincipal.server";

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";

function clientWith(data: unknown, error: unknown = null) {
  return {
    async rpc(functionName: string, args?: Record<string, unknown>) {
      assert.equal(
        functionName,
        "faolla_resolve_ordinary_account_authorization_v1",
      );
      assert.deepEqual(args, { p_auth_user_id: AUTH_USER_ID });
      return { data, error };
    },
  };
}

test("authoritative merchant identity preserves one auth to many merchants and only accepts bound hints", async () => {
  const client = clientWith({
    schemaVersion: 1,
    status: "resolved",
    accountType: "merchant",
    merchantIds: ["12345678", "87654321"],
    personalAccountId: null,
  });
  const forgedUser = {
    id: AUTH_USER_ID,
    email: "forged@example.com",
    user_metadata: {
      account_type: "personal",
      merchant_id: "99999999",
      personal_id: "forged-personal",
    },
    app_metadata: {
      merchant_id: "99999999",
    },
  };

  assert.deepEqual(
    await resolveOrdinaryAccountPlatformIdentity(client, forgedUser, {
      preferredMerchantId: "87654321",
      preferredAccountId: "99999999",
      preferredMerchantIds: ["99999999", "12345678"],
    }),
    {
      accountType: "merchant",
      accountId: "87654321",
      merchantId: "87654321",
      merchantIds: ["12345678", "87654321"],
    },
  );

  assert.deepEqual(
    await resolveOrdinaryAccountPlatformIdentity(client, forgedUser, {
      preferredMerchantId: "99999999",
    }),
    {
      accountType: "merchant",
      accountId: "12345678",
      merchantId: "12345678",
      merchantIds: ["12345678", "87654321"],
    },
  );

  await assert.rejects(
    () =>
      resolveOrdinaryAccountPlatformIdentity(client, forgedUser, {
        preferredMerchantId: "99999999",
        strictPreferredMerchantId: true,
      }),
    (error: unknown) =>
      error instanceof OrdinaryAccountPrincipalError &&
      error.code === "ordinary_account_merchant_selection_forbidden" &&
      error.status === 403,
  );
});

test("authoritative personal identity ignores forged metadata and account hints", async () => {
  const identity = await resolveOrdinaryAccountPlatformIdentity(
    clientWith({
      schemaVersion: 1,
      status: "resolved",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010105",
    }),
    {
      id: AUTH_USER_ID,
      user_metadata: {
        account_type: "merchant",
        merchant_id: "99999999",
        personal_id: "forged-personal",
      },
    },
    {
      preferredAccountId: "forged-personal",
      preferredMerchantId: "99999999",
    },
  );

  assert.deepEqual(identity, {
    accountType: "personal",
    accountId: "50010105",
    merchantId: null,
    merchantIds: [],
  });

  await assert.rejects(
    () =>
      resolveOrdinaryAccountPlatformIdentity(
        clientWith({
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        }),
        { id: AUTH_USER_ID },
        {
          preferredMerchantId: "99999999",
          strictPreferredMerchantId: true,
        },
      ),
    /ordinary_account_merchant_selection_forbidden/,
  );
});

test("disabled and unbound principals fail closed", async () => {
  await assert.rejects(
    () =>
      loadActiveOrdinaryAccountAuthorization(
        clientWith({
          schemaVersion: 1,
          status: "disabled",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010106",
        }),
        { id: AUTH_USER_ID },
      ),
    (error: unknown) =>
      error instanceof OrdinaryAccountPrincipalError &&
      error.code === "ordinary_account_personal_disabled" &&
      error.status === 403,
  );

  await assert.rejects(
    () =>
      loadActiveOrdinaryAccountAuthorization(
        clientWith({
          schemaVersion: 1,
          status: "unbound",
          accountType: null,
          merchantIds: [],
          personalAccountId: null,
        }),
        { id: AUTH_USER_ID },
      ),
    (error: unknown) =>
      error instanceof OrdinaryAccountPrincipalError &&
      error.code === "ordinary_account_principal_unbound" &&
      error.status === 403,
  );
});

test("schema and resolver failures remain fail closed", async () => {
  await assert.rejects(
    () =>
      loadActiveOrdinaryAccountAuthorization(
        clientWith(null, {
          code: "PGRST202",
          message:
            "Could not find faolla_resolve_ordinary_account_authorization_v1 in the schema cache",
        }),
        { id: AUTH_USER_ID },
      ),
    (error: unknown) =>
      error instanceof OrdinaryAccountPrincipalError &&
      error.code === "ordinary_account_principal_unavailable" &&
      error.status === 503,
  );

  await assert.rejects(
    () =>
      loadActiveOrdinaryAccountAuthorization(
        clientWith(null, {
          message: "ordinary_account_staff_identity_forbidden",
        }),
        { id: AUTH_USER_ID },
      ),
    /merchant_staff_identity_forbidden/,
  );

  await assert.rejects(
    () =>
      loadActiveOrdinaryAccountAuthorization(
        clientWith(null, {
          message: "ordinary_account_merchant_binding_conflict",
        }),
        { id: AUTH_USER_ID },
      ),
    (error: unknown) =>
      error instanceof OrdinaryAccountPrincipalError &&
      error.code === "ordinary_account_binding_conflict" &&
      error.status === 409,
  );
});

test("signup bootstrap uses the service-only RPC and authorizes only after a resolver read", async () => {
  const calls: Array<{
    functionName: string;
    args?: Record<string, unknown>;
  }> = [];
  const client = {
    async rpc(functionName: string, args?: Record<string, unknown>) {
      calls.push({ functionName, args });
      if (functionName === "faolla_bootstrap_ordinary_account_authorization_v1") {
        return {
          data: {
            schemaVersion: 1,
            status: "resolved",
            accountType: "merchant",
            merchantIds: ["99999999"],
            personalAccountId: null,
          },
          error: null,
        };
      }
      return {
        data: {
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["12345678"],
          personalAccountId: null,
        },
        error: null,
      };
    },
  };

  assert.deepEqual(
    await bootstrapActiveOrdinaryAccountAuthorization(
      client,
      { id: AUTH_USER_ID },
      "merchant",
    ),
    {
      schemaVersion: 1,
      status: "resolved",
      accountType: "merchant",
      merchantIds: ["12345678"],
      personalAccountId: null,
    },
  );
  assert.deepEqual(calls, [
    {
      functionName: "faolla_bootstrap_ordinary_account_authorization_v1",
      args: {
        p_auth_user_id: AUTH_USER_ID,
        p_account_type: "merchant",
      },
    },
    {
      functionName: "faolla_resolve_ordinary_account_authorization_v1",
      args: { p_auth_user_id: AUTH_USER_ID },
    },
  ]);
});

test("signup bootstrap rejects a resolver account type that disagrees with the request", async () => {
  const client = {
    async rpc(functionName: string) {
      if (functionName === "faolla_bootstrap_ordinary_account_authorization_v1") {
        return { data: { ignored: true }, error: null };
      }
      return {
        data: {
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        },
        error: null,
      };
    },
  };

  await assert.rejects(
    () =>
      bootstrapActiveOrdinaryAccountAuthorization(
        client,
        { id: AUTH_USER_ID },
        "merchant",
      ),
    (error: unknown) =>
      error instanceof OrdinaryAccountPrincipalError &&
      error.code === "ordinary_account_principal_unavailable" &&
      error.status === 503,
  );
});

test("signup bootstrap rejects a disabled account without attempting a resolver grant", async () => {
  const calls: string[] = [];
  const client = {
    async rpc(functionName: string) {
      calls.push(functionName);
      return {
        data: null,
        error: { message: "ordinary_account_personal_disabled" },
      };
    },
  };

  await assert.rejects(
    () =>
      bootstrapActiveOrdinaryAccountAuthorization(
        client,
        { id: AUTH_USER_ID },
        "personal",
      ),
    (error: unknown) =>
      error instanceof OrdinaryAccountPrincipalError &&
      error.code === "ordinary_account_personal_disabled" &&
      error.status === 403,
  );
  assert.deepEqual(calls, [
    "faolla_bootstrap_ordinary_account_authorization_v1",
  ]);
});

test("explicit admin creation uses create-only RPC and trusts only the following resolver read", async () => {
  const calls: Array<{
    functionName: string;
    args?: Record<string, unknown>;
  }> = [];
  const client = {
    async rpc(functionName: string, args?: Record<string, unknown>) {
      calls.push({ functionName, args });
      if (functionName === "faolla_create_ordinary_account_authorization_v1") {
        return {
          data: {
            schemaVersion: 1,
            status: "resolved",
            accountType: "merchant",
            merchantIds: ["99999999"],
            personalAccountId: null,
          },
          error: null,
        };
      }
      return {
        data: {
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["12345678", "87654321"],
          personalAccountId: null,
        },
        error: null,
      };
    },
  };

  assert.deepEqual(
    await createActiveOrdinaryAccountAuthorization(
      client,
      { id: AUTH_USER_ID },
      "merchant",
      "87654321",
    ),
    {
      schemaVersion: 1,
      status: "resolved",
      accountType: "merchant",
      merchantIds: ["12345678", "87654321"],
      personalAccountId: null,
    },
  );
  assert.deepEqual(calls, [
    {
      functionName: "faolla_create_ordinary_account_authorization_v1",
      args: {
        p_auth_user_id: AUTH_USER_ID,
        p_account_type: "merchant",
        p_account_id: "87654321",
      },
    },
    {
      functionName: "faolla_resolve_ordinary_account_authorization_v1",
      args: { p_auth_user_id: AUTH_USER_ID },
    },
  ]);
});

test("explicit admin creation safely retries response loss and fails closed on resolver mismatch", async () => {
  let createAttempts = 0;
  const client = {
    async rpc(functionName: string) {
      if (functionName === "faolla_create_ordinary_account_authorization_v1") {
        createAttempts += 1;
        if (createAttempts === 1) throw new Error("response lost after commit");
        return { data: { ignored: true }, error: null };
      }
      return {
        data: {
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010107",
        },
        error: null,
      };
    },
  };

  await assert.rejects(
    () =>
      createActiveOrdinaryAccountAuthorization(
        client,
        { id: AUTH_USER_ID },
        "personal",
        "50010105",
      ),
    (error: unknown) =>
      error instanceof OrdinaryAccountPrincipalError &&
      error.code === "ordinary_account_principal_unavailable" &&
      error.status === 503,
  );
  assert.equal(createAttempts, 2);
});

test("explicit admin creation accepts an exact fresh resolver binding after both acknowledgements are lost", async () => {
  let createAttempts = 0;
  let resolverReads = 0;
  const client = {
    async rpc(functionName: string) {
      if (functionName === "faolla_create_ordinary_account_authorization_v1") {
        createAttempts += 1;
        throw new Error("response lost after committed create");
      }
      resolverReads += 1;
      return {
        data: {
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["12345678", "87654321"],
          personalAccountId: null,
        },
        error: null,
      };
    },
  };

  assert.deepEqual(
    await createActiveOrdinaryAccountAuthorization(
      client,
      { id: AUTH_USER_ID },
      "merchant",
      "87654321",
    ),
    {
      schemaVersion: 1,
      status: "resolved",
      accountType: "merchant",
      merchantIds: ["12345678", "87654321"],
      personalAccountId: null,
    },
  );
  assert.equal(createAttempts, 2);
  assert.equal(resolverReads, 1);
});

test("explicit admin creation reports a permanent binding conflict without retrying or resolving", async () => {
  const calls: string[] = [];
  const client = {
    async rpc(functionName: string) {
      calls.push(functionName);
      return {
        data: null,
        error: { message: "ordinary_account_binding_conflict" },
      };
    },
  };

  await assert.rejects(
    () =>
      createActiveOrdinaryAccountAuthorization(
        client,
        { id: AUTH_USER_ID },
        "merchant",
        "12345678",
      ),
    (error: unknown) =>
      error instanceof OrdinaryAccountPrincipalError &&
      error.code === "ordinary_account_binding_conflict" &&
      error.status === 409,
  );
  assert.deepEqual(calls, [
    "faolla_create_ordinary_account_authorization_v1",
  ]);
});

test("explicit admin creation maps permanent type and staff conflicts without retrying", async () => {
  for (const scenario of [
    {
      databaseCode: "ordinary_account_principal_type_conflict",
      applicationCode: "ordinary_account_principal_type_conflict",
      status: 409,
    },
    {
      databaseCode: "ordinary_account_staff_identity_forbidden",
      applicationCode: "merchant_staff_identity_forbidden",
      status: 403,
    },
  ] as const) {
    const calls: string[] = [];
    const client = {
      async rpc(functionName: string) {
        calls.push(functionName);
        return {
          data: null,
          error: { message: scenario.databaseCode },
        };
      },
    };

    await assert.rejects(
      () =>
        createActiveOrdinaryAccountAuthorization(
          client,
          { id: AUTH_USER_ID },
          "merchant",
          "12345678",
        ),
      (error: unknown) =>
        error instanceof OrdinaryAccountPrincipalError &&
        error.code === scenario.applicationCode &&
        error.status === scenario.status,
    );
    assert.deepEqual(calls, [
      "faolla_create_ordinary_account_authorization_v1",
    ]);
  }
});
