import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { chmod, link, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  captureStableProductionProcessSupabaseEnvironment,
  parseProductionProcessSupabaseEnvironment,
  readFrozenProductionSupabaseEnvironment,
  readFrozenProductionSupabaseEnvironmentSnapshot,
  readFrozenProductionSupabaseRollbackEnvironmentSnapshot,
} from "./read-production-supabase-environment.mjs";

const helperPath = fileURLToPath(
  new URL("./read-production-supabase-environment.mjs", import.meta.url),
);
const buildId = "a".repeat(40);
const internalUrl = "http://127.0.0.1:8000";
const publicUrl = "https://contract.supabase.co";
const anonKey = "contract_anon.key-safe_value~2026";

const environmentBytes = ({
  build = buildId,
  url = publicUrl,
  key = anonKey,
  internal = internalUrl,
  prefix = "",
  suffix = "",
} = {}) => Buffer.from(
  `${prefix}FAOLLA_WEB_BUILD_ID=${build}\n` +
    `SUPABASE_INTERNAL_URL=${internal}\n` +
    `NEXT_PUBLIC_SUPABASE_URL=${url}\n` +
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${key}\n${suffix}`,
  "utf8",
);

async function withEnvironmentFile(bytes, callback) {
  const directory = await mkdtemp(join(tmpdir(), "faolla-production-supabase-env-"));
  const path = join(directory, ".env.local");
  await writeFile(path, bytes, { mode: 0o600 });
  try {
    return await callback({ directory, path });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("reads an exact previous atomic release Supabase environment without normalization", async () => {
  await withEnvironmentFile(
    environmentBytes({ prefix: "UNRELATED=preserved\n", suffix: "LAST=value\n" }),
    async ({ path }) => {
      assert.deepEqual(
        readFrozenProductionSupabaseEnvironment(path, buildId),
        { buildId, publicUrl, anonKey },
      );
      const snapshot = readFrozenProductionSupabaseEnvironmentSnapshot(path, buildId);
      assert.match(snapshot.directoryIdentity, /^(?:[0-9]+:){6}[0-9]+$/);
      assert.match(snapshot.fileIdentity, /^(?:[0-9]+:){7}[0-9]+$/);
      assert.equal(
        snapshot.sha256,
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      );
      const rollbackSnapshot =
        readFrozenProductionSupabaseRollbackEnvironmentSnapshot(path, buildId);
      assert.deepEqual(
        {
          buildId: rollbackSnapshot.buildId,
          internalUrl: rollbackSnapshot.internalUrl,
          publicUrl: rollbackSnapshot.publicUrl,
          anonKey: rollbackSnapshot.anonKey,
          directoryIdentity: rollbackSnapshot.directoryIdentity,
          fileIdentity: rollbackSnapshot.fileIdentity,
          sha256: rollbackSnapshot.sha256,
        },
        {
          buildId,
          internalUrl,
          publicUrl,
          anonKey,
          directoryIdentity: snapshot.directoryIdentity,
          fileIdentity: snapshot.fileIdentity,
          sha256: snapshot.sha256,
        },
      );
      const buildResult = spawnSync(
        process.execPath,
        [helperPath, "build-id", path, buildId.slice(0, 12)],
        { encoding: "utf8" },
      );
      assert.equal(buildResult.status, 0, buildResult.stderr);
      assert.equal(buildResult.stdout, buildId);
      assert.equal(buildResult.stderr, "");
      const result = spawnSync(
        process.execPath,
        [helperPath, "anon-key", path, buildId, publicUrl],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(Buffer.from(result.stdout, "base64").toString("utf8"), anonKey);
      assert.equal(result.stdout.includes(publicUrl), false);
      assert.equal(result.stdout.includes(anonKey), false);
      const snapshotResult = spawnSync(
        process.execPath,
        [helperPath, "snapshot", path, buildId],
        { encoding: "utf8" },
      );
      assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
      assert.equal(snapshotResult.stderr, "");
      assert.deepEqual(snapshotResult.stdout.split("\n"), [
        snapshot.directoryIdentity,
        snapshot.fileIdentity,
        snapshot.sha256,
      ]);
      assert.equal(snapshotResult.stdout.includes(publicUrl), false);
      assert.equal(snapshotResult.stdout.includes(anonKey), false);
      const rollbackResult = spawnSync(
        process.execPath,
        [helperPath, "rollback-snapshot", path, buildId],
        { encoding: "utf8" },
      );
      assert.equal(rollbackResult.status, 0, rollbackResult.stderr);
      assert.equal(rollbackResult.stderr, "");
      assert.deepEqual(rollbackResult.stdout.split("\n"), [
        snapshot.directoryIdentity,
        snapshot.fileIdentity,
        snapshot.sha256,
        Buffer.from(internalUrl).toString("base64"),
        Buffer.from(publicUrl).toString("base64"),
        Buffer.from(anonKey).toString("base64"),
      ]);
      assert.equal(rollbackResult.stdout.includes(internalUrl), false);
      assert.equal(rollbackResult.stdout.includes(publicUrl), false);
      assert.equal(rollbackResult.stdout.includes(anonKey), false);
    },
  );
});

test("rejects missing, duplicate, malformed, or mismatched persisted values", async (t) => {
  const cases = [
    ["wrong build", environmentBytes({ build: "b".repeat(40) })],
    ["missing URL", Buffer.from(`FAOLLA_WEB_BUILD_ID=${buildId}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}\n`)],
    ["missing anon", Buffer.from(`FAOLLA_WEB_BUILD_ID=${buildId}\nNEXT_PUBLIC_SUPABASE_URL=${publicUrl}\n`)],
    ["duplicate URL", environmentBytes({ suffix: `NEXT_PUBLIC_SUPABASE_URL=${publicUrl}\n` })],
    ["duplicate anon", environmentBytes({ suffix: `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}\n` })],
    ["credentials", environmentBytes({ url: "https://user:pass@contract.supabase.co" })],
    ["query", environmentBytes({ url: "https://contract.supabase.co?secret=value" })],
    ["empty query", environmentBytes({ url: "https://contract.supabase.co?" })],
    ["fragment", environmentBytes({ url: "https://contract.supabase.co#fragment" })],
    ["empty fragment", environmentBytes({ url: "https://contract.supabase.co#" })],
    ["unsafe scheme", environmentBytes({ url: "file:///tmp/database" })],
    ["anon whitespace", environmentBytes({ key: "contract anon key" })],
    ["CRLF", Buffer.from(environmentBytes().toString("utf8").replaceAll("\n", "\r\n"))],
    ["invalid UTF-8", Buffer.concat([environmentBytes(), Buffer.from([0xff])])],
    ["oversized anon", environmentBytes({ key: "a".repeat(16 * 1024 + 1) })],
  ];
  for (const [name, bytes] of cases) {
    await t.test(name, async () => {
      await withEnvironmentFile(bytes, async ({ path }) => {
        assert.throws(
          () => readFrozenProductionSupabaseEnvironment(path, buildId),
          /production_supabase_environment_invalid/,
        );
      });
    });
  }
});

test("rollback snapshots require one valid internal URL from the same frozen read", async (t) => {
  const cases = [
    [
      "missing internal URL",
      Buffer.from(environmentBytes().toString("utf8").replace(
        `SUPABASE_INTERNAL_URL=${internalUrl}\n`,
        "",
      )),
    ],
    ["duplicate internal URL", environmentBytes({
      suffix: `SUPABASE_INTERNAL_URL=${internalUrl}\n`,
    })],
    ["internal credentials", environmentBytes({
      internal: "http://user:pass@127.0.0.1:8000",
    })],
    ["internal query", environmentBytes({
      internal: "http://127.0.0.1:8000?secret=value",
    })],
    ["internal fragment", environmentBytes({
      internal: "http://127.0.0.1:8000#fragment",
    })],
    ["internal unsafe scheme", environmentBytes({ internal: "file:///tmp/database" })],
    ["oversized internal URL", environmentBytes({
      internal: `https://${"a".repeat(4097)}.example.com`,
    })],
  ];
  for (const [name, bytes] of cases) {
    await t.test(name, async () => {
      await withEnvironmentFile(bytes, async ({ path }) => {
        assert.throws(
          () => readFrozenProductionSupabaseRollbackEnvironmentSnapshot(path, buildId),
          /production_supabase_environment_invalid/,
        );
      });
    });
  }
});

