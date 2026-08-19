import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_PERSONAL_RECOVERY_CASE_ENV,
  LEGACY_PERSONAL_RECOVERY_APPROVAL_ATTEMPT_METADATA_KEY,
  LEGACY_PERSONAL_RECOVERY_COMPLETED_METADATA_KEY,
  LEGACY_PERSONAL_RECOVERY_ENABLED_ENV,
  LEGACY_PERSONAL_RECOVERY_HMAC_ENV,
  LEGACY_PERSONAL_RECOVERY_VERIFIED_METADATA_KEY,
  LegacyPersonalRecoveryError,
  approveLegacyPersonalRecovery,
  createLegacyPersonalRecoveryNonce,
  getLegacyPersonalRecoveryStatus,
  loadLegacyPersonalRecoveryCase,
  normalizeOrdinaryAuthoritativeReadiness,
  requestLegacyPersonalRecoveryOtp,
  sha256,
  verifyLegacyPersonalRecoveryOtp,
  type LegacyPersonalRecoveryApprovalDependencies,
  type LegacyPersonalRecoveryAuthUser,
  type LegacyPersonalRecoveryOtpDependencies,
} from "@/lib/legacyPersonalRecovery.server";
import {
  createLegacyPersonalRecoveryApprovalDependencies,
  type LegacyPersonalRecoverySupabaseServiceClient,
} from "@/lib/legacyPersonalRecoverySupabase.server";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
const PERSONAL_ACCOUNT_ID = "50010105";
const EMAIL = "legacy-personal@example.com";
const HMAC_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function caseEnv(input: { enabled?: string; expiresAt?: string } = {}) {
  return {
    [LEGACY_PERSONAL_RECOVERY_ENABLED_ENV]: input.enabled ?? "true",
    [LEGACY_PERSONAL_RECOVERY_CASE_ENV]: JSON.stringify({
      caseId: "legacy_case_20260819",
      authUserId: AUTH_USER_ID,
      personalAccountId: PERSONAL_ACCOUNT_ID,
      emailSha256: sha256(EMAIL),
      expiresAt:
        input.expiresAt ?? new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
    }),
    [LEGACY_PERSONAL_RECOVERY_HMAC_ENV]: HMAC_SECRET,
    SUPER_ADMIN_VERIFICATION_SECRET: "different-super-admin-test-secret-123456",
  };
}

function consistentUser(): LegacyPersonalRecoveryAuthUser {
  return {
    id: AUTH_USER_ID,
    email: EMAIL,
    userMetadata: {
      account_type: "personal",
      accountType: "personal",
      account_id: PERSONAL_ACCOUNT_ID,
      accountId: PERSONAL_ACCOUNT_ID,
      login_id: PERSONAL_ACCOUNT_ID,
      loginId: PERSONAL_ACCOUNT_ID,
      personal_id: PERSONAL_ACCOUNT_ID,
      personalId: PERSONAL_ACCOUNT_ID,
    },
    appMetadata: {
      account_type: "personal",
      accountType: "personal",
      account_id: PERSONAL_ACCOUNT_ID,
      accountId: PERSONAL_ACCOUNT_ID,
      login_id: PERSONAL_ACCOUNT_ID,
      loginId: PERSONAL_ACCOUNT_ID,
      personal_id: PERSONAL_ACCOUNT_ID,
      personalId: PERSONAL_ACCOUNT_ID,
    },
  };
}

function readiness(canonicalBindingCount: number, ready = true) {
  return {
    schemaVersion: 1,
    asOf: "2026-08-19T12:00:00.000Z",
    readyForCutover: ready,
    merchant: {
      recordCount: 10,
      authoritativeBindingCount: 10,
      invalidBindingCount: 0,
    },
    personal: {
      canonicalBindingCount,
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
      schemaReady: ready,
      aclReady: ready,
    },
  };
}

function unboundAuthorization() {
  return {
    schemaVersion: 1,
    status: "unbound",
    accountType: null,
    merchantIds: [],
    personalAccountId: null,
  };
}

