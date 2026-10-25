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

test("no application entry point imports or enables the unfinished preparation adapter", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)]);
  const production = walk(path.join(root, "src")).filter((file) => /\.[jt]sx?$/.test(file)
    && !/\.test\.[jt]sx?$/.test(file) && !file.endsWith("merchantBookingAtomicPreparation.server.ts"));
  for (const file of production) {
    assert.ok(!readFileSync(file, "utf8").includes("merchantBookingAtomicPreparation"), `unfinished adapter imported by ${file}`);
  }
  const adapter = readFileSync(path.join(root, "src/lib/merchantBookingAtomicPreparation.server.ts"), "utf8");
  assert.doesNotMatch(adapter, /process\.env|createServerSupabase|sendMerchantBooking|writeJsonFile/);
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
