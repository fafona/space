import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  access,
  chmod,
  link,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import { ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL } from "./check-ordinary-account-cutover-readiness.mjs";
import {
  buildOrdinaryAccountCutoverReadinessFenceSql,
  holdOrdinaryAccountCutoverReadinessFence,
  ordinaryAccountCutoverReadinessFenceFailureLogBytes,
  OrdinaryAccountCutoverReadinessFenceError,
  probeOrdinaryAccountCutoverReadinessFenceEndpoints,
  parseOrdinaryAccountCutoverReadinessFenceFailureLog,
  readOrdinaryAccountCutoverReadinessFenceFailureRecord,
  readAuthorizedOrdinaryAccountCutoverFenceReleaseRequest,
  resolveSupabaseServiceClientAddresses,
  runOrdinaryAccountCutoverReadinessFenceCli,
  terminateOrdinaryAccountCutoverReadinessFenceSession,
  writeAtomicReadinessFenceMarker,
} from "./hold-ordinary-account-cutover-readiness-fence.mjs";
import {
  canonicalJsonBytes,
  parseProductionReleaseAttestation,
  PRODUCTION_BACKUP_ATTESTATION_KIND,
  PRODUCTION_READINESS_ATTESTATION_KIND,
  sha256Hex,
} from "./production-release-attestation.mjs";

const NOW = "2026-08-20T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const TARGET_SHA = "a".repeat(40);
const CONTAINER_ID = "b".repeat(64);
const REST_SERVICE_IDENTITY = {
  containerId: "c".repeat(64),
  imageId: `sha256:${"d".repeat(64)}`,
  clientAddresses: ["172.20.0.10"],
  clientAddressSources: {
    dockerIpv4: ["172.20.0.10"],
    dockerIpv6: ["2001:db8:20::10"],
    sharedGateway: ["172.20.0.1", "2001:db8:20::1"],
  },
  databaseUser: "authenticator",
  databaseName: "postgres",
  databasePort: "5432",
};
const AUTH_SERVICE_IDENTITY = {
  containerId: "e".repeat(64),
  imageId: `sha256:${"f".repeat(64)}`,
  clientAddresses: ["172.20.0.11"],
  clientAddressSources: {
    dockerIpv4: ["172.20.0.11"],
    dockerIpv6: ["2001:db8:20::11"],
    sharedGateway: ["172.20.0.1", "2001:db8:20::1"],
  },
  databaseUser: "supabase_auth_admin",
  databaseName: "postgres",
  databasePort: "5432",
};
const SERVICE_IDENTITIES = {
  rest: REST_SERVICE_IDENTITY,
  auth: AUTH_SERVICE_IDENTITY,
};

function database(overrides = {}) {
  return {
    containerName: "supabase-db",
    containerId: CONTAINER_ID,
    dbName: "postgres",
    dbOid: "16384",
    systemId: "7612345678901234567",
    primary: true,
    ...overrides,
  };
}

function baseline(overrides = {}) {
  return {
    merchantRecordCount: "11",
    merchantAuthoritativeBindingCount: "11",
    merchantInvalidBindingCount: "0",
    personalCanonicalBindingCount: "6",
    personalCanonicalOrphanCount: "0",
    personalInvalidCanonicalCount: "0",
    personalDuplicateAuthUserCount: "0",
    personalDuplicateAccountIdCount: "0",
    crossAccountTypeOverlapCount: "0",
    accountIdentifierCollisionCount: "0",
    staffRegistryOverlapCount: "0",
    systemSitePrincipalOverlapCount: "0",
    ordinaryIdentityContentSha256: "1".repeat(64),
    ...overrides,
  };
}

function artifact({
  id,
  name,
  runId,
  createdAt,
  file,
  digestCharacter = "c",
} = {}) {
  return {
    id,
    name,
    digest: `sha256:${digestCharacter.repeat(64)}`,
    sizeBytes: "4096",
    createdAt,
    expiresAt: "2026-08-27T12:00:00.000Z",
    expired: false,
    workflowRunId: runId,
    workflowRunAttempt: "1",
    headSha: TARGET_SHA,
    file,
  };
}

function readinessAttestation(overrides = {}) {
  const backup = parseProductionReleaseAttestation(
    {
      schemaVersion: 1,
      kind: PRODUCTION_BACKUP_ATTESTATION_KIND,
      repository: "fafona/space",
      targetSha: TARGET_SHA,
      run: {
        id: "8001",
        attempt: "1",
        workflowPath: ".github/workflows/database-backup.yml",
        event: "workflow_dispatch",
        headSha: TARGET_SHA,
        headBranch: "main",
      },
      remoteSource: {
        headSha: TARGET_SHA,
        originMainSha: TARGET_SHA,
        detached: true,
        cleanBefore: true,
        cleanAfter: true,
      },
      database: database(),
      baseline: baseline(),
      backupArtifact: artifact({
        id: "9001",
        name: "faolla-encrypted-disaster-recovery-8001-1",
        runId: "8001",
        createdAt: "2026-08-20T11:00:00.000Z",
        file: {
          name: "faolla-database-backup.tar.enc",
          sizeBytes: "2048",
          sha256: "d".repeat(64),
        },
      }),
      issuedAt: "2026-08-20T11:05:00.000Z",
      validUntil: "2026-08-21T11:05:00.000Z",
    },
    { nowMs: NOW_MS, expectedKind: "backup" },
  );
  const backupBytes = canonicalJsonBytes(backup);
  const value = {
    schemaVersion: 1,
    kind: PRODUCTION_READINESS_ATTESTATION_KIND,
    repository: "fafona/space",
    targetSha: TARGET_SHA,
    run: {
      id: "8002",
      attempt: "1",
      workflowPath: ".github/workflows/ordinary-account-cutover-readiness.yml",
      event: "workflow_dispatch",
      headSha: TARGET_SHA,
      headBranch: "main",
    },
    remoteSource: {
      headSha: TARGET_SHA,
      originMainSha: TARGET_SHA,
      detached: true,
      cleanBefore: true,
      cleanAfter: true,
    },
    database: database(),
    baseline: baseline(),
    readinessArtifact: artifact({
      id: "9003",
      name: "faolla-production-readiness-report-8002-1",
      runId: "8002",
      createdAt: "2026-08-20T11:59:00.000Z",
      digestCharacter: "f",
      file: {
        name: "production-readiness-report.json",
        sizeBytes: "1024",
        sha256: "e".repeat(64),
      },
    }),
    backup: {
      attestation: backup,
      attestationArtifact: artifact({
        id: "9002",
        name: "faolla-production-backup-attestation-8001-1",
        runId: "8001",
        createdAt: "2026-08-20T11:10:00.000Z",
        digestCharacter: "1",
        file: {
          name: "production-backup-attestation.json",
          sizeBytes: String(backupBytes.length),
          sha256: sha256Hex(backupBytes),
        },
      }),
    },
    issuedAt: NOW,
    validUntil: "2026-08-20T14:00:00.000Z",
  };
  return parseProductionReleaseAttestation(Object.assign(value, overrides), {
    nowMs: NOW_MS,
    expectedKind: "readiness",
  });
}

function readyReport(overrides = {}) {
  const value = {
    databaseActorReady: true,
    databaseIdentity: {
      dbName: "postgres",
      dbOid: "16384",
      systemId: "7612345678901234567",
      primary: true,
    },
    databaseIdentityReady: true,
    baselineReady: true,
    runtimeRpcHardeningReady: true,
    migrationsReady: true,
    functionMetadataReady: true,
    functionAclReady: true,
    registryAclReady: true,
    objectContractsReady: true,
    readiness: {
      schemaVersion: 1,
      asOf: NOW,
      readyForCutover: true,
      schemaReady: true,
      aclReady: true,
      merchantRecordCount: 11,
      merchantAuthoritativeBindingCount: 11,
      merchantInvalidBindingCount: 0,
      personalCanonicalBindingCount: 6,
      personalCanonicalOrphanCount: 0,
      personalInvalidCanonicalCount: 0,
      personalDuplicateAuthUserCount: 0,
      personalDuplicateAccountIdCount: 0,
      crossAccountTypeOverlapCount: 0,
      accountIdentifierCollisionCount: 0,
      staffRegistryOverlapCount: 0,
      systemSitePrincipalOverlapCount: 0,
      ordinaryIdentityContentSha256: "1".repeat(64),
    },
  };
  return Object.assign(value, overrides);
}

function fenceLine(report = readyReport()) {
  return `${JSON.stringify({ backendPid: "4321", report })}\n`;
}

function fenceHoldLine(overrides = {}) {
  return `${JSON.stringify({
    backendPid: "4321",
    holdLocks: {
      authShareLockCount: "1",
      authAccessExclusiveLockCount: "0",
      pagesAccessExclusiveLockCount: "0",
      registryAccessExclusiveLockCount: "1",
      ...overrides,
    },
  })}\n`;
}

class FakeChild extends EventEmitter {
  constructor({ holdOutput = fenceHoldLine() } = {}) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.input = Buffer.alloc(0);
    this.signals = [];
    this.closed = false;
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.input = Buffer.concat([this.input, Buffer.from(chunk)]);
        if (Buffer.from(chunk).includes(Buffer.from("AS fence_hold_result;"))) {
          queueMicrotask(() => this.stdout.write(holdOutput));
        }
        callback();
      },
    });
  }

  kill(signal) {
    this.signals.push(signal);
    queueMicrotask(() => this.close(null, signal));
    return true;
  }

  close(code = 0, signal = null) {
    if (this.closed) return;
    this.closed = true;
    this.stderr.once("end", () => this.emit("close", code, signal));
    this.stdout.end();
    this.stderr.end();
  }
}

function outputChild(stdout, code = 0) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  child.kill = () => true;
  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.stderr.end();
    child.emit("close", code, null);
  });
  return child;
}

async function temporaryDirectory(callback) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-readiness-fence-test-"),
  );
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function fixture(directory, attestation = readinessAttestation()) {
  const attestationPath = path.join(directory, "readiness-attestation.json");
  const markerPath = path.join(directory, "readiness-fence.ready.json");
  const releaseRequestPath = path.join(
    directory,
    "readiness-fence.release.json",
  );
  await writeFile(attestationPath, canonicalJsonBytes(attestation));
  return {
    attestation,
    attestationPath,
    markerPath,
    releaseRequestPath,
    input: {
      attestationPath,
      expectedTargetSha: TARGET_SHA,
      expectedRunId: "8002",
      expectedRunAttempt: "1",
      expectedArtifactId: "9003",
      expectedArtifactDigest: `sha256:${"f".repeat(64)}`,
      expectedAttestationSha256: sha256Hex(canonicalJsonBytes(attestation)),
      expectedContainerId: CONTAINER_ID,
      minimumRemainingTtlSeconds: "570",
      markerPath,
      releaseRequestPath,
      maximumHoldSeconds: "30",
    },
  };
}

async function assertCode(promise, expectedCode) {
  await assert.rejects(
    promise,
    (error) =>
      error instanceof OrdinaryAccountCutoverReadinessFenceError &&
      error.code === expectedCode,
  );
}

