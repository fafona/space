import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  access,
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
  OrdinaryAccountCutoverReadinessFenceError,
  probeOrdinaryAccountCutoverReadinessFenceEndpoints,
  readAuthorizedOrdinaryAccountCutoverFenceReleaseRequest,
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

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.input = Buffer.alloc(0);
    this.signals = [];
    this.closed = false;
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.input = Buffer.concat([this.input, Buffer.from(chunk)]);
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
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }
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
      expectedContainerId: CONTAINER_ID,
      minimumRemainingTtlSeconds: "360",
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

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  throw new Error("marker_not_created");
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

function successfulProbeSequence({ lingerAfterAbort = false } = {}) {
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
    });
    return lingerAfterAbort
      ? [observation(), observation([candidate]), observation([candidate]), observation()]
      : [observation(), observation([candidate]), observation()];
  });
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
  assert.ok(lateTimeout > captureIndex);
  assert.ok(authExclusiveLock > lateTimeout);
  assert.ok(pagesExclusiveLock > authExclusiveLock);
  assert.ok(registryExclusiveLock > pagesExclusiveLock);
  assert.ok(outputIndex > registryExclusiveLock);
  assert.ok(sql.indexOf("pg_sleep") > outputIndex);
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

test("four anon behavior probes bind internal/public REST pages and Auth users waiters without exposing service credentials", async () => {
  const calls = [];
  const snapshots = successfulProbeSequence({ lingerAfterAbort: true });
  const cancelled = [];
  const evidence =
    await probeOrdinaryAccountCutoverReadinessFenceEndpoints(
      {
        containerId: CONTAINER_ID,
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
        fetchImpl: pendingFetchRecorder(calls),
        observeWaiters: async () => snapshots.shift(),
        cancelWaiter: async (candidate) => cancelled.push(candidate.pid),
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
        /^[0-9a-f]{64}$/.test(entry.endpointSha256),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /127\.0\.0\.1|db\.example|anon-only|invalid\.example/,
  );
});

test("behavior probes fail closed on early HTTP, stale/multiple/wrong waiters, and cancellation residue", async (t) => {
  const baseInput = {
    containerId: CONTAINER_ID,
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
      "readiness_fence_probe_waiter_invalid",
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
      "readiness_fence_probe_waiter_invalid",
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
    const snapshots = [
      observation(),
      observation([candidate]),
      ...Array.from({ length: 302 }, () => observation([candidate])),
    ];
    await assertCode(
      probeOrdinaryAccountCutoverReadinessFenceEndpoints(baseInput, {
        ...baseDependencies,
        fetchImpl: pendingFetchRecorder(calls),
        observeWaiters: async () => snapshots.shift() ?? observation([candidate]),
      }),
      "readiness_fence_probe_waiter_residual",
    );
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
  const blocked = readyReport({ objectContractsReady: false });
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

test("a canonical private release request is the only successful path and preserves more than 120 seconds of marker-ready hold budget", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    value.input.maximumHoldSeconds = "121";
    value.input.minimumRemainingTtlSeconds = "421";
    const child = new FakeChild();
    const scheduled = [];
    let terminationInput = null;
    const promise = holdOrdinaryAccountCutoverReadinessFence(
      value.input,
      coreDependencies(child, {
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
    await writeFile(
      value.releaseRequestPath,
      canonicalJsonBytes({
        schemaVersion: 1,
        kind: "faolla.ordinary-account-cutover-readiness-fence-release.v1",
        markerSha256: sha256Hex(markerBytes),
        releaseToken: marker.releaseToken,
      }),
      { flag: "wx", mode: 0o600 },
    );
    const result = await promise;
    assert.equal(result.markerSha256, sha256Hex(markerBytes));
    assert.equal(terminationInput.backendPid, "4321");
    assert.equal(terminationInput.requireExactOne, true);
    assert.ok(scheduled.includes(181_000));
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

test("finite maximum hold timeout terminates the child without an orphan marker", async () => {
  await temporaryDirectory(async (directory) => {
    const value = await fixture(directory);
    value.input.minimumRemainingTtlSeconds = "301";
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
    "--expected-container-id",
    CONTAINER_ID,
    "--minimum-remaining-ttl-seconds",
    "360",
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
