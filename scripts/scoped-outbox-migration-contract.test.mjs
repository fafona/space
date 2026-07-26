import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607250008_scoped_outbox_claim.sql",
);

test("scoped outbox claim requires exact merchant and event type scopes", () => {
  const source = fs.readFileSync(migrationPath, "utf8");
  assert.match(
    source,
    /create or replace function public\.faolla_claim_merchant_outbox_scoped_v1/,
  );
  assert.match(source, /invalid_outbox_merchant_scope/);
  assert.match(source, /invalid_outbox_event_type_scope/);
  assert.match(source, /event\.merchant_id = any\(v_merchant_ids\)/);
  assert.match(source, /event\.event_type = any\(v_event_types\)/);
  assert.match(source, /for update skip locked/);
});

test("scoped outbox claim is service-role only and retains attempt history", () => {
  const source = fs.readFileSync(migrationPath, "utf8");
  assert.match(
    source,
    /revoke all on function public\.faolla_claim_merchant_outbox_scoped_v1[\s\S]*?from public/,
  );
  assert.match(
    source,
    /grant execute on function public\.faolla_claim_merchant_outbox_scoped_v1[\s\S]*?to service_role/,
  );
  assert.match(source, /insert into public\.merchant_outbox_attempts/);
  assert.doesNotMatch(source, /\bdelete\s+from\b/i);
  assert.doesNotMatch(source, /to authenticated/);
});