function resolvedAuthorization() {
  return {
    schemaVersion: 1,
    status: "resolved",
    accountType: "personal",
    merchantIds: [],
    personalAccountId: PERSONAL_ACCOUNT_ID,
  };
}

function directory(bound: boolean) {
  return {
    merchantBindingCount: 0,
    systemSiteBindingCount: 0,
    staffBindingCount: 0,
    employeeBindingCount: 0,
    accountIdentifierCollisionCount: 0,
    personalAuthBindingCount: bound ? 1 : 0,
    personalIdBindingCount: bound ? 1 : 0,
    exactCanonicalBindingCount: bound ? 1 : 0,
  };
}

function errorCode(error: unknown) {
  return error instanceof LegacyPersonalRecoveryError ? error.code : "";
}

function mutableOtpFixture(input: {
  otpUser?: LegacyPersonalRecoveryAuthUser | null;
  now?: number;
} = {}) {
  const user = consistentUser();
  let sentInput = "";
  const dependencies: LegacyPersonalRecoveryOtpDependencies = {
    now: () => input.now ?? NOW,
    getAuthUser: async () => structuredClone(user),
    sendOtp: async (email) => {
      sentInput = email;
    },
    verifyOtp: async () =>
      input.otpUser === undefined
        ? structuredClone(user)
        : input.otpUser
          ? structuredClone(input.otpUser)
          : null,
    updateAuthAppMetadata: async (_authUserId, appMetadata) => {
      user.appMetadata = structuredClone(appMetadata);
    },
  };
  return { user, dependencies, sentInput: () => sentInput };
}

async function addVerifiedMarker(
  user: LegacyPersonalRecoveryAuthUser,
  now = NOW,
) {
  const recoveryCase = loadLegacyPersonalRecoveryCase(caseEnv(), now);
  const fixture = mutableOtpFixture({ now });
  fixture.user.appMetadata = structuredClone(user.appMetadata);
  fixture.user.userMetadata = structuredClone(user.userMetadata);
  const nonce = createLegacyPersonalRecoveryNonce(
    recoveryCase,
    now,
    () => Buffer.alloc(32, 7),
  );
  await verifyLegacyPersonalRecoveryOtp(
    recoveryCase,
    {
      email: EMAIL,
      personalAccountId: PERSONAL_ACCOUNT_ID,
      code: "123456",
      nonceCookie: nonce,
    },
    fixture.dependencies,
  );
  user.appMetadata = structuredClone(fixture.user.appMetadata);
  return recoveryCase;
}

function approvalFixture(user: LegacyPersonalRecoveryAuthUser, input: {
  createThrowsAfterWrite?: boolean;
  createThrowsBeforeWrite?: boolean;
  directoryConflict?: Partial<ReturnType<typeof directory>>;
  readinessReady?: boolean;
  extraUsers?: LegacyPersonalRecoveryAuthUser[];
  operatorAuthorized?: () => boolean;
} = {}) {
  let bound = false;
  let createCalls = 0;
  let metadataUpdateCalls = 0;
  const dependencies: LegacyPersonalRecoveryApprovalDependencies = {
    now: () => NOW + 60_000,
    reauthorizeOperator: input.operatorAuthorized ?? (() => true),
    getAuthUser: async () => structuredClone(user),
    listAuthUsers: async () => [
      structuredClone(user),
      ...(input.extraUsers ?? []).map((item) => structuredClone(item)),
    ],
    resolveAuthorization: async () =>
      bound ? resolvedAuthorization() : unboundAuthorization(),
    loadReadiness: async () =>
      readiness(bound ? 1 : 0, input.readinessReady ?? true),
    inspectDirectory: async () => ({
      ...directory(bound),
      ...(input.directoryConflict ?? {}),
    }),
    createAuthorization: async (authUserId, accountType, accountId) => {
      assert.equal(authUserId, AUTH_USER_ID);
      assert.equal(accountType, "personal");
      assert.equal(accountId, PERSONAL_ACCOUNT_ID);
      createCalls += 1;
      if (input.createThrowsBeforeWrite) {
        throw new Error("simulated_prewrite_failure");
      }
      bound = true;
      if (input.createThrowsAfterWrite) {
        throw new Error("simulated_response_loss");
      }
      return resolvedAuthorization();
    },
    updateAuthAppMetadata: async (authUserId, appMetadata) => {
      assert.equal(authUserId, AUTH_USER_ID);
      metadataUpdateCalls += 1;
      user.appMetadata = structuredClone(appMetadata);
    },
  };
  return {
    dependencies,
    createCalls: () => createCalls,
    metadataUpdateCalls: () => metadataUpdateCalls,
    isBound: () => bound,
    setResponseLoss: (value: boolean) => {
      input.createThrowsAfterWrite = value;
    },
  };
}

