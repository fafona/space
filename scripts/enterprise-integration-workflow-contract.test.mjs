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
    /docker exec[\s\S]{0,500}--workdir \/workspace[\s\S]{0,500}bash scripts\/enterprise-integration\/run\.sh/,
  );
  assert.match(
    workflow,
    /--env DATABASE_URL="\$\{DATABASE_URL\}"[\s\S]{0,240}--env ENTERPRISE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE="\$\{ENTERPRISE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE\}"/,
  );
  assert.doesNotMatch(workflow, /apt-get|postgresql-client/);
});
