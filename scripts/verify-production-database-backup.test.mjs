import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDatabaseBackupManifest,
  DATABASE_BACKUP_ARCHIVE_FILES,
  DATABASE_BACKUP_DATA_FILES,
} from "./database-backup-contract.mjs";
import { verifyProductionDatabaseBackup } from "./verify-production-database-backup.mjs";

const SOURCE_IDENTITY = {
  sourceRepository: "fafona/space",
  sourceSha: "a".repeat(40),
  databaseIdentity: {
    containerName: "supabase-db",
    containerId: "b".repeat(64),
    imageId: `sha256:${"c".repeat(64)}`,
    containerStartedAt: "2026-08-20T10:00:00.000Z",
    databaseName: "postgres",
    databaseOid: "16384",
    systemIdentifier: "7612345678901234567",
    serverVersionNum: "150008",
    postmasterStartedAt: "2026-08-20T10:00:01.000Z",
    primary: true,
    baseline: {
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
    },
  },
};

async function createFixture(directory) {
  const sourceDirectory = path.join(directory, "source");
  await mkdir(sourceDirectory, { recursive: true });
  for (const name of DATABASE_BACKUP_DATA_FILES) {
    await writeFile(path.join(sourceDirectory, name), `fixture:${name}\n`);
  }
  const manifest = await buildDatabaseBackupManifest({
    directory: sourceDirectory,
    createdAt: "2026-07-27T12:00:00.000Z",
    toolVersion: "15.8",
    databaseImage: "supabase/postgres:15.8.1.085",
    storageImage: "supabase/storage-api:v1.37.8",
    storageBackend: "file",
    ...SOURCE_IDENTITY,
  });
  await writeFile(
    path.join(sourceDirectory, "manifest.json"),
    JSON.stringify(manifest),
  );
  const encryptedPath = path.join(directory, "backup.tar.enc");
  await writeFile(encryptedPath, "encrypted fixture");
  return { sourceDirectory, encryptedPath };
}

function fixtureRunner(sourceDirectory, options = {}) {
  return async (command, args) => {
    if (command === "openssl") {
      await writeFile(args[args.indexOf("-out") + 1], "outer archive");
      return { stdout: "" };
    }
    if (command === "gzip") return { stdout: "" };
    if (command !== "tar") throw new Error("unexpected command");

    if (args.includes("-tf")) {
      return { stdout: `${DATABASE_BACKUP_ARCHIVE_FILES.join("\n")}\n` };
    }
    if (args.includes("-xf")) {
      const destination = args[args.indexOf("-C") + 1];
      await mkdir(destination, { recursive: true });
      for (const name of DATABASE_BACKUP_ARCHIVE_FILES) {
        await copyFile(
          path.join(sourceDirectory, name),
          path.join(destination, name),
        );
      }
      return { stdout: "" };
    }
    if (args.includes("-tzf")) {
      const archiveName = path.basename(args.at(-1));
      const listings = {
        "postgres-config.tar.gz": options.postgresListing ??
          "./\n./pgsodium_root.key\n./postgresql.conf\n",
        "storage.tar.gz": "./\n./bucket/object.webp\n",
        "supabase-config.tar.gz":
          "./\n./.env\n./docker-compose.yml\n",
        "app-config.tar.gz": "./\n./.env.local\n",
      };
      return { stdout: listings[archiveName] ?? "" };
    }
    throw new Error("unexpected tar command");
  };
}

test("encrypted database backup verifies every nested recovery component", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-db-verify-test-"),
  );
  try {
    const fixture = await createFixture(directory);
    const report = await verifyProductionDatabaseBackup({
      inputPath: fixture.encryptedPath,
      passphrase: "long-enough-encryption-passphrase",
      runCommand: fixtureRunner(fixture.sourceDirectory),
    });

    assert.equal(report.status, "verified");
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.manifestSchemaVersion, 2);
    assert.equal(report.source.sha, SOURCE_IDENTITY.sourceSha);
    assert.equal(report.nestedArchives.postgresConfig.entryCount, 2);
    assert.equal(report.nestedArchives.storage.entryCount, 1);
    assert.equal(report.nestedArchives.supabaseConfig.entryCount, 2);
    assert.equal(report.nestedArchives.appConfig.entryCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("encrypted database backup rejects a missing pgsodium recovery key", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-db-key-test-"),
  );
  try {
    const fixture = await createFixture(directory);
    await assert.rejects(
      verifyProductionDatabaseBackup({
        inputPath: fixture.encryptedPath,
        passphrase: "long-enough-encryption-passphrase",
        runCommand: fixtureRunner(fixture.sourceDirectory, {
          postgresListing: "./\n./postgresql.conf\n",
        }),
      }),
      /pgsodium_root_key_missing/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
