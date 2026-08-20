import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalJsonBytes,
  parseProductionReleaseAttestation,
  PRODUCTION_BACKUP_ATTESTATION_KIND,
  PRODUCTION_READINESS_ATTESTATION_KIND,
  ProductionReleaseAttestationError,
  productionReleaseAttestationSummary,
  readProductionReleaseAttestationFile,
  runProductionReleaseAttestationCli,
  sha256Hex,
  validateProductionReleaseAttestation,
} from "./production-release-attestation.mjs";

const NOW_ISO = "2026-08-20T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const TARGET_SHA = "a".repeat(40);
const CONTAINER_ID = "b".repeat(64);

function baseline(overrides = {}) {
  return {
    merchantRecordCount: "10",
    merchantAuthoritativeBindingCount: "10",
    merchantInvalidBindingCount: "0",
    personalCanonicalBindingCount: "5",
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

function artifact({
  id,
  runId,
  runAttempt = "1",
  name,
  fileName,
  createdAt,
  expiresAt = "2026-08-27T12:00:00.000Z",
  digestCharacter = "c",
  fileHashCharacter = "d",
  artifactSize = "2048",
  fileSize = "1024",
  headSha = TARGET_SHA,
} = {}) {
  return {
    id,
    name,
    digest: `sha256:${digestCharacter.repeat(64)}`,
    sizeBytes: artifactSize,
    createdAt,
    expiresAt,
    expired: false,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    headSha,
    file: {
      name: fileName,
      sizeBytes: fileSize,
      sha256: fileHashCharacter.repeat(64),
    },
  };
}

function backupAttestation(overrides = {}) {
  const value = {
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
      runId: "8001",
      name: "faolla-encrypted-disaster-recovery-8001-1",
      fileName: "faolla-database-backup.tar.enc",
      createdAt: "2026-08-20T11:50:00.000Z",
    }),
    issuedAt: "2026-08-20T11:55:00.000Z",
    validUntil: "2026-08-21T11:55:00.000Z",
  };
  return Object.assign(value, overrides);
}

function readinessAttestation(overrides = {}) {
  const parsedBackup = parseProductionReleaseAttestation(backupAttestation(), {
    nowMs: NOW_MS,
  });
  const backupBytes = canonicalJsonBytes(parsedBackup);
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
      runId: "8002",
      name: "faolla-production-readiness-report-8002-1",
      fileName: "production-readiness-report.json",
      createdAt: "2026-08-20T11:59:00.000Z",
      digestCharacter: "e",
      fileHashCharacter: "f",
    }),
    backup: {
      attestation: parsedBackup,
      attestationArtifact: artifact({
        id: "9002",
        runId: "8001",
        name: "faolla-production-backup-attestation-8001-1",
        fileName: "production-backup-attestation.json",
        createdAt: "2026-08-20T11:56:00.000Z",
        digestCharacter: "1",
        fileHashCharacter: "0",
        artifactSize: "4096",
        fileSize: String(backupBytes.length),
      }),
    },
    issuedAt: NOW_ISO,
    validUntil: "2026-08-20T14:00:00.000Z",
  };
  value.backup.attestationArtifact.file.sha256 = sha256Hex(backupBytes);
  return Object.assign(value, overrides);
}

function clone(value) {
  return structuredClone(value);
}

function assertInvalid(value, expectedCode, options = {}) {
  const validation = validateProductionReleaseAttestation(value, {
    nowMs: NOW_MS,
    ...options,
  });
  assert.deepEqual(validation, { valid: false, error: expectedCode });
  assert.throws(
    () =>
      parseProductionReleaseAttestation(value, {
        nowMs: NOW_MS,
        ...options,
      }),
    (error) =>
      error instanceof ProductionReleaseAttestationError &&
      error.code === expectedCode,
  );
}

