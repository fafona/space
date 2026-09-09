import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load } from "js-yaml";

const root = "/var/lib/faolla-maintenance-code", sha = "a".repeat(40);
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const entries = [
  { file: "database-backup.yml", job: "backup", variable: "FAOLLA_BACKUP_WORKTREE", leaf: "faolla-database-backup-source-12-3",
    prepare: "Prepare Remote Detached Exact Source", cleanup: "Remove Temporary Backup And Exact Source" },
  { file: "database-migrate.yml", job: "migrate", variable: "FAOLLA_MIGRATION_WORKTREE", leaf: "faolla-database-migrate-12-3",
    prepare: "Prepare Remote Detached Exact Migration Source", cleanup: "Remove Remote Exact Migration Source" },
].map((entry) => {
  const source = readFileSync(new URL("../.github/workflows/" + entry.file, import.meta.url), "utf8");
  const workflow = load(source);
  const jobs = workflow.jobs[entry.job] ?? Object.values(workflow.jobs)[0];
  const remote = (name) => {
    const run = jobs.steps.find((step) => step.name === name)?.run.replaceAll("\r\n", "\n");
    assert.equal(typeof run, "string");
    const match = run.match(/<<'REMOTE'[^\n]*\n([\s\S]*?)\nREMOTE(?:\n|$)/); assert.ok(match, name);
    return match[1];
  };
  return { ...entry, source, workflow, prepareSource: remote(entry.prepare), cleanupSource: remote(entry.cleanup) };
});

