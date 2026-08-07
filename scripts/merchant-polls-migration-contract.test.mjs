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
const deletionMigrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608070028_merchant_poll_ballot_deletion.sql",
);
const registeredParticipantsMigrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608070029_merchant_poll_registered_participants.sql",
);
const payloadCapacityMigrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608070030_merchant_poll_payload_capacity.sql",
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

test("poll result deletion is granted only to the server service role in a forward migration", () => {
  const sql = fs.readFileSync(deletionMigrationPath, "utf8");
  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /grant delete on table public\.merchant_poll_ballots to service_role/i);
  assert.doesNotMatch(sql, /grant\s+delete\s+on[\s\S]+\s+to\s+(?:anon|authenticated|public)\b/i);
  assert.match(sql, /202608070028, 'merchant_poll_ballot_deletion'/i);
  assert.match(sql, /\bcommit\s*;\s*$/i);
});

test("registered poll participants are added with a forward-only constraint migration", () => {
  const sql = fs.readFileSync(registeredParticipantsMigrationPath, "utf8");
  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /drop constraint if exists merchant_poll_ballots_participant_type_check/i);
  assert.match(sql, /participant_type in \('member', 'registered', 'guest'\)/i);
  assert.match(sql, /202608070029, 'merchant_poll_registered_participants'/i);
  assert.doesNotMatch(sql, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
  assert.match(sql, /\bcommit\s*;\s*$/i);
});

test("poll payload capacity supports configured question and option limits while remaining bounded", () => {
  const sql = fs.readFileSync(payloadCapacityMigrationPath, "utf8");
  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /merchant_poll_ballots_answers_check[\s\S]+pg_column_size\(answers\) <= 2097152/i);
  assert.match(sql, /merchant_poll_ballots_poll_snapshot_check[\s\S]+pg_column_size\(poll_snapshot\) <= 2097152/i);
  assert.match(sql, /202608070030, 'merchant_poll_payload_capacity'/i);
  assert.doesNotMatch(sql, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
  assert.match(sql, /\bcommit\s*;\s*$/i);
});