async function withTemporaryDirectory(callback) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-release-attestation-test-"),
  );
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("backup attestation validates exact run, source, database, baseline, and artifact metadata", () => {
  const value = backupAttestation();
  const parsed = parseProductionReleaseAttestation(value, { nowMs: NOW_MS });
  const validation = validateProductionReleaseAttestation(value, {
    nowMs: NOW_MS,
    expectedKind: "backup",
    expectedRepository: "fafona/space",
    expectedTargetSha: TARGET_SHA,
    expectedRunId: "8001",
    expectedRunAttempt: "1",
    expectedBackupRunId: "8001",
    expectedArtifactId: "9001",
    expectedArtifactDigest: `sha256:${"c".repeat(64)}`,
    expectedDatabase: database(),
    expectedBaseline: baseline(),
  });

  assert.equal(parsed.kind, PRODUCTION_BACKUP_ATTESTATION_KIND);
  assert.equal(
    parsed.run.workflowPath,
    ".github/workflows/database-backup.yml",
  );
  assert.equal(parsed.database.primary, true);
  assert.equal(validation.valid, true);
  assert.equal(validation.sha256, sha256Hex(validation.canonicalBytes));
});

test("readiness attestation recursively binds the complete backup and exact baseline", () => {
  const value = readinessAttestation();
  const parsed = parseProductionReleaseAttestation(value, { nowMs: NOW_MS });
  const summary = productionReleaseAttestationSummary(parsed);

  assert.equal(parsed.kind, PRODUCTION_READINESS_ATTESTATION_KIND);
  assert.equal(parsed.run.id, "8002");
  assert.equal(parsed.backup.attestation.run.id, "8001");
  assert.equal(parsed.baseline.merchantRecordCount, "10");
  assert.equal(parsed.backup.attestation.baseline.merchantRecordCount, "10");
  assert.equal(summary.backupRunId, "8001");
  assert.equal(summary.backupRunAttempt, "1");
  assert.equal(summary.readinessRunId, "8002");
  assert.equal(summary.backupArtifactId, "9001");
  assert.equal(summary.backupAttestationArtifactId, "9002");
  assert.equal(summary.readinessArtifactId, "9003");
  assert.match(summary.databaseIdentitySha256, /^[0-9a-f]{64}$/);
  assert.match(summary.baselineSha256, /^[0-9a-f]{64}$/);
});

test("readiness rejects any population change after the verified backup", () => {
  const value = readinessAttestation();
  value.baseline.merchantRecordCount = "11";
  value.baseline.merchantAuthoritativeBindingCount = "11";
  assertInvalid(value, "readiness_backup_baseline_mismatch");
});

test("canonical JSON bytes sort every object key and include exactly one LF", () => {
  const left = { z: 2, a: { y: true, x: "value" }, items: [{ b: 1, a: 0 }] };
  const right = { items: [{ a: 0, b: 1 }], a: { x: "value", y: true }, z: 2 };
  const expected =
    '{"a":{"x":"value","y":true},"items":[{"a":0,"b":1}],"z":2}\n';

  assert.equal(canonicalJsonBytes(left).toString("utf8"), expected);
  assert.deepEqual(canonicalJsonBytes(left), canonicalJsonBytes(right));
  assert.equal(sha256Hex(canonicalJsonBytes(left)), sha256Hex(expected));
});

test("canonical JSON rejects lossy numbers, unsupported values, and cycles", () => {
  for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, -0]) {
    assert.throws(
      () => canonicalJsonBytes({ value }),
      (error) => error.code === "canonical_json_number_invalid",
    );
  }
  assert.throws(
    () => canonicalJsonBytes({ value: undefined }),
    (error) => error.code === "canonical_json_value_invalid",
  );
  assert.throws(
    () => canonicalJsonBytes({ value: new Date(NOW_MS) }),
    (error) => error.code === "canonical_json_value_invalid",
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => canonicalJsonBytes(cyclic),
    (error) => error.code === "canonical_json_cycle",
  );
});

