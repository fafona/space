import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isDeferredGraphqlAclStatement,
  rehearseVerifiedDatabaseBackup,
} from "./rehearse-production-database-restore.mjs";

const RESTORED_BASELINE = {
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
};

function restoreManifest(image = "supabase/postgres:15.8.1.085") {
  return {
    source: {
      strategy: "docker_exec_postgres",
      databaseImage: image,
      storageImage: "supabase/storage-api:v1.37.8",
      storageBackend: "file",
      repository: "fafona/space",
      sha: "a".repeat(40),
      originMainSha: "a".repeat(40),
      detached: true,
      treeState: "clean",
      stability: {
        source: "matched_before_after",
        database: "matched_before_after",
      },
      database: {
        containerName: "supabase-db",
        containerId: "b".repeat(64),
        imageId: `sha256:${"c".repeat(64)}`,
        containerStartedAt: "2026-08-20T10:00:00.000Z",
        databaseName: "faolla",
        databaseOid: "16384",
        systemIdentifier: "7612345678901234567",
        serverVersionNum: "150008",
        postmasterStartedAt: "2026-08-20T10:00:01.000Z",
        primary: true,
        baseline: RESTORED_BASELINE,
      },
    },
  };
}

test("database restore rehearsal uses an isolated container and validates key data", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-restore-test-"),
  );
  const calls = [];
  let restored = false;
  try {
    await writeFile(path.join(directory, "database.sql.gz"), "sql");
    await writeFile(path.join(directory, "postgres-config.tar.gz"), "config");
    await writeFile(path.join(directory, "storage.tar.gz"), "storage");

    const runCommand = async (command, args) => {
      calls.push([command, ...args]);
      if (command === "tar") {
        const destination = args[args.indexOf("-C") + 1];
        await mkdir(destination, { recursive: true });
        if (args.some((entry) => entry.endsWith("postgres-config.tar.gz"))) {
          await writeFile(
            path.join(destination, "pgsodium_root.key"),
            "fixture-key",
          );
        } else {
          await mkdir(path.join(destination, "bucket"), {
            recursive: true,
          });
          await writeFile(
            path.join(destination, "bucket", "object.webp"),
            "fixture-object",
          );
        }
        return { stdout: "" };
      }
      const sqlIndex = args.indexOf("-c");
      if (command === "docker" && sqlIndex >= 0) {
        const sql = args[sqlIndex + 1];
        if (
          sql.includes(
            "faolla_get_ordinary_account_authoritative_cutover_readiness_v1",
          )
        ) {
          return { stdout: `${JSON.stringify(RESTORED_BASELINE)}\n` };
        }
        if (sql.includes("information_schema.schemata")) {
          return { stdout: "8\n" };
        }
        if (sql.includes("information_schema.tables")) {
          return { stdout: "42\n" };
        }
        if (sql.includes("public.pages")) return { stdout: "3\n" };
        if (sql.includes("auth.users")) return { stdout: "4\n" };
        if (sql.includes("storage.objects")) return { stdout: "5\n" };
        if (sql.includes("to_regprocedure")) return { stdout: "1\n" };
        if (sql.includes("has_function_privilege")) {
          return { stdout: "4\n" };
        }
      }
      return { stdout: "" };
    };

    const report = await rehearseVerifiedDatabaseBackup({
      directory,
      manifest: restoreManifest(),
      runCommand,
      restoreSql: async (dumpPath, containerName) => {
        restored = true;
        assert.equal(dumpPath, path.join(directory, "database.sql.gz"));
        assert.match(containerName, /^faolla-restore-test$/);
        return { skippedGraphqlPublicAclCount: 4 };
      },
      sleep: async () => {},
      resourceSuffix: "test",
    });

    assert.equal(restored, true);
    assert.equal(report.status, "restored");
    assert.equal(report.isolation, "ephemeral_docker_no_network");
    assert.deepEqual(report.restoredBaseline, RESTORED_BASELINE);
    assert.deepEqual(report.database, {
      schemas: 8,
      tables: 42,
      pages: 3,
      authUsers: 4,
      storageObjects: 5,
      graphqlPublicFunctions: 1,
      graphqlExecuteRoles: 4,
    });
    assert.equal(report.storage.files, 1);
    assert.equal(
      calls.some(
        (args) =>
          args[0] === "docker" &&
          args[1] === "run" &&
          args.includes("--network") &&
          args.includes("none"),
      ),
      true,
    );
    assert.equal(
      calls
        .filter(
          (args) =>
            args[0] === "docker" &&
            args[1] === "exec" &&
            args.includes("psql") &&
            args.includes("-c"),
        )
        .every((args) => args[args.indexOf("-d") + 1] === "faolla"),
      true,
    );
    const databaseRun = calls.find(
      (args) =>
        args[0] === "docker" &&
        args[1] === "run" &&
        args.includes("--name") &&
        args.includes("faolla-restore-test"),
    );
    assert.ok(databaseRun);
    assert.equal(databaseRun.includes("--no-healthcheck"), true);
    assert.equal(
      databaseRun.includes(
        "/docker-entrypoint-initdb.d:rw,noexec,nosuid,size=65536",
      ),
      true,
    );
    assert.equal(
      databaseRun.some((entry) =>
        entry.includes("faolla-restore-config-test,dst=/etc/postgresql-custom"),
      ),
      true,
    );
    assert.equal(
      databaseRun.some((entry) =>
        entry.includes("dst=/etc/postgresql/pg_ident.conf,readonly"),
      ),
      true,
    );
    assert.equal(
      calls.some(
        (args) =>
          args[0] === "docker" &&
          args[1] === "run" &&
          args.includes("--entrypoint") &&
          args.includes("sh") &&
          args.some((entry) =>
            entry.includes("cp -a /etc/postgresql-custom/. /target/"),
          ) &&
          args.some((entry) =>
            entry.includes("dst=/source/pgsodium_root.key,readonly"),
          ),
      ),
      true,
    );
    assert.equal(
      calls.some((args) => args[0] === "docker" && args[1] === "restart"),
      false,
    );
    assert.equal(
      calls.some((args) =>
        args.some(
          (entry) =>
            typeof entry === "string" &&
            entry.includes(
              "CREATE OR REPLACE FUNCTION graphql_public.graphql(",
            ),
        ),
      ),
      true,
    );
    assert.equal(
      calls.some((args) =>
        args.some(
          (entry) =>
            typeof entry === "string" && entry.includes("DROP DATABASE"),
        ),
      ),
      false,
    );
    assert.equal(
      calls.some(
        (args) =>
          args[0] === "docker" &&
          args[1] === "rm" &&
          args.includes("faolla-restore-test"),
      ),
      true,
    );
    assert.equal(
      calls.some(
        (args) =>
          args[0] === "docker" && args[1] === "volume" && args[2] === "rm",
      ),
      true,
    );
    assert.equal(
      calls.filter(
        (args) =>
          args[0] === "docker" && args[1] === "volume" && args[2] === "rm",
      ).length,
      2,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database restore rehearsal rejects a same-count restored identity replacement", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-restore-baseline-mismatch-test-"),
  );
  try {
    await writeFile(path.join(directory, "database.sql.gz"), "sql");
    await writeFile(path.join(directory, "postgres-config.tar.gz"), "config");
    await writeFile(path.join(directory, "storage.tar.gz"), "storage");
    await assert.rejects(
      rehearseVerifiedDatabaseBackup({
        directory,
        manifest: restoreManifest(),
        runCommand: async (command, args) => {
          if (command === "tar") {
            const destination = args[args.indexOf("-C") + 1];
            await mkdir(destination, { recursive: true });
            if (
              args.some((entry) => entry.endsWith("postgres-config.tar.gz"))
            ) {
              await writeFile(
                path.join(destination, "pgsodium_root.key"),
                "fixture-key",
              );
            }
            return { stdout: "" };
          }
          const sqlIndex = args.indexOf("-c");
          if (command === "docker" && sqlIndex >= 0) {
            const sql = args[sqlIndex + 1];
            if (
              sql.includes(
                "faolla_get_ordinary_account_authoritative_cutover_readiness_v1",
              )
            ) {
              return {
                stdout: `${JSON.stringify({
                  ...RESTORED_BASELINE,
                  ordinaryIdentityContentSha256: "2".repeat(64),
                })}\n`,
              };
            }
          }
          return { stdout: "" };
        },
        restoreSql: async () => ({ skippedGraphqlPublicAclCount: 0 }),
        sleep: async () => {},
        resourceSuffix: "baseline-mismatch",
      }),
      /restore_authoritative_baseline_mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database restore defers only the known GraphQL public ACL statements", () => {
  assert.equal(
    isDeferredGraphqlAclStatement(
      'GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO authenticated;',
    ),
    true,
  );
  assert.equal(
    isDeferredGraphqlAclStatement(
      'GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO unknown_role;',
    ),
    false,
  );
  assert.equal(
    isDeferredGraphqlAclStatement(
      "\tGRANT ALL ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO postgres;",
    ),
    false,
  );
});

test("database restore rehearsal rejects an unexpected image", async () => {
  await assert.rejects(
    rehearseVerifiedDatabaseBackup({
      directory: os.tmpdir(),
      manifest: restoreManifest("postgres:latest"),
    }),
    /restore_database_image_rejected/,
  );
});
