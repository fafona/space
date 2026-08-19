import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_PERSONAL_RECOVERY_RPC_NAMES,
} from "@/lib/legacyPersonalRecovery.server";
import {
  createLegacyPersonalRecoveryApprovalDependencies,
  createLegacyPersonalRecoveryOtpDependencies,
  type LegacyPersonalRecoverySupabaseAuthClient,
  type LegacyPersonalRecoverySupabaseServiceClient,
} from "@/lib/legacyPersonalRecoverySupabase.server";

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";

function authUser(index: number) {
  return {
    id:
      index === 0
        ? AUTH_USER_ID
        : `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
    email: `user-${index}@example.com`,
    app_metadata: {},
    user_metadata: {},
  };
}

test("OTP adapter hard-codes shouldCreateUser false and does not expose a session", async () => {
  let captured: unknown;
  const auth = {
    auth: {
      async signInWithOtp(input: unknown) {
        captured = input;
        return { error: null };
      },
      async verifyOtp() {
        return { data: { user: authUser(0) }, error: null };
      },
    },
  } as unknown as LegacyPersonalRecoverySupabaseAuthClient;
  const service = {
    auth: {
      admin: {
        async getUserById() {
          return { data: { user: authUser(0) }, error: null };
        },
        async updateUserById() {
          return { data: { user: authUser(0) }, error: null };
        },
      },
    },
  } as unknown as LegacyPersonalRecoverySupabaseServiceClient;
  const dependencies = createLegacyPersonalRecoveryOtpDependencies({
    service,
    auth,
    redirectTo: "https://faolla.com/auth/legacy-personal-recovery",
  });
  assert.deepEqual(await dependencies.sendOtp("user-0@example.com"), undefined);
  assert.deepEqual(captured, {
    email: "user-0@example.com",
    options: {
      shouldCreateUser: false,
      emailRedirectTo: "https://faolla.com/auth/legacy-personal-recovery",
    },
  });
});

test("Auth directory pagination is complete and any later-page error rejects the whole observation", async () => {
  const pageOne = Array.from({ length: 200 }, (_, index) => authUser(index + 1));
  const pageTwo = [authUser(0)];
  const requestedPages: number[] = [];
  let failSecondPage = false;
  const service = {
    auth: {
      admin: {
        async listUsers({ page }: { page: number }) {
          requestedPages.push(page);
          if (page === 2 && failSecondPage) {
            return { data: null, error: new Error("unavailable") };
          }
          return {
            data: {
              users: page === 1 ? pageOne : pageTwo,
              nextPage: page === 1 ? 2 : null,
              lastPage: 2,
              total: 201,
            },
            error: null,
          };
        },
      },
    },
  } as unknown as LegacyPersonalRecoverySupabaseServiceClient;
  const dependencies = createLegacyPersonalRecoveryApprovalDependencies(service);
  const users = await dependencies.listAuthUsers();
  assert.equal(users.length, 201);
  assert.deepEqual(requestedPages, [1, 2]);

  failSecondPage = true;
  requestedPages.length = 0;
  await assert.rejects(dependencies.listAuthUsers(), /legacy_personal_recovery_upstream_unavailable/);
  assert.deepEqual(requestedPages, [1, 2]);
});

test("Auth pagination rejects short pages, later duplicates, and total drift", async () => {
  let mode: "valid" | "duplicate" | "drift" = "valid";
  const pageOne = Array.from({ length: 200 }, (_, index) => authUser(index + 1));
  const requestedPages: number[] = [];
  const service = {
    auth: {
      admin: {
        async listUsers({ page }: { page: number }) {
          requestedPages.push(page);
          const second =
            mode === "duplicate" ? authUser(1) : authUser(201);
          return {
            data: {
              users: page === 1 ? pageOne : [second],
              nextPage: page === 1 ? 2 : null,
              lastPage: 2,
              total: mode === "drift" && page === 2 ? 202 : 201,
            },
            error: null,
          };
        },
      },
    },
  } as unknown as LegacyPersonalRecoverySupabaseServiceClient;
  const dependencies = createLegacyPersonalRecoveryApprovalDependencies(service);
  assert.equal((await dependencies.listAuthUsers()).length, 201);
  assert.deepEqual(requestedPages, [1, 2]);

  const shortService = {
    auth: {
      admin: {
        async listUsers() {
          return {
            data: {
              users: [authUser(1)],
              nextPage: 2,
              lastPage: 2,
              total: 2,
            },
            error: null,
          };
        },
      },
    },
  } as unknown as LegacyPersonalRecoverySupabaseServiceClient;
  await assert.rejects(
    createLegacyPersonalRecoveryApprovalDependencies(
      shortService,
    ).listAuthUsers(),
    /legacy_personal_recovery_upstream_unavailable/,
  );

  mode = "duplicate";
  requestedPages.length = 0;
  await assert.rejects(
    dependencies.listAuthUsers(),
    /legacy_personal_recovery_upstream_unavailable/,
  );
  assert.deepEqual(requestedPages, [1, 2]);

  mode = "drift";
  requestedPages.length = 0;
  await assert.rejects(
    dependencies.listAuthUsers(),
    /legacy_personal_recovery_upstream_unavailable/,
  );
  assert.deepEqual(requestedPages, [1, 2]);
});

test("Auth pagination derives page ten from total despite the auth-js two-digit Link bug", async () => {
  const total = 1_801;
  const requestedPages: number[] = [];
  const service = {
    auth: {
      admin: {
        async listUsers({ page }: { page: number }) {
          requestedPages.push(page);
          const offset = (page - 1) * 200;
          const count = Math.min(200, total - offset);
          return {
            data: {
              users: Array.from({ length: count }, (_, index) =>
                authUser(offset + index + 1),
              ),
              // auth-js 2.93.3 truncates 10 to 1 while parsing Link.
              nextPage: page < 9 ? page + 1 : page === 9 ? 1 : null,
              lastPage: 1,
              total,
            },
            error: null,
          };
        },
      },
    },
  } as unknown as LegacyPersonalRecoverySupabaseServiceClient;
  const users = await createLegacyPersonalRecoveryApprovalDependencies(
    service,
  ).listAuthUsers();
  assert.equal(users.length, total);
  assert.deepEqual(
    requestedPages,
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
});

test("directory inspection uses only the service-only observer even when protected tables return 42501", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  let protectedReadAttempted = false;
  const observation = {
    schemaVersion: 1,
    merchantBindingCount: 0,
    systemSiteBindingCount: 0,
    staffBindingCount: 0,
    employeeBindingCount: 0,
    accountIdentifierCollisionCount: 0,
    personalAuthBindingCount: 0,
    personalIdBindingCount: 0,
    personalOtherAuthBindingCount: 0,
    exactCanonicalBindingCount: 0,
  };
  const service = {
    auth: { admin: {} },
    from() {
      protectedReadAttempted = true;
      return { error: { code: "42501" } };
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return { data: observation, error: null };
    },
  } as unknown as LegacyPersonalRecoverySupabaseServiceClient;
  const dependencies = createLegacyPersonalRecoveryApprovalDependencies(service);
  assert.deepEqual(
    await dependencies.inspectDirectory(AUTH_USER_ID, "50010105"),
    observation,
  );
  assert.deepEqual(calls, [{
    functionName: LEGACY_PERSONAL_RECOVERY_RPC_NAMES.observer,
    args: {
      p_auth_user_id: AUTH_USER_ID,
      p_personal_account_id: "50010105",
    },
  }]);
  assert.equal(protectedReadAttempted, false);
});

test("directory observer transport, PostgREST, and missing-RPC failures are fail-closed", async (t) => {
  for (const [name, rpc] of [
    ["transport", async () => { throw new Error("transport"); }],
    ["42501", async () => ({ data: null, error: { code: "42501" } })],
    ["missing", async () => ({ data: null, error: { code: "PGRST202" } })],
  ] as const) {
    await t.test(name, async () => {
      const service = {
        auth: { admin: {} },
        rpc,
      } as unknown as LegacyPersonalRecoverySupabaseServiceClient;
      await assert.rejects(
        createLegacyPersonalRecoveryApprovalDependencies(
          service,
        ).inspectDirectory(AUTH_USER_ID, "50010105"),
        /legacy_personal_recovery_upstream_unavailable/,
      );
    });
  }
});

test("create adapter calls only the 036 create-only RPC with server-provided arguments", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const service = {
    auth: { admin: {} },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return { data: { ok: true }, error: null };
    },
  } as unknown as LegacyPersonalRecoverySupabaseServiceClient;
  const dependencies = createLegacyPersonalRecoveryApprovalDependencies(service);
  await dependencies.createAuthorization(
    AUTH_USER_ID,
    "personal",
    "50010105",
  );
  assert.deepEqual(calls, [
    {
      functionName: LEGACY_PERSONAL_RECOVERY_RPC_NAMES.create,
      args: {
        p_auth_user_id: AUTH_USER_ID,
        p_account_type: "personal",
        p_account_id: "50010105",
      },
    },
  ]);
  assert.equal(
    calls.some((call) => /bind/i.test(call.functionName)),
    false,
  );
});