test("process environment parser accepts only exact all-present or all-absent states", async (t) => {
  const processBytes = (entries) => Buffer.from(`${entries.join("\0")}\0`, "utf8");
  const exactEntries = [
    `SUPABASE_INTERNAL_URL=${internalUrl}`,
    `NEXT_PUBLIC_SUPABASE_URL=${publicUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
  ];
  assert.deepEqual(
    parseProductionProcessSupabaseEnvironment(
      processBytes(["UNRELATED=preserved", ...exactEntries]),
    ),
    { status: "present", internalUrl, publicUrl, anonKey },
  );
  assert.deepEqual(
    parseProductionProcessSupabaseEnvironment(processBytes(["UNRELATED=preserved"])),
    { status: "absent" },
  );

  const rejected = [
    ["internal only", [exactEntries[0]]],
    ["public only", [exactEntries[1]]],
    ["anon only", [exactEntries[2]]],
    ["one missing", exactEntries.slice(0, 2)],
    ["duplicate", [...exactEntries, exactEntries[2]]],
    ["empty", [exactEntries[0], exactEntries[1], "NEXT_PUBLIC_SUPABASE_ANON_KEY="]],
    ["assignment without equals", ["SUPABASE_INTERNAL_URL"]],
    [
      "malformed internal URL",
      ["SUPABASE_INTERNAL_URL=file:///tmp/database", exactEntries[1], exactEntries[2]],
    ],
    [
      "malformed public URL",
      [exactEntries[0], "NEXT_PUBLIC_SUPABASE_URL=https://user:pass@example.com", exactEntries[2]],
    ],
    [
      "malformed anon key",
      [exactEntries[0], exactEntries[1], "NEXT_PUBLIC_SUPABASE_ANON_KEY=unsafe value"],
    ],
    [
      "oversized target value",
      [exactEntries[0], exactEntries[1], `NEXT_PUBLIC_SUPABASE_ANON_KEY=${"a".repeat(16 * 1024 + 1)}`],
    ],
  ];
  for (const [name, entries] of rejected) {
    await t.test(name, () => {
      assert.throws(
        () => parseProductionProcessSupabaseEnvironment(processBytes(entries)),
        /production_supabase_environment_invalid/,
      );
    });
  }
  assert.throws(
    () => parseProductionProcessSupabaseEnvironment(Buffer.from([0xff])),
    /production_supabase_environment_invalid/,
  );
});

test("process environment capture binds PID start time and runtime across the read", async (t) => {
  const presentBytes = Buffer.from(
    `SUPABASE_INTERNAL_URL=${internalUrl}\0` +
      `NEXT_PUBLIC_SUPABASE_URL=${publicUrl}\0` +
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}\0`,
  );
  const stableIdentity = { cwd: "/srv/releases/exact", startTicks: "4242", state: "S" };
  const stable = captureStableProductionProcessSupabaseEnvironment(
    "1234",
    "/srv/releases/exact",
    {
      resolveRuntime: (value) => value,
      readIdentity: () => stableIdentity,
      readEnvironment: () => presentBytes,
    },
  );
  assert.deepEqual(stable, {
    startTicks: "4242",
    status: "present",
    internalUrl,
    publicUrl,
    anonKey,
  });
  assert.deepEqual(
    captureStableProductionProcessSupabaseEnvironment(
      "1234",
      "/srv/releases/exact",
      {
        resolveRuntime: (value) => value,
        readIdentity: () => stableIdentity,
        readEnvironment: () => Buffer.from("UNRELATED=value\0"),
      },
    ),
    { startTicks: "4242", status: "absent" },
  );

  const rejected = [
    {
      name: "PID start time drift",
      identities: [stableIdentity, { ...stableIdentity, startTicks: "4243" }],
    },
    {
      name: "runtime drift",
      identities: [stableIdentity, { ...stableIdentity, cwd: "/srv/releases/other" }],
    },
    {
      name: "zombie process",
      identities: [{ ...stableIdentity, state: "Z" }, stableIdentity],
    },
    {
      name: "unreadable process environment",
      identities: [stableIdentity],
      unreadable: true,
    },
  ];
  for (const fixture of rejected) {
    await t.test(fixture.name, () => {
      const identities = [...fixture.identities];
      assert.throws(
        () => captureStableProductionProcessSupabaseEnvironment(
          "1234",
          "/srv/releases/exact",
          {
            resolveRuntime: (value) => value,
            readIdentity: () => identities.shift(),
            readEnvironment: () => {
              if (fixture.unreadable) throw new Error("secret-bearing producer failure");
              return presentBytes;
            },
          },
        ),
        /production_supabase_environment_invalid/,
      );
    });
  }
});

