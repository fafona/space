import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LegacyPersonalRecoveryOpsError,
  RECOVERY_CONFIG_INPUT_MAGIC,
  createEncryptedRecoveryConfig,
  createProductionSupabaseOpsApi,
  decryptRecoveryConfig,
  discoverVerifiedLegacyCandidate,
  normalizeAuthoritativeReadiness,
  normalizeRecoveryObservation,
  parseGeneratorInput,
  parseProductionEnv,
  runGenerator,
  selectUniqueLegacyCandidate,
} from "./generate-legacy-personal-recovery-encrypted-config.mjs";
import {
  LEGACY_PERSONAL_RECOVERY_INSTALL_SECRET_NAMES,
  installRecoverySecrets,
} from "./install-legacy-personal-recovery-secrets.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const workflowPath = join(
  repositoryRoot,
  ".github",
  "workflows",
  "legacy-personal-recovery-encrypted-config.yml",
);
const generatorPath = join(
  repositoryRoot,
  "scripts",
  "generate-legacy-personal-recovery-encrypted-config.mjs",
);
const transportPath = join(
  repositoryRoot,
  "scripts",
  "run-legacy-personal-recovery-config-transport.sh",
);
const remotePath = join(
  repositoryRoot,
  "scripts",
  "run-legacy-personal-recovery-config-remote.sh",
);
const installerPath = join(
  repositoryRoot,
  "scripts",
  "install-legacy-personal-recovery-secrets.mjs",
);
const runbookPath = join(
  repositoryRoot,
  "docs",
  "legacy-personal-recovery-encrypted-config-runbook.md",
);
const foundationMigrationPath = join(
  repositoryRoot,
  "scripts",
  "supabase-migrations",
  "202608190035_ordinary_account_authorization_foundation.sql",
);

const [
  workflow,
  generator,
  transport,
  remote,
  installer,
  runbook,
  foundationMigration,
] =
  await Promise.all(
    [
      workflowPath,
      generatorPath,
      transportPath,
      remotePath,
      installerPath,
      runbookPath,
      foundationMigrationPath,
    ].map((path) => readFile(path, "utf8")),
  );

const candidateEmail = "legacy.personal@example.com";
const candidateEmailSha256 = createHash("sha256")
  .update(candidateEmail)
  .digest("hex");
const candidatePersonalAccountId = "50010105";
const candidateAuthUserId = "11111111-1111-4111-8111-111111111111";
const unrelatedAuthUserId = "22222222-2222-4222-8222-222222222222";
const operatorKeyPair = generateKeyPairSync("rsa", { modulusLength: 3072 });
const operatorPublicKeyPem = operatorKeyPair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const operatorPrivateKeyPem = operatorKeyPair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const operatorPublicKeyPemBase64 = Buffer.from(operatorPublicKeyPem).toString(
  "base64",
);
const unrelatedKeyPair = generateKeyPairSync("rsa", { modulusLength: 3072 });
const unrelatedPrivateKeyPem = unrelatedKeyPair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const weakKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const weakPublicKeyPemBase64 = Buffer.from(
  weakKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
).toString("base64");
const malformedPublicKeyPemBase64 = Buffer.from(
  "not a public key\n".repeat(20),
).toString("base64");

function authUser({
  id = candidateAuthUserId,
  email = candidateEmail,
  personalAccountId = candidatePersonalAccountId,
  accountType = "personal",
  appMetadata = {},
  userMetadata = {},
} = {}) {
  return {
    id,
    email,
    app_metadata: {
      account_type: accountType,
      personal_id: personalAccountId,
      account_id: personalAccountId,
      ...appMetadata,
    },
    user_metadata: {
      accountType,
      personalId: personalAccountId,
      loginId: personalAccountId,
      ...userMetadata,
    },
  };
}

function normalizedAuthUser(options = {}) {
  const value = authUser(options);
  return {
    id: value.id.toLowerCase(),
    email: value.email.trim().toLowerCase(),
    appMetadata: value.app_metadata,
    userMetadata: value.user_metadata,
  };
}