test("recovery is disabled by default and rejects expired or unsafe configuration", () => {
  assert.throws(
    () => loadLegacyPersonalRecoveryCase({}, NOW),
    (error) =>
      errorCode(error) === "legacy_personal_recovery_disabled" &&
      (error as LegacyPersonalRecoveryError).status === 410,
  );
  assert.throws(
    () =>
      loadLegacyPersonalRecoveryCase(
        caseEnv({ expiresAt: new Date(NOW - 1).toISOString() }),
        NOW,
      ),
    (error) => errorCode(error) === "legacy_personal_recovery_expired",
  );
  assert.throws(
    () =>
      loadLegacyPersonalRecoveryCase(
        {
          ...caseEnv(),
          [LEGACY_PERSONAL_RECOVERY_HMAC_ENV]:
            caseEnv().SUPER_ADMIN_VERIFICATION_SECRET,
        },
        NOW,
      ),
    (error) => errorCode(error) === "legacy_personal_recovery_config_invalid",
  );
  assert.throws(
    () =>
      loadLegacyPersonalRecoveryCase(
        {
          ...caseEnv(),
          [LEGACY_PERSONAL_RECOVERY_HMAC_ENV]: "z".repeat(64),
        },
        NOW,
      ),
    (error) => errorCode(error) === "legacy_personal_recovery_config_invalid",
  );
  assert.throws(
    () =>
      loadLegacyPersonalRecoveryCase(
        {
          ...caseEnv(),
          [LEGACY_PERSONAL_RECOVERY_CASE_ENV]: JSON.stringify(
            JSON.parse(caseEnv()[LEGACY_PERSONAL_RECOVERY_CASE_ENV] ?? "{}"),
            null,
            2,
          ),
        },
        NOW,
      ),
    (error) => errorCode(error) === "legacy_personal_recovery_config_invalid",
  );
  const parsedCase = JSON.parse(
    caseEnv()[LEGACY_PERSONAL_RECOVERY_CASE_ENV] ?? "{}",
  ) as Record<string, unknown>;
  for (const numericField of [
    { caseId: 12345678 },
    { personalAccountId: 50010105 },
    { emailSha256: Number("1".repeat(64)) },
  ]) {
    assert.throws(
      () =>
        loadLegacyPersonalRecoveryCase(
          {
            ...caseEnv(),
            [LEGACY_PERSONAL_RECOVERY_CASE_ENV]: JSON.stringify({
              ...parsedCase,
              ...numericField,
            }),
          },
          NOW,
        ),
      (error) =>
        errorCode(error) === "legacy_personal_recovery_config_invalid",
    );
  }
});

