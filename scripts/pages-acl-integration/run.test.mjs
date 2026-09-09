import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolvePagesAclIntegrationConfig } from "./run.mjs";

const environment = {
  CI: "true", GITHUB_ACTIONS: "true", PAGES_ACL_INTEGRATION_ALLOW_DISPOSABLE_DATABASE: "1",
  FAOLLA_CI_POSTGRES_SERVICE_CONTAINER_ID: "a".repeat(64),
  FAOLLA_CI_POSTGRES_CONTAINER_ID: "a".repeat(64), FAOLLA_CI_POSTGRES_SERVER_IPV4: "172.18.0.2",
};

test("the new runner requires explicit disposable CI opt-in and bound service identity", () => {
  for (const key of Object.keys(environment)) {
    const bad = { ...environment }; delete bad[key];
    assert.throws(() => resolvePagesAclIntegrationConfig(bad));
  }
  assert.throws(() => resolvePagesAclIntegrationConfig({ ...environment, FAOLLA_CI_POSTGRES_CONTAINER_ID: "b".repeat(64) }));
  assert.throws(() => resolvePagesAclIntegrationConfig({ ...environment, FAOLLA_CI_POSTGRES_SERVER_IPV4: "8.8.8.8" }));
  assert.throws(() => resolvePagesAclIntegrationConfig(environment, ["--database=postgres"]));
});

test("connection and child environment cannot be redirected by inherited database credentials", () => {
  const config = resolvePagesAclIntegrationConfig({ ...environment,
    PGHOST: "elsewhere", PGHOSTADDR: "203.0.113.1", PGPORT: "6543", PGDATABASE: "postgres",
    PGUSER: "other", PGPASSWORD: "synthetic-secret", PGPASSFILE: "/synthetic/private",
    PGSERVICE: "private", PGSERVICEFILE: "/synthetic/service", PGOPTIONS: "-c search_path=other",
    DATABASE_URL: "postgres://synthetic.invalid/other", PAGES_ACL_TEST_PSQL: "wrong-binary",
  });
  assert.equal(config.database, "faolla_pages_acl_test");
  assert.equal(config.serverAddress, "172.18.0.2");
  for (const item of ["--host=127.0.0.1", "--port=5432", "--username=postgres", "--dbname=faolla_pages_acl_test", "--no-password", "--no-psqlrc"]) {
    assert.ok(config.args.includes(item));
  }
  assert.equal(config.env.PGHOSTADDR, "127.0.0.1");
  assert.equal(config.env.PGPASSFILE, "/dev/null");
  assert.equal(config.env.PGPASSWORD, undefined);
  assert.equal(config.env.PGSERVICE, undefined);
  assert.equal(config.env.PGSERVICEFILE, undefined);
  assert.equal(config.env.DATABASE_URL, undefined);
  assert.doesNotMatch(JSON.stringify(config), /synthetic-secret|203\.0\.113|private|wrong-binary/);
});

test("runner checks empty PG15 identity before mutations and never resets or starts services", () => {
  const source = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  const verified = source.indexOf('pass("fixed empty PG15 CI service identity")');
  const write = source.indexOf("query(`create role anon");
  assert.ok(verified > 0 && write > verified);
  assert.match(source, /major: 15/);
  assert.match(source, /relations: 0, functions: 0, roles: 0/);
  assert.match(source, /dataDirectory: "\/var\/lib\/postgresql\/data"/);
  assert.match(source, /Date\.now\(\) \+ 120_000/);
  assert.match(source, /timeout: Math\.min\(25_000, remaining\)/);
  assert.doesNotMatch(source, /\b(?:dropdb|initdb|pg_ctl|docker\s+run|DROP\s+DATABASE)\b/i);
  assert.doesNotMatch(source, /readFileSync\([^\n]*\.env|dotenv|loadEnvConfig/);
});