test("every attestation record rejects extra and missing keys", async (t) => {
  const cases = [
    [
      "backup top level",
      backupAttestation(),
      (value) => value,
      "backup_attestation_keys_invalid",
    ],
    [
      "run",
      backupAttestation(),
      (value) => value.run,
      "attestation_run_invalid",
    ],
    [
      "remote source",
      backupAttestation(),
      (value) => value.remoteSource,
      "attestation_remote_source_invalid",
    ],
    [
      "database",
      backupAttestation(),
      (value) => value.database,
      "attestation_database_identity_invalid",
    ],
    [
      "baseline",
      backupAttestation(),
      (value) => value.baseline,
      "attestation_baseline_invalid",
    ],
    [
      "artifact",
      backupAttestation(),
      (value) => value.backupArtifact,
      "attestation_artifact_invalid",
    ],
    [
      "artifact file",
      backupAttestation(),
      (value) => value.backupArtifact.file,
      "attestation_artifact_file_invalid",
    ],
    [
      "readiness top level",
      readinessAttestation(),
      (value) => value,
      "readiness_attestation_keys_invalid",
    ],
    [
      "backup reference",
      readinessAttestation(),
      (value) => value.backup,
      "readiness_backup_reference_invalid",
    ],
  ];

  for (const [name, source, select, code] of cases) {
    await t.test(`${name} rejects an extra key`, () => {
      const value = clone(source);
      select(value).unexpected = true;
      assertInvalid(value, code);
    });
    await t.test(`${name} rejects a missing key`, () => {
      const value = clone(source);
      delete select(value)[Object.keys(select(value))[0]];
      assertInvalid(value, code);
    });
  }
});

test("IDs, attempts, OIDs, system identifiers, sizes, and counts are bounded canonical decimal strings", async (t) => {
  const cases = [
    [
      "numeric run id",
      (value) => {
        value.run.id = 8001;
      },
      "attestation_run_id_invalid",
    ],
    [
      "zero run id",
      (value) => {
        value.run.id = "0";
      },
      "attestation_run_id_invalid",
    ],
    [
      "leading-zero run id",
      (value) => {
        value.run.id = "08001";
      },
      "attestation_run_id_invalid",
    ],
    [
      "overflow run id",
      (value) => {
        value.run.id = "18446744073709551616";
      },
      "attestation_run_id_invalid",
    ],
    [
      "zero attempt",
      (value) => {
        value.run.attempt = "0";
      },
      "attestation_run_attempt_invalid",
    ],
    [
      "overflow attempt",
      (value) => {
        value.run.attempt = "4294967296";
      },
      "attestation_run_attempt_invalid",
    ],
    [
      "zero database OID",
      (value) => {
        value.database.dbOid = "0";
      },
      "attestation_database_oid_invalid",
    ],
    [
      "overflow database OID",
      (value) => {
        value.database.dbOid = "4294967296";
      },
      "attestation_database_oid_invalid",
    ],
    [
      "zero system identifier",
      (value) => {
        value.database.systemId = "0";
      },
      "attestation_database_system_identifier_invalid",
    ],
    [
      "overflow system identifier",
      (value) => {
        value.database.systemId = "18446744073709551616";
      },
      "attestation_database_system_identifier_invalid",
    ],
    [
      "zero artifact bytes",
      (value) => {
        value.backupArtifact.sizeBytes = "0";
      },
      "attestation_artifact_size_invalid",
    ],
    [
      "zero artifact file bytes",
      (value) => {
        value.backupArtifact.file.sizeBytes = "0";
      },
      "attestation_artifact_file_size_invalid",
    ],
    [
      "numeric count",
      (value) => {
        value.baseline.merchantRecordCount = 10;
      },
      "attestation_baseline_merchantRecordCount_invalid",
    ],
    [
      "leading-zero count",
      (value) => {
        value.baseline.merchantRecordCount = "010";
      },
      "attestation_baseline_merchantRecordCount_invalid",
    ],
    [
      "negative count",
      (value) => {
        value.baseline.merchantRecordCount = "-1";
      },
      "attestation_baseline_merchantRecordCount_invalid",
    ],
    [
      "overflow count",
      (value) => {
        value.baseline.merchantRecordCount = "9223372036854775808";
      },
      "attestation_baseline_merchantRecordCount_invalid",
    ],
  ];

  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      const value = backupAttestation();
      mutate(value);
      assertInvalid(value, code);
    });
  }
});

