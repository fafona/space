import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { validateMigrationSource } from "./check-supabase-migrations.mjs";

const root = path.resolve(import.meta.dirname, "..");
const name = "202610250211_booking_atomic_preparation.sql";
const sql = readFileSync(path.join(root, "scripts/supabase-migrations", name), "utf8");

test("booking preparation migration obeys additive migration checks and defaults inactive", () => {
  assert.deepEqual(validateMigrationSource(name, sql), []);
  assert.match(sql, /active boolean not null default false/);
  assert.doesNotMatch(sql, /set\s+active\s*=\s*true/i);
  assert.doesNotMatch(sql, /create\s+(?:or replace\s+)?function[^;]*activat/i);
  for (const table of ["faolla_booking_atomic_control", "faolla_booking_atomic_commands", "faolla_booking_mail_jobs"]) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security;`));
  }
  assert.match(sql, /from public, anon, authenticated, service_role/);
  assert.match(sql, /for update skip locked/);
  assert.doesNotMatch(sql, /set\s+state\s*=\s*'pending'/i);
});

test("runtime upgrade requires an inactive database and preserves private bounded delivery APIs", () => {
  const runtimeName = "202610250212_booking_atomic_runtime.sql";
  const runtime = readFileSync(path.join(root, "scripts/supabase-migrations", runtimeName), "utf8");
  assert.deepEqual(validateMigrationSource(runtimeName, runtime), []);
  assert.ok(runtime.indexOf("booking_atomic_upgrade_requires_inactive") < runtime.indexOf("alter table"));
  assert.doesNotMatch(runtime, /set\s+active\s*=\s*true/i);
  assert.ok(runtime.includes("revoke all on function public.faolla_booking_mail_settle_v1(text,uuid,uuid,text,text) from service_role"));
  assert.ok(runtime.includes("p_error is distinct from 'provider_rate_limited'"));
  assert.ok(runtime.includes("attempts<3"));
  assert.ok(runtime.includes("lease_until > clock_timestamp()"));
  assert.ok(runtime.includes("booking_atomic_invalid_mail_context"));
});

test("only the reviewed default-off runtime imports the transaction protocol; activation still requires the database gate", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)]);
  const production = walk(path.join(root, "src")).filter((file) => /\.[jt]sx?$/.test(file)
    && !/\.test\.[jt]sx?$/.test(file) && !["merchantBookingAtomicPreparation.server.ts", "merchantBookingAtomicRuntime.server.ts", "merchantBookingNotificationWorker.server.ts"].some((name) => file.endsWith(name)));
  for (const file of production) {
    assert.ok(!readFileSync(file, "utf8").includes("merchantBookingAtomicPreparation"), `unfinished adapter imported by ${file}`);
  }
  const adapter = readFileSync(path.join(root, "src/lib/merchantBookingAtomicPreparation.server.ts"), "utf8");
  assert.doesNotMatch(adapter, /process\.env|createServerSupabase|sendMerchantBooking|writeJsonFile/);
  const runtime = readFileSync(path.join(root, "src/lib/merchantBookingAtomicRuntime.server.ts"), "utf8");
  assert.ok(runtime.includes('|| "legacy"'));
  assert.ok(runtime.includes('snapshot.protocol !== 2'));
  assert.ok(runtime.includes('await readAtomicBookingSnapshot()'));
});

test("explicit real PostgreSQL acceptance is retained with pinned isolated dependencies and no skip mode", () => {
  const entry = "scripts/booking-atomic-postgres-acceptance.mjs";
  const acceptance = readFileSync(path.join(root, entry), "utf8");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:booking-atomic:postgres"], `node --import tsx --test ${entry}`);
  assert.ok(acceptance.includes('"17.10.0-beta.17"'));
  assert.ok(acceptance.includes('"8.23.1"'));
  assert.ok(acceptance.includes('host: "127.0.0.1"'));
  assert.doesNotMatch(acceptance, /\b(?:test|it)\.skip\b|\bskip\s*:/);
  assert.ok(acceptance.includes("actual capacity rule plus real concurrent adapter commands"));
});

test("both booking browser acceptances are mandatory in the existing browser CI job", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:booking-browser"], "node --test --test-concurrency=1 scripts/booking-manage-browser-acceptance.mjs scripts/booking-flows-browser-acceptance.mjs");
  const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8").replace(/\r\n/g, "\n");
  const browser = workflow.slice(workflow.indexOf("  browser:\n"), workflow.indexOf("  qr-database:\n"));
  assert.ok(browser.includes("- name: Booking Browser Journeys\n"));
  assert.ok(browser.includes("run: npm run test:booking-browser"));
  assert.doesNotMatch(browser, /continue-on-error|\bif:|test-skip-pattern|test-name-pattern/);
  for (const file of ["booking-manage-browser-acceptance.mjs", "booking-flows-browser-acceptance.mjs"]) {
    assert.doesNotMatch(readFileSync(path.join(root, "scripts", file), "utf8"), /\btest\.skip\b|\bskip\s*:/);
  }
});