function readiness(overrides = {}) {
  return {
    schemaVersion: 1,
    asOf: "2026-08-19T12:00:00.000Z",
    readyForCutover: true,
    merchant: {
      recordCount: 10,
      authoritativeBindingCount: 10,
      invalidBindingCount: 0,
    },
    personal: {
      canonicalBindingCount: 0,
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
    invariants: { schemaReady: true, aclReady: true },
    ...overrides,
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

function recoveryObservation(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function stableApi({
  users = [normalizedAuthUser()],
  readinessValues = [readiness(), { ...readiness(), asOf: "2026-08-19T12:00:01.000Z" }],
  authorization = unboundAuthorization(),
  authorizationError = null,
  observer = recoveryObservation(),
  observerError = null,
} = {}) {
  let readinessIndex = 0;
  let authIndex = 0;
  return {
    async listAuthUsers() {
      const value = typeof users === "function" ? users(authIndex) : users;
      authIndex += 1;
      return structuredClone(value);
    },
    async callRpc(name) {
      if (
        name ===
        "faolla_get_ordinary_account_authoritative_cutover_readiness_v1"
      ) {
        const value = readinessValues[Math.min(readinessIndex, readinessValues.length - 1)];
        readinessIndex += 1;
        return structuredClone(value);
      }
      if (name === "faolla_resolve_ordinary_account_authorization_v1") {
        if (authorizationError) throw authorizationError;
        return structuredClone(authorization);
      }
      if (name === "faolla_observe_ordinary_account_recovery_v1") {
        if (observerError) throw observerError;
        return structuredClone(observer);
      }
      throw new Error("unexpected RPC");
    },
  };
}

function assertOpsError(error, code) {
  return error instanceof LegacyPersonalRecoveryOpsError && error.code === code;
}

test("workflow is manual, main-only, read-only, repository-key-pinned, and ciphertext-only", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|workflow_run):/m);
  const inputs = workflow.slice(
    workflow.indexOf("    inputs:"),
    workflow.indexOf("\npermissions:"),
  );
  assert.deepEqual(
    [...inputs.matchAll(/^      ([a-z0-9_]+):$/gm)].map((match) => match[1]),
    ["expected_sha", "confirmation"],
  );
  assert.doesNotMatch(inputs, /email|personal_account_id|candidate|operator|public|key/i);
  assert.match(
    workflow,
    /RECOVERY_OPS_OPERATOR_PUBLIC_KEY_PEM_BASE64: \$\{\{ secrets\.ORDINARY_LEGACY_PERSONAL_RECOVERY_OPERATOR_PUBLIC_KEY_PEM_BASE64 \}\}/,
  );
  assert.doesNotMatch(workflow, /inputs\.[^}\n]*(?:operator|public|key)/i);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /group: production-deploy/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /timeout-minutes: 10/);
  assert.doesNotMatch(workflow, /^\s+environment:/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /secrets\.SSH_KNOWN_HOSTS/);
  assert.match(workflow, /secrets\.ORDINARY_LEGACY_PERSONAL_RECOVERY_CANDIDATE_EMAIL_SHA256/);
  assert.match(workflow, /secrets\.ORDINARY_LEGACY_PERSONAL_RECOVERY_CANDIDATE_PERSONAL_ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /ssh-keyscan|StrictHostKeyChecking=accept-new/);
  assert.match(transport, /StrictHostKeyChecking=yes/);
  assert.match(transport, /UserKnownHostsFile=/);
  assert.match(transport, /GlobalKnownHostsFile=\/dev\/null/);
  assert.match(transport, /IdentitiesOnly=yes/);
  assert.match(transport, /KnownHostsCommand=none/);
  assert.match(transport, /UpdateHostKeys=no/);
  assert.match(transport, /VerifyHostKeyDNS=no/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /compression-level: 0/);
  assert.doesNotMatch(workflow, /GITHUB_OUTPUT|GITHUB_STEP_SUMMARY|STEP_SUMMARY|tee\b/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN|GH_TOKEN|\bPAT\b|gh secret set/);
  assert.doesNotMatch(workflow, /ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED/);
  assert.doesNotMatch(workflow, /deploy\.production|workflow run.*deploy/i);
});

