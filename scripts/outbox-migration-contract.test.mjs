import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607250007_reliable_outbox_runtime.sql",
);

test("outbox migration exposes the complete service-role lifecycle", () => {
  const source = fs.readFileSync(migrationPath, "utf8");
  [
    "faolla_enqueue_merchant_outbox_v1",
    "faolla_claim_merchant_outbox_v1",
    "faolla_renew_merchant_outbox_lease_v1",
    "faolla_complete_merchant_outbox_v1",
    "faolla_fail_merchant_outbox_v1",
    "faolla_replay_merchant_outbox_v1",
    "faolla_get_merchant_outbox_health_v1",
  ].forEach((functionName) => {
    assert.match(source, new RegExp(`create or replace function public\\.${functionName}`));
    assert.match(source, new RegExp(`grant execute on function public\\.${functionName}`));
  });
});

test("outbox migration retains attempt and replay history", () => {
  const source = fs.readFileSync(migrationPath, "utf8");
  assert.match(source, /create table if not exists public\.merchant_outbox_attempts/);
  assert.match(source, /create table if not exists public\.merchant_outbox_replays/);
  assert.match(source, /for update skip locked/);
  assert.match(source, /dead_lettered_at/);
  assert.match(
    source,
    /where status = 'processing'\s+and lease_expires_at is null/,
  );
  assert.match(
    source,
    /where status = 'failed'\s+and attempts >= max_attempts/,
  );
  assert.doesNotMatch(source, /\bdelete\s+from\b/i);
});

test("outbox tables and functions are not exposed to browser roles", () => {
  const source = fs.readFileSync(migrationPath, "utf8");
  assert.match(
    source,
    /revoke all on table public\.merchant_outbox_events from anon, authenticated/,
  );
  assert.match(
    source,
    /revoke all on function public\.faolla_enqueue_merchant_outbox_v1\(jsonb\)\s+from public/,
  );
  assert.doesNotMatch(source, /grant execute[\s\S]*?to authenticated/);
});