test("OTP request performs only a blind fixed identity comparison", async () => {
  const recoveryCase = loadLegacyPersonalRecoveryCase(caseEnv(), NOW);
  const fixture = mutableOtpFixture();
  await assert.rejects(
    requestLegacyPersonalRecoveryOtp(
      recoveryCase,
      { email: "wrong@example.com", personalAccountId: PERSONAL_ACCOUNT_ID },
      fixture.dependencies,
    ),
    (error) => errorCode(error) === "legacy_personal_recovery_identity_mismatch",
  );
  await assert.rejects(
    requestLegacyPersonalRecoveryOtp(
      recoveryCase,
      { email: EMAIL, personalAccountId: "50010106" },
      fixture.dependencies,
    ),
    (error) => errorCode(error) === "legacy_personal_recovery_identity_mismatch",
  );
  await requestLegacyPersonalRecoveryOtp(
    recoveryCase,
    { email: EMAIL.toUpperCase(), personalAccountId: PERSONAL_ACCOUNT_ID },
    fixture.dependencies,
  );
  assert.equal(fixture.sentInput(), EMAIL);
});

test("fresh OTP requires the signed httpOnly state and exact UUID plus normalized email", async () => {
  const recoveryCase = loadLegacyPersonalRecoveryCase(caseEnv(), NOW);
  const nonce = createLegacyPersonalRecoveryNonce(
    recoveryCase,
    NOW,
    () => Buffer.alloc(32, 3),
  );
  const noNonce = mutableOtpFixture();
  await assert.rejects(
    verifyLegacyPersonalRecoveryOtp(
      recoveryCase,
      {
        email: EMAIL,
        personalAccountId: PERSONAL_ACCOUNT_ID,
        code: "123456",
        nonceCookie: "",
      },
      noNonce.dependencies,
    ),
    (error) => errorCode(error) === "legacy_personal_recovery_nonce_invalid",
  );

  for (const otpUser of [
    { ...consistentUser(), id: "22222222-2222-4222-8222-222222222222" },
    { ...consistentUser(), email: "other@example.com" },
  ]) {
    const fixture = mutableOtpFixture({ otpUser });
    await assert.rejects(
      verifyLegacyPersonalRecoveryOtp(
        recoveryCase,
        {
          email: EMAIL,
          personalAccountId: PERSONAL_ACCOUNT_ID,
          code: "123456",
          nonceCookie: nonce,
        },
        fixture.dependencies,
      ),
      (error) =>
        errorCode(error) === "legacy_personal_recovery_otp_principal_mismatch",
    );
  }
});

test("successful OTP writes only a short service-owned marker and returns no session material", async () => {
  const recoveryCase = loadLegacyPersonalRecoveryCase(caseEnv(), NOW);
  const fixture = mutableOtpFixture();
  const result = await verifyLegacyPersonalRecoveryOtp(
    recoveryCase,
    {
      email: EMAIL,
      personalAccountId: PERSONAL_ACCOUNT_ID,
      code: "123456",
      nonceCookie: createLegacyPersonalRecoveryNonce(
        recoveryCase,
        NOW,
        () => Buffer.alloc(32, 4),
      ),
    },
    fixture.dependencies,
  );
  assert.deepEqual(result, { ok: true, verified: true });
  const marker = fixture.user.appMetadata?.[
    LEGACY_PERSONAL_RECOVERY_VERIFIED_METADATA_KEY
  ];
  const serialized = JSON.stringify(marker);
  assert.ok(serialized.includes("verificationHash"));
  for (const sensitive of [EMAIL, PERSONAL_ACCOUNT_ID, AUTH_USER_ID, "session", "token"]) {
    assert.equal(serialized.includes(sensitive), false);
    assert.equal(JSON.stringify(result).includes(sensitive), false);
  }
});

