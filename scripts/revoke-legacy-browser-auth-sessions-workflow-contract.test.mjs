import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    /HOTFIX_COMMIT: 26a3b2b0d0a82b3f972d13102b1b87c6fec6e589/,
  );
  assert.match(workflow, /REVOCATION_CUTOFF: 2026-08-20T03:01:52Z/);
  assert.match(workflow, /git merge-base --is-ancestor "\$HOTFIX_COMMIT" HEAD/);
  assert.match(workflow, /\.name == "Encrypted Database Backup"/);
  assert.match(workflow, /\.path == "\.github\/workflows\/database-backup\.yml"/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /faolla-encrypted-disaster-recovery-\$\{BACKUP_RUN_ID\}/);
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
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
});