test("transport and remote wrappers never place candidate secrets in argv or exported child state", () => {
  const sshBlock = transport.slice(
    transport.indexOf("} | ssh"),
    transport.indexOf("pipeline_status="),
  );
  assert.doesNotMatch(sshBlock, /\$candidate_email_sha256[^_]/);
  assert.doesNotMatch(sshBlock, /\$candidate_personal_account_id[^_]/);
  assert.match(transport, /unset RECOVERY_OPS_CANDIDATE_EMAIL_SHA256/);
  assert.match(transport, /unset RECOVERY_OPS_CANDIDATE_PERSONAL_ACCOUNT_ID/);
  assert.match(transport, /unset RECOVERY_OPS_OPERATOR_PUBLIC_KEY_PEM_BASE64/);
  const publicKeyValidator = transport.indexOf("if ! node -e '");
  const firstBase64Process = transport.indexOf('candidate_email_sha256_base64="$(');
  const sshProcess = transport.indexOf("} | ssh");
  assert.ok(publicKeyValidator > 0);
  assert.ok(publicKeyValidator < firstBase64Process);
  assert.ok(publicKeyValidator < sshProcess);
  assert.match(
    transport.slice(publicKeyValidator, firstBase64Process),
    /asymmetricKeyDetails\?\.modulusLength[\s\S]+modulusLength < 3072/,
  );
  assert.match(
    transport.slice(publicKeyValidator, firstBase64Process),
    /' <<<"\$operator_public_key_pem_base64" >\/dev\/null 2>&1/,
  );
  assert.doesNotMatch(
    transport.slice(publicKeyValidator, transport.indexOf("\n", publicKeyValidator)),
    /operator_public_key_pem_base64/,
  );
  assert.match(transport, /> "\$encrypted_artifact"/);
  assert.match(sshBlock, /2>\/dev\/null/);
  assert.doesNotMatch(transport, /tee\b|GITHUB_OUTPUT|GITHUB_STEP_SUMMARY/);
  assert.match(remote, /git symbolic-ref --quiet --short HEAD/);
  assert.match(remote, /actual_sha.*expected_sha/);
  assert.match(remote, /git diff --quiet HEAD/);
  assert.match(remote, /420s/);
  assert.match(remote, /node scripts\/generate-legacy-personal-recovery-encrypted-config\.mjs/);
  assert.doesNotMatch(remote, /echo .*candidate|set -x/);
  assert.match(generator, /process\.argv\.length !== 2/);
  assert.match(
    generator,
    /faolla_resolve_ordinary_account_authorization_v1/,
  );
  assert.match(
    generator,
    /faolla_observe_ordinary_account_recovery_v1[\s\S]+p_auth_user_id: authUserId[\s\S]+p_personal_account_id: personalAccountId/,
  );
  assert.match(
    foundationMigration,
    /from public\.merchant_enterprise_staff_identities as staff_identity[\s\S]+ordinary_account_staff_identity_forbidden/i,
  );
  assert.doesNotMatch(generator, /selectRows\(/);
  assert.doesNotMatch(
    generator,
    /faolla_personal_accounts|merchant_enterprise_staff_identities|\/rest\/v1\/(?!rpc\/)/,
    "the ops generator must use the service-only observer, never protected-table REST reads",
  );
});

test("runbook keeps discovery, secret installation, enablement, and cleanup separate", () => {
  assert.match(runbook, /never binds an account/i);
  assert.match(runbook, /never.*enables recovery/i);
  assert.match(runbook, /fresh OTP/i);
  assert.match(runbook, /super-admin/i);
  assert.match(runbook, /immediately delete both temporary candidate secrets/i);
  assert.match(
    runbook,
    /ORDINARY_LEGACY_PERSONAL_RECOVERY_OPERATOR_PUBLIC_KEY_PEM_BASE64/,
  );
  assert.match(runbook, /openssl base64 -A[\s\S]+gh secret set/i);
  assert.match(runbook, /does not use a GitHub Environment as a security boundary/i);
  assert.match(runbook, /separately reviewed change/i);
  assert.match(runbook, /Mandatory cleanup/);
  assert.match(runbook, /Remove this one-time workflow/);
  assert.match(installer, /\["secret", "set", name, "--repo", repository\]/);
  assert.doesNotMatch(installer, /--body|ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED/);
});

test("production env parsing accepts only a protected endpoint and exact service credential", () => {
  assert.deepEqual(
    parseProductionEnv(
      "SUPABASE_INTERNAL_URL=http://127.0.0.1:8000\nSUPABASE_SERVICE_ROLE_KEY=service-role-value\n",
    ),
    {
      baseUrl: "http://127.0.0.1:8000",
      serviceRoleKey: "service-role-value",
    },
  );
  assert.throws(
    () =>
      parseProductionEnv(
        "SUPABASE_INTERNAL_URL=http://supabase.example.com\nSUPABASE_SERVICE_ROLE_KEY=x\n",
      ),
    (error) => assertOpsError(error, "production_config_invalid"),
  );
  assert.throws(
    () =>
      parseProductionEnv(
        "SUPABASE_INTERNAL_URL=https://supabase.example.com\nSUPABASE_INTERNAL_URL=https://other.example.com\nSUPABASE_SERVICE_ROLE_KEY=x\n",
      ),
    (error) => assertOpsError(error, "production_config_invalid"),
  );
});

test("generator input is fixed-line stdin and requires a public RSA-3072 key", () => {
  const input = `${RECOVERY_CONFIG_INPUT_MAGIC}\n${candidateEmailSha256}\n${candidatePersonalAccountId}\n${operatorPublicKeyPemBase64}\n`;
  assert.deepEqual(parseGeneratorInput(input), {
    emailSha256: candidateEmailSha256,
    personalAccountId: candidatePersonalAccountId,
    publicKeyPem: operatorPublicKeyPem,
  });
  assert.throws(
    () =>
      parseGeneratorInput(
        `${RECOVERY_CONFIG_INPUT_MAGIC}\n${candidateEmailSha256}\n${candidatePersonalAccountId}\n${Buffer.from(operatorPrivateKeyPem).toString("base64")}\n`,
      ),
    (error) => assertOpsError(error, "public_key_invalid"),
  );
  assert.throws(
    () =>
      parseGeneratorInput(
        `${RECOVERY_CONFIG_INPUT_MAGIC}\n${candidateEmailSha256}\n${candidatePersonalAccountId}\n${weakPublicKeyPemBase64}\n`,
      ),
    (error) => assertOpsError(error, "public_key_invalid"),
  );
  assert.throws(
    () => parseGeneratorInput(`${input}extra\n`),
    (error) => assertOpsError(error, "input_invalid"),
  );
  assert.throws(
    () =>
      parseGeneratorInput(
        `${RECOVERY_CONFIG_INPUT_MAGIC}\n${candidateEmailSha256}\n50000000\n${operatorPublicKeyPemBase64}\n`,
      ),
    (error) => assertOpsError(error, "input_invalid"),
  );
});

test("Auth admin traversal derives and verifies every exact page", async () => {
  const rawUsers = Array.from({ length: 201 }, (_, index) =>
    authUser({
      id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
      email: `person-${index}@example.com`,
      personalAccountId: String(50_010_105 + index),
    }),
  );
  const requestedPages = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get("page"));
    const perPage = Number(parsed.searchParams.get("per_page"));
    requestedPages.push([page, perPage]);
    const start = (page - 1) * perPage;
    return new Response(
      JSON.stringify({ users: rawUsers.slice(start, start + perPage) }),
      { status: 200, headers: { "x-total-count": String(rawUsers.length) } },
    );
  };
  const api = createProductionSupabaseOpsApi({
    baseUrl: "http://127.0.0.1:8000",
    serviceRoleKey: "test-service-role",
    fetchImpl,
  });
  const users = await api.listAuthUsers();
  assert.equal(users.length, 201);
  assert.deepEqual(requestedPages, [
    [1, 200],
    [2, 200],
  ]);
});

