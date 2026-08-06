import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608060027_merchant_poll_ballots.sql",
);

function source() {
  return fs.readFileSync(migrationPath, "utf8");
}

test("poll ballots migration is forward-only and registers its schema version", () => {
  const sql = source();
  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /\bcommit\s*;\s*$/i);
  assert.match(sql, /create table if not exists public\.merchant_poll_ballots/i);
  assert.doesNotMatch(sql, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
  assert.match(sql, /202608060027, 'merchant_poll_ballots'/i);
});

test("poll ballots are tenant-scoped, immutable to browsers and idempotent per participant", () => {
  const sql = source();
  assert.match(sql, /merchant_id text not null references public\.merchants\(id\) on delete restrict/i);
  assert.match(sql, /unique \(merchant_id, poll_id, participant_key_hash\)/i);
  assert.match(sql, /participant_key_hash[\s\S]+sha256:\[0-9a-f\]\{64\}/i);
  assert.match(sql, /alter table public\.merchant_poll_ballots enable row level security/i);
  assert.match(sql, /revoke all on table public\.merchant_poll_ballots from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant select, insert on table public\.merchant_poll_ballots to service_role/i);
  assert.doesNotMatch(sql, /grant[\s\S]+(?:update|delete)[\s\S]+merchant_poll_ballots/i);
});

test("poll answers and snapshots have structural and size constraints", () => {
  const sql = source();
  assert.match(sql, /jsonb_typeof\(answers\) = 'array'/i);
  assert.match(sql, /pg_column_size\(answers\) <= 131072/i);
  assert.match(sql, /jsonb_typeof\(poll_snapshot\) = 'object'/i);
  assert.match(sql, /pg_column_size\(poll_snapshot\) <= 131072/i);
  assert.match(sql, /merchant_poll_ballots_poll_created_idx[\s\S]+merchant_id, poll_id, created_at desc, id desc/i);
});