test("OTP response loss retries from the fresh server marker only while the signed nonce remains", async () => {
  const recoveryCase = loadLegacyPersonalRecoveryCase(caseEnv(), NOW);
  const fixture = mutableOtpFixture();
  const nonce = createLegacyPersonalRecoveryNonce(
    recoveryCase,
    NOW,
    () => Buffer.alloc(32, 9),
  );
  await verifyLegacyPersonalRecoveryOtp(
    recoveryCase,
    {
      email: EMAIL,
      personalAccountId: PERSONAL_ACCOUNT_ID,
      code: "123456",
      nonceCookie: nonce,
    },
    fixture.dependencies,
  );
  let consumedOtpCalls = 0;
  fixture.dependencies.verifyOtp = async () => {
    consumedOtpCalls += 1;
    return null;
  };
  assert.deepEqual(
    await verifyLegacyPersonalRecoveryOtp(
      recoveryCase,
      {
        email: EMAIL,
        personalAccountId: PERSONAL_ACCOUNT_ID,
        code: "123456",
        nonceCookie: nonce,
      },
      fixture.dependencies,
    ),
    { ok: true, verified: true },
  );
  assert.equal(consumedOtpCalls, 0);
  await assert.rejects(
    verifyLegacyPersonalRecoveryOtp(
      recoveryCase,
      {
        email: EMAIL,
        personalAccountId: PERSONAL_ACCOUNT_ID,
        code: "123456",
        nonceCookie: "",
      },
      fixture.dependencies,
    ),
    (error) => errorCode(error) === "legacy_personal_recovery_nonce_invalid",
  );
});

test("immutable staff metadata blocks OTP verification before OTP or metadata side effects", async () => {
  const recoveryCase = loadLegacyPersonalRecoveryCase(caseEnv(), NOW);
  const requestFixture = mutableOtpFixture();
  requestFixture.user.appMetadata = {
    ...requestFixture.user.appMetadata,
    principal_type: "merchant_staff",
  };
  await assert.rejects(
    requestLegacyPersonalRecoveryOtp(
      recoveryCase,
      { email: EMAIL, personalAccountId: PERSONAL_ACCOUNT_ID },
      requestFixture.dependencies,
    ),
    (error) =>
      errorCode(error) === "legacy_personal_recovery_staff_identity_forbidden",
  );
  assert.equal(requestFixture.sentInput(), "");

  const verifyFixture = mutableOtpFixture();
  verifyFixture.user.appMetadata = {
    ...verifyFixture.user.appMetadata,
    principal_type: "merchant_staff",
  };
  let verifyCalls = 0;
  let metadataWrites = 0;
  verifyFixture.dependencies.verifyOtp = async () => {
    verifyCalls += 1;
    return structuredClone(verifyFixture.user);
  };
  verifyFixture.dependencies.updateAuthAppMetadata = async () => {
    metadataWrites += 1;
  };
  await assert.rejects(
    verifyLegacyPersonalRecoveryOtp(
      recoveryCase,
      {
        email: EMAIL,
        personalAccountId: PERSONAL_ACCOUNT_ID,
        code: "123456",
        nonceCookie: createLegacyPersonalRecoveryNonce(recoveryCase, NOW),
      },
      verifyFixture.dependencies,
    ),
    (error) =>
      errorCode(error) === "legacy_personal_recovery_staff_identity_forbidden",
  );
  assert.equal(verifyCalls, 0);
  assert.equal(metadataWrites, 0);
});

test("approval creates the fixed canonical row, rechecks readiness, and writes an HMAC audit marker", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const fixture = approvalFixture(user);
  const result = await approveLegacyPersonalRecovery(
    recoveryCase,
    fixture.dependencies,
  );
  assert.deepEqual(result, { ok: true, state: "completed", created: true });
  assert.equal(fixture.createCalls(), 1);
  assert.equal(
    user.appMetadata?.[LEGACY_PERSONAL_RECOVERY_VERIFIED_METADATA_KEY],
    null,
  );
  const completion = user.appMetadata?.[
    LEGACY_PERSONAL_RECOVERY_COMPLETED_METADATA_KEY
  ];
  const serialized = JSON.stringify(completion);
  for (const sensitive of [EMAIL, PERSONAL_ACCOUNT_ID, AUTH_USER_ID]) {
    assert.equal(serialized.includes(sensitive), false);
    assert.equal(JSON.stringify(result).includes(sensitive), false);
  }
  assert.match(serialized, /beforeReadinessHash/);
  assert.match(serialized, /afterReadinessHash/);
  assert.match(serialized, /auditHash/);
  assert.deepEqual(
    await getLegacyPersonalRecoveryStatus(recoveryCase, fixture.dependencies),
    { ok: true, state: "completed", readyForApproval: false },
  );
});