async function assertMissing(filePath) {
  await assert.rejects(access(filePath), { code: "ENOENT" });
}

async function waitForFile(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await readFile(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (Date.now() >= deadline) throw new Error("marker_not_created");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function coreDependencies(child, overrides = {}) {
  return {
    nowMs: NOW_MS,
    clockMs: () => NOW_MS,
    randomHex: () => "1".repeat(24),
    signalSource: new EventEmitter(),
    spawnProcess: () => child,
    terminateSession: async () => {},
    environment: {
      SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000",
      NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-do-not-log",
      FAOLLA_READINESS_FENCE_RELEASE_TOKEN: "9".repeat(64),
    },
    probeEndpoints: async ({ databaseOid, fenceBackendPid }) =>
      [
        ["internalRest", "public", "pages", "5101"],
        ["internalAuth", "auth", "users", "5102"],
        ["publicRest", "public", "pages", "5103"],
        ["publicAuth", "auth", "users", "5104"],
      ].map(([probe, schemaName, relationName, waiterPid], index) => ({
        probe,
        baseEndpointSha256: String(index < 2 ? "2" : "3").repeat(64),
        endpointSha256: String(index + 4).repeat(64),
        serviceIdentitySha256: ["8", "9", "a", "b"][index].repeat(64),
        databaseQuerySha256: String(index + 1).repeat(64),
        databaseOid,
        relationOid: String(18000 + index),
        schemaName,
        relationName,
        waiterPid,
        databaseClockEpochMilliseconds: "1787227200000",
        queryStartedAtEpochMilliseconds: "1787227200001",
        blockingPids: [fenceBackendPid],
      })),
    ...overrides,
  };
}

function waiter(overrides = {}) {
  return {
    pid: "5101",
    databaseOid: "16384",
    relationOid: "18000",
    schemaName: "public",
    relationName: "pages",
    databaseUser: "authenticator",
    applicationName: "PostgREST 12.1",
    clientAddress: "172.20.0.10",
    query: `SELECT "probe_${"a".repeat(24)}" FROM public.pages`,
    mode: "AccessShareLock",
    granted: false,
    queryStartedAtEpochMilliseconds: "1787227200001",
    blockingPids: ["4321"],
    ...overrides,
  };
}

function observation(waiters = [], overrides = {}) {
  return {
    databaseOid: "16384",
    clockEpochMilliseconds: "1787227200000",
    serviceSessions: [
      {
        databaseUser: "authenticator",
        applicationName: "PostgREST 12.1",
        clientAddress: "172.20.0.10",
      },
      {
        databaseUser: "supabase_auth_admin",
        applicationName: "",
        clientAddress: "172.20.0.11",
      },
    ],
    waiters,
    ...overrides,
  };
}

function pendingFetchRecorder(calls) {
  return (url, options) => {
    calls.push({ url: url.href, options });
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        },
        { once: true },
      );
    });
  };
}

function causalFetchRecorder(calls, cancelled = [], responseForCandidate = null) {
  let active = null;
  const fetchImpl = (url, options) => {
    calls.push({ url: url.href, options });
    return new Promise((resolve, reject) => {
      active = { resolve, reject };
      options.signal.addEventListener(
        "abort",
        () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        { once: true },
      );
    });
  };
  const cancelWaiter = async (candidate) => {
    cancelled.push(candidate.pid);
    assert.ok(active);
    const isRest = candidate.schemaName === "public";
    const body = responseForCandidate?.(candidate) ??
      (isRest
        ? { code: "57014", message: "语句已因用户请求而取消" }
        : { error_code: "unexpected_failure", msg: "查询已取消" });
    active.resolve(
      body && typeof body.status === "number" && typeof body.text === "function"
        ? body
        : { status: 500, text: async () => JSON.stringify(body) },
    );
    active = null;
  };
  return { fetchImpl, cancelWaiter };
}

function successfulProbeSequence({ lingerAfterCancel = false } = {}) {
  const relations = [
    ["public", "pages"],
    ["auth", "users"],
    ["public", "pages"],
    ["auth", "users"],
  ];
  return relations.flatMap(([schemaName, relationName], index) => {
    const candidate = waiter({
      pid: String(5101 + index),
      relationOid: String(18000 + index),
      schemaName,
      relationName,
      ...(schemaName === "auth"
        ? {
            databaseUser: "supabase_auth_admin",
            applicationName: "",
            clientAddress: "172.20.0.11",
            query: "SELECT id FROM auth.users WHERE email = $1",
          }
        : {}),
    });
    return lingerAfterCancel
      ? [observation(), observation([candidate]), observation([candidate]), observation()]
      : [observation(), observation([candidate]), observation()];
  });
}

function serviceIdentityDockerSpawner({
  service = "rest",
  databaseHost = "db",
  duplicateService = false,
  databaseNetworks = {
    supabase_default: {
      IPAddress: "172.20.0.2",
      GlobalIPv6Address: "2001:db8:20::2",
      Gateway: "172.20.0.1",
      IPv6Gateway: "2001:db8:20::1",
      Aliases: ["db", "supabase-db"],
    },
  },
  serviceNetworks = {
    supabase_default: {
      IPAddress: "172.20.0.10",
      GlobalIPv6Address: "2001:db8:20::10",
      Gateway: "172.20.0.1",
      IPv6Gateway: "2001:db8:20::1",
      Aliases: [service],
    },
  },
} = {}) {
  const serviceId = service === "rest" ? "c".repeat(64) : "e".repeat(64);
  const secondId = "7".repeat(64);
  const databaseUser =
    service === "rest" ? "authenticator" : "supabase_auth_admin";
  const environmentName =
    service === "rest" ? "PGRST_DB_URI" : "GOTRUE_DB_DATABASE_URL";
  const outputs = [
    JSON.stringify([
      {
        Id: CONTAINER_ID,
        Name: "/supabase-db",
        Config: { Labels: { "com.docker.compose.project": "supabase" } },
        NetworkSettings: { Networks: databaseNetworks },
      },
    ]),
    `${serviceId}${duplicateService ? `\n${secondId}` : ""}\n`,
    JSON.stringify([
      {
        Id: serviceId,
        Image: `sha256:${"d".repeat(64)}`,
        Config: {
          Labels: {
            "com.docker.compose.project": "supabase",
            "com.docker.compose.service": service,
          },
          Env: [
            `${environmentName}=postgres://${databaseUser}:never-log-this@${databaseHost}:5432/postgres`,
          ],
        },
        NetworkSettings: { Networks: serviceNetworks },
      },
    ]),
  ];
  const calls = [];
  return {
    calls,
    spawnProcess(command, argumentsList) {
      calls.push({ command, argumentsList });
      assert.equal(command, "docker");
      return outputChild(outputs.shift() ?? "");
    },
  };
}

test("fence SQL derives from the complete checker SQL, raises its timeout, upgrades all three relations before output, and has one final rollback", () => {
  const sql = buildOrdinaryAccountCutoverReadinessFenceSql("900");
  const captureBoundary = " AS report\n\n\\gset fence_";
  const captureIndex = sql.indexOf(captureBoundary);
  const originalWithoutRollback = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.slice(
    0,
    -"\n\nROLLBACK;".length,
  );

  assert.ok(captureIndex > 0);
  assert.equal(`${sql.slice(0, captureIndex)};`, originalWithoutRollback);
  assert.equal(sql.match(/ROLLBACK;/g)?.length, 1);
  assert.ok(sql.endsWith("ROLLBACK;"));
  const authExclusiveLock = sql.indexOf(
    "LOCK TABLE auth.users IN ACCESS EXCLUSIVE MODE;",
  );
  const registryExclusiveLock = sql.indexOf(
    "LOCK TABLE public.faolla_schema_migrations IN ACCESS EXCLUSIVE MODE;",
  );
  const pagesExclusiveLock = sql.indexOf(
    "LOCK TABLE public.pages IN ACCESS EXCLUSIVE MODE;",
  );
  const lateTimeout = sql.indexOf(
    "SET LOCAL statement_timeout = '930s';",
  );
  const outputIndex = sql.indexOf("AS fence_result;");
  const savepointIndex = sql.indexOf("SAVEPOINT endpoint_probe_locks;");
  const rollbackToIndex = sql.indexOf(
    "ROLLBACK TO SAVEPOINT endpoint_probe_locks;",
  );
  const releaseSavepointIndex = sql.indexOf(
    "RELEASE SAVEPOINT endpoint_probe_locks;",
  );
  const holdProofIndex = sql.indexOf("AS fence_hold_result;");
  assert.ok(lateTimeout > captureIndex);
  assert.ok(registryExclusiveLock > lateTimeout);
  assert.ok(savepointIndex > registryExclusiveLock);
  assert.ok(authExclusiveLock > savepointIndex);
  assert.ok(pagesExclusiveLock > authExclusiveLock);
  assert.ok(outputIndex > pagesExclusiveLock);
  assert.ok(rollbackToIndex > outputIndex);
  assert.ok(releaseSavepointIndex > rollbackToIndex);
  assert.ok(holdProofIndex > releaseSavepointIndex);
  assert.ok(sql.indexOf("pg_sleep") > holdProofIndex);
  assert.ok(sql.indexOf("pg_sleep") > captureIndex);
  assert.equal(
    sql.slice(0, sql.indexOf("pg_sleep")).includes("ROLLBACK;"),
    false,
  );
  assert.match(sql, /pg_sleep\(900::double precision\)/);
  assert.doesNotMatch(sql, /transaction_timestamp/);
  assert.throws(
    () => buildOrdinaryAccountCutoverReadinessFenceSql("901"),
    (error) => error.code === "readiness_fence_max_hold_seconds_invalid",
  );
});