function execute(entry, action, scenario = "valid") {
  const leaf = root + "/" + entry.leaf;
  // In-memory shell command doubles. Never create, chmod, remove or access a
  // real server worktree; even git and directory checks are intercepted.
  const doubles = `
LEAF='${leaf}'
ROOT='${root}'
SCENARIO='${scenario}'
ROOT_CREATED=0
LEAF_CREATED=${action === "cleanup" || scenario === "occupied" ? "1" : "0"}
id() { printf 0; }
test() {
  case "$1" in
    -d) return 0 ;;
    -f) return 0 ;;
    -L) { [ "$SCENARIO" = symlink ] || [ "$SCENARIO" = dangling ]; } && [ "$2" = "$LEAF" ]; return $? ;;
    -e)
      if [ "$2" = "$ROOT" ]; then [ "$SCENARIO" != missing-root ] || [ "$ROOT_CREATED" = 1 ]; return $?; fi
      if [ "$2" = "$LEAF" ]; then [ "$SCENARIO" = symlink ] || { [ "$LEAF_CREATED" = 1 ] && [ "$SCENARIO" != missing-root ]; }; return $?; fi
      return 0 ;;
    '!') shift; if test "$@"; then return 1; else return 0; fi ;;
    *) builtin test "$@" ;;
  esac
}
[() {
  if [[ "$1" = '!' && ( "$2" = -e || "$2" = -L || "$2" = -d || "$2" = -f ) ]]; then test '!' "$2" "$3"
  elif [[ "$1" = -e || "$1" = -L || "$1" = -d || "$1" = -f ]]; then test "$1" "$2"
  else builtin [ "$@"; fi
}
readlink() { if [ "$SCENARIO" = alias ] && [ "$3" = /var ]; then printf /different; else printf '%s' "$3"; fi; }
stat() {
  case "$2" in
    %u) if [ "$SCENARIO" = nonroot ] && [ "$4" = /var ]; then printf 1000; else printf 0; fi ;;
    %a)
      if [ "$SCENARIO" = writable ] && [ "$4" = /var ]; then printf 777
      elif [ "$SCENARIO" = parent-mode ] && [ "$4" = "$ROOT" ]; then printf 755
      elif [ "$SCENARIO" = leaf-mode ] && [ "$4" = "$LEAF" ]; then printf 755
      elif [ "$4" = "$ROOT" ] || [ "$4" = "$LEAF" ]; then printf 700
      else printf 755; fi ;;
    *) return 91 ;;
  esac
}
mkdir() { [ "$*" = '-m 700 -- ${root}' ] || return 92; ROOT_CREATED=1; printf 'created-root\\n'; }
chmod() { printf 'forbidden-chmod\\n'; return 93; }
rm() { printf 'removed-artifact\\n'; }
git() {
  case "$3 $4" in
    'rev-parse --is-inside-work-tree') printf true ;;
    'rev-parse refs/remotes/origin/main') printf '%s' "$FAOLLA_TARGET_SHA" ;;
    'rev-parse HEAD') if [ "$SCENARIO" = wrong-head ]; then printf '%040d' 0; else printf '%s' "$FAOLLA_TARGET_SHA"; fi ;;
    'status --porcelain=v1') [ "$SCENARIO" != status-error ] || return 1; [ "$SCENARIO" != dirty ] || printf ' M altered'; return 0 ;;
    'symbolic-ref -q') return 1 ;;
    'worktree add') [ "$5" = --detach ] || return 94; LEAF_CREATED=1; printf 'added-worktree\\n' ;;
    'worktree remove') [ "$5" = "$LEAF" ] && [ "$#" = 5 ] || return 95; LEAF_CREATED=0; printf 'removed-worktree\\n' ;;
    'fetch --no-tags'|'cat-file -e') return 0 ;;
    *) printf 'unexpected-git\\n'; return 96 ;;
  esac
}
`;
  const result = spawnSync(bash, ["-s"], {
    input: `set -euo pipefail\n${doubles}\n${action === "prepare" ? entry.prepareSource : entry.cleanupSource}\n`,
    encoding: "utf8", timeout: 10000, env: { ...process.env, FAOLLA_TARGET_SHA: sha,
      FAOLLA_APP_DIR_B64: Buffer.from("/repository").toString("base64"), FAOLLA_REPOSITORY_DIR_B64: Buffer.from("/repository").toString("base64"),
      [entry.variable]: leaf, FAOLLA_REMOTE_BACKUP_PATH: "/tmp/faolla-database-backup-12-3.tar.enc" },
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.doesNotMatch(result.stdout, /forbidden|unexpected/);
  return result;
}

for (const entry of entries) {
  test(`${entry.file}: exact trusted source location and strict non-mutating existing-directory gates`, () => {
    assert.match(entry.source, /REMOTE_(?:BACKUP|MIGRATION)_WORKTREE: \/var\/lib\/faolla-maintenance-code\/faolla-database-/);
    assert.doesNotMatch(entry.source, /REMOTE_(?:BACKUP|MIGRATION)_WORKTREE: \/tmp\//);
    for (const source of [entry.prepareSource, entry.cleanupSource]) {
      assert.match(source, /test "\$\(id -u\)" = 0/);
      assert.match(source, /for directory in \/ \/var \/var\/lib/);
      assert.match(source, /readlink -f -- "\$directory"/); assert.match(source, /8#\$mode & 8#22/);
      assert.match(source, /test "\$\(stat -c '%a' -- "\$source_root"\)" = 700/);
      assert.doesNotMatch(source, /chmod|mkdir -p|worktree remove --force/);
    }
    assert.ok(entry.prepareSource.indexOf("umask 077") < entry.prepareSource.indexOf("worktree add"));
    assert.ok(entry.cleanupSource.indexOf("rev-parse HEAD") < entry.cleanupSource.indexOf("worktree remove"));
    assert.ok(entry.cleanupSource.indexOf("status --porcelain") < entry.cleanupSource.indexOf("worktree remove"));
  });

  test(`${entry.file}: safe preparation accepts existing parent or creates only missing fixed parent`, () => {
    for (const scenario of ["valid", "missing-root"]) {
      const result = execute(entry, "prepare", scenario); assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /added-worktree/); assert.equal(result.stdout.includes("created-root"), scenario === "missing-root");
    }
  });

  test(`${entry.file}: unsafe chain, existing symlink or nonprivate parent never reaches git add`, () => {
    for (const scenario of ["alias", "nonroot", "writable", "parent-mode", "symlink", "dangling", "occupied"]) {
      const result = execute(entry, "prepare", scenario); assert.notEqual(result.status, 0, scenario);
      assert.doesNotMatch(result.stdout, /added-worktree|created-root/);
    }
    assert.notEqual(execute(entry, "prepare", "leaf-mode").status, 0);
  });

  test(`${entry.file}: cleanup only removes the exact clean source and never repairs bad evidence`, () => {
    const valid = execute(entry, "cleanup"); assert.equal(valid.status, 0, valid.stderr); assert.match(valid.stdout, /removed-worktree/);
    const missing = execute(entry, "cleanup", "missing-root"); assert.equal(missing.status, 0, missing.stderr);
    assert.doesNotMatch(missing.stdout, /removed-worktree|created-root/);
    for (const scenario of ["alias", "nonroot", "writable", "parent-mode", "symlink", "dangling", "leaf-mode", "wrong-head", "dirty", "status-error"]) {
      const result = execute(entry, "cleanup", scenario); assert.notEqual(result.status, 0, scenario);
      assert.doesNotMatch(result.stdout, /removed-worktree|created-root/);
    }
  });
}
