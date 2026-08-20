import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/enterprise-integration.yml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

test("enterprise PostgreSQL acceptance uses the healthy service container client", () => {
  assert.match(
    workflow,
    /node --test scripts\/enterprise-integration-workflow-contract\.test\.mjs/,
  );
  assert.match(workflow, /set -euo pipefail\n\s+umask 077/);
  assert.match(
    workflow,
    /POSTGRES_CONTAINER_ID:\s*\$\{\{\s*job\.services\.postgres\.id\s*\}\}/,
  );
  assert.match(
    workflow,
    /docker cp "\$\{GITHUB_WORKSPACE\}\/\." "\$\{POSTGRES_CONTAINER_ID\}:\/workspace"/,
  );
  assert.match(
    workflow,
    /cat > "\$psql_wrapper_dir\/psql" <<'PSQL_WRAPPER'[\s\S]{0,1200}exec docker exec[\s\S]{0,300}-i[\s\S]{0,300}--workdir \/workspace[\s\S]{0,300}psql "\$\{translated\[@\]\}"/,
  );
  assert.match(
    workflow,
    /if \[\[ "\$argument" == "\$GITHUB_WORKSPACE"\/\* \]\]; then[\s\S]{0,300}argument="\/workspace\/\$\{argument#"\$GITHUB_WORKSPACE"\/\}"/,
  );
  assert.match(
    workflow,
    /chmod 700 "\$psql_wrapper_dir\/psql"[\s\S]{0,200}PATH="\$psql_wrapper_dir:\$PATH"[\s\S]{0,100}bash scripts\/enterprise-integration\/run\.sh/,
  );
  assert.match(
    workflow,
    /--env "PGOPTIONS=\$\{PGOPTIONS:-\}"/,
  );
  assert.doesNotMatch(
    workflow,
    /apt-get|postgresql-client|--env DATABASE_URL=/,
  );
});