test("SHA fields and artifact digests are lowercase, exact-width, and cross-bound", async (t) => {
  const cases = [
    [
      "uppercase target",
      (value) => {
        value.targetSha = TARGET_SHA.toUpperCase();
      },
      "attestation_target_sha_invalid",
    ],
    [
      "short target",
      (value) => {
        value.targetSha = "a".repeat(39);
      },
      "attestation_target_sha_invalid",
    ],
    [
      "run head mismatch",
      (value) => {
        value.run.headSha = "1".repeat(40);
      },
      "attestation_run_head_sha_mismatch",
    ],
    [
      "remote head mismatch",
      (value) => {
        value.remoteSource.headSha = "1".repeat(40);
      },
      "attestation_remote_source_sha_mismatch",
    ],
    [
      "remote origin mismatch",
      (value) => {
        value.remoteSource.originMainSha = "1".repeat(40);
      },
      "attestation_remote_source_sha_mismatch",
    ],
    [
      "artifact head mismatch",
      (value) => {
        value.backupArtifact.headSha = "1".repeat(40);
      },
      "attestation_artifact_run_mismatch",
    ],
    [
      "bare artifact digest",
      (value) => {
        value.backupArtifact.digest = "c".repeat(64);
      },
      "attestation_artifact_digest_invalid",
    ],
    [
      "uppercase artifact digest",
      (value) => {
        value.backupArtifact.digest = `sha256:${"C".repeat(64)}`;
      },
      "attestation_artifact_digest_invalid",
    ],
    [
      "uppercase file SHA",
      (value) => {
        value.backupArtifact.file.sha256 = "D".repeat(64);
      },
      "attestation_artifact_file_sha256_invalid",
    ],
    [
      "uppercase identity content SHA",
      (value) => {
        value.baseline.ordinaryIdentityContentSha256 = "A".repeat(64);
      },
      "attestation_baseline_ordinaryIdentityContentSha256_invalid",
    ],
    [
      "short identity content SHA",
      (value) => {
        value.baseline.ordinaryIdentityContentSha256 = "a".repeat(63);
      },
      "attestation_baseline_ordinaryIdentityContentSha256_invalid",
    ],
  ];

  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      const value = backupAttestation();
      mutate(value);
      assertInvalid(value, code);
    });
  }
});

test("remote evidence must prove an exact clean detached checkout", async (t) => {
  for (const key of ["detached", "cleanBefore", "cleanAfter"]) {
    await t.test(`${key}=false is rejected`, () => {
      const value = backupAttestation();
      value.remoteSource[key] = false;
      assertInvalid(value, "attestation_remote_source_not_clean_detached");
    });
  }
});

test("workflow paths, events, branches, repositories, schemas, and kinds are frozen", async (t) => {
  const cases = [
    [
      "workflow path",
      (value) => {
        value.run.workflowPath = ".github/workflows/other.yml";
      },
      "attestation_run_workflow_path_mismatch",
    ],
    [
      "event",
      (value) => {
        value.run.event = "push";
      },
      "attestation_run_event_invalid",
    ],
    [
      "branch",
      (value) => {
        value.run.headBranch = "release";
      },
      "attestation_run_head_branch_invalid",
    ],
    [
      "repository",
      (value) => {
        value.repository = "not a repository";
      },
      "attestation_repository_invalid",
    ],
    [
      "schema",
      (value) => {
        value.schemaVersion = 2;
      },
      "attestation_schema_version_invalid",
    ],
    [
      "kind",
      (value) => {
        value.kind = "backup";
      },
      "attestation_kind_invalid",
    ],
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      const value = backupAttestation();
      mutate(value);
      assertInvalid(value, code);
    });
  }

  await t.test("scheduled backups remain valid", () => {
    const value = backupAttestation();
    value.run.event = "schedule";
    assert.equal(
      validateProductionReleaseAttestation(value, { nowMs: NOW_MS }).valid,
      true,
    );
  });
  await t.test("readiness never accepts a schedule event", () => {
    const value = readinessAttestation();
    value.run.event = "schedule";
    assertInvalid(value, "attestation_run_event_invalid");
  });
});