test("Auth traversal fails closed on missing totals, short pages, total drift, and duplicate UUIDs", async (t) => {
  async function expectPaginationError(fetchImpl) {
    const api = createProductionSupabaseOpsApi({
      baseUrl: "http://127.0.0.1:8000",
      serviceRoleKey: "test-service-role",
      fetchImpl,
    });
    await assert.rejects(
      api.listAuthUsers(),
      (error) =>
        error instanceof LegacyPersonalRecoveryOpsError &&
        ["auth_pagination_invalid", "auth_directory_invalid"].includes(error.code),
    );
  }

  await t.test("missing total", async () => {
    await expectPaginationError(
      async () => new Response(JSON.stringify({ users: [] }), { status: 200 }),
    );
  });
  await t.test("short page", async () => {
    await expectPaginationError(
      async () =>
        new Response(JSON.stringify({ users: [] }), {
          status: 200,
          headers: { "x-total-count": "1" },
        }),
    );
  });
  await t.test("total drift", async () => {
    let calls = 0;
    const page = Array.from({ length: 200 }, (_, index) =>
      authUser({
        id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
        email: `drift-${index}@example.com`,
        personalAccountId: String(50_010_105 + index),
      }),
    );
    await expectPaginationError(async () => {
      calls += 1;
      return new Response(JSON.stringify({ users: calls === 1 ? page : [] }), {
        status: 200,
        headers: { "x-total-count": calls === 1 ? "201" : "200" },
      });
    });
  });
  await t.test("duplicate UUID", async () => {
    const duplicate = authUser();
    await expectPaginationError(
      async () =>
        new Response(JSON.stringify({ users: [duplicate, duplicate] }), {
          status: 200,
          headers: { "x-total-count": "2" },
        }),
    );
  });
});

test("authoritative readiness requires the exact 037-safe shape", () => {
  assert.equal(normalizeAuthoritativeReadiness(readiness()).readyForCutover, true);
  const missingSystemIsolation = readiness();
  delete missingSystemIsolation.security.systemSitePrincipalOverlapCount;
  assert.throws(
    () => normalizeAuthoritativeReadiness(missingSystemIsolation),
    (error) => assertOpsError(error, "upstream_response_invalid"),
  );
  assert.throws(
    () =>
      normalizeAuthoritativeReadiness(
        readiness({
          readyForCutover: false,
          security: {
            ...readiness().security,
            systemSitePrincipalOverlapCount: 1,
          },
        }),
      ),
    (error) => assertOpsError(error, "readiness_blocked"),
  );
  assert.throws(
    () =>
      normalizeAuthoritativeReadiness({
        ...readiness(),
        unexpected: true,
      }),
    (error) => assertOpsError(error, "upstream_response_invalid"),
  );
  assert.throws(
    () =>
      normalizeAuthoritativeReadiness(
        readiness({
          merchant: {
            recordCount: 10,
            authoritativeBindingCount: 9,
            invalidBindingCount: 0,
          },
        }),
      ),
    (error) => assertOpsError(error, "upstream_response_invalid"),
  );
});

test("recovery observer accepts only the exact per-target unbound envelope", () => {
  assert.deepEqual(
    normalizeRecoveryObservation(recoveryObservation()),
    recoveryObservation(),
  );
  const missing = recoveryObservation();
  delete missing.personalOtherAuthBindingCount;
  assert.throws(
    () => normalizeRecoveryObservation(missing),
    (error) => assertOpsError(error, "upstream_response_invalid"),
  );
  assert.throws(
    () =>
      normalizeRecoveryObservation({
        ...recoveryObservation(),
        unexpected: 0,
      }),
    (error) => assertOpsError(error, "upstream_response_invalid"),
  );
  assert.throws(
    () =>
      normalizeRecoveryObservation(
        recoveryObservation({ personalIdBindingCount: -1 }),
      ),
    (error) => assertOpsError(error, "upstream_response_invalid"),
  );
  assert.throws(
    () =>
      normalizeRecoveryObservation(
        recoveryObservation({ personalOtherAuthBindingCount: 1 }),
      ),
    (error) => assertOpsError(error, "upstream_response_invalid"),
  );
});

test("candidate selection uses email hash as primary and metadata only as exact corroboration", () => {
  const candidate = normalizedAuthUser();
  assert.equal(
    selectUniqueLegacyCandidate(
      [candidate],
      candidateEmailSha256,
      candidatePersonalAccountId,
    ).id,
    candidateAuthUserId,
  );
  assert.throws(
    () =>
      selectUniqueLegacyCandidate(
        [
          candidate,
          normalizedAuthUser({
            id: unrelatedAuthUserId,
            email: "other@example.com",
          }),
        ],
        candidateEmailSha256,
        candidatePersonalAccountId,
      ),
    (error) => assertOpsError(error, "candidate_other_claimant"),
  );
  assert.throws(
    () =>
      selectUniqueLegacyCandidate(
        [
          normalizedAuthUser({
            userMetadata: { accountType: "merchant" },
          }),
        ],
        candidateEmailSha256,
        candidatePersonalAccountId,
      ),
    (error) => assertOpsError(error, "candidate_metadata_invalid"),
  );
  assert.throws(
    () =>
      selectUniqueLegacyCandidate(
        [
          normalizedAuthUser({
            appMetadata: { principal_type: "merchant_staff" },
          }),
        ],
        candidateEmailSha256,
        candidatePersonalAccountId,
      ),
    (error) => assertOpsError(error, "candidate_staff_forbidden"),
  );
});