test("service identity is derived from the attested compose project and direct database route without exposing its URI", async (t) => {
  const docker = serviceIdentityDockerSpawner();
  const identity = await resolveSupabaseServiceClientAddresses(
    "rest",
    CONTAINER_ID,
    "postgres",
    docker.spawnProcess,
  );
  assert.deepEqual(identity, REST_SERVICE_IDENTITY);
  assert.equal(docker.calls.length, 3);
  assert.match(docker.calls[1].argumentsList.join(" "), /compose\.service=rest/);
  assert.doesNotMatch(JSON.stringify(identity), /never-log-this|postgres:\/\//);

  await t.test("only shared-network Docker and gateway addresses are frozen", async () => {
    const isolated = serviceIdentityDockerSpawner({
      serviceNetworks: {
        supabase_default: {
          IPAddress: "172.20.0.10",
          GlobalIPv6Address: "2001:0db8:0020:0000:0000:0000:0000:0010",
          Gateway: "172.20.0.1",
          IPv6Gateway: "2001:0db8:0020:0000:0000:0000:0000:0001",
          Aliases: ["rest"],
        },
        service_only: {
          IPAddress: "not-an-ipv4-address",
          GlobalIPv6Address: "hostile-nonshared-ipv6",
          Gateway: "hostile-nonshared-gateway",
          IPv6Gateway: "hostile-nonshared-ipv6-gateway",
          Aliases: ["rest-external"],
        },
      },
    });
    const isolatedIdentity = await resolveSupabaseServiceClientAddresses(
      "rest",
      CONTAINER_ID,
      "postgres",
      isolated.spawnProcess,
    );
    assert.deepEqual(isolatedIdentity, REST_SERVICE_IDENTITY);
  });

  await t.test("multiple shared networks remain source-specific and deterministic", async () => {
    const multiple = serviceIdentityDockerSpawner({
      databaseNetworks: {
        supabase_default: {
          IPAddress: "172.20.0.2",
          GlobalIPv6Address: "2001:db8:20::2",
          Gateway: "172.20.0.1",
          IPv6Gateway: "2001:db8:20::1",
          Aliases: ["db", "supabase-db"],
        },
        supabase_secondary: {
          IPAddress: "172.21.0.2",
          GlobalIPv6Address: "2001:db8:21::2",
          Gateway: "172.21.0.1",
          IPv6Gateway: "2001:db8:21::1",
          Aliases: ["db-secondary"],
        },
      },
      serviceNetworks: {
        supabase_default: {
          IPAddress: "172.20.0.10",
          GlobalIPv6Address: "2001:db8:20::10",
          Gateway: "172.20.0.1",
          IPv6Gateway: "2001:db8:20::1",
          Aliases: ["rest"],
        },
        supabase_secondary: {
          IPAddress: "172.21.0.10",
          GlobalIPv6Address: "2001:db8:21::10",
          Gateway: "172.21.0.1",
          IPv6Gateway: "2001:db8:21::1",
          Aliases: ["rest-secondary"],
        },
        service_only: {
          IPAddress: "192.0.2.10",
          GlobalIPv6Address: "2001:db8:ffff::10",
          Gateway: "192.0.2.1",
          IPv6Gateway: "2001:db8:ffff::1",
          Aliases: ["rest-external"],
        },
      },
    });
    assert.deepEqual(
      await resolveSupabaseServiceClientAddresses(
        "rest",
        CONTAINER_ID,
        "postgres",
        multiple.spawnProcess,
      ),
      {
        ...REST_SERVICE_IDENTITY,
        clientAddresses: ["172.20.0.10", "172.21.0.10"],
        clientAddressSources: {
          dockerIpv4: ["172.20.0.10", "172.21.0.10"],
          dockerIpv6: ["2001:db8:20::10", "2001:db8:21::10"],
          sharedGateway: [
            "172.20.0.1",
            "172.21.0.1",
            "2001:db8:20::1",
            "2001:db8:21::1",
          ],
        },
      },
    );
  });

  await t.test("malformed and duplicate diagnostic addresses never become a new gate", async () => {
    const bestEffort = serviceIdentityDockerSpawner({
      databaseNetworks: {
        supabase_default: {
          IPAddress: "172.20.0.2",
          Aliases: ["db", "supabase-db"],
        },
        supabase_secondary: {
          IPAddress: "172.21.0.2",
          Aliases: ["db-secondary"],
        },
      },
      serviceNetworks: {
        supabase_default: {
          IPAddress: "172.20.0.10",
          GlobalIPv6Address: "2001:db8:20::10",
          Gateway: "172.20.0.1",
          IPv6Gateway: "2001:db8:20::1",
          Aliases: ["rest"],
        },
        supabase_secondary: {
          IPAddress: "172.21.0.10",
          GlobalIPv6Address:
            "2001:0db8:0020:0000:0000:0000:0000:0010",
          Gateway: "172.20.0.1",
          IPv6Gateway: "hostile-shared-ipv6-gateway",
          Aliases: ["rest-secondary"],
        },
      },
    });
    assert.deepEqual(
      await resolveSupabaseServiceClientAddresses(
        "rest",
        CONTAINER_ID,
        "postgres",
        bestEffort.spawnProcess,
      ),
      {
        ...REST_SERVICE_IDENTITY,
        clientAddresses: ["172.20.0.10", "172.21.0.10"],
        clientAddressSources: {
          dockerIpv4: ["172.20.0.10", "172.21.0.10"],
          dockerIpv6: ["2001:db8:20::10"],
          sharedGateway: ["172.20.0.1", "2001:db8:20::1"],
        },
      },
    );
  });

  await t.test("pooler or other non-attested database hop is rejected", async () => {
    const hostile = serviceIdentityDockerSpawner({ databaseHost: "pooler" });
    await assertCode(
      resolveSupabaseServiceClientAddresses(
        "rest",
        CONTAINER_ID,
        "postgres",
        hostile.spawnProcess,
      ),
      "readiness_fence_probe_service_database_route_invalid",
    );
  });
  await t.test("multiple running compose services are rejected", async () => {
    const hostile = serviceIdentityDockerSpawner({ duplicateService: true });
    await assertCode(
      resolveSupabaseServiceClientAddresses(
        "rest",
        CONTAINER_ID,
        "postgres",
        hostile.spawnProcess,
      ),
      "readiness_fence_probe_service_identity_invalid",
    );
  });
  await t.test("a Docker inspect child that never closes is killed at its deadline", async () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    const kills = [];
    child.kill = (signal) => {
      kills.push(signal);
      return true;
    };
    const deadline = async (_promise, _milliseconds, code, onTimeout) => {
      onTimeout?.();
      throw new OrdinaryAccountCutoverReadinessFenceError(code);
    };
    await assertCode(
      resolveSupabaseServiceClientAddresses(
        "rest",
        CONTAINER_ID,
        "postgres",
        () => child,
        deadline,
      ),
      "readiness_fence_probe_service_identity_invalid_timeout",
    );
    assert.deepEqual(kills, ["SIGKILL"]);
  });
});

test("four anon behavior probes bind internal/public REST pages and Auth users waiters without exposing service credentials", async () => {
  const calls = [];
  const snapshots = successfulProbeSequence({ lingerAfterCancel: true });
  const cancelled = [];
  const causal = causalFetchRecorder(calls, cancelled);
  const evidence =
    await probeOrdinaryAccountCutoverReadinessFenceEndpoints(
      {
        containerId: CONTAINER_ID,
        databaseName: "postgres",
        databaseOid: "16384",
        fenceBackendPid: "4321",
      },
      {
        environment: {
          SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-only-key",
          SUPABASE_SERVICE_ROLE_KEY: "must-never-be-used",
        },
        randomProbeHex: (byteLength) => "a".repeat(byteLength * 2),
        fetchImpl: causal.fetchImpl,
        observeWaiters: async () => snapshots.shift(),
        cancelWaiter: causal.cancelWaiter,
        serviceIdentities: SERVICE_IDENTITIES,
        poll: async () => {},
      },
    );

  assert.equal(snapshots.length, 0);
  assert.deepEqual(
    calls.map(({ url, options }) => ({
      origin: new URL(url).origin,
      path: new URL(url).pathname,
      method: options.method,
      cache: options.cache,
      redirect: options.redirect,
    })),
    [
      {
        origin: "http://127.0.0.1:8000",
        path: "/rest/v1/pages",
        method: "GET",
        cache: "no-store",
        redirect: "error",
      },
      {
        origin: "http://127.0.0.1:8000",
        path: "/auth/v1/token",
        method: "POST",
        cache: "no-store",
        redirect: "error",
      },
      {
        origin: "https://db.example.test",
        path: "/rest/v1/pages",
        method: "GET",
        cache: "no-store",
        redirect: "error",
      },
      {
        origin: "https://db.example.test",
        path: "/auth/v1/token",
        method: "POST",
        cache: "no-store",
        redirect: "error",
      },
    ],
  );
  assert.ok(
    calls.every(
      ({ options }) =>
        options.headers.apikey === "anon-only-key" &&
        options.headers.authorization === "Bearer anon-only-key" &&
        options.headers["cache-control"].includes("no-cache"),
    ),
  );
  assert.doesNotMatch(JSON.stringify(calls), /must-never-be-used/);
  assert.match(calls[1].options.body, /@invalid\.example/);
  assert.match(calls[1].url, /grant_type=password/);
  assert.equal(
    new URL(calls[0].url).searchParams.get("select"),
    `probe_${"a".repeat(24)}:id`,
  );
  assert.deepEqual(cancelled, ["5101", "5102", "5103", "5104"]);
  assert.deepEqual(
    evidence.map((entry) => [
      entry.probe,
      entry.schemaName,
      entry.relationName,
      entry.blockingPids,
    ]),
    [
      ["internalRest", "public", "pages", ["4321"]],
      ["internalAuth", "auth", "users", ["4321"]],
      ["publicRest", "public", "pages", ["4321"]],
      ["publicAuth", "auth", "users", ["4321"]],
    ],
  );
  assert.ok(
    evidence.every(
      (entry) =>
        /^[0-9a-f]{64}$/.test(entry.baseEndpointSha256) &&
        /^[0-9a-f]{64}$/.test(entry.endpointSha256) &&
        /^[0-9a-f]{64}$/.test(entry.serviceIdentitySha256) &&
        /^[0-9a-f]{64}$/.test(entry.databaseQuerySha256),
    ),
  );
  assert.deepEqual(
    evidence.map((entry) => entry.baseEndpointSha256),
    [
      sha256Hex(Buffer.from("http://127.0.0.1:8000/")),
      sha256Hex(Buffer.from("http://127.0.0.1:8000/")),
      sha256Hex(Buffer.from("https://db.example.test/")),
      sha256Hex(Buffer.from("https://db.example.test/")),
    ],
  );
  assert.deepEqual(
    evidence.map((entry) => entry.databaseQuerySha256),
    successfulProbeSequence()
      .filter((_entry, index) => index % 3 === 1)
      .map((entry) => sha256Hex(Buffer.from(entry.waiters[0].query))),
  );
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /127\.0\.0\.1|db\.example|anon-only|invalid\.example/,
  );
});