test("database identity is exact, primary-only, and recursively stable", async (t) => {
  const cases = [
    [
      "unsafe container name",
      (value) => {
        value.database.containerName = "/supabase-db";
      },
      "attestation_database_container_name_invalid",
    ],
    [
      "short container ID",
      (value) => {
        value.database.containerId = "b".repeat(63);
      },
      "attestation_database_container_id_invalid",
    ],
    [
      "unsafe database name",
      (value) => {
        value.database.dbName = "production database";
      },
      "attestation_database_name_invalid",
    ],
    [
      "replica",
      (value) => {
        value.database.primary = false;
      },
      "attestation_database_not_primary",
    ],
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      const value = backupAttestation();
      mutate(value);
      assertInvalid(value, code);
    });
  }

  await t.test(
    "readiness rejects a different container-backed database",
    () => {
      const value = readinessAttestation();
      value.database.containerId = "9".repeat(64);
      assertInvalid(value, "readiness_backup_database_mismatch");
    },
  );
});

test("aggregate vectors reject semantic merchant binding overflow", () => {
  const value = backupAttestation();
  value.baseline.merchantAuthoritativeBindingCount = "11";
  assertInvalid(value, "attestation_baseline_merchant_binding_count_invalid");
});

test("attestation and artifact TTLs reject future, expired, undersized, and overlong evidence", async (t) => {
  const cases = [
    [
      "noncanonical issued timestamp",
      (value) => {
        value.issuedAt = "2026-08-20T11:55:00Z";
      },
      "attestation_issued_at_invalid",
    ],
    [
      "issued in future",
      (value) => {
        value.issuedAt = "2026-08-20T12:00:00.001Z";
        value.validUntil = "2026-08-20T13:00:00.001Z";
      },
      "attestation_issued_in_future",
    ],
    [
      "expired attestation",
      (value) => {
        value.validUntil = NOW_ISO;
      },
      "attestation_expired",
    ],
    [
      "TTL below one minute",
      (value) => {
        value.issuedAt = "2026-08-20T11:59:30.001Z";
        value.validUntil = "2026-08-20T12:00:30.000Z";
      },
      "attestation_ttl_invalid",
    ],
    [
      "backup TTL above 24 hours",
      (value) => {
        value.validUntil = "2026-08-21T11:55:00.001Z";
      },
      "attestation_ttl_invalid",
    ],
    [
      "artifact reports expired",
      (value) => {
        value.backupArtifact.expired = true;
      },
      "attestation_artifact_expired",
    ],
    [
      "artifact expiry is in the past",
      (value) => {
        value.backupArtifact.expiresAt = "2026-08-20T11:59:59.999Z";
      },
      "attestation_artifact_expired",
    ],
    [
      "artifact expires before attestation",
      (value) => {
        value.backupArtifact.expiresAt = "2026-08-21T11:54:59.999Z";
      },
      "attestation_artifact_ttl_mismatch",
    ],
    [
      "artifact created in future",
      (value) => {
        value.backupArtifact.createdAt = "2026-08-20T12:00:00.001Z";
      },
      "attestation_artifact_created_in_future",
    ],
    [
      "artifact run mismatch",
      (value) => {
        value.backupArtifact.workflowRunId = "8002";
      },
      "attestation_artifact_run_mismatch",
    ],
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      const value = backupAttestation();
      mutate(value);
      assertInvalid(value, code);
    });
  }

  await t.test("minimum remaining TTL is enforced", () => {
    assertInvalid(
      backupAttestation(),
      "attestation_remaining_ttl_insufficient",
      { minimumRemainingTtlMs: 24 * 60 * 60 * 1000 },
    );
  });
  await t.test("readiness TTL cannot exceed two hours", () => {
    const value = readinessAttestation();
    value.validUntil = "2026-08-20T14:00:00.001Z";
    assertInvalid(value, "attestation_ttl_invalid");
  });
  await t.test("readiness cannot outlive its backup", () => {
    const value = readinessAttestation();
    value.backup.attestation.validUntil = "2026-08-20T13:30:00.000Z";
    value.backup.attestation.backupArtifact.expiresAt =
      "2026-08-27T12:00:00.000Z";
    const nestedBytes = canonicalJsonBytes(value.backup.attestation);
    value.backup.attestationArtifact.file.sha256 = sha256Hex(nestedBytes);
    value.backup.attestationArtifact.file.sizeBytes = String(
      nestedBytes.length,
    );
    assertInvalid(value, "readiness_backup_lifetime_mismatch");
  });
});