test("discovery performs two stable full observations before returning a UUID", async () => {
  const candidate = await discoverVerifiedLegacyCandidate(
    stableApi(),
    candidateEmailSha256,
    candidatePersonalAccountId,
  );
  assert.deepEqual(candidate, { authUserId: candidateAuthUserId });

  const existingUnrelatedCanonical = readiness({
    personal: {
      ...readiness().personal,
      canonicalBindingCount: 1,
    },
  });
  assert.deepEqual(
    await discoverVerifiedLegacyCandidate(
      stableApi({
        readinessValues: [
          existingUnrelatedCanonical,
          {
            ...existingUnrelatedCanonical,
            asOf: "2026-08-19T12:00:01.000Z",
          },
        ],
      }),
      candidateEmailSha256,
      candidatePersonalAccountId,
    ),
    { authUserId: candidateAuthUserId },
    "an unrelated canonical row must not replace the observer's per-target proof",
  );

  await assert.rejects(
    discoverVerifiedLegacyCandidate(
      stableApi({
        users(index) {
          return [
            normalizedAuthUser(),
            normalizedAuthUser({
              id: unrelatedAuthUserId,
              email: index === 0 ? "stable@example.com" : "changed@example.com",
              personalAccountId: "50010106",
            }),
          ];
        },
      }),
      candidateEmailSha256,
      candidatePersonalAccountId,
    ),
    (error) => assertOpsError(error, "observation_drift"),
  );
});