test("child diagnostics expose only bounded status and an exact SQLSTATE", async (t) => {
  const runFailure = async (stderr, code = 3, signal = null) => {
    let failureBytes;
    await temporaryDirectory(async (directory) => {
      const value = await fixture(directory);
      const child = new FakeChild();
      try {
        await holdOrdinaryAccountCutoverReadinessFence(
          value.input,
          coreDependencies(child, {
            spawnProcess: () => {
              queueMicrotask(() => {
                if (stderr !== null) child.stderr.write(stderr);
                child.close(code, signal);
              });
              return child;
            },
          }),
        );
        assert.fail("expected the fence helper to fail");
      } catch (error) {
        failureBytes = ordinaryAccountCutoverReadinessFenceFailureLogBytes(error);
      }
    });
    return failureBytes;
  };

  await t.test("one verbose PSQL header yields only its SQLSTATE", async () => {
    const secret = "password-do-not-log::error::";
    const bytes = await runFailure(`ERROR:  P0001: ${secret}\n`);
    const record = parseOrdinaryAccountCutoverReadinessFenceFailureLog(bytes);
    assert.deepEqual(record, {
      childExitCode: "3",
      childResult: "exit",
      childSignal: null,
      error: "readiness_fence_child_failed",
      ok: false,
      sqlstate: "P0001",
      sqlstateStatus: "exact",
    });
    assert.doesNotMatch(bytes.toString("utf8"), /password-do-not-log|::error::/);
  });
  await t.test("missing and ambiguous headers never expose text", async () => {
    const absent = parseOrdinaryAccountCutoverReadinessFenceFailureLog(
      await runFailure("password-do-not-log\n"),
    );
    assert.equal(absent.sqlstate, null);
    assert.equal(absent.sqlstateStatus, "absent");
    const ambiguous = parseOrdinaryAccountCutoverReadinessFenceFailureLog(
      await runFailure("ERROR:  P0001: first\nFATAL:  42501: second\n"),
    );
    assert.equal(ambiguous.sqlstate, null);
    assert.equal(ambiguous.sqlstateStatus, "ambiguous");
  });
  await t.test("invalid UTF-8 and overflow discard all stderr", async () => {
    const invalid = parseOrdinaryAccountCutoverReadinessFenceFailureLog(
      await runFailure(Buffer.from([0xff, 0xfe, 0xfd])),
    );
    assert.equal(invalid.sqlstateStatus, "invalid_utf8");
    assert.equal(invalid.sqlstate, null);
    const overflow = parseOrdinaryAccountCutoverReadinessFenceFailureLog(
      await runFailure(Buffer.alloc(64 * 1024 + 1, 0x61)),
    );
    assert.equal(overflow.sqlstateStatus, "overflow");
    assert.equal(overflow.sqlstate, null);
  });
  await t.test("signals are normalized without a raw signal string", async () => {
    const record = parseOrdinaryAccountCutoverReadinessFenceFailureLog(
      await runFailure(null, null, "SIGUSR1"),
    );
    assert.equal(record.childExitCode, null);
    assert.equal(record.childResult, "signal");
    assert.equal(record.childSignal, "OTHER");
  });
});

test("behavior probes fail closed on early HTTP, stale/multiple/wrong waiters, and cancellation residue", async (t) => {
  const baseInput = {
    containerId: CONTAINER_ID,
    databaseName: "postgres",
    databaseOid: "16384",
    fenceBackendPid: "4321",
  };
  const environment = {
    SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000",
    NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-only-key",
  };
  const baseDependencies = {
    environment,
    randomProbeHex: (byteLength) => "a".repeat(byteLength * 2),
    poll: async () => {},
    cancelWaiter: async () => {},
    serviceIdentities: SERVICE_IDENTITIES,
  };
  const cases = [
    [
      "early HTTP 200",
      [observation(), observation([waiter()])],
      async () => ({ status: 200 }),
      "readiness_fence_probe_http_completed_early",
    ],
    [
      "stale query",
      [
        observation(),
        observation([
          waiter({ queryStartedAtEpochMilliseconds: "1787227199999" }),
        ]),
      ],
      null,
      "readiness_fence_probe_waiter_initial_internal_rest_query_started_invalid",
    ],
    [
      "multiple new waiters",
      [
        observation(),
        observation([waiter(), waiter({ pid: "5102" })]),
      ],
      null,
      "readiness_fence_probe_waiter_count_invalid",
    ],
    [
      "wrong blocker",
      [observation(), observation([waiter({ blockingPids: ["4999"] })])],
      null,
      "readiness_fence_probe_waiter_initial_internal_rest_blocker_pid_invalid",
    ],
    [
      "wrong database user",
      [observation(), observation([waiter({ databaseUser: "other" })])],
      null,
      "readiness_fence_probe_waiter_initial_internal_rest_database_user_invalid",
    ],
    [
      "wrong service client address",
      [observation(), observation([waiter({ clientAddress: "172.20.0.99" })])],
      null,
      "readiness_fence_probe_waiter_initial_internal_rest_client_address_unmatched_invalid",
    ],
    [
      "wrong frozen application name",
      [observation(), observation([waiter({ applicationName: "Other" })])],
      null,
      "readiness_fence_probe_waiter_initial_internal_rest_application_name_invalid",
    ],
    [
      "missing REST query nonce",
      [observation(), observation([waiter({ query: "SELECT id FROM public.pages" })])],
      null,
      "readiness_fence_probe_waiter_initial_internal_rest_query_marker_invalid",
    ],
    [
      "ambiguous pre-probe service application",
      [
        observation([], {
          serviceSessions: [
            ...observation().serviceSessions,
            {
              databaseUser: "authenticator",
              applicationName: "PostgREST 13.0",
              clientAddress: "172.20.0.10",
            },
          ],
        }),
      ],
      null,
      "readiness_fence_probe_service_application_invalid",
    ],
  ];
  for (const [name, snapshots, fetchOverride, code] of cases) {
    await t.test(name, async () => {
      const calls = [];
      await assertCode(
        probeOrdinaryAccountCutoverReadinessFenceEndpoints(baseInput, {
          ...baseDependencies,
          fetchImpl: fetchOverride ?? pendingFetchRecorder(calls),
          observeWaiters: async () => snapshots.shift() ?? observation(),
        }),
        code,
      );
    });
  }
  await t.test("waiter remains after abort and exact cancellation", async () => {
    const calls = [];
    const candidate = waiter();
    const causal = causalFetchRecorder(calls);
    const snapshots = [
      observation(),
      observation([candidate]),
      ...Array.from({ length: 302 }, () => observation([candidate])),
    ];
    await assertCode(
      probeOrdinaryAccountCutoverReadinessFenceEndpoints(baseInput, {
        ...baseDependencies,
        fetchImpl: causal.fetchImpl,
        cancelWaiter: causal.cancelWaiter,
        observeWaiters: async () => snapshots.shift() ?? observation([candidate]),
      }),
      "readiness_fence_probe_waiter_residual",
    );
  });
});

test("a rejected waiter client address emits a fixed unmatched classification", async () => {
  const snapshots = [
    observation(),
    observation([waiter({ clientAddress: "203.0.113.77" })]),
  ];
  const calls = [];
  await assertCode(
    probeOrdinaryAccountCutoverReadinessFenceEndpoints(
      {
        containerId: CONTAINER_ID,
        databaseName: "postgres",
        databaseOid: "16384",
        fenceBackendPid: "4321",
      },
      {
        environment: {
          SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-only-key",
        },
        randomProbeHex: (byteLength) => "a".repeat(byteLength * 2),
        fetchImpl: pendingFetchRecorder(calls),
        observeWaiters: async () => snapshots.shift() ?? observation(),
        cancelWaiter: async () => {},
        serviceIdentities: SERVICE_IDENTITIES,
        poll: async () => {},
      },
    ),
    "readiness_fence_probe_waiter_initial_internal_rest_client_address_unmatched_invalid",
  );
});