test("create-only response loss is recovered from the resolver without a second write", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const fixture = approvalFixture(user, { createThrowsAfterWrite: true });
  await assert.rejects(
    approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    (error) => errorCode(error) === "legacy_personal_recovery_rpc_failed",
  );
  assert.equal(fixture.isBound(), true);
  fixture.setResponseLoss(false);
  const result = await approveLegacyPersonalRecovery(
    recoveryCase,
    fixture.dependencies,
  );
  assert.deepEqual(result, { ok: true, state: "completed", created: false });
  assert.equal(fixture.createCalls(), 1);
});

test("approval rechecks the fresh marker after slow preflight and never creates after TTL", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const fixture = approvalFixture(user);
  const times = [
    NOW + 14 * 60_000,
    NOW + 14 * 60_000,
    NOW + 16 * 60_000,
  ];
  fixture.dependencies.now = () => times.shift() ?? NOW + 16 * 60_000;
  await assert.rejects(
    approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    (error) =>
      errorCode(error) === "legacy_personal_recovery_verification_required",
  );
  assert.equal(fixture.createCalls(), 0);
});

test("an RPC crossing the OTP TTL still completes from the signed approval attempt", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const fixture = approvalFixture(user);
  const times = [
    NOW + 14 * 60_000,
    NOW + 14 * 60_000,
    NOW + 14.5 * 60_000,
    NOW + 20 * 60_000,
  ];
  fixture.dependencies.now = () => times.shift() ?? NOW + 20 * 60_000;
  assert.deepEqual(
    await approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    { ok: true, state: "completed", created: true },
  );
  assert.equal(fixture.createCalls(), 1);
  assert.equal(
    user.appMetadata?.[LEGACY_PERSONAL_RECOVERY_APPROVAL_ATTEMPT_METADATA_KEY],
    null,
  );
});

test("an unbound failed attempt cannot create later from an expired OTP marker", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const fixture = approvalFixture(user, { createThrowsBeforeWrite: true });
  await assert.rejects(
    approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    (error) => errorCode(error) === "legacy_personal_recovery_rpc_failed",
  );
  assert.equal(fixture.isBound(), false);
  assert.equal(fixture.createCalls(), 1);
  fixture.dependencies.now = () => NOW + 16 * 60_000;
  await assert.rejects(
    approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    (error) =>
      errorCode(error) === "legacy_personal_recovery_verification_required",
  );
  assert.equal(fixture.createCalls(), 1);
});

test("operator session is reauthorized at the create and completion mutation boundaries", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  let operatorChecks = 0;
  const fixture = approvalFixture(user, {
    operatorAuthorized: () => {
      operatorChecks += 1;
      return operatorChecks === 1;
    },
  });
  await assert.rejects(
    approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    (error) =>
      errorCode(error) ===
      "legacy_personal_recovery_operator_reauthorization_required",
  );
  assert.equal(fixture.metadataUpdateCalls(), 1);
  assert.equal(fixture.createCalls(), 0);

  const responseLossUser = consistentUser();
  const responseLossCase = await addVerifiedMarker(responseLossUser);
  let authorized = true;
  const responseLossFixture = approvalFixture(responseLossUser, {
    createThrowsAfterWrite: true,
    operatorAuthorized: () => authorized,
  });
  await assert.rejects(
    approveLegacyPersonalRecovery(
      responseLossCase,
      responseLossFixture.dependencies,
    ),
    (error) => errorCode(error) === "legacy_personal_recovery_rpc_failed",
  );
  authorized = false;
  await assert.rejects(
    approveLegacyPersonalRecovery(
      responseLossCase,
      responseLossFixture.dependencies,
    ),
    (error) =>
      errorCode(error) ===
      "legacy_personal_recovery_operator_reauthorization_required",
  );
  assert.equal(
    responseLossUser.appMetadata?.[
      LEGACY_PERSONAL_RECOVERY_COMPLETED_METADATA_KEY
    ],
    undefined,
  );
});