test("production generator performs two exact Auth/readiness/resolver/observer passes", async () => {
  const calls = [];
  let readinessCall = 0;
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({
      path: url.pathname,
      page: url.searchParams.get("page"),
      method: options.method,
      body,
      authorization: options.headers.authorization,
    });
    if (url.pathname === "/auth/v1/admin/users") {
      return new Response(JSON.stringify({ users: [authUser()] }), {
        status: 200,
        headers: { "x-total-count": "1" },
      });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_get_ordinary_account_authoritative_cutover_readiness_v1"
    ) {
      readinessCall += 1;
      return new Response(
        JSON.stringify(
          readiness({
            asOf:
              readinessCall === 1
                ? "2026-08-19T12:00:00.000Z"
                : "2026-08-19T12:00:01.000Z",
          }),
        ),
        { status: 200 },
      );
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      assert.deepEqual(body, { p_auth_user_id: candidateAuthUserId });
      return new Response(JSON.stringify(unboundAuthorization()), {
        status: 200,
      });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_observe_ordinary_account_recovery_v1"
    ) {
      assert.deepEqual(body, {
        p_auth_user_id: candidateAuthUserId,
        p_personal_account_id: candidatePersonalAccountId,
      });
      return new Response(JSON.stringify(recoveryObservation()), {
        status: 200,
      });
    }
    return new Response("{}", { status: 404 });
  };
  const inputRaw = `${RECOVERY_CONFIG_INPUT_MAGIC}\n${candidateEmailSha256}\n${candidatePersonalAccountId}\n${operatorPublicKeyPemBase64}\n`;
  const envelope = await runGenerator({
    inputRaw,
    envRaw:
      "SUPABASE_INTERNAL_URL=http://127.0.0.1:8000\nSUPABASE_SERVICE_ROLE_KEY=service-role-test-value\n",
    fetchImpl,
    now: Date.parse("2026-08-19T12:00:00.000Z"),
  });
  const counts = calls.reduce((result, call) => {
    result[call.path] = (result[call.path] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, {
    "/rest/v1/rpc/faolla_get_ordinary_account_authoritative_cutover_readiness_v1": 2,
    "/auth/v1/admin/users": 2,
    "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1": 2,
    "/rest/v1/rpc/faolla_observe_ordinary_account_recovery_v1": 2,
  });
  assert.ok(calls.every((call) => call.authorization === "Bearer service-role-test-value"));
  const decrypted = decryptRecoveryConfig(envelope, operatorPrivateKeyPem);
  assert.equal(JSON.parse(decrypted.caseJson).authUserId, candidateAuthUserId);
});

test("discovery rejects resolver and every per-target observer conflict", async (t) => {
  await t.test("resolver already bound", async () => {
    await assert.rejects(
      discoverVerifiedLegacyCandidate(
        stableApi({
          authorization: {
            schemaVersion: 1,
            status: "resolved",
            accountType: "merchant",
            merchantIds: ["10000000"],
            personalAccountId: null,
          },
        }),
        candidateEmailSha256,
        candidatePersonalAccountId,
      ),
      (error) => assertOpsError(error, "resolver_conflict"),
    );
  });

  await t.test("035 resolver failure including staff rejection", async () => {
    await assert.rejects(
      discoverVerifiedLegacyCandidate(
        stableApi({
          authorizationError: new LegacyPersonalRecoveryOpsError(
            "database_unavailable",
          ),
        }),
        candidateEmailSha256,
        candidatePersonalAccountId,
      ),
      (error) => assertOpsError(error, "database_unavailable"),
    );
  });

  for (const countKey of [
    "merchantBindingCount",
    "systemSiteBindingCount",
    "staffBindingCount",
    "employeeBindingCount",
    "accountIdentifierCollisionCount",
    "personalAuthBindingCount",
    "personalIdBindingCount",
    "personalOtherAuthBindingCount",
    "exactCanonicalBindingCount",
  ]) {
    await t.test(countKey, async () => {
      const observerConflict =
        countKey === "personalOtherAuthBindingCount"
          ? recoveryObservation({
              personalIdBindingCount: 1,
              personalOtherAuthBindingCount: 1,
            })
          : countKey === "exactCanonicalBindingCount"
            ? recoveryObservation({
                personalAuthBindingCount: 1,
                personalIdBindingCount: 1,
                exactCanonicalBindingCount: 1,
              })
            : recoveryObservation({ [countKey]: 1 });
      await assert.rejects(
        discoverVerifiedLegacyCandidate(
          stableApi({
            observer: observerConflict,
          }),
          candidateEmailSha256,
          candidatePersonalAccountId,
        ),
        (error) => assertOpsError(error, "directory_conflict"),
      );
    });
  }
});

test("envelope contains only hybrid ciphertext and decrypts to exact five-field case plus independent HMAC", () => {
  const envelope = createEncryptedRecoveryConfig({
    authUserId: candidateAuthUserId,
    personalAccountId: candidatePersonalAccountId,
    emailSha256: candidateEmailSha256,
    publicKeyPem: operatorPublicKeyPem,
    now: Date.parse("2026-08-19T12:00:00.000Z"),
  });
  assert.equal(envelope.includes(candidateAuthUserId), false);
  assert.equal(envelope.includes(candidateEmailSha256), false);
  assert.equal(envelope.includes(candidatePersonalAccountId), false);
  const decrypted = decryptRecoveryConfig(envelope, operatorPrivateKeyPem);
  assert.throws(
    () => decryptRecoveryConfig(envelope, unrelatedPrivateKeyPem),
    (error) => assertOpsError(error, "encrypted_envelope_invalid"),
  );
  const recoveryCase = JSON.parse(decrypted.caseJson);
  assert.deepEqual(Object.keys(recoveryCase), [
    "caseId",
    "authUserId",
    "personalAccountId",
    "emailSha256",
    "expiresAt",
  ]);
  assert.equal(recoveryCase.authUserId, candidateAuthUserId);
  assert.equal(recoveryCase.personalAccountId, candidatePersonalAccountId);
  assert.equal(recoveryCase.emailSha256, candidateEmailSha256);
  assert.match(decrypted.hmacSecret, /^[0-9a-f]{64}$/);
  assert.notEqual(decrypted.hmacSecret, createHash("sha256").update(decrypted.caseJson).digest("hex"));
});

function resolveBashExecutable() {
  if (process.platform !== "win32") return "/bin/bash";
  return "C:\\Program Files\\Git\\bin\\bash.exe";
}

function toBashPath(path) {
  if (process.platform !== "win32") return path.replaceAll("\\", "/");
  const normalized = resolve(path).replaceAll("\\", "/");
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!match) return normalized;
  return `/${match[1].toLowerCase()}/${match[2]}`;
}