test("waiter validation diagnostics are fixed, stage/probe/predicate-specific, canonical, and value-free", async () => {
  const input = {
    containerId: CONTAINER_ID,
    databaseName: "postgres",
    databaseOid: "16384",
    fenceBackendPid: "4321",
  };
  const environment = {
    SUPABASE_INTERNAL_URL:
      "http://127.0.0.1:8000/hostile-internal-url-secret/",
    NEXT_PUBLIC_SUPABASE_URL:
      "https://hostile-public-url-secret.example/tenant/",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "hostile-anon-key-secret",
  };
  const stages = ["initial", "post_cancel"];
  const probes = [
    "internalRest",
    "internalAuth",
    "publicRest",
    "publicAuth",
  ];
  const predicateCases = [
    ["databaseOid", (candidate) => {
      candidate.databaseOid = "98765";
    }],
    ["schemaName", (candidate) => {
      candidate.schemaName = "hostile_schema_secret";
    }],
    ["relationName", (candidate) => {
      candidate.relationName = "hostile_relation_secret";
    }],
    ["mode", (candidate) => {
      candidate.mode = "HostileLockSecret";
    }],
    ["granted", (candidate) => {
      candidate.granted = true;
    }],
    ["queryStarted", (candidate) => {
      candidate.queryStartedAtEpochMilliseconds = "1787227199999";
    }],
    ["blockerCount", (candidate) => {
      candidate.blockingPids = ["4321", "4999"];
    }],
    ["blockerPid", (candidate) => {
      candidate.blockingPids = ["4999"];
    }],
    ["databaseUser", (candidate) => {
      candidate.databaseUser = "hostile_user_secret";
    }],
    ["applicationName", (candidate) => {
      candidate.applicationName = "hostile_app_secret";
    }],
    ["queryMarker", (candidate) => {
      candidate.query = "SELECT 'hostile_query_secret'";
    }],
  ];
  const diagnosticProbeNames = {
    internalRest: "internal_rest",
    internalAuth: "internal_auth",
    publicRest: "public_rest",
    publicAuth: "public_auth",
  };
  const diagnosticPredicateNames = {
    databaseOid: "database_oid",
    schemaName: "schema_name",
    relationName: "relation_name",
    mode: "mode",
    granted: "granted",
    queryStarted: "query_started",
    blockerCount: "blocker_count",
    blockerPid: "blocker_pid",
    databaseUser: "database_user",
    applicationName: "application_name",
    queryMarker: "query_marker",
  };
  const codeFor = (stage, probe, predicate) =>
    `readiness_fence_probe_waiter_${stage}_` +
    `${diagnosticProbeNames[probe]}_` +
    `${diagnosticPredicateNames[predicate]}_invalid`;
  const clientAddressClasses = [
    ["dockerIpv4", "docker_ipv4"],
    ["dockerIpv6", "docker_ipv6"],
    ["ipv4Mapped", "ipv4_mapped"],
    ["sharedGateway", "shared_gateway"],
    ["unmatched", "unmatched"],
  ];
  // A resolver-consistent Docker IPv4 is accepted by the preceding raw match.
  // Its diagnostic code remains fixed and parser-covered for schema completeness.
  const observableRejectedClientAddressClasses = clientAddressClasses.filter(
    ([classification]) => classification !== "dockerIpv4",
  );
  const clientAddressCodeFor = (stage, probe, classification) =>
    `readiness_fence_probe_waiter_${stage}_` +
    `${diagnosticProbeNames[probe]}_client_address_${classification}_invalid`;
  const confidentialValues = [
    "987654321",
    "16384",
    "98765",
    "4321",
    "4999",
    "1787227200001",
    "1787227199999",
    "172.20.0.10",
    "172.20.0.11",
    "203.0.113.77",
    "2001:0db8:0020:0000:0000:0000:0000:0010",
    "2001:0db8:0020:0000:0000:0000:0000:0011",
    "2001:db8:20::10",
    "2001:db8:20::11",
    "::ffff:172.20.0.10",
    "::ffff:172.20.0.11",
    "2001:0db8:0020:0000:0000:0000:0000:0001",
    "2001:db8:20::1",
    "2001:db8:ffff::77",
    "authenticator",
    "supabase_auth_admin",
    "PostgREST 12.1",
    "hostile_schema_secret",
    "hostile_relation_secret",
    "HostileLockSecret",
    "hostile_user_secret",
    "hostile_app_secret",
    "hostile_query_secret",
    "probe_aaaaaaaaaaaaaaaaaaaaaaaa",
    "hostile-internal-url-secret",
    "hostile-public-url-secret",
    "hostile-anon-key-secret",
  ];

  for (const stage of stages) {
    for (const [probeIndex, probe] of probes.entries()) {
      for (const [predicate, mutate] of predicateCases) {
        if (predicate === "queryMarker" && probe.endsWith("Auth")) continue;
        const snapshots = successfulProbeSequence({ lingerAfterCancel: true });
        snapshots[probeIndex * 4 + 2].waiters[0] = {
          ...snapshots[probeIndex * 4 + 2].waiters[0],
          blockingPids: [
            ...snapshots[probeIndex * 4 + 2].waiters[0].blockingPids,
          ],
        };
        const initialCandidate = snapshots[probeIndex * 4 + 1].waiters[0];
        const postCancelCandidate = snapshots[probeIndex * 4 + 2].waiters[0];
        initialCandidate.pid = "987654321";
        postCancelCandidate.pid = "987654321";
        const targetCandidate =
          stage === "initial" ? initialCandidate : postCancelCandidate;
        mutate(targetCandidate);
        const calls = [];
        const causal = causalFetchRecorder(calls);
        let failure;
        try {
          await probeOrdinaryAccountCutoverReadinessFenceEndpoints(input, {
            environment,
            randomProbeHex: (byteLength) => "a".repeat(byteLength * 2),
            fetchImpl: causal.fetchImpl,
            observeWaiters: async () => snapshots.shift() ?? observation(),
            cancelWaiter: causal.cancelWaiter,
            serviceIdentities: SERVICE_IDENTITIES,
            poll: async () => {},
          });
          assert.fail(`expected ${stage}/${probe}/${predicate} to fail`);
        } catch (error) {
          failure = error;
        }
        const expectedCode = codeFor(stage, probe, predicate);
        assert.ok(
          failure instanceof OrdinaryAccountCutoverReadinessFenceError,
          `${stage}/${probe}/${predicate} returned the wrong error type`,
        );
        assert.equal(
          failure.code,
          expectedCode,
          `${stage}/${probe}/${predicate} returned the wrong code`,
        );
        const bytes = ordinaryAccountCutoverReadinessFenceFailureLogBytes(failure);
        assert.ok(
          bytes.length <= 512,
          `${stage}/${probe}/${predicate} exceeded the failure-record bound`,
        );
        const record = parseOrdinaryAccountCutoverReadinessFenceFailureLog(bytes);
        assert.equal(record?.error, expectedCode);
        assert.deepEqual(bytes, canonicalJsonBytes(record));
        const serialized = bytes.toString("utf8");
        for (const confidential of confidentialValues) {
          assert.equal(
            serialized.includes(confidential),
            false,
            `${stage}/${probe}/${predicate} exposed ${confidential}`,
          );
        }
      }
    }
  }

  for (const stage of stages) {
    for (const [probeIndex, probe] of probes.entries()) {
      for (const [
        classification,
        classificationCode,
      ] of observableRejectedClientAddressClasses) {
        const snapshots = successfulProbeSequence({ lingerAfterCancel: true });
        snapshots[probeIndex * 4 + 2].waiters[0] = {
          ...snapshots[probeIndex * 4 + 2].waiters[0],
          blockingPids: [
            ...snapshots[probeIndex * 4 + 2].waiters[0].blockingPids,
          ],
        };
        const initialCandidate = snapshots[probeIndex * 4 + 1].waiters[0];
        const postCancelCandidate = snapshots[probeIndex * 4 + 2].waiters[0];
        initialCandidate.pid = "987654321";
        postCancelCandidate.pid = "987654321";
        const targetCandidate =
          stage === "initial" ? initialCandidate : postCancelCandidate;
        const service = probe.endsWith("Auth") ? "auth" : "rest";
        const suffix = service === "auth" ? "11" : "10";
        switch (classification) {
          case "dockerIpv6":
            targetCandidate.clientAddress =
              `2001:0db8:0020:0000:0000:0000:0000:00${suffix}`;
            break;
          case "ipv4Mapped":
            targetCandidate.clientAddress = `::ffff:172.20.0.${suffix}`;
            break;
          case "sharedGateway":
            targetCandidate.clientAddress =
              "2001:0db8:0020:0000:0000:0000:0000:0001";
            break;
          case "unmatched":
            targetCandidate.clientAddress = "2001:db8:ffff::77";
            break;
          default:
            assert.fail(`unexpected client address class ${classification}`);
        }
        const calls = [];
        const causal = causalFetchRecorder(calls);
        let failure;
        try {
          await probeOrdinaryAccountCutoverReadinessFenceEndpoints(input, {
            environment,
            randomProbeHex: (byteLength) => "a".repeat(byteLength * 2),
            fetchImpl: causal.fetchImpl,
            observeWaiters: async () => snapshots.shift() ?? observation(),
            cancelWaiter: causal.cancelWaiter,
            serviceIdentities: SERVICE_IDENTITIES,
            poll: async () => {},
          });
          assert.fail(
            `expected ${stage}/${probe}/clientAddress/${classification} to fail`,
          );
        } catch (error) {
          failure = error;
        }
        const expectedCode = clientAddressCodeFor(
          stage,
          probe,
          classificationCode,
        );
        assert.ok(
          failure instanceof OrdinaryAccountCutoverReadinessFenceError,
          `${stage}/${probe}/clientAddress/${classification} returned the wrong error type`,
        );
        assert.equal(
          failure.code,
          expectedCode,
          `${stage}/${probe}/clientAddress/${classification} returned the wrong code`,
        );
        const bytes = ordinaryAccountCutoverReadinessFenceFailureLogBytes(failure);
        assert.ok(
          bytes.length <= 512,
          `${stage}/${probe}/clientAddress/${classification} exceeded the failure-record bound`,
        );
        const record = parseOrdinaryAccountCutoverReadinessFenceFailureLog(bytes);
        assert.equal(record?.error, expectedCode);
        assert.deepEqual(bytes, canonicalJsonBytes(record));
        const serialized = bytes.toString("utf8");
        for (const confidential of confidentialValues) {
          assert.equal(
            serialized.includes(confidential),
            false,
            `${stage}/${probe}/clientAddress/${classification} exposed ${confidential}`,
          );
        }
      }
    }
  }

  for (const stage of stages) {
    for (const probe of probes) {
      for (const [predicate] of predicateCases) {
        const code = codeFor(stage, probe, predicate);
        const bytes = ordinaryAccountCutoverReadinessFenceFailureLogBytes(
          new OrdinaryAccountCutoverReadinessFenceError(code),
        );
        assert.ok(bytes.length <= 512, `${code} exceeded the failure-record bound`);
        const record = parseOrdinaryAccountCutoverReadinessFenceFailureLog(bytes);
        assert.equal(record?.error, code, `${code} was not allowlisted`);
        assert.deepEqual(bytes, canonicalJsonBytes(record));
      }
      for (const [, classificationCode] of clientAddressClasses) {
        const code = clientAddressCodeFor(stage, probe, classificationCode);
        const bytes = ordinaryAccountCutoverReadinessFenceFailureLogBytes(
          new OrdinaryAccountCutoverReadinessFenceError(code),
        );
        assert.ok(bytes.length <= 512, `${code} exceeded the failure-record bound`);
        const record = parseOrdinaryAccountCutoverReadinessFenceFailureLog(bytes);
        assert.equal(record?.error, code, `${code} was not allowlisted`);
        assert.deepEqual(bytes, canonicalJsonBytes(record));
      }
    }
  }

  const defaultDiagnostic = {
    childExitCode: null,
    childResult: "not_observed",
    childSignal: null,
    ok: false,
    sqlstate: null,
    sqlstateStatus: "absent",
  };
  for (const hostileCode of [
    "readiness_fence_probe_waiter_invalid",
    ...stages.flatMap((stage) =>
      probes.map(
        (probe) =>
          `readiness_fence_probe_waiter_${stage}_${diagnosticProbeNames[probe]}_client_address_invalid`,
      ),
    ),
    "readiness_fence_probe_waiter_initial_internal_rest_database_oid_invalid_suffix",
    "readiness_fence_probe_waiter_initial_internal_rest_client_address_arbitrary_invalid",
    "readiness_fence_probe_waiter_initial_internal_rest_client_address_docker_ipv6_invalid_suffix",
    "readiness_fence_probe_waiter_arbitrary_internal_rest_database_oid_invalid",
    "readiness_fence_probe_waiter_initial_arbitrary_database_oid_invalid",
    "readiness_fence_probe_waiter_initial_internal_rest_arbitrary_invalid",
  ]) {
    const serialized = ordinaryAccountCutoverReadinessFenceFailureLogBytes(
      new OrdinaryAccountCutoverReadinessFenceError(hostileCode),
    );
    assert.equal(
      parseOrdinaryAccountCutoverReadinessFenceFailureLog(serialized).error,
      "readiness_fence_unexpected_error",
    );
    assert.doesNotMatch(serialized.toString("utf8"), /arbitrary|suffix/);
    assert.equal(
      parseOrdinaryAccountCutoverReadinessFenceFailureLog(
        canonicalJsonBytes({
          ...defaultDiagnostic,
          error: hostileCode,
        }),
      ),
      null,
    );
  }
});

