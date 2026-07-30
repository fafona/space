import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(
  scriptDirectory,
  "..",
  ".github",
  "workflows",
  "database-migrate.yml",
);

function readWorkflow() {
  return fs.readFileSync(workflowPath, "utf8");
}

test("production migrations remain manual, serialized, and backup-gated", () => {
  const workflow = readWorkflow();

  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):\s*$/m);
  assert.match(workflow, /group:\s*production-deploy/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /backup_run_id:/);
  assert.match(workflow, /\.name == "Encrypted Database Backup"/);
  assert.match(
    workflow,
    /\.path == "\.github\/workflows\/database-backup\.yml"/,
  );
  assert.match(workflow, /\.event == "workflow_dispatch"/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /faolla-encrypted-disaster-recovery-\$\{BACKUP_RUN_ID\}/);
  assert.match(workflow, /\.expired == false/);
  assert.match(workflow, /\.size_in_bytes > 0/);
  assert.match(workflow, /backup_age_seconds.*-le 86400/);
});

test("production migration workflow requires explicit apply confirmation", () => {
  const workflow = readWorkflow();

  assert.match(workflow, /test "\$CONFIRMATION" = "APPLY"/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /\^\[0-9\]\{12\}\$/);
  assert.match(workflow, /latest_migration/);
  assert.match(
    workflow,
    /apply-production-database-migrations\.mjs --apply --through=/,
  );
  assert.match(workflow, /--expected-build "\$GITHUB_SHA"/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /git status --porcelain --untracked-files=all/);
  assert.match(workflow, /node --env-file=\.env\.local scripts\/apply-production/);
  assert.match(workflow, /EXPECTED_COMMIT:\s*\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /--require-v1-ready --json/);
});
