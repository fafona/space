import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptUrl = new URL("./recover-failed-post-switch-production-runtime.sh", import.meta.url);
const source = readFileSync(scriptUrl, "utf8");
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const bash = process.platform === "win32"
  ? ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe"].find(existsSync)
  : "bash";

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end}`);
  return source.slice(from, to);
}

function nodeHeredocs(block) {
  return [...block.matchAll(/<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/g)]
    .map((match) => match[1]);
}

test("the post-switch incident interface remains independently pinned", () => {
  assert.match(source, /EXPECTED_INCIDENT_DEPLOY_RUN_ID="32625801433"/);
  assert.match(source, /EXPECTED_INCIDENT_SHA="58c26e178faeb3eee0172a2e0aa487084f6910e4"/);
  assert.match(source, /EXPECTED_INCIDENT_READINESS_RUN_ID="32625773494"/);
  assert.match(source, /EXPECTED_PRIOR_FAILED_RECOVERY_RUN_ID="32630861830"/);
  assert.match(source, /EXPECTED_PRIOR_FAILED_RECOVERY_RUN_ATTEMPT="1"/);
  assert.match(source, /EXPECTED_PRIOR_FAILED_RECOVERY_SHA="fe1be992a48204e8f2426615762273f14331ab83"/);
  assert.match(source, /EXPECTED_CANDIDATE_BUILD_ID="58c26e178faeb3eee0172a2e0aa487084f6910e4"/);
  assert.match(source, /EXPECTED_OLD_BUILD_ID="2a121454a18a16ae30e356977ca82b24a310e8e5"/);
  assert.match(source, /EXPECTED_CONFIRMATION="RECOVER_FAILED_POST_SWITCH_DEPLOY_32625801433"/);
  assert.doesNotMatch(source, /RECOVER_FAILED_PRE_FORWARD/);
});

test("canonical payload is exact-keyed and binds every incident boundary", () => {
  assert.match(source, /\[ "\$loaded_count" -eq 19 \]/);
  for (const key of [
    "PRIOR_FAILED_RECOVERY_RUN_ID",
    "PRIOR_FAILED_RECOVERY_RUN_ATTEMPT",
    "PRIOR_FAILED_RECOVERY_SHA",
    "INCIDENT_DEPLOY_RUN_ID",
    "INCIDENT_SHA",
    "READINESS_RUN_ID",
    "READINESS_RUN_ATTEMPT",
    "DATABASE_CONTAINER_ID",
    "DATABASE_NAME",
    "DATABASE_OID",
    "DATABASE_SYSTEM_ID",
    "DATABASE_PRIMARY",
  ]) assert.match(source, new RegExp(`\\[ "\\$${key}" = "\\$EXPECTED_|${key}`));
  assert.match(source, /Object\.keys\(value\)\.sort\(\)/);
  assert.match(source, /JSON\.stringify\(Object\.fromEntries/);
  assert.match(source, /before\.nlink !== 1n/);
  assert.match(source, /constants\.O_NOFOLLOW/);
  assert.match(source, /before\.size > 65536n/);
  assert.match(source, /APP_NAME" =~ \^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,127\}\$/);
});

test("deploy lock is held read-only and requires the frozen 0600 identity", () => {
  const lock = between("verify_deploy_lock_permissions()", "frozen_tracked_file_contract()");
  assert.match(lock, /exec 9<"\$DEPLOY_LOCK_FILE"/);
  assert.match(lock, /flock -w 1 9/);
  assert.match(lock, /%d:%i:%h:%u:%f:%a/);
  assert.match(lock, /\/proc\/\$\$\/fd\/9/);
  assert.match(lock, /\[ "\$deploy_lock_mode" = "600" \]/);
  assert.doesNotMatch(lock, /644|chmod/);
  assert.doesNotMatch(lock, /rm\s/);
  assert.doesNotMatch(lock, /mv\s/);
});

test("candidate and frozen inventory and identity have distinct pre-business-mutation stages", () => {
  const stages = [
    "incident_env_helper_identity",
    "candidate_inventory",
    "frozen_inventory",
    "initial_current_target",
    "initial_current_identity",
    "initial_current_compatibility",
    "initial_current_temporary_links",
    "candidate_structure",
    "candidate_env_file_identity",
    "candidate_env_encoding",
    "candidate_env_server_build_binding",
    "candidate_env_public_build_binding",
    "candidate_env_snapshot_contract",
    "candidate_next_build_identity",
    "frozen_release_structure",
    "frozen_scripts_identity",
    "frozen_smoke_helper_identity",
    "frozen_package_identity",
    "frozen_worker_identity",
    "frozen_env_build_binding",
    "frozen_next_build_identity",
  ];
  const positions = stages.map((stage) => source.indexOf(`RECOVERY_FAILURE_STAGE="${stage}"`));
  assert.ok(positions.every((position) => position >= 0), "split release stages missing");
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.doesNotMatch(source, /candidate_env_build_binding/);

  const firstProtectedBusinessMutation = source.indexOf("FENCE_CLEANUP_STARTED=1");
  assert.ok(firstProtectedBusinessMutation > positions.at(-1));
  const releasePreflight = source.slice(
    positions[0],
    source.indexOf('RECOVERY_FAILURE_STAGE="frozen_environment"', positions[0]),
  );
  assert.doesNotMatch(
    releasePreflight,
    /\b(?:unlink|rmdir|mv|chmod)\b|\bln\s+-s\b|\bpm2\s+(?:start|delete|save|stop|restart)\b|pg_(?:cancel|terminate)_backend/,
  );

  const candidateInventory = between(
    'RECOVERY_FAILURE_STAGE="candidate_inventory"',
    'RECOVERY_FAILURE_STAGE="frozen_inventory"',
  );
  const frozenInventory = between(
    'RECOVERY_FAILURE_STAGE="frozen_inventory"',
    'RECOVERY_FAILURE_STAGE="initial_current_target"',
  );
  const initialCurrentTarget = between(
    'RECOVERY_FAILURE_STAGE="initial_current_target"',
    'RECOVERY_FAILURE_STAGE="initial_current_identity"',
  );
  const initialCurrentIdentity = between(
    'RECOVERY_FAILURE_STAGE="initial_current_identity"',
    'RECOVERY_FAILURE_STAGE="initial_current_compatibility"',
  );
  const initialCurrentCompatibility = between(
    'RECOVERY_FAILURE_STAGE="initial_current_compatibility"',
    'RECOVERY_FAILURE_STAGE="initial_current_temporary_links"',
  );
  const initialCurrentTemporaryLinks = between(
    'RECOVERY_FAILURE_STAGE="initial_current_temporary_links"',
    'RECOVERY_FAILURE_STAGE="candidate_structure"',
  );
  const candidateStructure = between(
    'RECOVERY_FAILURE_STAGE="candidate_structure"',
    'RECOVERY_FAILURE_STAGE="candidate_env_file_identity"',
  );
  const candidateEnvironment = between(
    'RECOVERY_FAILURE_STAGE="candidate_env_file_identity"',
    'RECOVERY_FAILURE_STAGE="candidate_next_build_identity"',
  );
  const candidateNextBuild = between(
    'RECOVERY_FAILURE_STAGE="candidate_next_build_identity"',
    'RECOVERY_FAILURE_STAGE="frozen_release_structure"',
  );
  const frozenStructure = between(
    'RECOVERY_FAILURE_STAGE="frozen_release_structure"',
    'RECOVERY_FAILURE_STAGE="frozen_scripts_identity"',
  );
  const frozenScripts = between(
    'RECOVERY_FAILURE_STAGE="frozen_scripts_identity"',
    'RECOVERY_FAILURE_STAGE="frozen_smoke_helper_identity"',
  );
  const frozenSmoke = between(
    'RECOVERY_FAILURE_STAGE="frozen_smoke_helper_identity"',
    'RECOVERY_FAILURE_STAGE="frozen_package_identity"',
  );
  const frozenPackage = between(
    'RECOVERY_FAILURE_STAGE="frozen_package_identity"',
    'RECOVERY_FAILURE_STAGE="frozen_worker_identity"',
  );
  const frozenWorker = between(
    'RECOVERY_FAILURE_STAGE="frozen_worker_identity"',
    'RECOVERY_FAILURE_STAGE="frozen_env_build_binding"',
  );
  const frozenEnvironment = between(
    'RECOVERY_FAILURE_STAGE="frozen_env_build_binding"',
    'RECOVERY_FAILURE_STAGE="frozen_next_build_identity"',
  );
  const frozenNextBuild = between(
    'RECOVERY_FAILURE_STAGE="frozen_next_build_identity"',
    'RECOVERY_FAILURE_STAGE="frozen_environment"',
  );
  assert.match(candidateInventory, /CANDIDATE_RUNTIME_DIR/);
  assert.match(frozenInventory, /FROZEN_RUNTIME_DIR/);
  assert.match(initialCurrentTarget, /readlink -- "\$CURRENT_LINK"/);
  assert.match(initialCurrentTarget, /CANDIDATE_RUNTIME_DIR/);
  assert.match(initialCurrentTarget, /FROZEN_RUNTIME_DIR/);
  assert.match(initialCurrentIdentity, /trusted_symlink_identity "\$CURRENT_LINK"/);
  assert.match(initialCurrentCompatibility, /revalidate_initial_current_compatibility/);
  assert.match(initialCurrentTemporaryLinks, /revalidate_initial_current_temporary_links/);
  assert.match(source, /EXPECTED_SWITCH_TEMP_LINK=.*\.recover-/);
  assert.match(source, /EXPECTED_COMPENSATION_TEMP_LINK=.*\.compensate-/);
  assert.doesNotMatch(initialCurrentTemporaryLinks, /SWITCH_TEMP_LINK=/);
  assert.doesNotMatch(initialCurrentTemporaryLinks, /COMPENSATION_TEMP_LINK=/);
  assert.match(candidateStructure, /release_structure_identity/);
  assert.match(candidateNextBuild, /next_build_identity/);
  assert.match(candidateEnvironment, /candidate_environment_build_binding_result/);
  assert.match(candidateEnvironment, /EXPECTED_CANDIDATE_BUILD_ID/);
  assert.doesNotMatch(candidateEnvironment, /trusted_helper_snapshot/);
  assert.match(frozenStructure, /release_structure_identity/);
  assert.match(frozenScripts, /harden_frozen_scripts_directory/);
  assert.match(frozenScripts, /trusted_directory_identity/);
  assert.match(frozenSmoke, /harden_frozen_tracked_file/);
  assert.match(frozenSmoke, /FROZEN_SMOKE_HELPER_SNAPSHOT/);
  assert.match(frozenPackage, /harden_frozen_tracked_file/);
  assert.match(frozenPackage, /FROZEN_PACKAGE_SNAPSHOT/);
  assert.match(frozenWorker, /harden_frozen_tracked_file/);
  assert.match(frozenWorker, /FROZEN_WORKER_SNAPSHOT/);
  assert.match(frozenNextBuild, /next_build_identity/);
  assert.match(frozenEnvironment, /\.env\.local/);
  assert.match(frozenEnvironment, /EXPECTED_OLD_BUILD_ID/);
  assert.match(source, /stat -Lc '%d:%i'.*CANDIDATE_RUNTIME_DIR.*!=.*FROZEN_RUNTIME_DIR/s);
  assert.doesNotMatch(source, /FROZEN_ENV_HELPER/);
  assert.doesNotMatch(source, /FROZEN_FENCE_HELPER/);
  assert.match(
    source,
    /capture_trusted_environment_helper_output\(\)[\s\S]*"\$INCIDENT_ENV_HELPER" "\$EXPECTED_INCIDENT_SHA"[\s\S]*"\$APP_DIR" "\$INCIDENT_ENV_HELPER_FROZEN_SNAPSHOT"/,
  );
  assert.doesNotMatch(source, /CANDIDATE_ENV_HELPER|candidate_env_helper_identity/);
  assert.doesNotMatch(source, /CANDIDATE_PACKAGE_(?:FILE|SNAPSHOT)|candidate_source_identity/);
  assert.match(source, /FROZEN_SMOKE_HELPER=.*FROZEN_RUNTIME_DIR/);
  assert.match(source, /FROZEN_PACKAGE_FILE=.*FROZEN_RUNTIME_DIR/);
  assert.match(source, /FROZEN_WORKER_FILE=.*FROZEN_RUNTIME_DIR/);
  assert.match(source, /FROZEN_PACKAGE_SNAPSHOT/);
  assert.match(source, /FROZEN_WORKER_SNAPSHOT/);
  assert.match(source, /"\$expected_commit:\$helper_relative"/);
  assert.doesNotMatch(source, /git[^\n]*EXPECTED_OLD_BUILD_ID/);
});

test("the incident-pinned environment reader supports the historical frozen tree", () => {
  const oldBuild = "2a121454a18a16ae30e356977ca82b24a310e8e5";
  const probe = spawnSync("git", ["cat-file", "-e", `${oldBuild}^{commit}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (probe.status === 0) {
    const tree = spawnSync("git", ["ls-tree", "-r", "--name-only", oldBuild], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(tree.status, 0);
    const paths = new Set(tree.stdout.trim().split(/\r?\n/));
    assert.equal(paths.has("scripts/read-production-supabase-environment.mjs"), false);
    assert.equal(paths.has("scripts/hold-ordinary-account-cutover-readiness-fence.mjs"), false);
    assert.equal(paths.has("scripts/check-production-smoke.mjs"), true);
    assert.equal(paths.has("scripts/run-merchant-enterprise-automation-worker.ts"), true);
  }
  assert.doesNotMatch(source, /FROZEN_(?:ENV|FENCE)_HELPER/);
  const incidentHelper = between(
    'RECOVERY_FAILURE_STAGE="incident_env_helper_identity"',
    'RECOVERY_FAILURE_STAGE="candidate_inventory"',
  );
  assert.match(incidentHelper, /trusted_helper_snapshot/);
  assert.match(incidentHelper, /"\$INCIDENT_ENV_HELPER" "\$ENV_HELPER_RELATIVE"/);
  assert.match(incidentHelper, /"\$EXPECTED_INCIDENT_SHA" "\$APP_DIR"/);
  assert.match(source, /readonly INCIDENT_ENV_HELPER="\$APP_DIR\/\$ENV_HELPER_RELATIVE"/);
  const capture = between(
    "capture_trusted_release_environment_helper_output()",
    "capture_trusted_environment_helper_output()",
  );
  assert.equal((capture.match(/trusted_helper_matches/g) ?? []).length, 2);
  assert.match(capture, /timeout --signal=TERM --kill-after=1s[\s\S]*node "\$helper_path"/);
  const wrapper = between(
    "capture_trusted_environment_helper_output()",
    'RELEASES_REAL="$(readlink -f -- "$RELEASES_DIR"',
  );
  assert.match(wrapper, /"\$INCIDENT_ENV_HELPER" "\$EXPECTED_INCIDENT_SHA"/);
  assert.match(wrapper, /"\$APP_DIR" "\$INCIDENT_ENV_HELPER_FROZEN_SNAPSHOT"/);
  assert.doesNotMatch(wrapper, /CANDIDATE/);
  assert.match(source, /rollback-snapshot "\$FROZEN_RUNTIME_DIR\/\.env\.local" "\$EXPECTED_OLD_BUILD_ID"/);
});

test("frozen executable inputs are offline-pinned and hardened without an old server Git object", () => {
  const contracts = [
    {
      path: "package.json",
      blob: "4aa8c7a442b6bc8926e74322503f91b28359fd3e",
      sha256: "ecbbce22ad2cb0ce4d616726b8d024f454a2aeef48270eee241bb25553740b31",
      bytes: 21229,
    },
    {
      path: "scripts/check-production-smoke.mjs",
      blob: "c3e8ac359279879970530c40ee446ea25bc4ac9c",
      sha256: "cf25612c2a9051bc3cb36516b23955f0fb32c39579fbc8f38377c23344b36da3",
      bytes: 12565,
    },
    {
      path: "scripts/run-merchant-enterprise-automation-worker.ts",
      blob: "e575042993f18c2ed24f876afdb6de567db8bce0",
      sha256: "99596c2bfe070a8f9c6fa01b9bfbd310de6a0ba296ab9289db2cd911b013fa74",
      bytes: 28125,
    },
  ];
  for (const contract of contracts) {
    assert.ok(source.includes(contract.blob), `${contract.path} blob missing`);
    assert.ok(source.includes(contract.sha256), `${contract.path} sha256 missing`);
    assert.ok(source.includes(`"${contract.bytes}"`), `${contract.path} byte size missing`);
  }
  assert.doesNotMatch(source, /git[^\n]*EXPECTED_OLD_BUILD_ID/);

  const hardener = between("harden_frozen_tracked_file()", "trusted_helper_snapshot()");
  assert.match(hardener, /constants\.O_NOFOLLOW/);
  assert.match(hardener, /before\.nlink !== 1n/);
  assert.match(hardener, /before\.uid !== BigInt\(process\.getuid\(\)\)/);
  assert.match(hardener, /before\.gid !== BigInt\(process\.getgid\(\)\)/);
  assert.match(hardener, /\[0o664n, 0o600n\]/);
  assert.match(hardener, /requireAlreadyHardened === "true"[\s\S]*permissions !== 0o600n/);
  assert.doesNotMatch(hardener, /0o644n|0o666n/);
  assert.match(hardener, /fchmodSync\(descriptor, 0o600\)/);
  assert.match(hardener, /readSync\(descriptor, bytes, offset, size - offset, offset\)/);
  assert.match(hardener, /readSync\(descriptor, extra, 0, 1, size\)/);
  assert.match(hardener, /createHash\("sha1"\)/);
  assert.match(hardener, /createHash\("sha256"\)/);
  assert.ok(
    hardener.indexOf("verifyBytes(bytesBefore") < hardener.indexOf("fchmodSync(descriptor"),
    "content is not verified before permission mutation",
  );
  assert.ok(
    hardener.indexOf("const bytesAfter") > hardener.indexOf("fchmodSync(descriptor"),
    "content is not reread after permission mutation",
  );
  const scriptsHardener = between(
    "harden_frozen_scripts_directory()",
    "harden_frozen_tracked_file()",
  );
  assert.match(scriptsHardener, /constants\.O_DIRECTORY/);
  assert.match(scriptsHardener, /\[0o775n, 0o700n\]/);
  assert.match(scriptsHardener, /requireAlreadyHardened === "true"[\s\S]*permissions !== 0o700n/);
  assert.match(scriptsHardener, /fchmodSync\(descriptor, 0o700\)/);
  assert.equal(
    (source.match(/fchmodSync\(descriptor, /g) ?? []).length,
    2,
    "only the frozen scripts directory and frozen tracked file may be hardened",
  );
  assert.equal(
    (source.match(/harden_frozen_scripts_directory \|\| exit 1/g) ?? []).length,
    1,
    "directory hardener must run exactly once",
  );
  assert.equal(
    (source.match(/harden_frozen_tracked_file "\$FROZEN_/g) ?? []).length,
    3,
    "tracked-file hardener must run exactly once for each frozen executable input",
  );

  const oldBuild = "2a121454a18a16ae30e356977ca82b24a310e8e5";
  const probe = spawnSync("git", ["cat-file", "-e", `${oldBuild}^{commit}`], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  if (probe.status === 0) {
    for (const contract of contracts) {
      const content = spawnSync("git", ["show", `${oldBuild}:${contract.path}`], {
        cwd: repositoryRoot,
        encoding: null,
      });
      const blob = spawnSync("git", ["rev-parse", `${oldBuild}:${contract.path}`], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      assert.equal(content.status, 0, contract.path);
      assert.equal(blob.status, 0, contract.path);
      assert.equal(content.stdout.length, contract.bytes, `${contract.path} size`);
      assert.equal(createHash("sha256").update(content.stdout).digest("hex"), contract.sha256);
      assert.equal(blob.stdout.trim(), contract.blob);
    }
  }
});

test("frozen permission hardener programs are unambiguous heredocs", () => {
  assert.equal(
    nodeHeredocs(
      between("harden_frozen_tracked_file()", "trusted_helper_snapshot()"),
    ).length,
    1,
  );
  assert.equal(
    nodeHeredocs(
      between("harden_frozen_scripts_directory()", "harden_frozen_tracked_file()"),
    ).length,
    1,
  );
});

test("frozen permission hardeners are fd-bound, fail closed, and idempotent", {
  skip: process.platform === "win32",
}, () => {
  const fileHardener = nodeHeredocs(
    between("harden_frozen_tracked_file()", "trusted_helper_snapshot()"),
  )[0];
  const directoryHardener = nodeHeredocs(
    between("harden_frozen_scripts_directory()", "harden_frozen_tracked_file()"),
  )[0];
  assert.ok(fileHardener, "file hardener missing");
  assert.ok(directoryHardener, "directory hardener missing");
  const directory = mkdtempSync(join(tmpdir(), "faolla-frozen-hardening-"));
  const bytes = Buffer.from("exact frozen fixture\n", "utf8");
  const blob = createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const runFileHardener = (path, overrides = {}, program = fileHardener) => spawnSync(
    process.execPath,
    ["--input-type=module", "-"],
    {
      input: program,
      encoding: "utf8",
      env: {
        ...process.env,
        FAOLLA_FROZEN_TRACKED_PATH: path,
        FAOLLA_EXPECTED_BLOB: blob,
        FAOLLA_EXPECTED_SHA256: sha256,
        FAOLLA_EXPECTED_BYTES: String(bytes.length),
        FAOLLA_REQUIRE_ALREADY_HARDENED: "false",
        ...overrides,
      },
    },
  );
  const mode = (path) => statSync(path).mode & 0o777;
  const writeFixture = (path, permissions = 0o664) => {
    writeFileSync(path, bytes);
    chmodSync(path, permissions);
  };
  try {
    const validPath = join(directory, "valid");
    writeFixture(validPath);
    assert.equal(runFileHardener(validPath).status, 0, "valid 0664 file rejected");
    assert.equal(mode(validPath), 0o600);
    assert.equal(runFileHardener(validPath).status, 0, "already-hardened file rejected");
    assert.equal(mode(validPath), 0o600);

    const frozenResumeWritablePath = join(directory, "frozen-resume-writable");
    writeFixture(frozenResumeWritablePath);
    assert.notEqual(
      runFileHardener(frozenResumeWritablePath, { FAOLLA_REQUIRE_ALREADY_HARDENED: "true" }).status,
      0,
      "frozen resume accepted and mutated a 0664 file",
    );
    assert.equal(mode(frozenResumeWritablePath), 0o664);
    const frozenResumeHardenedPath = join(directory, "frozen-resume-hardened");
    writeFixture(frozenResumeHardenedPath, 0o600);
    assert.equal(
      runFileHardener(frozenResumeHardenedPath, { FAOLLA_REQUIRE_ALREADY_HARDENED: "true" }).status,
      0,
      "frozen resume rejected an exact 0600 file",
    );

    for (const [label, overrides] of [
      ["wrong blob", { FAOLLA_EXPECTED_BLOB: "0".repeat(40) }],
      ["wrong sha256", { FAOLLA_EXPECTED_SHA256: "0".repeat(64) }],
      ["wrong size", { FAOLLA_EXPECTED_BYTES: String(bytes.length + 1) }],
    ]) {
      const path = join(directory, label.replaceAll(" ", "-"));
      writeFixture(path);
      assert.notEqual(runFileHardener(path, overrides).status, 0, `${label} accepted`);
      assert.equal(mode(path), 0o664, `${label} changed permissions`);
    }

    for (const permissions of [0o644, 0o666]) {
      const path = join(directory, `mode-${permissions.toString(8)}`);
      writeFixture(path, permissions);
      assert.notEqual(runFileHardener(path).status, 0, `mode ${permissions.toString(8)} accepted`);
      assert.equal(mode(path), permissions);
    }

    const targetPath = join(directory, "symlink-target");
    const symlinkPath = join(directory, "symlink");
    writeFixture(targetPath);
    symlinkSync(targetPath, symlinkPath, "file");
    assert.notEqual(runFileHardener(symlinkPath).status, 0, "symlink accepted");
    assert.equal(mode(targetPath), 0o664);

    const hardlinkPath = join(directory, "hardlink-source");
    const hardlinkAlias = join(directory, "hardlink-alias");
    writeFixture(hardlinkPath);
    linkSync(hardlinkPath, hardlinkAlias);
    assert.notEqual(runFileHardener(hardlinkPath).status, 0, "hardlink accepted");
    assert.equal(mode(hardlinkPath), 0o664);

    const toctouPath = join(directory, "toctou");
    writeFixture(toctouPath);
    const toctouHardener = fileHardener
      .replace("  closeSync,", "  appendFileSync,\n  closeSync,")
      .replace(
        "  const afterRead = fstatSync(descriptor, { bigint: true });",
        "  appendFileSync(path, Buffer.from(\"x\"));\n  const afterRead = fstatSync(descriptor, { bigint: true });",
      );
    assert.notEqual(toctouHardener, fileHardener, "TOCTOU injection failed");
    assert.notEqual(runFileHardener(toctouPath, {}, toctouHardener).status, 0);
    assert.equal(mode(toctouPath), 0o664, "TOCTOU failure changed permissions");

    const scriptsPath = join(directory, "scripts");
    mkdirSync(scriptsPath, { mode: 0o775 });
    chmodSync(scriptsPath, 0o775);
    const runDirectoryHardener = (requireAlreadyHardened = "false") => spawnSync(
      process.execPath,
      ["--input-type=module", "-"],
      {
        input: directoryHardener,
        encoding: "utf8",
        env: {
          ...process.env,
          FAOLLA_FROZEN_SCRIPTS_PATH: scriptsPath,
          FAOLLA_REQUIRE_ALREADY_HARDENED: requireAlreadyHardened,
        },
      },
    );
    assert.equal(runDirectoryHardener().status, 0, "valid scripts directory rejected");
    assert.equal(mode(scriptsPath), 0o700);
    assert.equal(runDirectoryHardener().status, 0, "hardened scripts directory rejected");
    chmodSync(scriptsPath, 0o775);
    assert.notEqual(
      runDirectoryHardener("true").status,
      0,
      "frozen resume accepted and mutated a 0775 scripts directory",
    );
    assert.equal(mode(scriptsPath), 0o775);
    chmodSync(scriptsPath, 0o700);
    assert.equal(runDirectoryHardener("true").status, 0, "frozen resume rejected 0700 scripts");
    chmodSync(scriptsPath, 0o755);
    assert.notEqual(runDirectoryHardener().status, 0, "unexpected 0755 directory accepted");
    assert.equal(mode(scriptsPath), 0o755);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("candidate source is never executed or trusted while safe runtime anchors are revalidated", () => {
  assert.doesNotMatch(source, /CANDIDATE_PACKAGE_(?:FILE|SNAPSHOT)|candidate_source_identity/);
  const trustedSnapshot = between("trusted_helper_snapshot()", "trusted_helper_matches()");
  assert.doesNotMatch(trustedSnapshot, /EXPECTED_CANDIDATE_BUILD_ID/);
  const candidatePreflight = between(
    'RECOVERY_FAILURE_STAGE="candidate_structure"',
    'RECOVERY_FAILURE_STAGE="frozen_release_structure"',
  );
  assert.doesNotMatch(candidatePreflight, /trusted_helper_(?:snapshot|matches)/);
  assert.doesNotMatch(
    candidatePreflight,
    /\b(?:node|npm|bash|tsx)\b[^\n]*\$CANDIDATE_RUNTIME_DIR/,
  );
  const revalidation = between(
    "revalidate_incident_release_pair()",
    "revalidate_incident_runtimes()",
  );
  assert.doesNotMatch(
    revalidation,
    /trusted_helper_matches[\t ]*\\\r?\n[\t ]*"\$CANDIDATE/,
  );
  assert.doesNotMatch(revalidation, /CANDIDATE_ENV_HELPER/);
  assert.match(
    revalidation,
    /release_structure_identity "\$CANDIDATE_RUNTIME_DIR" "\$EXPECTED_CANDIDATE_BUILD_ID"/,
  );
  assert.match(revalidation, /candidate_environment_build_binding_snapshot/);
  assert.match(revalidation, /CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY/);
  assert.match(revalidation, /CANDIDATE_ENVIRONMENT_FILE_IDENTITY/);
  assert.match(revalidation, /CANDIDATE_ENVIRONMENT_SHA256/);
  assert.match(revalidation, /next_build_identity "\$CANDIDATE_RUNTIME_DIR"/);
  assert.match(revalidation, /FROZEN_SCRIPTS_IDENTITY/);
  assert.match(revalidation, /FROZEN_SMOKE_HELPER_SNAPSHOT/);
  assert.match(revalidation, /FROZEN_PACKAGE_SNAPSHOT/);
  assert.match(revalidation, /FROZEN_WORKER_SNAPSHOT/);
  const currentRevalidation = between(
    "revalidate_incident_runtimes()",
    "current_link_is_exact()",
  );
  assert.match(currentRevalidation, /CURRENT_SWITCH_COMPLETED/);
  assert.match(source, /CURRENT_LINK_IDENTITY=""/);
  assert.match(source, /FROZEN_CURRENT_LINK_IDENTITY=""/);
  assert.match(currentRevalidation, /expected_identity="\$CURRENT_LINK_IDENTITY"/);
  assert.match(currentRevalidation, /expected_identity="\$FROZEN_CURRENT_LINK_IDENTITY"/);
  assert.match(currentRevalidation, /trusted_symlink_identity "\$CURRENT_LINK"/);
  assert.match(currentRevalidation, /revalidate_initial_current_temporary_links/);
  const structure = between("release_structure_identity()", "candidate_environment_build_binding_result()");
  assert.match(
    structure,
    /\[ -f "\$runtime_dir\/package\.json" \] && \[ ! -L "\$runtime_dir\/package\.json" \]/,
  );
  assert.ok(
    [...source.matchAll(/revalidate_incident_runtimes/g)].length >= 8,
    "shared release revalidation is not present at all protected mutation boundaries",
  );
});

test("opaque Next BUILD_ID is snapshotted while the Git build is bound by the exact environment assignment", () => {
  const environmentCode = between("environment_build_binding_snapshot()", "next_build_identity()");
  const environmentValidator = nodeHeredocs(environmentCode).find((code) =>
    code.includes('exactAssignment(lines, "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID")'));
  assert.ok(environmentValidator, "dual environment build binding validator missing");
  assert.match(environmentValidator, /exactAssignment\(lines, "FAOLLA_WEB_BUILD_ID"\) !== expected/);
  assert.match(environmentValidator, /exactAssignment\(lines, "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID"\) !== expected/);
  assert.match(environmentValidator, /source\.includes\("\\0"\) \|\| source\.includes\("\\r"\)/);
  const releaseCode = between("next_build_identity()", 'RECOVERY_FAILURE_STAGE="frozen_environment"');
  const validator = nodeHeredocs(releaseCode).find((code) =>
    code.includes("lstatSync(path") && code.includes("readFileSync(descriptor)"));
  assert.ok(validator, "Next BUILD_ID validator missing");
  assert.doesNotMatch(validator, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(validator, /before\.isSymbolicLink\(\)/);
  assert.match(validator, /before\.nlink !== 1n/);
  assert.match(validator, /const current = lstatSync\(path/);
  assert.match(validator, /ctimeNs/);
  assert.match(validator, /uid/);
  assert.match(validator, /mode/);
  assert.match(validator, /sameIdentity\([^)]+,\s*current\)/);
  assert.doesNotMatch(releaseCode, /\.next\/BUILD_ID[\s\S]{0,500}EXPECTED_(?:CANDIDATE|OLD)_BUILD_ID/);
  assert.doesNotMatch(releaseCode, /\[ "\$(?:next_)?build_id" = "\$expected_build" \]/);

  const directory = mkdtempSync(join(tmpdir(), "faolla-next-build-id-"));
  const nextDirectory = join(directory, ".next");
  const buildPath = join(nextDirectory, "BUILD_ID");
  const runValidator = (path) => spawnSync(
    process.execPath,
    ["--input-type=module", "-", path],
    { input: validator, encoding: "utf8" },
  );
  try {
    mkdirSync(nextDirectory, { mode: 0o700 });
    // The production validator deliberately depends on Linux-only ownership,
    // no-follow, and inode semantics. Keep those assertions real on Linux
    // instead of weakening the validator in-memory to manufacture a Windows pass.
    if (process.platform !== "win32") {
      writeFileSync(buildPath, "opaque_next-build_ID-2026", { mode: 0o600 });
      chmodSync(buildPath, 0o600);
      assert.equal(runValidator(buildPath).status, 0, "valid opaque Next BUILD_ID rejected");

      const hardlinkPath = join(nextDirectory, "BUILD_ID-hardlink");
      linkSync(buildPath, hardlinkPath);
      assert.notEqual(runValidator(buildPath).status, 0, "hard-linked Next BUILD_ID accepted");
      rmSync(hardlinkPath);

      const symlinkTarget = join(nextDirectory, "BUILD_ID-target");
      const symlinkPath = join(nextDirectory, "BUILD_ID-symlink");
      writeFileSync(symlinkTarget, "opaque_target", { mode: 0o600 });
      symlinkSync(symlinkTarget, symlinkPath, "file");
      assert.notEqual(runValidator(symlinkPath).status, 0, "symlinked Next BUILD_ID accepted");

      for (const [label, value] of [
        ["empty", ""],
        ["newline", "opaque\nsecond-line"],
        ["nul", "opaque\0suffix"],
        ["path punctuation", "../opaque"],
        ["non-ascii", "opaque-\u00e9"],
        ["oversized", "x".repeat(129)],
      ]) {
        writeFileSync(buildPath, value, { mode: 0o600 });
        assert.notEqual(runValidator(buildPath).status, 0, `${label} Next BUILD_ID accepted`);
      }
    }

    const expectedBuild = "a".repeat(40);
    const environmentPath = join(directory, ".env.local");
    const baseEnvironment = [
      `FAOLLA_WEB_BUILD_ID=${expectedBuild}`,
      `NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=${expectedBuild}`,
      "NEXT_PUBLIC_SUPABASE_URL=https://example.invalid",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-token",
      "",
    ].join("\n");
    const environmentHelper = fileURLToPath(
      new URL("./read-production-supabase-environment.mjs", import.meta.url),
    );
    const readBuild = () => spawnSync(
      process.execPath,
      [environmentHelper, "build-id", environmentPath, expectedBuild.slice(0, 12)],
      { encoding: "utf8" },
    );
    const validateBinding = () => spawnSync(
      process.execPath,
      ["--input-type=module", "-", environmentPath, directory],
      {
        input: environmentValidator,
        encoding: "utf8",
        env: { ...process.env, FAOLLA_EXPECTED_BUILD_ID: expectedBuild },
      },
    );
    writeFileSync(environmentPath, baseEnvironment, { mode: 0o600 });
    chmodSync(environmentPath, 0o600);
    const validEnvironment = readBuild();
    assert.equal(validEnvironment.status, 0, validEnvironment.stderr);
    assert.equal(validEnvironment.stdout, expectedBuild);
    if (process.platform !== "win32") {
      assert.equal(validateBinding().status, 0, "valid dual build binding rejected");
    }

    writeFileSync(
      environmentPath,
      baseEnvironment.replace(expectedBuild, "b".repeat(40)),
      { mode: 0o600 },
    );
    assert.notEqual(readBuild().status, 0, "wrong environment build id accepted");
    if (process.platform !== "win32") {
      assert.notEqual(validateBinding().status, 0, "wrong private environment build id accepted");
    }

    writeFileSync(
      environmentPath,
      `${baseEnvironment}FAOLLA_WEB_BUILD_ID=${expectedBuild}\n`,
      { mode: 0o600 },
    );
    assert.notEqual(readBuild().status, 0, "duplicate environment build id accepted");
    if (process.platform !== "win32") {
      assert.notEqual(validateBinding().status, 0, "duplicate private environment build id accepted");
    }
    if (process.platform !== "win32") {
      writeFileSync(
        environmentPath,
        baseEnvironment.replace(
          `NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=${expectedBuild}`,
          `NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=${"b".repeat(40)}`,
        ),
        { mode: 0o600 },
      );
      assert.notEqual(validateBinding().status, 0, "wrong public environment build id accepted");
      writeFileSync(
        environmentPath,
        `${baseEnvironment}NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=${expectedBuild}\n`,
        { mode: 0o600 },
      );
      assert.notEqual(validateBinding().status, 0, "duplicate public environment build id accepted");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("candidate environment accepts LF and only well-formed CRLF with fixed fail-closed tokens", () => {
  const candidateCode = between(
    "candidate_environment_build_binding_result()",
    "candidate_environment_build_binding_snapshot()",
  );
  const validator = nodeHeredocs(candidateCode)[0];
  assert.ok(validator, "candidate environment validator missing");
  assert.match(candidateCode, /2>\/dev\/null/);
  assert.match(validator, /source\[index\] === "\\r" && source\[index \+ 1\] !== "\\n"/);
  assert.match(validator, /line\.endsWith\("\\r"\) \? line\.slice\(0, -1\) : line/);
  assert.match(validator, /exactAssignmentMatches\(lines, "FAOLLA_WEB_BUILD_ID", expected\)/);
  assert.match(validator, /exactAssignmentMatches\(lines, "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID", expected\)/);
  assert.match(validator, /createHash\("sha256"\)\.update\(bytes\)/);
  assert.match(validator, /directoryIdentity\(directoryBefore\)/);
  assert.match(validator, /fileIdentity\(opened\)/);
  assert.match(validator, /sameFile\(opened, after\)/);
  assert.match(validator, /sameFile\(opened, current\)/);
  assert.match(validator, /sameDirectory\(directoryBefore, directoryAfter\)/);
  assert.doesNotMatch(validator, /console\.(?:error|log)/);

  if (process.platform === "win32") return;

  const expectedBuild = "a".repeat(40);
  const otherBuild = "b".repeat(40);
  const directory = mkdtempSync(join(tmpdir(), "faolla-candidate-env-"));
  const environmentPath = join(directory, ".env.local");
  const hardlinkPath = join(directory, "environment-hardlink");
  const symlinkTarget = join(directory, "environment-target");
  const validLines = [
    `FAOLLA_WEB_BUILD_ID=${expectedBuild}`,
    `NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=${expectedBuild}`,
    "NEXT_PUBLIC_SUPABASE_URL=https://example.invalid",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-token",
  ];
  const validLf = `${validLines.join("\n")}\n`;
  const runValidator = (code = validator) => spawnSync(
    process.execPath,
    ["--input-type=module", "-", environmentPath, directory],
    {
      input: code,
      encoding: "utf8",
      env: { ...process.env, FAOLLA_EXPECTED_BUILD_ID: expectedBuild },
    },
  );
  const writeEnvironment = (value, mode = 0o600) => {
    rmSync(environmentPath, { force: true });
    writeFileSync(environmentPath, value, { mode });
    chmodSync(environmentPath, mode);
  };
  const expectAccepted = (value, label) => {
    writeEnvironment(value);
    const result = runValidator();
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.equal(result.stderr, "", label);
    const parts = result.stdout.split("\n");
    assert.equal(parts.length, 4, label);
    assert.equal(parts[0], "candidate_env_snapshot_ok", label);
    assert.match(parts[1], /^([0-9]+:){6}[0-9]+$/, label);
    assert.match(parts[2], /^([0-9]+:){7}[0-9]+$/, label);
    assert.match(parts[3], /^[0-9a-f]{64}$/, label);
  };
  const expectRejected = (value, token, label) => {
    writeEnvironment(value);
    const result = runValidator();
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.equal(result.stdout, token, label);
    assert.equal(result.stderr, "", label);
  };

  try {
    chmodSync(directory, 0o700);
    expectAccepted(validLf, "LF");
    expectAccepted(`${validLines.join("\r\n")}\r\n`, "CRLF");
    expectAccepted(
      `${validLines[0]}\r\n${validLines[1]}\n${validLines[2]}\r\n${validLines[3]}\n`,
      "mixed LF and CRLF",
    );

    expectRejected(`${validLf}\r`, "candidate_env_encoding", "bare CR");
    expectRejected(`COMMENT=left\rright\n${validLf}`, "candidate_env_encoding", "embedded CR");
    expectRejected(`COMMENT=double\r\r\n${validLf}`, "candidate_env_encoding", "double CR");
    expectRejected(Buffer.from(`${validLf}\0suffix`), "candidate_env_encoding", "NUL");
    expectRejected(
      Buffer.concat([Buffer.from(validLf), Buffer.from([0xff])]),
      "candidate_env_encoding",
      "invalid UTF-8",
    );

    const withoutServer = validLines.filter((line) =>
      !line.startsWith("FAOLLA_WEB_BUILD_ID=")
    ).join("\n") + "\n";
    expectRejected(
      withoutServer,
      "candidate_env_server_build_binding",
      "missing server build",
    );
    expectRejected(
      `${validLf}FAOLLA_WEB_BUILD_ID=${expectedBuild}\n`,
      "candidate_env_server_build_binding",
      "duplicate server build",
    );
    expectRejected(
      validLf.replace(`FAOLLA_WEB_BUILD_ID=${expectedBuild}`, `FAOLLA_WEB_BUILD_ID=${otherBuild}`),
      "candidate_env_server_build_binding",
      "wrong server build",
    );

    const withoutPublic = validLines.filter((line) =>
      !line.startsWith("NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=")
    ).join("\n") + "\n";
    expectRejected(
      withoutPublic,
      "candidate_env_public_build_binding",
      "missing public build",
    );
    expectRejected(
      `${validLf}NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=${expectedBuild}\n`,
      "candidate_env_public_build_binding",
      "duplicate public build",
    );
    expectRejected(
      validLf.replace(
        `NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=${expectedBuild}`,
        `NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID=${otherBuild}`,
      ),
      "candidate_env_public_build_binding",
      "wrong public build",
    );

    writeEnvironment(validLf, 0o640);
    let result = runValidator();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "candidate_env_file_identity");

    writeEnvironment(validLf);
    linkSync(environmentPath, hardlinkPath);
    result = runValidator();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "candidate_env_file_identity");
    rmSync(hardlinkPath);

    rmSync(environmentPath);
    writeFileSync(symlinkTarget, validLf, { mode: 0o600 });
    chmodSync(symlinkTarget, 0o600);
    symlinkSync(symlinkTarget, environmentPath, "file");
    result = runValidator();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "candidate_env_file_identity");
    rmSync(environmentPath);
    rmSync(symlinkTarget);

    writeEnvironment(validLf);
    chmodSync(directory, 0o770);
    result = runValidator();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "candidate_env_file_identity");
    chmodSync(directory, 0o700);

    writeEnvironment(validLf);
    const toctouValidator = validator
      .replace("  closeSync,", "  appendFileSync,\n  closeSync,")
      .replace(
        "  const bytes = readFileSync(descriptor);",
        "  const bytes = readFileSync(descriptor);\n  appendFileSync(path, \"TOCTOU=1\\n\");",
      );
    assert.notEqual(toctouValidator, validator, "TOCTOU harness injection failed");
    result = runValidator(toctouValidator);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "candidate_env_file_identity");
  } finally {
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release inventory failures have exact fixed codes and cannot enter production cleanup", () => {
  assert.ok(bash, "bash unavailable");
  const finish = between("finish_recovery()", "trap finish_recovery EXIT");
  const stages = new Map([
    ["incident_env_helper_identity", "recovery_failed_pre_runtime_incident_env_helper_identity"],
    ["candidate_inventory", "recovery_failed_pre_runtime_candidate_inventory"],
    ["frozen_inventory", "recovery_failed_pre_runtime_frozen_inventory"],
    ["initial_current_target", "recovery_failed_pre_runtime_initial_current_target"],
    ["initial_current_identity", "recovery_failed_pre_runtime_initial_current_identity"],
    ["initial_current_compatibility", "recovery_failed_pre_runtime_initial_current_compatibility"],
    ["initial_current_temporary_links", "recovery_failed_pre_runtime_initial_current_temporary_links"],
    ["candidate_structure", "recovery_failed_pre_runtime_candidate_structure"],
    ["candidate_next_build_identity", "recovery_failed_pre_runtime_candidate_next_build_identity"],
    ["candidate_env_file_identity", "recovery_failed_pre_runtime_candidate_env_file_identity"],
    ["candidate_env_encoding", "recovery_failed_pre_runtime_candidate_env_encoding"],
    ["candidate_env_server_build_binding", "recovery_failed_pre_runtime_candidate_env_server_build_binding"],
    ["candidate_env_public_build_binding", "recovery_failed_pre_runtime_candidate_env_public_build_binding"],
    ["candidate_env_snapshot_contract", "recovery_failed_pre_runtime_candidate_env_snapshot_contract"],
    ["frozen_release_structure", "recovery_failed_pre_runtime_frozen_release_structure"],
    ["frozen_scripts_identity", "recovery_failed_pre_runtime_frozen_scripts_identity"],
    ["frozen_smoke_helper_identity", "recovery_failed_pre_runtime_frozen_smoke_helper_identity"],
    ["frozen_package_identity", "recovery_failed_pre_runtime_frozen_package_identity"],
    ["frozen_worker_identity", "recovery_failed_pre_runtime_frozen_worker_identity"],
    ["frozen_next_build_identity", "recovery_failed_pre_runtime_frozen_next_build_identity"],
    ["frozen_env_build_binding", "recovery_failed_pre_runtime_frozen_env_build_binding"],
  ]);
  for (const [stage, code] of stages) {
    const harness = `
set -u
RECOVERY_PAYLOAD_FILE=''
RECOVERY_COMPLETE=0
FENCE_CLEANUP_STARTED=0
FENCE_CLEANUP_VERIFIED=0
WORKER_START_ATTEMPTED=0
WEB_START_ATTEMPTED=0
FROZEN_WEB_COMMITTED=0
CURRENT_SWITCH_ARMED=0
CANDIDATE_PREFLIGHT_VERIFIED=0
FROZEN_RESUME_PREFLIGHT_VERIFIED=0
PM2_STATE_MUTATED=0
SWITCH_TEMP_LINK=''
COMPENSATION_TEMP_LINK=''
RECOVERY_FAILURE_STAGE='${stage}'
cleanup_started_process() { printf mutation >&2; return 1; }
restore_candidate_before_web_commit() { printf mutation >&2; return 1; }
verify_precommit_safe_state() { printf mutation >&2; return 1; }
timeout() { printf mutation >&2; return 1; }
${finish}
false
finish_recovery
`;
    const result = spawnSync(bash, ["-s"], { input: harness, encoding: "utf8" });
    assert.notEqual(result.status, 0, stage);
    assert.equal(result.stdout, "", stage);
    assert.equal(result.stderr, `${code}\n`, stage);
  }
});

test("legacy compatibility links have the exact atomic layout and no backups", () => {
  assert.match(source, /readlink -- "\$APP_DIR\/\.next".*"\$CURRENT_LINK\/\.next"/s);
  assert.match(source, /readlink -- "\$APP_DIR\/node_modules".*"\$CURRENT_LINK\/node_modules"/s);
  assert.match(source, /! -e "\$APP_DIR\/\.next\.pre-atomic-deploy"/);
  assert.match(source, /! -e "\$APP_DIR\/node_modules\.pre-atomic-deploy"/);
  assert.doesNotMatch(source, /restore_legacy_runtime_compatibility_paths/);
});

test("database preflight proves identity and zero holders or waiters without mutation", () => {
  const database = between("verify_database_fence_clear()", "RECOVERY_FAILURE_STAGE=\"fence_cleanup\"");
  assert.match(database, /pg_control_system\(\)/);
  assert.match(database, /pg_is_in_recovery\(\)/);
  assert.match(database, /matching_sessions/);
  assert.match(database, /blocked_waiters/);
  assert.match(database, /true:0:0/);
  assert.doesNotMatch(database, /pg_(?:cancel|terminate)_backend/);
  assert.doesNotMatch(database, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
});

test("stale fence cleanup is canonical, time-bound, non-recursive, and starts at unlink", () => {
  const cleanup = between("RECOVERY_FAILURE_STAGE=\"fence_cleanup\"", "pm2_process_snapshot()");
  assert.match(cleanup, /\[ "\$\{#fence_entries\[@\]\}" -le 1 \]/);
  assert.match(
    cleanup,
    /\[ "\$INITIAL_CURRENT_STATE" = "candidate" \][\s\S]*\[ "\$\{#fence_entries\[@\]\}" -eq 0 \]/,
  );
  assert.match(cleanup, /\[ "\$\{#stale_children\[@\]\}" -eq 1 \]/);
  assert.match(cleanup, /stale_log_size.*-le 512/);
  assert.match(cleanup, /FAILED_RUN_STARTED_EPOCH/);
  assert.match(cleanup, /FAILED_RUN_COMPLETED_EPOCH \+ 1500/);
  assert.match(cleanup, /readOrdinaryAccountCutoverReadinessFenceFailureRecord/);
  const mutation = cleanup.indexOf("FENCE_CLEANUP_STARTED=1");
  const preMutation = cleanup.slice(0, mutation);
  assert.ok(preMutation.lastIndexOf("verify_database_fence_clear") >= 0);
  assert.ok(
    preMutation.lastIndexOf("revalidate_incident_runtimes") >
      preMutation.lastIndexOf("verify_database_fence_clear"),
    "runtime identity is not revalidated after the final database proof",
  );
  assert.ok(
    preMutation.lastIndexOf("revalidate_deploy_lock") >
      preMutation.lastIndexOf("revalidate_incident_runtimes"),
    "deploy lock is not the final cross-resource guard",
  );
  assert.ok(preMutation.lastIndexOf("trusted_helper_matches") > preMutation.lastIndexOf("revalidate_deploy_lock"));
  assert.ok(preMutation.lastIndexOf("stale_log_identity") > preMutation.lastIndexOf("trusted_helper_matches"));
  assert.ok(preMutation.lastIndexOf("stale_dir_identity") > preMutation.lastIndexOf("trusted_helper_matches"));
  assert.match(
    cleanup,
    /FENCE_CLEANUP_STARTED=1\s+FENCE_CLEANUP_VERIFIED=0\s+RECOVERY_FAILURE_STAGE="fence_unlink"\s+unlink -- "\$stale_log"/,
  );
  assert.match(
    cleanup,
    /RECOVERY_FAILURE_STAGE="fence_rmdir"\s+rmdir -- "\$stale_dir"/,
  );
  assert.match(
    cleanup,
    /RECOVERY_FAILURE_STAGE="fence_post_inventory"\s+mapfile -d '' -t post_cleanup_fence_entries/,
  );
  assert.match(
    cleanup,
    /RECOVERY_FAILURE_STAGE="fence_post_database"\s+verify_database_fence_clear/,
  );
  assert.doesNotMatch(cleanup, /rm\s+-[A-Za-z]*[rR]/);
});

test("pre-switch PM2 keeps candidate compatibility but frozen resume requires absence", () => {
  const candidate = between("candidate_pm2_state()", "RECOVERY_FAILURE_STAGE=\"current_switch\"");
  assert.match(candidate, /entry\.name === name \|\| entry\.pm2_env\?\.name === name/);
  assert.match(candidate, /entry\.name !== name[\s\S]*entry\.pm2_env\.name !== name/);
  assert.match(candidate, /entry\.pid !== 0/);
  assert.match(candidate, /env\.status !== "stopped"/);
  assert.match(candidate, /env\.pm_cwd !== cwd/);
  assert.match(candidate, /new Set\(\["node", process\.env\.FAOLLA_EXPECTED_NODE_EXEC\]\)/);
  assert.match(candidate, /!allowedInterpreters\.has\(env\.exec_interpreter\)/);
  assert.match(candidate, /env\.exec_mode !== "fork_mode"/);
  assert.match(candidate, /env\.node_args\.length !== 0/);
  assert.match(candidate, /absent:absent\|absent:inactive\|inactive:absent\|inactive:inactive/);
  assert.match(candidate, /\[ -z "\$port_state" \]/);
  assert.doesNotMatch(candidate, /\brunning:/);
  assert.doesNotMatch(candidate, /\bkill\s/);
  assert.doesNotMatch(candidate, /pm2 (?:stop|restart)/);
  const preflight = between(
    'RECOVERY_FAILURE_STAGE="candidate_process_preflight"',
    'RECOVERY_FAILURE_STAGE="candidate_stop"',
  );
  assert.match(preflight, /case "\$INITIAL_CURRENT_STATE" in/);
  assert.match(preflight, /candidate\)[\s\S]*candidate_pm2_state web[\s\S]*inactive:inactive/);
  assert.match(
    preflight,
    /frozen\)[\s\S]*pm2_process_snapshot "\$APP_NAME"[\s\S]*pm2_process_snapshot[\s\S]*AUTOMATION_WORKER_NAME[\s\S]*"absent:absent"/,
  );
  assert.match(preflight, /FROZEN_RESUME_PREFLIGHT_VERIFIED=1/);
  assert.match(
    preflight,
    /if \[ "\$INITIAL_CURRENT_STATE" = "candidate" \]; then\s+CANDIDATE_PREFLIGHT_VERIFIED=1\s+else\s+FROZEN_RESUME_PREFLIGHT_VERIFIED=1/,
  );
  const stop = between(
    'RECOVERY_FAILURE_STAGE="candidate_stop"',
    'RECOVERY_FAILURE_STAGE="current_switch"',
  );
  const frozenStop = stop.slice(stop.indexOf("else"));
  assert.match(frozenStop, /pm2_process_snapshot "\$APP_NAME"/);
  assert.doesNotMatch(frozenStop, /remove_exact_inactive_candidate_process|pm2 delete/);
});

test("candidate current switch is atomic while frozen current resume is read-only", () => {
  const change = between(
    'RECOVERY_FAILURE_STAGE="current_switch"',
    'RECOVERY_FAILURE_STAGE="current_resume"',
  );
  const resume = between(
    'RECOVERY_FAILURE_STAGE="current_resume"',
    "printf '%s\\n' 'current_frozen_release_verified'",
  );
  assert.match(change, /trusted_symlink_identity "\$CURRENT_LINK".*CURRENT_LINK_IDENTITY/s);
  assert.match(change, /readlink -- "\$CURRENT_LINK".*CANDIDATE_RUNTIME_DIR/s);
  assert.match(change, /ln -s -- "\$FROZEN_RUNTIME_DIR" "\$SWITCH_TEMP_LINK"/);
  assert.match(change, /ln -s -- "\$FROZEN_RUNTIME_DIR" "\$SWITCH_TEMP_LINK"[\s\S]*\|\| switch_link_status=\$\?/);
  assert.match(change, /capture_trusted_temp_symlink_snapshot[\s\S]*SWITCH_TEMP_LINK_IDENTITY SWITCH_TEMP_LINK_OBJECT_IDENTITY/);
  assert.ok(change.indexOf("capture_trusted_temp_symlink_snapshot") < change.indexOf("CURRENT_SWITCH_ARMED=1"));
  assert.ok(change.indexOf("capture_trusted_temp_symlink_snapshot") < change.indexOf('"$switch_link_status" -eq 0'));
  assert.match(change, /trap defer_recovery_signal HUP INT TERM[\s\S]*trap handle_recovery_signal HUP INT TERM/);
  assert.ok(change.indexOf("CURRENT_SWITCH_ARMED=1") < change.indexOf("mv -T"));
  const preMove = change.slice(
    change.indexOf("CURRENT_SWITCH_ARMED=1"),
    change.indexOf("mv -T"),
  );
  for (const required of [
    "revalidate_incident_release_pair",
    "revalidate_deploy_lock",
    "candidate_pm2_state web",
    "candidate_pm2_state worker",
    "port_is_free",
    "verify_database_fence_clear",
    "current_link_is_exact",
    "CURRENT_LINK_IDENTITY",
    "SWITCH_TEMP_LINK_IDENTITY",
    "SWITCH_TEMP_LINK_OBJECT_IDENTITY",
  ]) assert.ok(preMove.includes(required), `pre-mv revalidation missing ${required}`);
  assert.match(preMove, /readlink -- "\$SWITCH_TEMP_LINK"/);
  assert.match(preMove, /readlink -f -- "\$SWITCH_TEMP_LINK"/);
  assert.match(change, /mv -T -- "\$SWITCH_TEMP_LINK" "\$CURRENT_LINK"/);
  assert.match(change, /capture_relocated_symlink_identity[\s\S]*SWITCH_TEMP_LINK_OBJECT_IDENTITY/);
  assert.ok(change.indexOf("mv -T") < change.indexOf("capture_relocated_symlink_identity"));
  assert.ok(change.indexOf("capture_relocated_symlink_identity") < change.indexOf("FROZEN_CURRENT_LINK_IDENTITY="));
  assert.ok(change.indexOf("FROZEN_CURRENT_LINK_IDENTITY=") < change.indexOf("CURRENT_SWITCH_COMPLETED=1"));
  assert.ok(change.indexOf("CURRENT_SWITCH_COMPLETED=1") < change.indexOf('SWITCH_TEMP_LINK=""'));
  assert.match(change, /CURRENT_SWITCH_COMPLETED=1/);
  assert.doesNotMatch(change, /trusted_symlink_identity "\$CURRENT_LINK"[^\n]*=\s*\\?\s*\n?\s*"\$SWITCH_TEMP_LINK_IDENTITY"/);
  assert.match(change, /revalidate_incident_release_pair/);
  assert.match(resume, /CURRENT_SWITCH_COMPLETED" -eq 1/);
  assert.match(resume, /CURRENT_SWITCH_ARMED" -eq 0/);
  assert.match(resume, /FROZEN_RESUME_PREFLIGHT_VERIFIED" -eq 1/);
  assert.match(resume, /revalidate_incident_runtimes/);
  assert.match(resume, /verify_frozen_resume_permissions/);
  assert.match(resume, /pm2_process_snapshot "\$APP_NAME"/);
  assert.match(resume, /verify_database_fence_clear/);
  assert.doesNotMatch(resume, /\bln\s+-s\b|\bmv\s+-T\b|SWITCH_TEMP_LINK=|COMPENSATION_TEMP_LINK=/);
  const releasePair = between("revalidate_incident_release_pair()", "revalidate_incident_runtimes()");
  assert.match(releasePair, /release_structure_identity "\$CANDIDATE_RUNTIME_DIR" "\$EXPECTED_CANDIDATE_BUILD_ID"/);
  assert.match(releasePair, /release_structure_identity "\$FROZEN_RUNTIME_DIR" "\$EXPECTED_OLD_BUILD_ID"/);
  assert.match(releasePair, /find_unique_release "\$\{EXPECTED_CANDIDATE_BUILD_ID:0:12\}"/);
  assert.match(releasePair, /find_unique_release "\$\{EXPECTED_OLD_BUILD_ID:0:12\}"/);
  assert.match(releasePair, /next_build_identity "\$CANDIDATE_RUNTIME_DIR"/);
  assert.match(releasePair, /next_build_identity "\$FROZEN_RUNTIME_DIR"/);
  assert.match(releasePair, /candidate_environment_build_binding_snapshot/);
  assert.match(releasePair, /candidate_parts\[0\].*CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY/s);
  assert.match(releasePair, /candidate_parts\[1\].*CANDIDATE_ENVIRONMENT_FILE_IDENTITY/s);
  assert.match(releasePair, /candidate_parts\[2\].*CANDIDATE_ENVIRONMENT_SHA256/s);
  const structure = between("trusted_directory_identity()", "candidate_environment_build_binding_result()");
  assert.match(structure, /trusted_directory_identity "\$runtime_dir"/);
  assert.match(structure, /trusted_directory_identity "\$runtime_dir\/\.next"/);
  assert.match(structure, /trusted_directory_identity "\$runtime_dir\/node_modules"/);
  assert.match(structure, /trusted_symlink_identity "\$runtime_dir\/\.runtime"/);
  assert.doesNotMatch(source, /rm\s+[^\n]*CANDIDATE_RUNTIME_DIR/);
  assert.doesNotMatch(source, /unlink\s+[^\n]*CANDIDATE_RUNTIME_DIR/);
});

test("relocated symlink identity ignores rename timestamps but rejects replacement objects", {
  skip: process.platform === "win32",
}, () => {
  assert.ok(bash, "bash unavailable");
  const identityHelpers = between("trusted_symlink_identity()", "cleanup_started_process()");
  const relocationHelper = between(
    "capture_relocated_symlink_identity()",
    "cleanup_compensation_pending()",
  );
  const directory = mkdtempSync(join(tmpdir(), "faolla-symlink-relocation-"));
  try {
    const harness = `
set -Eeuo pipefail
${identityHelpers}
${relocationHelper}
root="$1"
mkdir "$root/candidate" "$root/frozen"
CURRENT_LINK_PARENT_DIR="$root"
CURRENT_LINK="$root/current"
EXPECTED_SWITCH_TEMP_LINK="$root/current.switch"
EXPECTED_COMPENSATION_TEMP_LINK="$root/current.compensate"
CANDIDATE_RUNTIME_DIR="$root/candidate"
FROZEN_RUNTIME_DIR="$root/frozen"
CURRENT_LINK_PARENT_IDENTITY="$(trusted_directory_object_identity "$root")"
ln -s -- "$CANDIDATE_RUNTIME_DIR" "$CURRENT_LINK"
ln -s -- "$FROZEN_RUNTIME_DIR" "$EXPECTED_SWITCH_TEMP_LINK"
before_full="$(trusted_symlink_identity "$EXPECTED_SWITCH_TEMP_LINK")"
before_object="$(symlink_object_identity_from_full "$before_full")"
IFS=: read -r _ _ _ _ before_ctime _ _ _ <<< "$before_full"
sleep 1.1
mv -T -- "$EXPECTED_SWITCH_TEMP_LINK" "$CURRENT_LINK"
after_full="$(trusted_symlink_identity "$CURRENT_LINK")"
after_object="$(symlink_object_identity_from_full "$after_full")"
IFS=: read -r _ _ _ _ after_ctime _ _ _ <<< "$after_full"
[ "$before_full" != "$after_full" ]
[ "$after_ctime" -gt "$before_ctime" ]
[ "$before_object" = "$after_object" ]
captured="$(capture_relocated_symlink_identity \
  "$EXPECTED_SWITCH_TEMP_LINK" "$CURRENT_LINK" \
  "$FROZEN_RUNTIME_DIR" "$before_object")"
[ "$captured" = "$after_full" ]
ln -s -- "$CANDIDATE_RUNTIME_DIR" "$EXPECTED_COMPENSATION_TEMP_LINK"
compensation_full="$(trusted_symlink_identity "$EXPECTED_COMPENSATION_TEMP_LINK")"
compensation_object="$(symlink_object_identity_from_full "$compensation_full")"
mv -T -- "$EXPECTED_COMPENSATION_TEMP_LINK" "$CURRENT_LINK"
ln -s -- "$CANDIDATE_RUNTIME_DIR" "$root/substitute"
mv -T -- "$root/substitute" "$CURRENT_LINK"
if capture_relocated_symlink_identity \
  "$EXPECTED_COMPENSATION_TEMP_LINK" "$CURRENT_LINK" \
  "$CANDIDATE_RUNTIME_DIR" "$compensation_object" >/dev/null 2>&1; then
  exit 40
fi
printf '%s' verified
`;
    const result = spawnSync(bash, ["-c", harness, "bash", directory], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "verified");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("signal-window fallback refreshes frozen identity and performs a real compensation rename", {
  skip: process.platform === "win32",
}, () => {
  assert.ok(bash, "bash unavailable");
  const identityHelpers = between("trusted_symlink_identity()", "cleanup_started_process()");
  const stateHelpers = between(
    "current_link_is_exact()",
    'RECOVERY_FAILURE_STAGE="initial_current_target"',
  );
  const directory = mkdtempSync(join(tmpdir(), "faolla-signal-compensation-"));
  try {
    const harness = `
set -Eeuo pipefail
${identityHelpers}
${stateHelpers}
root="$1"
mkdir -p "$root/success/candidate" "$root/success/frozen" \
  "$root/attack/candidate" "$root/attack/frozen" \
  "$root/mvfail/candidate" "$root/mvfail/frozen" \
  "$root/lnstatus/candidate" "$root/lnstatus/frozen"
revalidate_deploy_lock() { return 0; }
port_is_free() { return 0; }
revalidate_incident_release_pair() { return 0; }
configure_case() {
  CURRENT_LINK_PARENT_DIR="$1"
  CURRENT_LINK="$1/current"
  EXPECTED_SWITCH_TEMP_LINK="$1/current.switch"
  EXPECTED_COMPENSATION_TEMP_LINK="$1/current.compensate"
  CANDIDATE_RUNTIME_DIR="$1/candidate"
  FROZEN_RUNTIME_DIR="$1/frozen"
  CURRENT_LINK_PARENT_IDENTITY="$(trusted_directory_object_identity "$1")"
  FROZEN_WEB_COMMITTED=0
  CURRENT_SWITCH_COMPLETED=0
  CURRENT_SWITCH_ARMED=1
  FROZEN_CURRENT_LINK_IDENTITY=''
  SWITCH_TEMP_LINK="$EXPECTED_SWITCH_TEMP_LINK"
  SWITCH_TEMP_LINK_IDENTITY=''
  SWITCH_TEMP_LINK_OBJECT_IDENTITY=''
  COMPENSATION_TEMP_LINK=''
  COMPENSATION_TEMP_LINK_IDENTITY=''
  COMPENSATION_TEMP_LINK_OBJECT_IDENTITY=''
}
configure_case "$root/success"
ln -s -- "$CANDIDATE_RUNTIME_DIR" "$CURRENT_LINK"
CURRENT_LINK_IDENTITY="$(trusted_symlink_identity "$CURRENT_LINK")"
ln -s -- "$FROZEN_RUNTIME_DIR" "$EXPECTED_SWITCH_TEMP_LINK"
SWITCH_TEMP_LINK_IDENTITY="$(trusted_symlink_identity "$EXPECTED_SWITCH_TEMP_LINK")"
SWITCH_TEMP_LINK_OBJECT_IDENTITY="$(symlink_object_identity_from_full \
  "$SWITCH_TEMP_LINK_IDENTITY")"
sleep 1.1
command mv -T -- "$EXPECTED_SWITCH_TEMP_LINK" "$CURRENT_LINK"
mv() {
  if [ "$3" = "$EXPECTED_COMPENSATION_TEMP_LINK" ]; then
    trusted_symlink_identity "$3" > "$root/compensation-before"
    sleep 1.1
  fi
  command mv "$@"
  return 17
}
restore_candidate_before_web_commit
compensation_before="$(< "$root/compensation-before")"
[ "$(readlink -- "$CURRENT_LINK")" = "$CANDIDATE_RUNTIME_DIR" ]
[ "$CURRENT_LINK_IDENTITY" = "$(trusted_symlink_identity "$CURRENT_LINK")" ]
[ "$CURRENT_LINK_IDENTITY" != "$compensation_before" ]
[ -n "$FROZEN_CURRENT_LINK_IDENTITY" ]
[ "$CURRENT_SWITCH_COMPLETED" -eq 0 ]
[ "$CURRENT_SWITCH_ARMED" -eq 0 ]
[ -z "$SWITCH_TEMP_LINK" ]
[ -z "$SWITCH_TEMP_LINK_IDENTITY" ]
[ -z "$SWITCH_TEMP_LINK_OBJECT_IDENTITY" ]
[ -z "$COMPENSATION_TEMP_LINK" ]
[ -z "$COMPENSATION_TEMP_LINK_IDENTITY" ]
[ -z "$COMPENSATION_TEMP_LINK_OBJECT_IDENTITY" ]
unset -f mv
configure_case "$root/attack"
ln -s -- "$CANDIDATE_RUNTIME_DIR" "$CURRENT_LINK"
CURRENT_LINK_IDENTITY="$(trusted_symlink_identity "$CURRENT_LINK")"
ln -s -- "$FROZEN_RUNTIME_DIR" "$EXPECTED_SWITCH_TEMP_LINK"
SWITCH_TEMP_LINK_IDENTITY="$(trusted_symlink_identity "$EXPECTED_SWITCH_TEMP_LINK")"
SWITCH_TEMP_LINK_OBJECT_IDENTITY="$(symlink_object_identity_from_full \
  "$SWITCH_TEMP_LINK_IDENTITY")"
command mv -T -- "$EXPECTED_SWITCH_TEMP_LINK" "$CURRENT_LINK"
ln -s -- "$FROZEN_RUNTIME_DIR" "$root/attack/substitute"
command mv -T -- "$root/attack/substitute" "$CURRENT_LINK"
if restore_candidate_before_web_commit; then exit 41; fi
[ "$CURRENT_SWITCH_COMPLETED" -eq 0 ]
[ "$CURRENT_SWITCH_ARMED" -eq 1 ]
[ -z "$FROZEN_CURRENT_LINK_IDENTITY" ]
[ ! -e "$EXPECTED_COMPENSATION_TEMP_LINK" ] \
  && [ ! -L "$EXPECTED_COMPENSATION_TEMP_LINK" ]
configure_case "$root/mvfail"
command ln -s -- "$FROZEN_RUNTIME_DIR" "$CURRENT_LINK"
CURRENT_LINK_IDENTITY=unused
FROZEN_CURRENT_LINK_IDENTITY="$(trusted_symlink_identity "$CURRENT_LINK")"
CURRENT_SWITCH_COMPLETED=1
mv() { return 17; }
if restore_candidate_before_web_commit; then exit 42; fi
[ "$(readlink -- "$CURRENT_LINK")" = "$FROZEN_RUNTIME_DIR" ]
[ "$FROZEN_CURRENT_LINK_IDENTITY" = \
  "$(trusted_symlink_identity "$CURRENT_LINK")" ]
[ "$CURRENT_SWITCH_COMPLETED" -eq 1 ]
[ "$CURRENT_SWITCH_ARMED" -eq 1 ]
[ ! -e "$EXPECTED_COMPENSATION_TEMP_LINK" ] \
  && [ ! -L "$EXPECTED_COMPENSATION_TEMP_LINK" ]
[ -z "$COMPENSATION_TEMP_LINK" ]
[ -z "$COMPENSATION_TEMP_LINK_IDENTITY" ]
[ -z "$COMPENSATION_TEMP_LINK_OBJECT_IDENTITY" ]
unset -f mv
configure_case "$root/lnstatus"
command ln -s -- "$FROZEN_RUNTIME_DIR" "$CURRENT_LINK"
CURRENT_LINK_IDENTITY=unused
FROZEN_CURRENT_LINK_IDENTITY="$(trusted_symlink_identity "$CURRENT_LINK")"
CURRENT_SWITCH_COMPLETED=1
ln() { command ln "$@"; return 17; }
mv() { : > "$root/unexpected-mv"; return 0; }
if restore_candidate_before_web_commit; then exit 43; fi
[ "$(readlink -- "$CURRENT_LINK")" = "$FROZEN_RUNTIME_DIR" ]
[ "$CURRENT_SWITCH_COMPLETED" -eq 1 ]
[ "$CURRENT_SWITCH_ARMED" -eq 1 ]
[ ! -e "$EXPECTED_COMPENSATION_TEMP_LINK" ] \
  && [ ! -L "$EXPECTED_COMPENSATION_TEMP_LINK" ]
[ -z "$COMPENSATION_TEMP_LINK" ]
[ -z "$COMPENSATION_TEMP_LINK_IDENTITY" ]
[ -z "$COMPENSATION_TEMP_LINK_OBJECT_IDENTITY" ]
[ ! -e "$root/unexpected-mv" ]
printf '%s' verified
`;
    const result = spawnSync(bash, ["-c", harness, "bash", directory], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "verified");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pre-commit failure compensates only exact frozen current and covers the mv flag window", () => {
  const finish = between("finish_recovery()", "require_command()");
  const compensate = between(
    "restore_candidate_before_web_commit()",
    'RECOVERY_FAILURE_STAGE="initial_current_target"',
  );
  assert.match(finish, /CURRENT_SWITCH_ARMED.*restore_candidate_before_web_commit/s);
  assert.doesNotMatch(finish, /CURRENT_SWITCH_COMPLETED.*restore_candidate_before_web_commit/s);
  assert.match(finish, /trap '' HUP INT TERM/);
  assert.match(source, /trap handle_recovery_signal HUP INT TERM/);
  assert.match(finish, /SWITCH_TEMP_LINK_IDENTITY[\s\S]*SWITCH_TEMP_LINK_OBJECT_IDENTITY[\s\S]*FROZEN_RUNTIME_DIR[\s\S]*unlink -- "\$SWITCH_TEMP_LINK"/);
  assert.match(finish, /COMPENSATION_TEMP_LINK_IDENTITY[\s\S]*COMPENSATION_TEMP_LINK_OBJECT_IDENTITY[\s\S]*CANDIDATE_RUNTIME_DIR[\s\S]*unlink -- "\$COMPENSATION_TEMP_LINK"/);
  assert.match(finish, /revalidate_current_link_parent/);
  assert.match(compensate, /trusted_symlink_identity "\$CURRENT_LINK".*CURRENT_LINK_IDENTITY/s);
  assert.match(compensate, /trusted_symlink_identity "\$CURRENT_LINK".*FROZEN_CURRENT_LINK_IDENTITY/s);
  assert.match(compensate, /revalidate_incident_release_pair[\s\S]*revalidate_deploy_lock[\s\S]*port_is_free[\s\S]*mv -T -- "\$COMPENSATION_TEMP_LINK"/);
  assert.match(compensate, /capture_trusted_temp_symlink_snapshot[\s\S]*COMPENSATION_TEMP_LINK_IDENTITY[\s\S]*COMPENSATION_TEMP_LINK_OBJECT_IDENTITY/);
  assert.match(compensate, /ln -s -- "\$CANDIDATE_RUNTIME_DIR" "\$COMPENSATION_TEMP_LINK"[\s\S]*\|\| compensation_link_status=\$\?/);
  assert.ok(compensate.indexOf("capture_trusted_temp_symlink_snapshot") < compensate.indexOf('"$compensation_link_status" -ne 0'));
  assert.match(compensate, /mv -T -- "\$COMPENSATION_TEMP_LINK" "\$CURRENT_LINK"/);
  assert.match(compensate, /capture_relocated_symlink_identity[\s\S]*COMPENSATION_TEMP_LINK_OBJECT_IDENTITY/);
  const compensationCapture = compensate.lastIndexOf("capture_relocated_symlink_identity");
  const candidateIdentityCommit = compensate.lastIndexOf('CURRENT_LINK_IDENTITY="$relocated_identity"');
  const compensationFlagsCommit = compensate.lastIndexOf("CURRENT_SWITCH_COMPLETED=0");
  assert.ok(compensate.indexOf("mv -T") < compensationCapture);
  assert.ok(compensationCapture < candidateIdentityCommit);
  assert.ok(candidateIdentityCommit < compensationFlagsCommit);
  assert.doesNotMatch(compensate, /CURRENT_LINK_IDENTITY="\$COMPENSATION_TEMP_LINK_IDENTITY"/);
  assert.match(compensate, /SWITCH_TEMP_LINK_OBJECT_IDENTITY[\s\S]*capture_relocated_symlink_identity[\s\S]*FROZEN_CURRENT_LINK_IDENTITY="\$relocated_identity"/);
  assert.match(compensate, /ln -s -- "\$CANDIDATE_RUNTIME_DIR" "\$COMPENSATION_TEMP_LINK" \\\n+        >\/dev\/null 2>&1/);
  assert.match(compensate, /mv -T -- "\$COMPENSATION_TEMP_LINK" "\$CURRENT_LINK" \\\n+        >\/dev\/null 2>&1/);
  assert.match(source, /trusted_symlink_identity\(\)[\s\S]*%d:%i:%s:%Y:%Z:%u:%f:%h/);
  assert.match(
    source,
    /printf '%s:%s:%s:%s:%s:%s' \\\n+    "\$device" "\$inode" "\$size" "\$link_uid" "\$link_raw_mode" "\$link_count"/,
  );
  assert.match(source, /trusted_symlink_object_identity\(\)[\s\S]*symlink_object_identity_from_full/);
  assert.doesNotMatch(between("symlink_object_identity_from_full()", "trusted_symlink_object_identity()"), /%Y|%Z/);
  assert.match(source, /trusted_directory_object_identity\(\)[\s\S]*8#022/);
  const relocation = between(
    "capture_relocated_symlink_identity()",
    "cleanup_compensation_pending()",
  );
  assert.match(relocation, /! -e "\$source_path"[\s\S]*! -L "\$source_path"/);
  assert.match(relocation, /first_object_identity.*expected_object_identity/s);
  assert.match(relocation, /second_full_identity.*first_full_identity/s);
  assert.match(relocation, /revalidate_current_link_parent/);
  assert.match(source, /link_uid.*id -u[\s\S]*link_count.*"1"[\s\S]*0120000/);
  assert.match(source, /verify_precommit_safe_state[\s\S]*inactive:inactive\|inactive:absent/);
  assert.match(
    source,
    /verify_precommit_safe_state\(\)[\s\S]*frozen\)[\s\S]*CURRENT_SWITCH_COMPLETED[\s\S]*CURRENT_SWITCH_ARMED[\s\S]*pm2_process_snapshot "\$APP_NAME"/,
  );
  assert.match(finish, /FROZEN_RESUME_PREFLIGHT_VERIFIED/);
  assert.ok(bash, "bash unavailable");
  for (const failure of ["ln", "mv"]) {
    const harness = `
set -u
FROZEN_WEB_COMMITTED=0
CURRENT_SWITCH_COMPLETED=1
CURRENT_SWITCH_ARMED=1
CURRENT_LINK=/current
CANDIDATE_RUNTIME_DIR=/candidate
FROZEN_RUNTIME_DIR=/frozen
CURRENT_LINK_IDENTITY=original
FROZEN_CURRENT_LINK_IDENTITY=frozen-identity
EXPECTED_INCIDENT_DEPLOY_RUN_ID=32625801433
EXPECTED_COMPENSATION_TEMP_LINK=/current.compensate-32625801433
COMPENSATION_TEMP_LINK=''
COMPENSATION_TEMP_LINK_IDENTITY=''
COMPENSATION_TEMP_LINK_OBJECT_IDENTITY=''
revalidate_deploy_lock() { return 0; }
revalidate_current_link_parent() { return 0; }
port_is_free() { return 0; }
revalidate_incident_release_pair() { return 0; }
current_link_is_exact() { [ "$1" = /frozen ]; }
trusted_symlink_identity() { if [ "$1" = /current ]; then printf frozen-identity; else printf pending-identity; fi; }
symlink_object_identity_from_full() { printf pending-object; }
trusted_symlink_object_identity() { printf pending-object; }
capture_trusted_temp_symlink_snapshot() {
  ${failure === "ln" ? "return 1" : ":"}
  printf -v "$3" pending-identity
  printf -v "$4" pending-object
}
capture_relocated_symlink_identity() { return 1; }
readlink() { case "$*" in *current) printf /frozen;; *) printf /candidate;; esac; }
ln() { ${failure === "ln" ? "printf leak-from-ln >&2; return 1" : "return 0"}; }
mv() { ${failure === "mv" ? "printf leak-from-mv >&2; return 1" : "return 0"}; }
${compensate}
if restore_candidate_before_web_commit; then exit 1; fi
`;
    const result = spawnSync(bash, ["-c", harness], { encoding: "utf8" });
    assert.equal(result.status, 0, `${failure}: ${result.stderr}`);
    assert.equal(result.stderr, "", failure);
  }
});

test("web and worker starts capture identity before honoring a nonzero start status", () => {
  const web = between("RECOVERY_FAILURE_STAGE=\"web_start\"", "verify_local_four_route_old_build()");
  assert.match(web, /web_state="\$\(started_pm2_state web\)"/);
  assert.ok(web.indexOf("web_start_status=$?") < web.indexOf("capture_started_process_identity STARTED_WEB"));
  assert.ok(web.indexOf("capture_started_process_identity STARTED_WEB") < web.indexOf('[ "$web_start_status" -eq 0 ]'));
  const worker = between("RECOVERY_FAILURE_STAGE=\"worker_start\"", "RECOVERY_FAILURE_STAGE=\"persist_and_verify\"");
  assert.match(worker, /worker_state="\$\(started_pm2_state worker\)"/);
  assert.match(worker, /--kill-timeout 180000[\s\S]*--restart-delay 5000[\s\S]*--wait-ready[\s\S]*--listen-timeout 20000/);
  assert.match(worker, /stable_worker_checks.*-ge 3/s);
  assert.match(worker, /for _ in 1 2 3; do[\s\S]*started_process_identity_matches[\s\S]*verify_process_environment[\s\S]*verify_worker_flags/);
  assert.ok(worker.indexOf("worker_start_status=$?") < worker.indexOf("capture_started_process_identity STARTED_WORKER"));
  assert.ok(worker.indexOf("capture_started_process_identity STARTED_WORKER") < worker.indexOf('[ "$worker_start_status" -eq 0 ]'));
  const strictState = between("started_pm2_state()", "candidate_pm2_state()");
  assert.match(strictState, /env\.pm_exec_path !== execPath/);
  assert.match(strictState, /env\.args\.some/);
  assert.match(strictState, /env\.node_args\.length !== 0/);
  const cleanup = between("cleanup_started_process()", "finish_recovery()");
  assert.match(cleanup, /inactive\)[\s\S]*started_pm2_state[\s\S]*pm2 delete/);
});

test("empty provisional identity cleanup accepts absent and exact inactive without proc checks", () => {
  assert.ok(bash, "bash unavailable");
  const cleanup = between("cleanup_started_process()", "finish_recovery()");
  for (const state of ["absent", "inactive"]) {
    const harness = `
set -u
PM2_STATE_MUTATED=0
started_pm2_state() { printf '%s' '${state}'; }
started_process_identity_matches() { return 1; }
pm2_process_snapshot() { printf '%s' 'absent'; }
linux_process_start_ticks() { return 2; }
wait_for_port_free_bounded() { return 0; }
timeout() { return 0; }
${cleanup}
cleanup_started_process web app '' '' '' '' 1
`;
    const result = spawnSync(bash, ["-c", harness], { encoding: "utf8" });
    assert.equal(result.status, 0, `${state}: ${result.stderr}`);
  }
});

test("all PM2 parsers reject top-only and env-only related entries", () => {
  const parserBlocks = [
    between("pm2_process_snapshot()", "linux_process_start_ticks()"),
    between("started_pm2_state()", "candidate_pm2_state()"),
    between("candidate_pm2_state()", "remove_exact_inactive_candidate_process()"),
    between("verify_web_launch_contract()", "verify_worker_flags()"),
    between("verify_worker_launch_contract()", "RECOVERY_FAILURE_STAGE=\"web_identity\""),
  ];
  for (const block of parserBlocks) {
    assert.match(block, /entry\.name === (?:name|expectedName) \|\| entry\.pm2_env\?\.name === (?:name|expectedName)/);
    assert.match(
      block,
      /(?:entry|related\[0\])\.name !== (?:name|expectedName)[\s\S]*(?:entry|related\[0\])\.pm2_env\.name !== (?:name|expectedName)/,
    );
  }
  const runParser = (block, env, list) => {
    const match = block.match(/node -e '\n([\s\S]*?)\n\s*' (?:2>\/dev\/null )?<<< "\$process_list"/);
    assert.ok(match, "embedded PM2 parser missing");
    return spawnSync(process.execPath, ["-e", match[1]], {
      input: JSON.stringify(list), encoding: "utf8", env: { ...process.env, ...env },
    });
  };
  const generic = between("pm2_process_snapshot()", "linux_process_start_ticks()");
  const started = between("started_pm2_state()", "candidate_pm2_state()");
  const candidate = between("candidate_pm2_state()", "remove_exact_inactive_candidate_process()");
  const relatedFixtures = [
    [{ name: "app", pid: 99, pm2_env: { name: "other", status: "online" } }],
    [{ name: "other", pid: 99, pm2_env: { name: "app", status: "online" } }],
  ];
  for (const fixture of relatedFixtures) {
    assert.notEqual(runParser(generic, { FAOLLA_PM2_PROCESS_NAME: "app" }, fixture).status, 0);
    const common = {
      FAOLLA_PM2_KIND: "web", FAOLLA_EXPECTED_NAME: "app",
      FAOLLA_EXPECTED_CWD: "/frozen", FAOLLA_EXPECTED_PORT: "3000",
      FAOLLA_EXPECTED_NPM: "/npm", FAOLLA_EXPECTED_NPM_COMMAND: "/npm",
      FAOLLA_EXPECTED_NPM_REAL: "/npm", FAOLLA_EXPECTED_NODE_EXEC: "/node",
      FAOLLA_EXPECTED_TSX: "/tsx", FAOLLA_EXPECTED_WORKER: "/worker",
    };
    assert.notEqual(runParser(started, common, fixture).status, 0);
    assert.notEqual(runParser(candidate, common, fixture).status, 0);
  }
  const candidateEnv = {
    FAOLLA_PM2_KIND: "web", FAOLLA_EXPECTED_NAME: "app",
    FAOLLA_EXPECTED_CWD: "/candidate", FAOLLA_EXPECTED_PORT: "3000",
    FAOLLA_EXPECTED_NPM_COMMAND: "/npm", FAOLLA_EXPECTED_NPM_REAL: "/npm-real",
    FAOLLA_EXPECTED_NODE_EXEC: "/node-real", FAOLLA_EXPECTED_TSX: "/tsx",
    FAOLLA_EXPECTED_WORKER: "/worker",
  };
  const candidateEntry = (interpreter) => [{
    name: "app", pm_id: 1, pid: 0,
    pm2_env: {
      name: "app", pm_id: 1, status: "stopped", pm_cwd: "/candidate",
      exec_interpreter: interpreter, exec_mode: "fork_mode", pm_exec_path: "/npm",
      args: ["start", "--", "-p", "3000"], node_args: [],
    },
  }];
  assert.equal(runParser(candidate, candidateEnv, candidateEntry("node")).status, 0);
  assert.equal(runParser(candidate, candidateEnv, candidateEntry("/node-real")).status, 0);
  assert.notEqual(runParser(candidate, candidateEnv, candidateEntry("/other-node")).status, 0);
});

test("restored PM2 metadata, environment, identity, and four local routes are strict", () => {
  assert.match(source, /--origin "http:\/\/127\.0\.0\.1:\$\{APP_PORT\}"/);
  assert.match(source, /--paths \/,\/login,\/10909094,\/admin/);
  assert.match(source, /--expected-build "\$EXPECTED_OLD_BUILD_ID"/);
  assert.match(source, /environment\.pm_exec_path !== expectedTsx/);
  assert.match(source, /environment\.args\.length !== 1/);
  assert.match(source, /environment\.args\[0\] !== expectedWorker/);
  assert.match(source, /environment\.node_args\.length !== 0/);
  assert.match(source, /env\.pm_exec_path !== npm/);
  assert.match(source, /NODE_OPTIONS="" NODE_PATH=""/);
  assert.match(source, /npm_config_node_options="" NPM_CONFIG_NODE_OPTIONS=""/);
  assert.match(source, /"NODE_OPTIONS", "NODE_PATH", "npm_config_node_options", "NPM_CONFIG_NODE_OPTIONS"/);
  assert.match(source, /verify_process_environment/);
  assert.match(source, /verify_web_flags/);
  assert.match(source, /verify_worker_flags/);
});

test("healthy frozen web is committed before worker/save and retained on later failure", () => {
  const commit = source.indexOf("FROZEN_WEB_COMMITTED=1");
  const worker = source.indexOf('RECOVERY_FAILURE_STAGE="worker_preflight"');
  const save = source.indexOf("pm2 save", worker);
  assert.ok(commit > 0 && commit < worker && worker < save);
  const finish = between("finish_recovery()", "require_command()");
  assert.match(finish, /WEB_START_ATTEMPTED.*FROZEN_WEB_COMMITTED.*-ne 1/);
  assert.match(finish, /WORKER_START_ATTEMPTED/);
  assert.match(finish, /PM2_STATE_MUTATED.*pm2 save/s);
});

test("all assigned stages have a fixed failure-code case", () => {
  const assigned = new Set([...source.matchAll(/RECOVERY_FAILURE_STAGE="([a-z_]+)"/g)].map((match) => match[1]));
  const finish = between("case \"$failure_stage\" in", "if [ -n \"${RECOVERY_PAYLOAD_FILE:-}\" ]");
  const cases = new Set([...finish.matchAll(/^\s{8}([a-z_]+)\)$/gm)].map((match) => match[1]));
  assert.deepEqual([...assigned].filter((stage) => !cases.has(stage)), []);
  assert.match(source, /local failure_stage="\$\{RECOVERY_FAILURE_STAGE:-invalid\}"/);
  assert.doesNotMatch(source, /RECOVERY_FAILURE_STAGE="runtime"/);
});

test("operator-visible markers are fixed and dangerous broad mutations are absent", () => {
  const literalMarkers = [...source.matchAll(/printf '%s\\n' '([a-z0-9_]+)'/g)].map((match) => match[1]);
  const allowed = new Set([
    "recovery_failed_stage_invalid", "cleanup_failed_reason_invalid",
    "fence_cleanup_verified", "candidate_state_verified", "candidate_processes_stopped",
    "current_frozen_release_verified", "frozen_web_restored",
    "worker_state_restored", "recovery_complete",
    ...[...source.matchAll(/'((?:recovery_failed_(?:pre_)?runtime)[a-z0-9_]*)'/g)].map((match) => match[1]),
    ...[...source.matchAll(/'(cleanup_failed_reason_[a-z0-9_]+)'/g)].map((match) => match[1]),
  ]);
  assert.deepEqual(literalMarkers.filter((value) => !allowed.has(value)), []);
  assert.doesNotMatch(source, /cleanup_unverified/);
  const finish = between("finish_recovery()", "require_command()");
  for (const reason of [
    "switch_temp", "compensation_temp", "fence_incomplete", "worker_cleanup",
    "web_cleanup", "candidate_restore", "precommit_verify", "pm2_save",
  ]) {
    assert.match(finish, new RegExp(`record_cleanup_failure ${reason}`));
    assert.match(finish, new RegExp(`cleanup_failed_reason_${reason}`));
  }
  assert.match(finish, /if \[ -z "\$cleanup_reason" \]; then cleanup_reason="\$reason"; fi/);
  assert.doesNotMatch(source, /\brm\s+-[A-Za-z]*[rR]/);
  assert.doesNotMatch(source, /\bgit\s+(?:reset|clean|checkout|switch|merge|rebase)\b/);
  assert.doesNotMatch(source, /\b(?:npm|pnpm|yarn)\s+(?:install|ci|run build)\b/);
  assert.doesNotMatch(source, /pg_(?:cancel|terminate)_backend/);
  assert.doesNotMatch(source, /\bdocker\s+(?:stop|kill|restart|rm)\b/);
});

test("shell parses and an unconfigured invocation emits only the fixed input code", () => {
  assert.ok(bash, "bash unavailable");
  const syntax = spawnSync(bash, ["-n", fileURLToPath(scriptUrl)], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  const run = spawnSync(bash, [fileURLToPath(scriptUrl)], { cwd: repositoryRoot, encoding: "utf8", env: {} });
  assert.notEqual(run.status, 0);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "recovery_failed_pre_runtime_input\n");
});