test("query cancellation is causally bound to the same HTTP request with locale-stable machine codes and bounded awaits", async (t) => {
  const input = {
    containerId: CONTAINER_ID,
    databaseName: "postgres",
    databaseOid: "16384",
    fenceBackendPid: "4321",
  };
  const common = {
    environment: {
      SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000",
      NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-only-key",
    },
    randomProbeHex: (byteLength) => "a".repeat(byteLength * 2),
    serviceIdentities: SERVICE_IDENTITIES,
    poll: async () => {},
  };
  const runWithResponse = async (responseForCandidate) => {
    const snapshots = successfulProbeSequence();
    const calls = [];
    const causal = causalFetchRecorder(calls, [], responseForCandidate);
    return probeOrdinaryAccountCutoverReadinessFenceEndpoints(input, {
      ...common,
      fetchImpl: causal.fetchImpl,
      cancelWaiter: causal.cancelWaiter,
      observeWaiters: async () => snapshots.shift() ?? observation(),
    });
  };

  await t.test("non-English messages with REST SQLSTATE and Auth error_code pass", async () => {
    assert.equal((await runWithResponse()).length, 4);
  });
  await t.test("a cold GoTrue pool with no pre-existing Auth session still binds through the unique causal request", async () => {
    const snapshots = successfulProbeSequence();
    for (const index of [3, 9]) {
      snapshots[index].serviceSessions = snapshots[index].serviceSessions.filter(
        (session) => session.databaseUser !== "supabase_auth_admin",
      );
    }
    const calls = [];
    const causal = causalFetchRecorder(calls);
    const evidence = await probeOrdinaryAccountCutoverReadinessFenceEndpoints(
      input,
      {
        ...common,
        fetchImpl: causal.fetchImpl,
        cancelWaiter: causal.cancelWaiter,
        observeWaiters: async () => snapshots.shift() ?? observation(),
      },
    );
    assert.equal(evidence.length, 4);
  });
  await t.test("empty standard GoTrue application_name passes but candidate drift fails", async () => {
    const snapshots = successfulProbeSequence();
    snapshots[4].waiters[0].applicationName = "unexpected-auth-app";
    const calls = [];
    const causal = causalFetchRecorder(calls);
    await assertCode(
      probeOrdinaryAccountCutoverReadinessFenceEndpoints(input, {
        ...common,
        fetchImpl: causal.fetchImpl,
        cancelWaiter: causal.cancelWaiter,
        observeWaiters: async () => snapshots.shift() ?? observation(),
      }),
      "readiness_fence_probe_waiter_initial_internal_auth_application_name_invalid",
    );
  });
  await t.test("wrong REST SQLSTATE fails", async () => {
    await assertCode(
      runWithResponse((candidate) =>
        candidate.schemaName === "public"
          ? { code: "XX000", message: "已取消" }
          : { error_code: "unexpected_failure" },
      ),
      "readiness_fence_probe_query_cancel_response_invalid",
    );
  });
  await t.test("wrong Auth machine code fails", async () => {
    await assertCode(
      runWithResponse((candidate) =>
        candidate.schemaName === "public"
          ? { code: "57014", message: "已取消" }
          : { error_code: "other_failure", msg: "已取消" },
      ),
      "readiness_fence_probe_query_cancel_response_invalid",
    );
  });
  await t.test("an unrelated waiter cannot satisfy a still-pending HTTP request", async () => {
    const snapshots = [observation(), observation([waiter()]), observation()];
    const calls = [];
    const deadline = async (promise, _milliseconds, code, onTimeout) => {
      if (code === "readiness_fence_probe_query_cancel_response_timeout") {
        onTimeout?.();
        throw new OrdinaryAccountCutoverReadinessFenceError(code);
      }
      return await promise;
    };
    await assertCode(
      probeOrdinaryAccountCutoverReadinessFenceEndpoints(input, {
        ...common,
        fetchImpl: pendingFetchRecorder(calls),
        cancelWaiter: async () => {},
        observeWaiters: async () => snapshots.shift() ?? observation(),
        deadline,
      }),
      "readiness_fence_probe_query_cancel_response_timeout",
    );
    assert.equal(snapshots.length, 0);
  });
  await t.test("a response body that never resolves is bounded after residual-zero proof", async () => {
    const snapshots = [observation(), observation([waiter()]), observation()];
    const calls = [];
    const causal = causalFetchRecorder(calls, [], () => ({
      status: 500,
      text: async () => await new Promise(() => {}),
    }));
    const deadline = async (promise, _milliseconds, code, onTimeout) => {
      if (code === "readiness_fence_probe_query_cancel_response_timeout") {
        onTimeout?.();
        throw new OrdinaryAccountCutoverReadinessFenceError(code);
      }
      return await promise;
    };
    await assertCode(
      probeOrdinaryAccountCutoverReadinessFenceEndpoints(input, {
        ...common,
        fetchImpl: causal.fetchImpl,
        cancelWaiter: causal.cancelWaiter,
        observeWaiters: async () => snapshots.shift() ?? observation(),
        deadline,
      }),
      "readiness_fence_probe_query_cancel_response_timeout",
    );
    assert.equal(snapshots.length, 0);
  });
  for (const [name, awaitedCode, dependency] of [
    [
      "observer",
      "readiness_fence_probe_observer_timeout",
      { observeWaiters: async () => await new Promise(() => {}) },
    ],
    [
      "cancel",
      "readiness_fence_probe_waiter_cancel_timeout",
      {
        observeWaiters: (() => {
          const snapshots = [observation(), observation([waiter()])];
          return async () => snapshots.shift() ?? observation();
        })(),
        cancelWaiter: async () => await new Promise(() => {}),
      },
    ],
  ]) {
    await t.test(`${name} await has an absolute deadline`, async () => {
      const deadline = async (promise, _milliseconds, code, onTimeout) => {
        if (code === awaitedCode) {
          onTimeout?.();
          throw new OrdinaryAccountCutoverReadinessFenceError(code);
        }
        return await promise;
      };
      await assertCode(
        probeOrdinaryAccountCutoverReadinessFenceEndpoints(input, {
          ...common,
          fetchImpl: pendingFetchRecorder([]),
          ...dependency,
          deadline,
        }),
        awaitedCode,
      );
    });
  }
  await t.test("the exact pg_cancel_backend Docker child is killed if it never closes", async () => {
    const snapshots = [observation(), observation([waiter()])];
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const sqlChunks = [];
    child.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        sqlChunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const kills = [];
    let spawnArguments = [];
    child.kill = (signal) => {
      kills.push(signal);
      return true;
    };
    const deadline = async (promise, _milliseconds, code, onTimeout) => {
      if (code === "readiness_fence_probe_waiter_cancel_timeout") {
        onTimeout?.();
        throw new OrdinaryAccountCutoverReadinessFenceError(code);
      }
      return await promise;
    };
    await assertCode(
      probeOrdinaryAccountCutoverReadinessFenceEndpoints(input, {
        ...common,
        fetchImpl: pendingFetchRecorder([]),
        observeWaiters: async () => snapshots.shift() ?? observation(),
        spawnProcess: (_command, argumentsList) => {
          spawnArguments = argumentsList;
          return child;
        },
        deadline,
      }),
      "readiness_fence_probe_waiter_cancel_timeout",
    );
    assert.deepEqual(kills, ["SIGKILL"]);
    for (const binding of [
      "FAOLLA_WAITER_PID=5101",
      "FAOLLA_DATABASE_OID=16384",
      "FAOLLA_RELATION_OID=18000",
      "FAOLLA_SCHEMA_NAME=public",
      "FAOLLA_RELATION_NAME=pages",
      "FAOLLA_DATABASE_USER=authenticator",
      "FAOLLA_APPLICATION_NAME=PostgREST 12.1",
      "FAOLLA_CLIENT_ADDRESS=172.20.0.10",
      "FAOLLA_QUERY_STARTED_AT_EPOCH_MS=1787227200001",
      "FAOLLA_FENCE_BACKEND_PID=4321",
    ]) {
      assert.ok(spawnArguments.includes(binding));
    }
    assert.match(Buffer.concat(sqlChunks).toString("utf8"), /pg_cancel_backend/);
  });
});

test("attestation validation fails closed on wrong, expired, noncanonical, and container-mismatched evidence before Docker", async (t) => {
  const cases = [
    [
      "wrong target",
      async (value) => {
        value.input.expectedTargetSha = "c".repeat(40);
      },
      "attestation_target_sha_mismatch",
      NOW_MS,
    ],
    [
      "expired",
      async () => {},
      "attestation_expired",
      Date.parse("2026-08-20T15:00:00.000Z"),
    ],
    [
      "attestation hash",
      async (value) => {
        value.input.expectedAttestationSha256 = "0".repeat(64);
      },
      "readiness_fence_attestation_sha256_mismatch",
      NOW_MS,
    ],
    [
      "container",
      async (value) => {
        value.input.expectedContainerId = "c".repeat(64);
      },
      "readiness_fence_container_id_mismatch",
      NOW_MS,
    ],
    [
      "noncanonical",
      async (value) => {
        await writeFile(
          value.attestationPath,
          `${JSON.stringify(value.attestation, null, 2)}\n`,
        );
      },
      "attestation_json_not_canonical",
      NOW_MS,
    ],
    [
      "attestation symlink",
      async (value) => {
        const target = path.join(
          path.dirname(value.attestationPath),
          "readiness-attestation-target.json",
        );
        await writeFile(target, canonicalJsonBytes(value.attestation));
        await unlink(value.attestationPath);
        await symlink(target, value.attestationPath, "file");
      },
      "readiness_fence_attestation_symlink",
      NOW_MS,
    ],
    [
      "attestation path swap",
      async () => {},
      "readiness_fence_attestation_file_changed",
      NOW_MS,
      async (value) => {
        const replacement = path.join(
          path.dirname(value.attestationPath),
          "readiness-attestation-replacement.json",
        );
        await writeFile(replacement, canonicalJsonBytes(value.attestation));
        return {
          attestationFileOperations: {
            lstat,
            open: async (filePath, flags) => {
              await unlink(filePath);
              await rename(replacement, filePath);
              return open(filePath, flags);
            },
          },
        };
      },
    ],
  ];
  for (const [name, mutate, code, nowMs, dependencyFactory] of cases) {
    await t.test(name, async () => {
      await temporaryDirectory(async (directory) => {
        const value = await fixture(directory);
        await mutate(value);
        const extraDependencies = dependencyFactory
          ? await dependencyFactory(value)
          : {};
        let spawnCount = 0;
        await assertCode(
          holdOrdinaryAccountCutoverReadinessFence(value.input, {
            nowMs,
            ...extraDependencies,
            spawnProcess: () => {
              spawnCount += 1;
              throw new Error("must_not_spawn");
            },
          }),
          code,
        );
        assert.equal(spawnCount, 0);
        await assertMissing(value.markerPath);
      });
    });
  }
});

test("blocked and live-database-mismatched reports terminate the session without a marker", async (t) => {
  const blocked = readyReport({ migrationsReady: false });
  const wrongDatabase = readyReport({
    databaseIdentity: {
      dbName: "postgres",
      dbOid: "16385",
      systemId: "7612345678901234567",
      primary: true,
    },
  });
  const wrongIdentityContent = readyReport();
  wrongIdentityContent.readiness = {
    ...wrongIdentityContent.readiness,
    ordinaryIdentityContentSha256: "2".repeat(64),
  };
  for (const [name, report, code] of [
    ["blocked", blocked, "readiness_fence_report_blocked"],
    [
      "database identity",
      wrongDatabase,
      "readiness_fence_database_identity_mismatch",
    ],
    [
      "same-count identity content",
      wrongIdentityContent,
      "readiness_fence_baseline_mismatch",
    ],
  ]) {
    await t.test(name, async () => {
      await temporaryDirectory(async (directory) => {
        const value = await fixture(directory);
        const child = new FakeChild();
        const dependencies = coreDependencies(child, {
          spawnProcess: () => {
            queueMicrotask(() => child.stdout.write(fenceLine(report)));
            return child;
          },
        });
        await assertCode(
          holdOrdinaryAccountCutoverReadinessFence(value.input, dependencies),
          code,
        );
        assert.deepEqual(child.signals, ["SIGTERM"]);
        await assertMissing(value.markerPath);
      });
    });
  }
});