test("approval rejects metadata drift and any second legacy personal candidate", async () => {
  const drifted = consistentUser();
  await addVerifiedMarker(drifted);
  drifted.userMetadata = {
    ...drifted.userMetadata,
    personalId: "50010106",
  };
  const recoveryCase = loadLegacyPersonalRecoveryCase(caseEnv(), NOW);
  await assert.rejects(
    approveLegacyPersonalRecovery(
      recoveryCase,
      approvalFixture(drifted).dependencies,
    ),
    (error) => errorCode(error) === "legacy_personal_recovery_metadata_drift",
  );

  const user = consistentUser();
  await addVerifiedMarker(user);
  const other = consistentUser();
  other.id = "22222222-2222-4222-8222-222222222222";
  other.email = "another@example.com";
  await assert.rejects(
    approveLegacyPersonalRecovery(
      recoveryCase,
      approvalFixture(user, { extraUsers: [other] }).dependencies,
    ),
    (error) => errorCode(error) === "legacy_personal_recovery_candidate_conflict",
  );
});

test("immutable staff metadata blocks approval before the create-only RPC", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  user.appMetadata = {
    ...user.appMetadata,
    principal_type: "merchant_staff",
  };
  const fixture = approvalFixture(user);
  await assert.rejects(
    approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    (error) =>
      errorCode(error) === "legacy_personal_recovery_staff_identity_forbidden",
  );
  assert.equal(fixture.createCalls(), 0);
  assert.equal(fixture.metadataUpdateCalls(), 0);
});

test("complete Auth observation ignores unrelated personal principals but still uses every page", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const unrelated = consistentUser();
  unrelated.id = "33333333-3333-4333-8333-333333333333";
  unrelated.email = "unrelated-personal@example.com";
  for (const metadata of [unrelated.userMetadata, unrelated.appMetadata]) {
    if (!metadata) continue;
    for (const key of [
      "account_id",
      "accountId",
      "login_id",
      "loginId",
      "personal_id",
      "personalId",
    ]) {
      metadata[key] = "50010106";
    }
  }
  const fixture = approvalFixture(user, { extraUsers: [unrelated] });
  assert.deepEqual(
    await approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    { ok: true, state: "completed", created: true },
  );
});

test("a malformed short Auth page fails closed before create", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const conflict = consistentUser();
  conflict.id = "22222222-2222-4222-8222-222222222222";
  conflict.email = "different@example.com";
  const rawUser = (value: LegacyPersonalRecoveryAuthUser) => ({
    id: value.id,
    email: value.email,
    app_metadata: value.appMetadata,
    user_metadata: value.userMetadata,
  });
  const requestedPages: number[] = [];
  const service = {
    auth: {
      admin: {
        async listUsers({ page }: { page: number }) {
          requestedPages.push(page);
          return {
            data: {
              users: [rawUser(page === 1 ? user : conflict)],
              nextPage: page === 1 ? 2 : null,
              lastPage: 2,
              total: 2,
            },
            error: null,
          };
        },
      },
    },
  } as unknown as LegacyPersonalRecoverySupabaseServiceClient;
  const paginated = createLegacyPersonalRecoveryApprovalDependencies(service);
  const fixture = approvalFixture(user);
  fixture.dependencies.listAuthUsers = paginated.listAuthUsers;
  await assert.rejects(
    approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    (error) =>
      errorCode(error) === "legacy_personal_recovery_upstream_unavailable",
  );
  assert.deepEqual(requestedPages, [1]);
  assert.equal(fixture.createCalls(), 0);
});