test("rejects path replacement between read and final identity checks", async () => {
  await withEnvironmentFile(environmentBytes(), async ({ directory, path }) => {
    const replacement = environmentBytes({
      key: anonKey.replace("2026", "2027"),
    });
    assert.equal(replacement.length, environmentBytes().length);
    const replacementPath = join(directory, "replacement.env");
    writeFileSync(replacementPath, replacement, { mode: 0o600 });
    assert.throws(
      () => readFrozenProductionSupabaseRollbackEnvironmentSnapshot(path, buildId, {
        afterRead() {
          rmSync(path);
          renameSync(replacementPath, path);
        },
      }),
      /production_supabase_environment_invalid/,
    );
  });
});

test("frozen reads bind canonical paths, ctime, and nonblocking no-follow opens", () => {
  const source = readFileSync(helperPath, "utf8");
  assert.match(source, /constants\.O_DIRECTORY/);
  assert.match(source, /"\/proc\/self\/fd\/" \+ directoryDescriptor/);
  assert.match(source, /realpathSync\(path\) !== resolvedPath/);
  assert.match(source, /left\.ctimeNs === right\.ctimeNs/);
  assert.match(source, /constants\.O_NOFOLLOW/);
  assert.match(source, /constants\.O_NONBLOCK/);
});