test("atomic marker creation refuses symlinks and cleans a failed partial temporary write", async (t) => {
  await t.test("existing symlink", async () => {
    await temporaryDirectory(async (directory) => {
      const target = path.join(directory, "target.json");
      const marker = path.join(directory, "marker.json");
      await writeFile(target, "unchanged");
      await symlink(target, marker, "file");
      await assertCode(
        writeAtomicReadinessFenceMarker(
          marker,
          canonicalJsonBytes({ ok: true }),
        ),
        "readiness_fence_marker_exists",
      );
      assert.equal(await readFile(target, "utf8"), "unchanged");
      assert.equal((await lstat(marker)).isSymbolicLink(), true);
    });
  });

  await t.test("partial temporary write", async () => {
    await temporaryDirectory(async (directory) => {
      const marker = path.join(directory, "marker.json");
      const operations = {
        link,
        lstat,
        unlink,
        open: async (...argumentsList) => {
          const handle = await open(...argumentsList);
          return {
            writeFile: async (bytes) => {
              await handle.write(bytes.subarray(0, 4));
              throw Object.assign(new Error("injected_write_failure"), {
                code: "EIO",
              });
            },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      };
      await assertCode(
        writeAtomicReadinessFenceMarker(
          marker,
          canonicalJsonBytes({ ok: true }),
          { operations },
        ),
        "readiness_fence_marker_write_failed",
      );
      await assertMissing(marker);
      assert.deepEqual(await readdir(directory), []);
    });
  });
});

test("release request reader accepts only canonical 0600 marker-hash and token bindings", async (t) => {
  await temporaryDirectory(async (directory) => {
    const releaseRequestPath = path.join(directory, "release.json");
    const expected = {
      markerSha256: "7".repeat(64),
      releaseToken: "9".repeat(64),
    };
    const valid = {
      schemaVersion: 1,
      kind: "faolla.ordinary-account-cutover-readiness-fence-release.v1",
      markerSha256: expected.markerSha256,
      releaseToken: expected.releaseToken,
    };
    await writeFile(releaseRequestPath, canonicalJsonBytes(valid), {
      flag: "wx",
      mode: 0o600,
    });
    const parsed =
      await readAuthorizedOrdinaryAccountCutoverFenceReleaseRequest(
        releaseRequestPath,
        expected,
      );
    assert.deepEqual(parsed.bytes, canonicalJsonBytes(valid));
    assert.match(parsed.identity.dev, /^[0-9]+$/);
    await unlink(releaseRequestPath);

    for (const [name, value, code] of [
      [
        "wrong marker",
        { ...valid, markerSha256: "8".repeat(64) },
        "readiness_fence_release_request_binding_mismatch",
      ],
      [
        "wrong token",
        { ...valid, releaseToken: "8".repeat(64) },
        "readiness_fence_release_request_binding_mismatch",
      ],
      [
        "extra key",
        { ...valid, extra: true },
        "readiness_fence_release_request_invalid",
      ],
    ]) {
      await t.test(name, async () => {
        await writeFile(releaseRequestPath, canonicalJsonBytes(value), {
          flag: "wx",
          mode: 0o600,
        });
        await assertCode(
          readAuthorizedOrdinaryAccountCutoverFenceReleaseRequest(
            releaseRequestPath,
            expected,
          ),
          code,
        );
        await unlink(releaseRequestPath);
      });
    }
    await writeFile(releaseRequestPath, `${JSON.stringify(valid, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await assertCode(
      readAuthorizedOrdinaryAccountCutoverFenceReleaseRequest(
        releaseRequestPath,
        expected,
      ),
      "readiness_fence_release_request_invalid",
    );
  });
});

test("session termination requires exact-one for release, accepts zero only for cleanup, and rejects multiple", async (t) => {
  const applicationName = `faolla_readiness_fence_${process.pid}_${"1".repeat(24)}`;
  const run = async ({ matchedCount, terminatedCount, requireExactOne }) => {
    const child = new FakeChild();
    const promise = terminateOrdinaryAccountCutoverReadinessFenceSession({
      containerId: CONTAINER_ID,
      applicationName,
      backendPid: requireExactOne ? "4321" : null,
      requireExactOne,
      spawnProcess: () => {
        queueMicrotask(() => {
          child.stdout.write(
            `${JSON.stringify({
              matchedCount,
              terminatedCount,
            })}\n${JSON.stringify({ remainingCount: "0" })}\n`,
          );
          child.close(0);
        });
        return child;
      },
    });
    return { promise, child };
  };
  await t.test("exact one release", async () => {
    const { promise, child } = await run({
      matchedCount: "1",
      terminatedCount: "1",
      requireExactOne: true,
    });
    await promise;
    assert.match(child.input.toString("utf8"), /pg_terminate_backend/);
    assert.match(child.input.toString("utf8"), /remainingCount/);
  });
  await t.test("zero cleanup", async () => {
    const { promise } = await run({
      matchedCount: "0",
      terminatedCount: "0",
      requireExactOne: false,
    });
    await promise;
  });
  for (const [name, matchedCount, terminatedCount, requireExactOne] of [
    ["zero release", "0", "0", true],
    ["multiple cleanup", "2", "2", false],
    ["failed termination", "1", "0", true],
  ]) {
    await t.test(name, async () => {
      const { promise } = await run({
        matchedCount,
        terminatedCount,
        requireExactOne,
      });
      await assertCode(promise, "readiness_fence_termination_failed");
    });
  }
});

test("SIGTERM kills the psql child, waits termination, and removes the complete 0600 marker", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    const child = new FakeChild();
    const signals = new EventEmitter();
    let spawnArguments = [];
    let terminationFinished = false;
    const promise = holdOrdinaryAccountCutoverReadinessFence(
      value.input,
      coreDependencies(child, {
        signalSource: signals,
        spawnProcess: (command, argumentsList) => {
          assert.equal(command, "docker");
          spawnArguments = argumentsList;
          queueMicrotask(() => child.stdout.write(fenceLine()));
          return child;
        },
        terminateSession: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          terminationFinished = true;
        },
        markerWriter: async (...argumentsList) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return writeAtomicReadinessFenceMarker(...argumentsList);
        },
      }),
    );
    const markerBytes = await waitForFile(value.markerPath);
    const marker = JSON.parse(markerBytes);
    const markerMode = (await lstat(value.markerPath)).mode & 0o777;

    try {
      assert.deepEqual(markerBytes, canonicalJsonBytes(marker));
      assert.equal(marker.backendPid, "4321");
      assert.equal(marker.database.containerId, CONTAINER_ID);
      assert.ok(
        spawnArguments.includes(
          `FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256=${"1".repeat(64)}`,
        ),
      );
      if (process.platform !== "win32") assert.equal(markerMode, 0o600);
    } finally {
      signals.emit("SIGTERM");
    }
    await assertCode(promise, "readiness_fence_interrupted");
    assert.equal(terminationFinished, true);
    assert.deepEqual(child.signals, ["SIGTERM"]);
    await assertMissing(value.markerPath);
  });
});

test("SIGHUP from a disconnected deploy session fails closed and terminates the exact fence session", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    const child = new FakeChild();
    const signals = new EventEmitter();
    let terminationInput = null;
    const promise = holdOrdinaryAccountCutoverReadinessFence(
      value.input,
      coreDependencies(child, {
        signalSource: signals,
        spawnProcess: () => {
          queueMicrotask(() => child.stdout.write(fenceLine()));
          return child;
        },
        terminateSession: async (input) => {
          terminationInput = input;
          child.close(1);
        },
      }),
    );
    await waitForFile(value.markerPath);
    signals.emit("SIGHUP");
    await assertCode(promise, "readiness_fence_interrupted");
    assert.deepEqual(terminationInput, {
      containerId: CONTAINER_ID,
      applicationName: terminationInput.applicationName,
      backendPid: "4321",
      requireExactOne: false,
    });
    assert.match(
      terminationInput.applicationName,
      /^faolla_readiness_fence_[1-9][0-9]*_[0-9a-f]{24}$/,
    );
    assert.deepEqual(child.signals, ["SIGTERM"]);
    await assertMissing(value.markerPath);
  });
});

test("a canonical private release request is the only successful path after a 240-second startup budget and preserves the full 900-second marker-ready hold", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    value.input.maximumHoldSeconds = "900";
    value.input.minimumRemainingTtlSeconds = "1440";
    const child = new FakeChild();
    const scheduled = [];
    let terminationInput = null;
    const promise = holdOrdinaryAccountCutoverReadinessFence(
      value.input,
      coreDependencies(child, {
        clockMs: () => NOW_MS + 240_000,
        spawnProcess: () => {
          queueMicrotask(() => child.stdout.write(fenceLine()));
          return child;
        },
        setTimer: (callback, milliseconds) => {
          scheduled.push(milliseconds);
          return setTimeout(callback, milliseconds);
        },
        terminateSession: async (input) => {
          terminationInput = input;
          child.close(1);
        },
      }),
    );
    const markerBytes = await waitForFile(value.markerPath);
    const marker = JSON.parse(markerBytes);
    assert.equal(marker.releaseToken, "9".repeat(64));
    assert.equal(marker.startedAt, "2026-08-20T12:04:00.000Z");
    assert.equal(marker.releaseTokenSha256, sha256Hex(Buffer.from(marker.releaseToken)));
    assert.equal(marker.endpointEvidence.length, 4);
    assert.deepEqual(
      marker.endpointEvidence.map((entry) => entry.probe),
      ["internalRest", "internalAuth", "publicRest", "publicAuth"],
    );
    assert.doesNotMatch(
      markerBytes.toString("utf8"),
      /127\.0\.0\.1|db\.example\.test|anon-key-do-not-log/,
    );
    await writeAtomicReadinessFenceMarker(
      value.releaseRequestPath,
      canonicalJsonBytes({
        schemaVersion: 1,
        kind: "faolla.ordinary-account-cutover-readiness-fence-release.v1",
        markerSha256: sha256Hex(markerBytes),
        releaseToken: marker.releaseToken,
      }),
    );
    const result = await promise;
    assert.equal(result.markerSha256, sha256Hex(markerBytes));
    assert.equal(terminationInput.backendPid, "4321");
    assert.equal(terminationInput.requireExactOne, true);
    assert.ok(scheduled.includes(960_000));
    assert.ok(scheduled.includes(240_000));
    await assertMissing(value.markerPath);
    await assertMissing(value.releaseRequestPath);
  });
});

test("natural database hold completion after a marker remains a nonzero failure", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    const child = new FakeChild();
    const promise = holdOrdinaryAccountCutoverReadinessFence(
      value.input,
      coreDependencies(child, {
        spawnProcess: () => {
          queueMicrotask(() => child.stdout.write(fenceLine()));
          return child;
        },
      }),
    );
    await waitForFile(value.markerPath);
    child.close(0);
    await assertCode(promise, "readiness_fence_ended_before_release");
    await assertMissing(value.markerPath);
  });
});

test("child exit before a report fails closed without orphaning a marker", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    const child = new FakeChild();
    const promise = holdOrdinaryAccountCutoverReadinessFence(
      value.input,
      coreDependencies(child, {
        spawnProcess: () => {
          queueMicrotask(() => child.close(2));
          return child;
        },
      }),
    );
    await assertCode(promise, "readiness_fence_child_failed");
    await assertMissing(value.markerPath);
  });
});

test("marker publication is impossible until the downgraded hold-lock proof is exact", async (t) => {
  for (const [name, holdOutput, expectedCode] of [
    [
      "registry AX missing",
      fenceHoldLine({ registryAccessExclusiveLockCount: "0" }),
      "readiness_fence_hold_locks_invalid",
    ],
    [
      "pages AX retained",
      fenceHoldLine({ pagesAccessExclusiveLockCount: "1" }),
      "readiness_fence_hold_locks_invalid",
    ],
    ["malformed hold proof", "{}\n", "readiness_fence_hold_output_invalid"],
  ]) {
    await t.test(name, async () => {
      await temporaryDirectory(async (directory) => {
        const value = await fixture(directory);
        const child = new FakeChild({ holdOutput });
        let releaseWaitCalled = false;
        let terminationInput = null;
        await assertCode(
          holdOrdinaryAccountCutoverReadinessFence(
            value.input,
            coreDependencies(child, {
              spawnProcess: () => {
                queueMicrotask(() => child.stdout.write(fenceLine()));
                return child;
              },
              waitForReleaseRequest: async () => {
                releaseWaitCalled = true;
              },
              terminateSession: async (input) => {
                terminationInput = input;
              },
            }),
          ),
          expectedCode,
        );
        assert.equal(releaseWaitCalled, false);
        assert.equal(terminationInput.requireExactOne, false);
        await assertMissing(value.markerPath);
      });
    });
  }
});

test("marker-ready time revalidates enough attestation TTL for the full hold plus rollback margin", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    const child = new FakeChild();
    await assertCode(
      holdOrdinaryAccountCutoverReadinessFence(
        value.input,
        coreDependencies(child, {
          clockMs: () => Date.parse("2026-08-20T13:54:31.000Z"),
          spawnProcess: () => {
            queueMicrotask(() => child.stdout.write(fenceLine()));
            return child;
          },
        }),
      ),
      "readiness_fence_marker_ttl_insufficient",
    );
    await assertMissing(value.markerPath);
  });
});

test("the whole endpoint probe and custom terminator remain wall-clock bounded", async (t) => {
  await t.test("never-resolving endpoint probe cannot outlive its total deadline", async () => {
    await temporaryDirectory(async (directory) => {
      const value = await fixture(directory);
      const child = new FakeChild();
      const deadline = async (promise, _milliseconds, code, onTimeout) => {
        if (code === "readiness_fence_probe_timeout") {
          onTimeout?.();
          throw new OrdinaryAccountCutoverReadinessFenceError(code);
        }
        return await promise;
      };
      await assertCode(
        holdOrdinaryAccountCutoverReadinessFence(
          value.input,
          coreDependencies(child, {
            spawnProcess: () => {
              queueMicrotask(() => child.stdout.write(fenceLine()));
              return child;
            },
            probeEndpoints: async () => await new Promise(() => {}),
            deadline,
          }),
        ),
        "readiness_fence_probe_timeout",
      );
      assert.deepEqual(child.signals, ["SIGTERM"]);
      await assertMissing(value.markerPath);
    });
  });

  await t.test("never-resolving terminator cannot leave the helper alive", async () => {
    await temporaryDirectory(async (directory) => {
      const value = await fixture(directory);
      const child = new FakeChild();
      const signals = new EventEmitter();
      const deadline = async (promise, _milliseconds, code, onTimeout) => {
        if (code === "readiness_fence_termination_timeout") {
          onTimeout?.();
          throw new OrdinaryAccountCutoverReadinessFenceError(code);
        }
        return await promise;
      };
      const promise = holdOrdinaryAccountCutoverReadinessFence(
        value.input,
        coreDependencies(child, {
          signalSource: signals,
          spawnProcess: () => {
            queueMicrotask(() => child.stdout.write(fenceLine()));
            return child;
          },
          terminateSession: async () => await new Promise(() => {}),
          deadline,
        }),
      );
      await waitForFile(value.markerPath);
      signals.emit("SIGTERM");
      await assertCode(promise, "readiness_fence_termination_failed");
      await assertMissing(value.markerPath);
    });
  });
});

test("finite maximum hold timeout terminates the child without an orphan marker", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    value.input.minimumRemainingTtlSeconds = "541";
    value.input.maximumHoldSeconds = "1";
    const child = new FakeChild();
    const scheduled = [];
    await assertCode(
      holdOrdinaryAccountCutoverReadinessFence(
        value.input,
        coreDependencies(child, {
          spawnProcess: () => {
            queueMicrotask(() => child.stdout.write(fenceLine()));
            return child;
          },
          setTimer: (callback, milliseconds) => {
            scheduled.push(milliseconds);
            const delay = milliseconds === 61_000 ? 0 : milliseconds;
            return setTimeout(callback, delay);
          },
          clearTimer: clearTimeout,
        }),
      ),
      "readiness_fence_timeout",
    );
    assert.ok(scheduled.includes(61_000));
    assert.ok(scheduled.includes(240_000));
    assert.deepEqual(child.signals, ["SIGTERM"]);
    await assertMissing(value.markerPath);
  });
});

function cliArguments(value) {
  return [
    "hold",
    "--attestation",
    value.attestationPath,
    "--expected-target-sha",
    TARGET_SHA,
    "--expected-run-id",
    "8002",
    "--expected-run-attempt",
    "1",
    "--expected-artifact-id",
    "9003",
    "--expected-artifact-digest",
    `sha256:${"f".repeat(64)}`,
    "--expected-attestation-sha256",
    value.input.expectedAttestationSha256,
    "--expected-container-id",
    CONTAINER_ID,
    "--minimum-remaining-ttl-seconds",
    "570",
    "--ready-marker",
    value.markerPath,
    "--release-request",
    value.releaseRequestPath,
    "--maximum-hold-seconds",
    "30",
  ];
}

test("CLI rejects duplicate and extra arguments and emits only canonical aggregate success", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    await assertCode(
      runOrdinaryAccountCutoverReadinessFenceCli([
        ...cliArguments(value),
        "--expected-run-id",
        "8002",
      ]),
      "readiness_fence_cli_argument_invalid",
    );
    await assertCode(
      runOrdinaryAccountCutoverReadinessFenceCli([
        ...cliArguments(value),
        "--extra",
        "value",
      ]),
      "readiness_fence_cli_argument_invalid",
    );

    const child = new FakeChild();
    const writes = [];
    const statusPromise = runOrdinaryAccountCutoverReadinessFenceCli(
      cliArguments(value),
      coreDependencies(child, {
        spawnProcess: () => {
          queueMicrotask(() => child.stdout.write(fenceLine()));
          return child;
        },
        waitForReleaseRequest: async () => {},
        terminateSession: async () => child.close(1),
        write: (bytes) => writes.push(Buffer.from(bytes)),
      }),
    );
    assert.equal(await statusPromise, 0);
    const output = Buffer.concat(writes);
    const summary = JSON.parse(output);
    assert.deepEqual(output, canonicalJsonBytes(summary));
    assert.equal(summary.ok, true);
    assert.equal(summary.backendPid, "4321");
    assert.match(summary.markerSha256, /^[0-9a-f]{64}$/);
    await assertMissing(value.markerPath);
  });
});

test("private helper failure logs expose only an allowlisted canonical code", async () => {
  const allowedRecord = {
    childExitCode: null,
    childResult: "not_observed",
    childSignal: null,
    error: "readiness_fence_probe_environment_invalid",
    ok: false,
    sqlstate: null,
    sqlstateStatus: "absent",
  };
  const allowedBytes = canonicalJsonBytes(allowedRecord);
  assert.deepEqual(
    parseOrdinaryAccountCutoverReadinessFenceFailureLog(allowedBytes),
    allowedRecord,
  );
  for (const hostileBytes of [
    Buffer.from(
      '{"error":"readiness_fence_probe_environment_invalid_secret","ok":false}\n',
    ),
    Buffer.from(
      '{"ok":false,"error":"readiness_fence_probe_environment_invalid"}\n',
    ),
    Buffer.from(
      '{"error":"readiness_fence_probe_environment_invalid","ok":false,"secret":"do-not-log"}\n',
    ),
    Buffer.concat([allowedBytes, Buffer.from("do-not-log")]),
    Buffer.alloc(8 * 1024, 0x61),
  ]) {
    assert.equal(
      parseOrdinaryAccountCutoverReadinessFenceFailureLog(hostileBytes),
      null,
    );
  }

  await temporaryDirectory(async (directory) => {
    const logPath = path.join(directory, "helper.log");
    const hardLinkPath = path.join(directory, "helper-hard-link.log");
    const targetPath = path.join(directory, "target.log");
    await writeFile(logPath, allowedBytes, { mode: 0o600 });
    await chmod(logPath, 0o600);
    assert.deepEqual(
      await readOrdinaryAccountCutoverReadinessFenceFailureRecord(logPath),
      allowedRecord,
    );
    await link(logPath, hardLinkPath);
    assert.equal(
      await readOrdinaryAccountCutoverReadinessFenceFailureRecord(logPath),
      null,
    );
    await unlink(hardLinkPath);
    const before = await lstat(logPath, { bigint: true });
    let lstatCount = 0;
    assert.equal(
      await readOrdinaryAccountCutoverReadinessFenceFailureRecord(logPath, {
        lstat: async () => {
          lstatCount += 1;
          if (lstatCount === 1) return before;
          return {
            ...before,
            ino: before.ino + 1n,
            isFile: () => true,
            isSymbolicLink: () => false,
          };
        },
      }),
      null,
    );
    await unlink(logPath);
    await writeFile(targetPath, allowedBytes, { mode: 0o600 });
    await symlink(targetPath, logPath);
    assert.equal(
      await readOrdinaryAccountCutoverReadinessFenceFailureRecord(logPath),
      null,
    );
  });
});

test("failure serialization rejects accessors, prototypes, and attacker-shaped codes", () => {
  const secret = "do-not-log::error::private-value";
  const hostile = new OrdinaryAccountCutoverReadinessFenceError(
    "readiness_fence_child_failed",
    Object.assign(Object.create({
      toJSON: () => secret,
    }), {
      childExitCode: "3",
      childResult: "exit",
      childSignal: null,
      sqlstate: "P0001",
      sqlstateStatus: "exact",
    }),
  );
  Object.defineProperty(hostile, "code", {
    configurable: true,
    get() {
      throw new Error(secret);
    },
  });
  const bytes = ordinaryAccountCutoverReadinessFenceFailureLogBytes(hostile);
  assert.doesNotMatch(bytes.toString("utf8"), /do-not-log|::error::|private-value/);
  assert.deepEqual(
    parseOrdinaryAccountCutoverReadinessFenceFailureLog(bytes),
    {
      childExitCode: null,
      childResult: "not_observed",
      childSignal: null,
      error: "readiness_fence_unexpected_error",
      ok: false,
      sqlstate: null,
      sqlstateStatus: "absent",
    },
  );

  const attestationError = new OrdinaryAccountCutoverReadinessFenceError(
    `attestation_${secret}`,
  );
  const attestationBytes =
    ordinaryAccountCutoverReadinessFenceFailureLogBytes(attestationError);
  assert.doesNotMatch(attestationBytes.toString("utf8"), /do-not-log|private-value/);
  assert.equal(
    parseOrdinaryAccountCutoverReadinessFenceFailureLog(attestationBytes).error,
    "readiness_fence_attestation_invalid",
  );
});
