import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  readFrozenProductionSupabaseEnvironment,
} from "./read-production-supabase-environment.mjs";

const helperPath = fileURLToPath(
  new URL("./read-production-supabase-environment.mjs", import.meta.url),
);
const buildId = "a".repeat(40);
const publicUrl = "https://contract.supabase.co";
const anonKey = "contract_anon.key-safe_value~2026";

const environmentBytes = ({
  build = buildId,
  url = publicUrl,
  key = anonKey,
  prefix = "",
  suffix = "",
} = {}) => Buffer.from(
  `${prefix}FAOLLA_WEB_BUILD_ID=${build}\n` +
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

test("rejects path replacement between read and final identity checks", async () => {
  await withEnvironmentFile(environmentBytes(), async ({ directory, path }) => {
    const replacement = environmentBytes({
      key: anonKey.replace("2026", "2027"),
    });
    assert.equal(replacement.length, environmentBytes().length);
    const replacementPath = join(directory, "replacement.env");
    writeFileSync(replacementPath, replacement, { mode: 0o600 });
    assert.throws(
      () => readFrozenProductionSupabaseEnvironment(path, buildId, {
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
    },
  );
});
