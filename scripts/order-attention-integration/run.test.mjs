import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DATABASE, createOrderAttentionMutationSnapshot, extractBaselineDdl, resolveOrderAttentionIntegrationConfig } from "./run.mjs";
import { discoverLocalTests } from "../run-local-tests.mjs";

const containerId = "a".repeat(64);
const environment = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
  ORDER_ATTENTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE: "1", PATH: "/usr/bin:/bin",
  FAOLLA_CI_POSTGRES_SERVICE_CONTAINER_ID: containerId, FAOLLA_CI_POSTGRES_CONTAINER_ID: containerId,
  FAOLLA_CI_POSTGRES_SERVER_IPV4: "172.19.0.2" };

test("runner requires explicit disposable hosted-CI intent and takes no CLI overrides", () => {
  for (const [key, value] of [["CI", "false"], ["GITHUB_ACTIONS", "false"], ["RUNNER_ENVIRONMENT", "self-hosted"],
    ["ORDER_ATTENTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE", ""], ["FAOLLA_CI_POSTGRES_CONTAINER_ID", "b".repeat(64)],
    ["FAOLLA_CI_POSTGRES_SERVER_IPV4", "8.8.8.8"]]) {
    assert.throws(() => resolveOrderAttentionIntegrationConfig({ ...environment, [key]: value }), /required|identity_invalid/);
  }
  assert.throws(() => resolveOrderAttentionIntegrationConfig(environment, ["--database=postgres"]), /required/);
});

test("configuration fixes endpoint, database and psql flags, never forwards credentials or service overrides", () => {
  const config = resolveOrderAttentionIntegrationConfig({ ...environment, PGHOST: "production.invalid", PGPORT: "9999",
    PGDATABASE: "production", PGPASSWORD: "do-not-forward", PGSERVICE: "production", PGSERVICEFILE: "/secret",
    PGPASSFILE: "/secret", PGOPTIONS: "unsafe", DATABASE_URL: "postgres://production.invalid/private",
    SUPABASE_SERVICE_ROLE_KEY: "do-not-forward", ORDER_ATTENTION_TEST_PSQL: "unsafe-program" });
  assert.equal(config.database, DATABASE);
  assert.equal(DATABASE, "faolla_order_attention_test");
  assert.equal(config.serverAddress, "172.19.0.2");
  assert.deepEqual(config.args, ["--host=127.0.0.1", "--port=5432", "--username=postgres", "--no-password", "--no-psqlrc",
    "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=default"]);
  assert.deepEqual(Object.keys(config.env).sort(), ["PATH", "LANG", "LC_ALL", "PGHOSTADDR", "PGCONNECT_TIMEOUT", "PGSSLMODE", "PGPASSFILE", "PGOPTIONS"].sort());
  assert.equal(config.env.PGHOSTADDR, "127.0.0.1");
  assert.equal(config.env.PGPASSFILE, "/dev/null");
  assert.match(config.env.PGOPTIONS, /statement_timeout=20000 -c lock_timeout=10000/);
  assert.doesNotMatch(JSON.stringify(config), /production|secret|unsafe|do-not-forward/);
});

test("missing opt-in fails before starting a PostgreSQL client and runner is not discovered as unit test", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./run.mjs", import.meta.url))], {
    env: { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", PATH: "" },
    encoding: "utf8", timeout: 5000, windowsHide: true, shell: false,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /order_attention_disposable_ci_database_required/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn psql/);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const discovered = discoverLocalTests(root);
  assert.equal(discovered.includes("scripts/order-attention-integration/run.mjs"), false);
  assert.equal(discovered.filter((name) => name === "scripts/order-attention-integration/run.test.mjs").length, 1);
});