test("recursive backup scope, run IDs, artifact IDs, and canonical bytes cannot be substituted", async (t) => {
  await t.test("repository mismatch", () => {
    const value = readinessAttestation();
    value.backup.attestation.repository = "other/space";
    const nestedBytes = canonicalJsonBytes(value.backup.attestation);
    value.backup.attestationArtifact.file.sha256 = sha256Hex(nestedBytes);
    value.backup.attestationArtifact.file.sizeBytes = String(
      nestedBytes.length,
    );
    assertInvalid(value, "readiness_backup_scope_mismatch");
  });
  await t.test("backup run ID cannot equal readiness run ID", () => {
    const value = readinessAttestation();
    value.backup.attestation.run.id = value.run.id;
    value.backup.attestation.backupArtifact.workflowRunId = value.run.id;
    value.backup.attestationArtifact.workflowRunId = value.run.id;
    const nestedBytes = canonicalJsonBytes(value.backup.attestation);
    value.backup.attestationArtifact.file.sha256 = sha256Hex(nestedBytes);
    value.backup.attestationArtifact.file.sizeBytes = String(
      nestedBytes.length,
    );
    assertInvalid(value, "readiness_backup_run_id_reused");
  });
  await t.test("attestation file SHA mismatch", () => {
    const value = readinessAttestation();
    value.backup.attestationArtifact.file.sha256 = "9".repeat(64);
    assertInvalid(value, "readiness_backup_attestation_artifact_mismatch");
  });
  await t.test("attestation file byte length mismatch", () => {
    const value = readinessAttestation();
    value.backup.attestationArtifact.file.sizeBytes = "1";
    assertInvalid(value, "readiness_backup_attestation_artifact_mismatch");
  });
  await t.test("artifact IDs cannot be reused", () => {
    const value = readinessAttestation();
    value.readinessArtifact.id = value.backup.attestationArtifact.id;
    assertInvalid(value, "readiness_artifact_id_reused");
  });
  await t.test(
    "backup attestation artifact must belong to the backup run",
    () => {
      const value = readinessAttestation();
      value.backup.attestationArtifact.workflowRunId = value.run.id;
      assertInvalid(value, "attestation_artifact_run_mismatch");
    },
  );
});