test("rejects loose permissions, symlinks, and hard links", async (t) => {
  await withEnvironmentFile(environmentBytes(), async ({ directory, path }) => {
    if (process.platform !== "win32") {
      await chmod(path, 0o640);
      assert.throws(
        () => readFrozenProductionSupabaseEnvironment(path, buildId),
        /production_supabase_environment_invalid/,
      );
      await chmod(path, 0o600);
    }

    const hardLinkPath = join(directory, "hard-link.env");
    await link(path, hardLinkPath);
    assert.throws(
      () => readFrozenProductionSupabaseEnvironment(path, buildId),
      /production_supabase_environment_invalid/,
    );
    await rm(hardLinkPath, { force: true });

    const ancestorLinkPath = join(directory, "ancestor-link");
    try {
      await symlink(directory, ancestorLinkPath, process.platform === "win32" ? "junction" : "dir");
      assert.throws(
        () => readFrozenProductionSupabaseEnvironment(
          join(ancestorLinkPath, ".env.local"),
          buildId,
        ),
        /production_supabase_environment_invalid/,
      );
    } catch (error) {
      if (process.platform === "win32" && error?.code === "EPERM") {
        t.diagnostic("directory link creation is not permitted on this Windows host");
      } else {
        throw error;
      }
    } finally {
      await rm(ancestorLinkPath, { recursive: true, force: true });
    }

    const symbolicLinkPath = join(directory, "symbolic-link.env");
    try {
      await symlink(path, symbolicLinkPath, "file");
    } catch (error) {
      if (process.platform === "win32" && error?.code === "EPERM") {
        t.diagnostic("symbolic link creation is not permitted on this Windows host");
        return;
      }
      throw error;
    }
    assert.throws(
      () => readFrozenProductionSupabaseEnvironment(symbolicLinkPath, buildId),
      /production_supabase_environment_invalid/,
    );
  });
});

test("CLI failures and URL mismatches are silent even with hostile persisted text", async () => {
  const hostile = "secret-value::error::%0Asecond-line";
  await withEnvironmentFile(
    environmentBytes({ key: hostile }),
    async ({ path }) => {
      const result = spawnSync(process.execPath, [
        helperPath,
        "anon-key",
        path,
        buildId,
        "https://different-project.supabase.co",
      ], {
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(`${result.stdout}${result.stderr}`.includes(hostile), false);
      const rollbackResult = spawnSync(process.execPath, [
        helperPath,
        "rollback-snapshot",
        path,
        buildId,
      ], {
        encoding: "utf8",
      });
      assert.equal(rollbackResult.status, 1);
      assert.equal(rollbackResult.stdout, "");
      assert.equal(rollbackResult.stderr, "");
      assert.equal(
        `${rollbackResult.stdout}${rollbackResult.stderr}`.includes(hostile),
        false,
      );
    },
  );
});