async function runTransportScenario({
  sshStatus = 0,
  candidateEmailHash = candidateEmailSha256,
  candidatePersonalId = candidatePersonalAccountId,
  operatorKeyBase64 = operatorPublicKeyPemBase64,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "faolla-recovery-ops-transport-"));
  const fakeBin = join(root, "bin");
  const runnerTemp = join(root, "runner");
  const argvCapture = join(root, "argv.bin");
  const envCapture = join(root, "env.bin");
  const stdinCapture = join(root, "stdin.bin");
  const envelopeFile = join(root, "fake-envelope.json");
  const knownHosts = join(root, "known_hosts");
  const privateKeyFile = join(root, "id_ed25519");
  await Promise.all([
    import("node:fs/promises").then(({ mkdir }) => mkdir(fakeBin)),
    import("node:fs/promises").then(({ mkdir }) => mkdir(runnerTemp)),
  ]);
  const envelope = createEncryptedRecoveryConfig({
    authUserId: candidateAuthUserId,
    personalAccountId: candidatePersonalAccountId,
    emailSha256: candidateEmailSha256,
    publicKeyPem: operatorPublicKeyPem,
  });
  await Promise.all([
    writeFile(envelopeFile, `${envelope}\n`, { mode: 0o600 }),
    writeFile(knownHosts, "example.test ssh-ed25519 AAAATEST\n", { mode: 0o600 }),
    writeFile(privateKeyFile, "test-private-key\n", { mode: 0o600 }),
  ]);
  const fakeSsh = join(fakeBin, "ssh");
  await writeFile(
    fakeSsh,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf '%s\\0' \"$@\" > \"$FAKE_CAPTURE_ARGV\"",
      "env -0 > \"$FAKE_CAPTURE_ENV\"",
      "cat > \"$FAKE_CAPTURE_STDIN\"",
      "cat \"$FAKE_CAPTURE_STDIN\" >&2",
      "cat \"$FAKE_ENVELOPE_FILE\"",
      "exit \"$FAKE_SSH_STATUS\"",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  await chmod(fakeSsh, 0o700);
  const sha = "a".repeat(40);
  const env = {
    ...process.env,
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: "123456789",
    RUNNER_TEMP: toBashPath(runnerTemp),
    RECOVERY_OPS_EXPECTED_SHA: sha,
    RECOVERY_OPS_CONFIRMATION:
      "GENERATE_LEGACY_PERSONAL_RECOVERY_ENCRYPTED_CONFIG",
    RECOVERY_OPS_OPERATOR_PUBLIC_KEY_PEM_BASE64: operatorKeyBase64,
    RECOVERY_OPS_CANDIDATE_EMAIL_SHA256: candidateEmailHash,
    RECOVERY_OPS_CANDIDATE_PERSONAL_ACCOUNT_ID: candidatePersonalId,
    RECOVERY_OPS_SSH_HOST: "example.test",
    RECOVERY_OPS_SSH_PORT: "22",
    RECOVERY_OPS_SSH_USER: "deploy",
    RECOVERY_OPS_APP_DIR: "/var/www/merchant-space",
    RECOVERY_OPS_KNOWN_HOSTS_FILE: toBashPath(knownHosts),
    RECOVERY_OPS_SSH_PRIVATE_KEY_FILE: toBashPath(privateKeyFile),
    FAKE_BIN: toBashPath(fakeBin),
    FAKE_CAPTURE_ARGV: toBashPath(argvCapture),
    FAKE_CAPTURE_ENV: toBashPath(envCapture),
    FAKE_CAPTURE_STDIN: toBashPath(stdinCapture),
    FAKE_ENVELOPE_FILE: toBashPath(envelopeFile),
    FAKE_SSH_STATUS: String(sshStatus),
  };
  const result = spawnSync(
    resolveBashExecutable(),
    [
      "-c",
      'export PATH="$FAKE_BIN:$PATH"; exec bash scripts/run-legacy-personal-recovery-config-transport.sh',
    ],
    {
      cwd: repositoryRoot,
      env,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  return {
    root,
    runnerTemp,
    result,
    argv: await readFile(argvCapture).catch(() => Buffer.alloc(0)),
    childEnv: await readFile(envCapture).catch(() => Buffer.alloc(0)),
    framedInput: await readFile(stdinCapture).catch(() => Buffer.alloc(0)),
    artifactPath: join(
      runnerTemp,
      "legacy-personal-recovery-config.enc.json",
    ),
  };
}

test("transport behavior confines candidate material to the SSH stdin frame", async (t) => {
  const scenario = await runTransportScenario();
  try {
    assert.equal(scenario.result.status, 0, scenario.result.stderr);
    const argv = scenario.argv.toString("utf8");
    const childEnv = scenario.childEnv.toString("utf8");
    const output = `${scenario.result.stdout}\n${scenario.result.stderr}`;
    const artifact = await readFile(scenario.artifactPath, "utf8");
    for (const sensitive of [
      candidateEmailSha256,
      candidatePersonalAccountId,
      Buffer.from(candidateEmailSha256).toString("base64"),
      Buffer.from(candidatePersonalAccountId).toString("base64"),
      operatorPublicKeyPem,
      operatorPublicKeyPemBase64,
    ]) {
      assert.equal(argv.includes(sensitive), false);
      assert.equal(childEnv.includes(sensitive), false);
      assert.equal(output.includes(sensitive), false);
      assert.equal(artifact.includes(sensitive), false);
    }
    assert.equal(
      scenario.framedInput.includes(Buffer.from(candidateEmailSha256)),
      true,
    );
    assert.equal(
      scenario.framedInput.includes(Buffer.from(candidatePersonalAccountId)),
      true,
    );
    assert.equal(
      scenario.framedInput.includes(Buffer.from(operatorPublicKeyPemBase64)),
      true,
    );
    assert.match(argv, /StrictHostKeyChecking=yes/);
    assert.match(argv, /GlobalKnownHostsFile=\/dev\/null/);
    assert.match(argv, /KnownHostsCommand=none/);
    assert.match(argv, /UpdateHostKeys=no/);
    assert.match(argv, /VerifyHostKeyDNS=no/);
    assert.match(argv, /run-legacy-personal-recovery-config-remote\.sh/);
    assert.match(output, /run=123456789/);
    assert.match(output, /sha=a{40}/);
    assert.match(output, /result=encrypted_config_created/);
    assert.deepEqual(scenario.result.stdout.trim().split(/\r?\n/), [
      "[legacy-personal-recovery-ops] run=123456789",
      `[legacy-personal-recovery-ops] sha=${"a".repeat(40)}`,
      "[legacy-personal-recovery-ops] result=encrypted_config_created",
    ]);
    assert.equal(scenario.result.stderr, "");
    assert.equal((await stat(scenario.artifactPath)).isFile(), true);
    const decryptedArtifact = decryptRecoveryConfig(
      artifact,
      operatorPrivateKeyPem,
    );
    assert.equal(
      JSON.parse(decryptedArtifact.caseJson).authUserId,
      candidateAuthUserId,
    );
    assert.throws(
      () => decryptRecoveryConfig(artifact, unrelatedPrivateKeyPem),
      (error) => assertOpsError(error, "encrypted_envelope_invalid"),
    );

    await t.test("failed SSH leaves no artifact and no candidate output", async () => {
      const failed = await runTransportScenario({ sshStatus: 37 });
      try {
        assert.notEqual(failed.result.status, 0);
        const failedOutput = `${failed.result.stdout}\n${failed.result.stderr}`;
        assert.equal(failedOutput.includes(candidateEmailSha256), false);
        assert.equal(failedOutput.includes(candidatePersonalAccountId), false);
        assert.match(failedOutput, /result=remote_generation_failed/);
        for (const line of failedOutput.split(/\r?\n/).filter(Boolean)) {
          assert.match(
            line,
            /^\[legacy-personal-recovery-ops\] (?:run=\d+|sha=[0-9a-f]{40}|result=[a-z0-9_]+)$/,
          );
        }
        await assert.rejects(stat(failed.artifactPath), { code: "ENOENT" });
      } finally {
        await rm(failed.root, { recursive: true, force: true });
      }
    });

    await t.test("invalid candidate fails before SSH without disclosing the value", async () => {
      const invalidPersonalId = "50000000";
      const failed = await runTransportScenario({
        candidatePersonalId: invalidPersonalId,
      });
      try {
        assert.notEqual(failed.result.status, 0);
        const failedOutput = `${failed.result.stdout}\n${failed.result.stderr}`;
        assert.equal(failedOutput.includes(invalidPersonalId), false);
        assert.match(failedOutput, /result=candidate_input_invalid/);
        assert.equal(failed.argv.length, 0);
        assert.equal(failed.framedInput.length, 0);
        await assert.rejects(stat(failed.artifactPath), { code: "ENOENT" });
      } finally {
        await rm(failed.root, { recursive: true, force: true });
      }
    });

    for (const [name, operatorKeyBase64, expectedCode] of [
      ["missing fixed key", "", "required_configuration_missing"],
      ["malformed fixed key", malformedPublicKeyPemBase64, "public_key_invalid"],
      ["weak RSA key", weakPublicKeyPemBase64, "public_key_invalid"],
    ]) {
      await t.test(`${name} fails before SSH without disclosing the value`, async () => {
        const failed = await runTransportScenario({ operatorKeyBase64 });
        try {
          assert.notEqual(failed.result.status, 0);
          const failedOutput = `${failed.result.stdout}\n${failed.result.stderr}`;
          if (operatorKeyBase64) {
            assert.equal(failedOutput.includes(operatorKeyBase64), false);
          }
          assert.match(failedOutput, new RegExp(`result=${expectedCode}`));
          assert.equal(failed.argv.length, 0);
          assert.equal(failed.framedInput.length, 0);
          await assert.rejects(stat(failed.artifactPath), { code: "ENOENT" });
        } finally {
          await rm(failed.root, { recursive: true, force: true });
        }
      });
    }
  } finally {
    await rm(scenario.root, { recursive: true, force: true });
  }
});

test("local installer sends only decrypted values over gh stdin and never enables recovery", () => {
  const envelope = createEncryptedRecoveryConfig({
    authUserId: candidateAuthUserId,
    personalAccountId: candidatePersonalAccountId,
    emailSha256: candidateEmailSha256,
    publicKeyPem: operatorPublicKeyPem,
  });
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, input: options.input, env: options.env });
    return { status: 0, stdout: "", stderr: "" };
  };
  installRecoverySecrets({
    encryptedEnvelope: envelope,
    privateKeyPem: operatorPrivateKeyPem,
    repository: "owner/repo",
    spawnImpl,
    runtimeEnvironment: {
      PATH: process.env.PATH,
      GITHUB_TOKEN: "workflow-token-must-not-reach-gh",
      GH_TOKEN: "pat-must-not-reach-gh",
      GITHUB_ENTERPRISE_TOKEN: "enterprise-token-must-not-reach-gh",
      GH_ENTERPRISE_TOKEN: "enterprise-pat-must-not-reach-gh",
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.args[2]),
    [
      LEGACY_PERSONAL_RECOVERY_INSTALL_SECRET_NAMES.hmac,
      LEGACY_PERSONAL_RECOVERY_INSTALL_SECRET_NAMES.caseJson,
    ],
  );
  for (const call of calls) {
    assert.equal(call.command, "gh");
    assert.deepEqual(call.args.slice(0, 2), ["secret", "set"]);
    assert.equal(call.args.join(" ").includes(candidateAuthUserId), false);
    assert.equal(call.args.join(" ").includes(candidateEmailSha256), false);
    assert.equal(call.args.includes("--body"), false);
    assert.ok(typeof call.input === "string" && call.input.length > 0);
    assert.equal(call.env.GITHUB_TOKEN, undefined);
    assert.equal(call.env.GH_TOKEN, undefined);
    assert.equal(call.env.GITHUB_ENTERPRISE_TOKEN, undefined);
    assert.equal(call.env.GH_ENTERPRISE_TOKEN, undefined);
  }
  assert.match(calls[0].input, /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(calls[1].input).authUserId, candidateAuthUserId);
});