test("explicit workflow expectations fail closed on every mismatch", async (t) => {
  const value = readinessAttestation();
  const cases = [
    ["kind", { expectedKind: "backup" }, "attestation_expected_kind_mismatch"],
    [
      "repository",
      { expectedRepository: "other/space" },
      "attestation_repository_mismatch",
    ],
    [
      "target",
      { expectedTargetSha: "1".repeat(40) },
      "attestation_target_sha_mismatch",
    ],
    ["run", { expectedRunId: "1" }, "attestation_run_id_mismatch"],
    [
      "attempt",
      { expectedRunAttempt: "2" },
      "attestation_run_attempt_mismatch",
    ],
    [
      "backup run",
      { expectedBackupRunId: "1" },
      "attestation_backup_run_id_mismatch",
    ],
    [
      "readiness run",
      { expectedReadinessRunId: "1" },
      "attestation_readiness_run_id_mismatch",
    ],
    [
      "artifact ID",
      { expectedArtifactId: "1" },
      "attestation_artifact_id_mismatch",
    ],
    [
      "artifact digest",
      { expectedArtifactDigest: `sha256:${"1".repeat(64)}` },
      "attestation_artifact_digest_mismatch",
    ],
    [
      "backup artifact ID",
      { expectedBackupArtifactId: "1" },
      "attestation_backup_artifact_id_mismatch",
    ],
    [
      "backup artifact digest",
      { expectedBackupArtifactDigest: `sha256:${"2".repeat(64)}` },
      "attestation_backup_artifact_digest_mismatch",
    ],
    [
      "backup attestation artifact ID",
      { expectedBackupAttestationArtifactId: "1" },
      "attestation_backup_attestation_artifact_id_mismatch",
    ],
    [
      "backup attestation artifact digest",
      { expectedBackupAttestationArtifactDigest: `sha256:${"2".repeat(64)}` },
      "attestation_backup_attestation_artifact_digest_mismatch",
    ],
    [
      "readiness artifact ID",
      { expectedReadinessArtifactId: "1" },
      "attestation_readiness_artifact_id_mismatch",
    ],
    [
      "readiness artifact digest",
      { expectedReadinessArtifactDigest: `sha256:${"2".repeat(64)}` },
      "attestation_readiness_artifact_digest_mismatch",
    ],
    [
      "database",
      { expectedDatabase: database({ dbOid: "16385" }) },
      "attestation_database_identity_mismatch",
    ],
    [
      "baseline",
      {
        expectedBaseline: baseline({
          merchantRecordCount: "11",
          merchantAuthoritativeBindingCount: "11",
        }),
      },
      "attestation_baseline_mismatch",
    ],
  ];

  for (const [name, options, code] of cases) {
    await t.test(name, () => assertInvalid(value, code, options));
  }
});

test("canonical file reader rejects empty, oversized, malformed, reordered, and duplicate-key JSON", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = parseProductionReleaseAttestation(backupAttestation(), {
      nowMs: NOW_MS,
    });
    const canonical = canonicalJsonBytes(value);
    const validPath = path.join(directory, "valid.json");
    await writeFile(validPath, canonical);
    const read = await readProductionReleaseAttestationFile(validPath, {
      nowMs: NOW_MS,
      expectedKind: "backup",
    });
    assert.equal(read.sha256, sha256Hex(canonical));

    const emptyPath = path.join(directory, "empty.json");
    await writeFile(emptyPath, "");
    await assert.rejects(
      readProductionReleaseAttestationFile(emptyPath, { nowMs: NOW_MS }),
      (error) => error.code === "attestation_input_file_invalid",
    );

    const oversizedPath = path.join(directory, "oversized.json");
    await writeFile(oversizedPath, "x".repeat(1024 * 1024 + 1));
    await assert.rejects(
      readProductionReleaseAttestationFile(oversizedPath, { nowMs: NOW_MS }),
      (error) => error.code === "attestation_input_file_invalid",
    );

    const malformedPath = path.join(directory, "malformed.json");
    await writeFile(malformedPath, "{not-json}\n");
    await assert.rejects(
      readProductionReleaseAttestationFile(malformedPath, { nowMs: NOW_MS }),
      (error) => error.code === "attestation_json_invalid",
    );

    const reorderedPath = path.join(directory, "reordered.json");
    await writeFile(reorderedPath, `${JSON.stringify(value, null, 2)}\n`);
    await assert.rejects(
      readProductionReleaseAttestationFile(reorderedPath, { nowMs: NOW_MS }),
      (error) => error.code === "attestation_json_not_canonical",
    );

    const duplicatePath = path.join(directory, "duplicate.json");
    const duplicate = canonical
      .toString("utf8")
      .trimEnd()
      .replace(/}$/, `,"targetSha":"${TARGET_SHA}"}\n`);
    await writeFile(duplicatePath, duplicate);
    await assert.rejects(
      readProductionReleaseAttestationFile(duplicatePath, { nowMs: NOW_MS }),
      (error) => error.code === "attestation_json_not_canonical",
    );
  });
});

