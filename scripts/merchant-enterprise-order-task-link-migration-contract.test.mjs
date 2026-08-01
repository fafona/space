import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310012_merchant_order_task_link.sql",
);

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8");
}

function readFunction(source, name) {
  const marker = `create or replace function public.${name}(`;
  const start = source.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return source.slice(start, end + 4);
}

test("migration preflights invalid source rows without repairing data", () => {
  const source = readMigration();
  const firstAlter = source.toLowerCase().indexOf("alter table public.merchant_tasks");
  const pairPreflight = source.toLowerCase().indexOf("merchant_task_source_pair_invalid");
  const duplicatePreflight = source
    .toLowerCase()
    .indexOf("merchant_order_task_source_duplicate");

  assert.ok(pairPreflight >= 0 && pairPreflight < firstAlter);
  assert.ok(duplicatePreflight >= 0 && duplicatePreflight < firstAlter);
  assert.match(
    source,
    /source_type = '' and source_id <> ''[\s\S]+source_type <> '' and source_id = ''/i,
  );
  assert.match(
    source,
    /where source_type = 'order'[\s\S]+group by merchant_id, source_id[\s\S]+having count\(\*\) > 1/i,
  );
  assert.match(source, /lock table public\.merchant_tasks in share row exclusive mode/i);
  assert.doesNotMatch(source, /update\s+public\.merchant_tasks/i);
  assert.doesNotMatch(source, /delete\s+from\s+public\.merchant_tasks/i);
});

test("task sources are paired and bounded", () => {
  const source = readMigration();

  assert.match(
    source,
    /add constraint merchant_tasks_source_pair_check[\s\S]+source_type = '' and source_id = ''[\s\S]+source_type <> '' and source_id <> ''/i,
  );
  assert.match(
    source,
    /add constraint merchant_tasks_source_length_check[\s\S]+char_length\(source_type\) <= 80[\s\S]+char_length\(source_id\) <= 200/i,
  );
  assert.match(source, /merchant_task_source_length_invalid/i);
});

test("one order links to one task for the full task lifecycle", () => {
  const source = readMigration();
  const indexMatch = source.match(
    /create unique index merchant_tasks_order_source_unique_idx[\s\S]*?where source_type = 'order';/i,
  );

  assert.ok(indexMatch, "missing partial order-source unique index");
  assert.match(indexMatch[0], /on public\.merchant_tasks\(merchant_id, source_id\)/i);
  assert.doesNotMatch(indexMatch[0], /archived_at/i);
});

test("source guard serializes order links and emits stable errors", () => {
  const source = readMigration();
  const guard = readFunction(source, "faolla_guard_merchant_task_source_v1");

  assert.match(
    guard,
    /tg_op = 'UPDATE'[\s\S]+new\.source_type is distinct from old\.source_type[\s\S]+new\.source_id is distinct from old\.source_id[\s\S]+merchant_task_source_immutable/i,
  );
  assert.match(
    guard,
    /new\.source_type = 'order'[\s\S]+pg_advisory_xact_lock[\s\S]+hashtextextended/i,
  );
  assert.match(
    guard,
    /existing_task\.merchant_id = new\.merchant_id[\s\S]+existing_task\.source_type = 'order'[\s\S]+existing_task\.source_id = new\.source_id[\s\S]+merchant_order_task_exists/i,
  );
  assert.match(guard, /using errcode = 'P0001'/i);
  assert.match(
    source,
    /create trigger merchant_tasks_source_guard[\s\S]+before insert or update on public\.merchant_tasks[\s\S]+faolla_guard_merchant_task_source_v1\(\)/i,
  );
});

test("migration 012 is atomic, forward-only, registered, and reloads PostgREST", () => {
  const source = readMigration();

  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /values \(202607310012, 'merchant_order_task_link'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /truncate\s+/i);
  assert.doesNotMatch(source, /drop\s+table/i);
  assert.doesNotMatch(source, /drop\s+column/i);
});
