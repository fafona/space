import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = await readFile(
  new URL(
    "../.github/workflows/revoke-legacy-browser-auth-sessions.yml",
    import.meta.url,
  ),
  "utf8",
);

test("session revocation is a manual, serialized, main-only production operation", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /\b(?:push|pull_request|schedule|workflow_run):/);
  assert.match(workflow, /group: production-deploy/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(
    workflow,
    /test "\$CONFIRMATION" = "REVOKE_LEGACY_BROWSER_AUTH_SESSIONS"/,
  );
  assert.doesNotMatch(workflow, /cutoff:\n\s+description:/);
});

test("workflow binds the immutable hotfix boundary and a fresh encrypted backup", () => {
  assert.match(
    workflow,
    /- name: Checkout Operation Source\n\s+uses: actions\/checkout@v5\n\s+with:\n\s+fetch-depth: 0/,
  );
  assert.match(
    workflow,
    /HOTFIX_COMMIT: 26a3b2b0d0a82b3f972d13102b1b87c6fec6e589/,
  );
  assert.match(workflow, /REVOCATION_CUTOFF: 2026-08-20T03:01:52Z/);
  assert.match(workflow, /git merge-base --is-ancestor "\$HOTFIX_COMMIT" HEAD/);
  assert.match(workflow, /\.name == "Encrypted Database Backup"/);
  assert.match(workflow, /\.path == "\.github\/workflows\/database-backup\.yml"/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /faolla-encrypted-disaster-recovery-\$\{suffix\}/);
  assert.match(workflow, /backup_age_seconds.*86400/s);
});

test("workflow requires the exact live source revision before any database access", () => {
  const verifyRelease = workflow.indexOf("- name: Verify Target Release Is Live");
  const inspectCohort = workflow.indexOf("- name: Inspect Bounded Session Cohort");
  const apply = workflow.indexOf("- name: Revoke Bounded Legacy Sessions");
  assert.ok(verifyRelease > 0);
  assert.ok(inspectCohort > verifyRelease);
  assert.ok(apply > inspectCohort);
  assert.match(
    workflow.slice(verifyRelease, inspectCohort),
    /--expected-build "\$GITHUB_SHA"/,
  );
  assert.match(
    workflow,
    /test \\"\\\$\(git rev-parse HEAD\)\\" = '\$GITHUB_SHA'/,
  );
  assert.match(
    workflow,
    /git status --porcelain --untracked-files=all -- scripts\/revoke-legacy-browser-auth-sessions\.mjs scripts\/apply-production-database-migrations\.mjs scripts\/check-database-backup-readiness\.mjs scripts\/check-supabase-migrations\.mjs/,
  );
  assert.equal(
    workflow.match(/git status --porcelain --untracked-files=all --/g)?.length,
    3,
  );
});

test("workflow dry-runs, applies with exact confirmation, and proves idempotence", () => {
  assert.match(
    workflow,
    /revoke-legacy-browser-auth-sessions\.mjs --dry-run --json/,
  );
  assert.match(
    workflow,
    /revoke-legacy-browser-auth-sessions\.mjs --apply --confirmation=REVOKE_LEGACY_BROWSER_AUTH_SESSIONS --json/,
  );
  assert.match(workflow, /\.remaining\.sessionCount == 0/);
  assert.match(workflow, /\.remaining\.refreshTokenCount == 0/);
  assert.match(workflow, /\.candidates\.sessionCount == 0/);
  assert.match(workflow, /\.candidates\.refreshTokenCount == 0/);
  assert.match(workflow, /Verify Idempotent Empty Cohort/);
});

test("workflow exposes no arbitrary SQL or user-controlled deletion boundary", () => {
  assert.doesNotMatch(workflow, /psql\b/);
  assert.doesNotMatch(workflow, /DELETE FROM/i);
  assert.doesNotMatch(workflow, /TRUNCATE/i);
  assert.doesNotMatch(workflow, /\$\{\{\s*inputs\.(?:sql|cutoff|command|path)/i);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /permissions:\n  actions: read\n  attestations: read\n  contents: read/);
});

test("new backup sources require a signed exact off binding before any database access", () => {
  const validate = workflow.slice(workflow.indexOf("- name: Validate Request And Backup"), workflow.indexOf("- name: Verify Target Release Is Live"));
  assert.match(validate, /git cat-file -e "\$\{backup_sha\}\^\{commit\}"/);
  assert.match(validate, /git ls-tree --name-only "\$backup_sha" -- scripts\/production-maintenance-workflow-contract\.mjs/);
  assert.match(validate, /git merge-base --is-ancestor "\$backup_sha" "\$LEGACY_BACKUP_MAX_SOURCE_SHA"/);
  assert.match(validate, /--source-digest "\$backup_sha" --source-ref refs\/heads\/main/);
  assert.match(validate, /--signer-workflow "github\.com\/\$GITHUB_REPOSITORY\/\.github\/workflows\/database-backup\.yml"/);
  assert.match(validate, /--mode off --operation-id "" --old-sha ""/);
  assert.doesNotMatch(validate, /\|\| true|continue-on-error|if \[ ! -f.*binding/);
  assert.match(workflow, /LEGACY_BACKUP_MAX_SOURCE_SHA: 22e6db38d017e05d8399ffbf60c6bea02fcb7bc9/);
});

test("revocation executes exact six/new or five/source-proven-legacy artifact validation", () => {
  const code = workflow.match(/<<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/)?.[1];
  assert.ok(code);
  const directory = mkdtempSync(join(tmpdir(), "faolla-revoke-inventory-"));
  const file = join(directory, "inventory.json");
  const run = "123", attempt = "2", sha = "a".repeat(40);
  const suffix = `${run}-${attempt}`;
  const names = ["faolla-encrypted-disaster-recovery", "faolla-production-backup-attestation", "faolla-backup-verification-reports", "faolla-encrypted-backup-attestation-bundle", "faolla-production-backup-attestation-bundle", "faolla-maintenance-backup-binding"];
  const entries = names.map((name, index) => ({
    id: index + 1, name: `${name}-${suffix}`, digest: `sha256:${String(index).repeat(64)}`,
    size_in_bytes: 100, expired: false, created_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(), workflow_run: { id: Number(run), head_branch: "main", head_sha: sha },
  }));
  const execute = (artifacts, protocol) => {
    writeFileSync(file, JSON.stringify([{ total_count: artifacts.length, artifacts }]));
    return spawnSync(process.execPath, ["--input-type=module", "-", file, run, attempt, sha, protocol], {
      input: code, encoding: "utf8", env: { SystemRoot: process.env.SystemRoot ?? "" },
    }).status;
  };
  try {
    assert.equal(execute(entries, "maintenance-binding-v1"), 0);
    assert.equal(execute(entries.slice(0, 5), "legacy"), 0);
    assert.notEqual(execute(entries.slice(0, 5), "maintenance-binding-v1"), 0);
    assert.notEqual(execute(entries, "legacy"), 0);
    assert.notEqual(execute(entries, "unknown"), 0);
    for (const change of [{ expired: true }, { id: 2 }, { name: entries[1].name }, { digest: "bad" }, { workflow_run: { id: 999, head_branch: "main", head_sha: sha } }]) {
      assert.notEqual(execute([{ ...entries[0], ...change }, ...entries.slice(1)], "maintenance-binding-v1"), 0);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