test("CLI emits a minimal canonical summary and accepts all workflow binding inputs", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = parseProductionReleaseAttestation(readinessAttestation(), {
      nowMs: NOW_MS,
    });
    const inputPath = path.join(directory, "readiness.json");
    await writeFile(inputPath, canonicalJsonBytes(value));
    let output = "";
    const status = await runProductionReleaseAttestationCli(
      [
        "validate",
        "--input",
        inputPath,
        "--kind",
        "readiness",
        "--now",
        NOW_ISO,
        "--expected-repository",
        "fafona/space",
        "--expected-target-sha",
        TARGET_SHA,
        "--expected-run-id",
        "8002",
        "--expected-run-attempt",
        "1",
        "--expected-backup-run-id",
        "8001",
        "--expected-readiness-run-id",
        "8002",
        "--expected-artifact-id",
        "9003",
        "--expected-artifact-digest",
        `sha256:${"e".repeat(64)}`,
        "--expected-backup-artifact-id",
        "9001",
        "--expected-backup-artifact-digest",
        `sha256:${"c".repeat(64)}`,
        "--expected-backup-attestation-artifact-id",
        "9002",
        "--expected-backup-attestation-artifact-digest",
        `sha256:${"1".repeat(64)}`,
        "--expected-readiness-artifact-id",
        "9003",
        "--expected-readiness-artifact-digest",
        `sha256:${"e".repeat(64)}`,
        "--minimum-remaining-seconds",
        "300",
      ],
      {
        write: (valueToWrite) => {
          output += valueToWrite;
        },
      },
    );
    const summary = JSON.parse(output);

    assert.equal(status, 0);
    assert.equal(summary.valid, true);
    assert.equal(summary.kind, PRODUCTION_READINESS_ATTESTATION_KIND);
    assert.equal(summary.backupRunId, "8001");
    assert.equal(summary.backupRunAttempt, "1");
    assert.equal(summary.readinessRunId, "8002");
    assert.deepEqual(Buffer.from(output), canonicalJsonBytes(summary));
  });
});

test("executable CLI returns nonzero without leaking input on noncanonical and mismatched evidence", async () => {
  await withTemporaryDirectory(async (directory) => {
    const modulePath = fileURLToPath(
      new URL("./production-release-attestation.mjs", import.meta.url),
    );
    const value = parseProductionReleaseAttestation(backupAttestation(), {
      nowMs: NOW_MS,
    });
    const inputPath = path.join(directory, "backup.json");
    await writeFile(inputPath, canonicalJsonBytes(value));
    const success = spawnSync(
      process.execPath,
      [
        modulePath,
        "validate",
        "--input",
        inputPath,
        "--kind",
        "backup",
        "--now",
        NOW_ISO,
      ],
      { encoding: "utf8" },
    );
    assert.equal(success.status, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).valid, true);
    assert.equal(success.stderr, "");

    const mismatch = spawnSync(
      process.execPath,
      [
        modulePath,
        "validate",
        "--input",
        inputPath,
        "--kind",
        "backup",
        "--now",
        NOW_ISO,
        "--expected-run-id",
        "9999",
      ],
      { encoding: "utf8" },
    );
    assert.equal(mismatch.status, 1);
    assert.equal(mismatch.stdout, "");
    assert.deepEqual(JSON.parse(mismatch.stderr), {
      error: "attestation_run_id_mismatch",
      valid: false,
    });
    assert.doesNotMatch(mismatch.stderr, /faolla-database-backup/);

    const unknownArgument = spawnSync(
      process.execPath,
      [
        modulePath,
        "validate",
        "--input",
        inputPath,
        "--kind",
        "backup",
        "--unknown",
        "secret-value",
      ],
      { encoding: "utf8" },
    );
    assert.equal(unknownArgument.status, 1);
    assert.deepEqual(JSON.parse(unknownArgument.stderr), {
      error: "attestation_cli_argument_invalid",
      valid: false,
    });
    assert.doesNotMatch(unknownArgument.stderr, /secret-value/);
  });
});
