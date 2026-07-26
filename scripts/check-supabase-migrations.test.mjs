import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkSupabaseMigrations,
  validateMigrationSource,
} from "./check-supabase-migrations.mjs";

function validMigration(version = "202607250001") {
  return `begin;
create table if not exists public.example_records (id uuid primary key);
insert into public.faolla_schema_migrations (version, name)
values (${version}, 'example_records')
on conflict (version) do nothing;
commit;
`;
}

test("validateMigrationSource accepts an additive registered migration", () => {
  assert.deepEqual(
    validateMigrationSource(
      "202607250001_example_records.sql",
      validMigration(),
    ),
    [],
  );
});

test("validateMigrationSource rejects destructive SQL", () => {
  const errors = validateMigrationSource(
    "202607250002_remove_records.sql",
    `begin;
drop table public.example_records;
insert into public.faolla_schema_migrations (version, name)
values (202607250002, 'remove_records');
commit;
`,
  );
  assert.match(errors.join("\n"), /drop table/);
});

test("validateMigrationSource requires matching version registration", () => {
  const errors = validateMigrationSource(
    "202607250003_example_records.sql",
    validMigration("202607250004"),
  );
  assert.match(errors.join("\n"), /register version 202607250003/);
});

test("repository migrations pass the migration safety check", () => {
  const result = checkSupabaseMigrations(process.cwd());
  assert.deepEqual(result.errors, []);
  assert.ok(result.files.includes("202607250001_core_transaction_foundation.sql"));
});

test("checkSupabaseMigrations reports duplicate versions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "faolla-migrations-"));
  const directory = path.join(root, "scripts", "supabase-migrations");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "202607250001_first.sql"),
    validMigration(),
  );
  fs.writeFileSync(
    path.join(directory, "202607250001_second.sql"),
    validMigration(),
  );
  try {
    const result = checkSupabaseMigrations(root);
    assert.match(result.errors.join("\n"), /duplicate migration version/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