test("integration uses actual baseline pages DDL and refuses incomplete fixtures", () => {
  const source = readFileSync(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const ddl = extractBaselineDdl(source);
  assert.match(ddl, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(ddl, /blocks jsonb not null default '\[\]'::jsonb/);
  assert.match(ddl, /create unique index if not exists pages_merchant_slug_unique_idx/);
  assert.match(ddl, /create trigger set_pages_updated_at/);
  assert.doesNotMatch(ddl, /page_events|grant |policy /);
  assert.throws(() => extractBaselineDdl("create table public.pages(id text);"), /baseline DDL missing/);
});

test("editing next order/customer/items/membership cannot mutate CAS witnesses or original snapshots", () => {
  const rows = [{ id: "row", slug: "__merchant_orders__:10000000:chunk:0", updated_at: "2026-09-24T10:00:00.000Z",
    blocks: [{ id: "order", status: "pending", customer: { note: "original", address: { city: "original" } },
      items: [{ name: "original", options: { labels: ["original"] } }] }] }];
  const member = { updated_at: "2026-09-24T10:00:00.000Z", blocks: [{ id: "member", pointBalance: 100,
    profile: { name: "original" }, transactions: [{ id: "original", metadata: { tags: ["original"] } }] }] };
  const originalRows = structuredClone(rows);
  const originalMember = structuredClone(member);
  const first = createOrderAttentionMutationSnapshot(rows, member);
  const second = createOrderAttentionMutationSnapshot(rows, member);
  first.orders.next[0].status = "confirmed";
  first.orders.next[0].customer.note = "changed";
  first.orders.next[0].customer.address.city = "changed";
  first.orders.next[0].items[0].name = "changed";
  first.orders.next[0].items[0].options.labels.push("changed");
  first.memberships.next[0].pointBalance += 10;
  first.memberships.next[0].profile.name = "changed";
  first.memberships.next[0].transactions[0].metadata.tags.push("changed");
  first.memberships.next.push({ id: "new-member" });
  assert.deepEqual(first.orders.expectedRows, originalRows);
  assert.equal(first.memberships.expectedUpdatedAt, originalMember.updated_at);
  assert.deepEqual(rows, originalRows);
  assert.deepEqual(member, originalMember);
  assert.deepEqual(second, createOrderAttentionMutationSnapshot(originalRows, originalMember));
  rows[0].blocks[0].customer.note = "later-input-change";
  member.blocks[0].transactions[0].id = "later-input-change";
  assert.deepEqual(second.orders.expectedRows, originalRows);
  assert.deepEqual(second.orders.next, originalRows[0].blocks);
  assert.deepEqual(second.memberships.next, originalMember.blocks);
  assert.deepEqual(createOrderAttentionMutationSnapshot([], null), {
    orders: { expectedRows: [], next: [] }, memberships: { expectedUpdatedAt: null, next: [] },
  });
});

test("real runner proves identity before create, refuses reuse and never drops/reset databases or patches 045", () => {
  const source = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  const createAt = source.indexOf("await query(`create database");
  assert.ok(createAt > source.indexOf("assert.deepEqual(identity"));
  assert.ok(createAt > source.indexOf('"refusing existing database"'));
  assert.match(source, /template template0/);
  assert.match(source, /major: 15, dataDirectory: "\/var\/lib\/postgresql\/data"/);
  assert.match(source, /202609080045_order_membership_atomic_mutation\.sql/);
  assert.match(source, /202609240052_order_attention_pilot\.sql/);
  assert.match(source, /pg_get_functiondef\('public\.faolla_commit_order_membership_v1/);
  assert.doesNotMatch(source, /drop database|drop schema|\.env\.local|\.\.\.process\.env|shell:\s*true/i);
  assert.match(source, /spawn\("psql"/);
  assert.match(source, /for \(const child of children\) child\.kill\(\)/);
});

test("acceptance retains deferred transaction, replica, ACL, exact generation and two-session race assertions", () => {
  const source = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  for (const contract of ["waitBlocked(writer.applicationName)", "await publisher.ready", "await direct.ready",
    "publisher.finish(\"commit;\")", "direct.finish(\"commit;\")", "set constraints all immediate; rollback;",
    "set session_replication_role=replica; truncate", "has_column_privilege", "9007199254740993",
    "__merchant_memberships_history_backup__", "order_membership_mutation_not_persisted",
    "alter table public.pages disable trigger", "generation=generation+1", "epoch=gen_random_uuid()",
    "generate_series(1,513)", "repeat('x',8388609)", "synthetic_capture_failure",
    "await firstWriter.ready", "await chunkWriter.ready", "waitBlocked(directChunks.applicationName)",
    "await waitBlocked(secondWriter.applicationName)", "delete from public.merchants"] ) {
    assert.ok(source.includes(contract), `missing acceptance: ${contract}`);
  }
});