test("a fixed-case conflict on a complete second Auth page blocks create", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const conflict = consistentUser();
  conflict.id = "22222222-2222-4222-8222-222222222222";
  conflict.email = "different@example.com";
  const rawUser = (value: LegacyPersonalRecoveryAuthUser) => ({
    id: value.id,
    email: value.email,
    app_metadata: value.appMetadata,
    user_metadata: value.userMetadata,
  });
  const fillers = Array.from({ length: 199 }, (_, index) => ({
    id: `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
    email: `unrelated-${index + 1}@example.com`,
    app_metadata: {},
    user_metadata: {},
  }));
  const requestedPages: number[] = [];
  const service = {
    auth: {
      admin: {
        async listUsers({ page }: { page: number }) {
          requestedPages.push(page);
          return {
            data: {
              users:
                page === 1
                  ? [rawUser(user), ...fillers]
                  : [rawUser(conflict)],
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
  const fixture = approvalFixture(user);
  fixture.dependencies.listAuthUsers =
    createLegacyPersonalRecoveryApprovalDependencies(service).listAuthUsers;
  await assert.rejects(
    approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    (error) =>
      errorCode(error) === "legacy_personal_recovery_candidate_conflict",
  );
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(fixture.createCalls(), 0);
});

test("approval fails closed for merchant, staff, site-main, ID, and personal directory conflicts", async (t) => {
  const cases: Array<[string, Partial<ReturnType<typeof directory>>]> = [
    ["merchant", { merchantBindingCount: 1 }],
    ["staff", { staffBindingCount: 1 }],
    ["employee", { employeeBindingCount: 1 }],
    ["site-main", { merchantBindingCount: 1, systemSiteBindingCount: 1 }],
    ["identifier", { accountIdentifierCollisionCount: 1 }],
    ["personal auth", { personalAuthBindingCount: 1 }],
    ["personal id", { personalIdBindingCount: 1 }],
  ];
  for (const [name, conflict] of cases) {
    await t.test(name, async () => {
      const user = consistentUser();
      const recoveryCase = await addVerifiedMarker(user);
      const fixture = approvalFixture(user, { directoryConflict: conflict });
      await assert.rejects(
        approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
        (error) =>
          errorCode(error) === "legacy_personal_recovery_directory_conflict",
      );
      assert.equal(fixture.createCalls(), 0);
    });
  }
});

test("authoritative schema/ACL and every security counter are hard blockers", async () => {
  const blockedReadiness = readiness(0, false);
  assert.deepEqual(
    normalizeOrdinaryAuthoritativeReadiness(blockedReadiness),
    blockedReadiness,
  );
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const fixture = approvalFixture(user, { readinessReady: false });
  await assert.rejects(
    approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies),
    (error) => errorCode(error) === "legacy_personal_recovery_readiness_blocked",
  );
  assert.equal(fixture.createCalls(), 0);

  for (const field of [
    "crossAccountTypeOverlapCount",
    "accountIdentifierCollisionCount",
    "staffRegistryOverlapCount",
    "systemSitePrincipalOverlapCount",
  ] as const) {
    const unsafe = readiness(0, false);
    unsafe.invariants.schemaReady = true;
    unsafe.invariants.aclReady = true;
    unsafe.security[field] = 1;
    assert.equal(
      normalizeOrdinaryAuthoritativeReadiness(unsafe).readyForCutover,
      false,
    );
  }
});

test("expired verified marker cannot be approved and errors contain no configured PII", async () => {
  const user = consistentUser();
  const recoveryCase = await addVerifiedMarker(user);
  const fixture = approvalFixture(user);
  fixture.dependencies.now = () => NOW + 16 * 60 * 1000;
  let caught: unknown;
  try {
    await approveLegacyPersonalRecovery(recoveryCase, fixture.dependencies);
  } catch (error) {
    caught = error;
  }
  assert.equal(
    errorCode(caught),
    "legacy_personal_recovery_verification_required",
  );
  const serialized = JSON.stringify({
    name: (caught as Error).name,
    message: (caught as Error).message,
  });
  for (const sensitive of [EMAIL, PERSONAL_ACCOUNT_ID, AUTH_USER_ID, HMAC_SECRET]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});
