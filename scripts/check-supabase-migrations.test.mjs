import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import "./merchant-employee-initial-password-setup-migration-contract.test.mjs";
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

test("validateMigrationSource rejects an actual TRUNCATE statement", () => {
  const errors = validateMigrationSource(
    "202607250005_truncate_records.sql",
    `begin;
truncate table public.example_records;
insert into public.faolla_schema_migrations (version, name)
values (202607250005, 'truncate_records');
commit;
`,
  );
  assert.match(errors.join("\n"), /truncate/);
});

test("validateMigrationSource allows a BEFORE TRUNCATE protection trigger", () => {
  const errors = validateMigrationSource(
    "202607250006_protect_records.sql",
    `begin;
create trigger example_records_reject_truncate
before truncate on public.example_records
for each statement execute function public.reject_record_mutation();
insert into public.faolla_schema_migrations (version, name)
values (202607250006, 'protect_records');
commit;
`,
  );
  assert.deepEqual(errors, []);
});

test("validateMigrationSource rejects TRUNCATE inside a procedural block", () => {
  const errors = validateMigrationSource(
    "202607250007_hidden_truncate.sql",
    `begin;
do $$
begin
  truncate table public.example_records;
end
$$;
insert into public.faolla_schema_migrations (version, name)
values (202607250007, 'hidden_truncate');
commit;
`,
  );
  assert.match(errors.join("\n"), /truncate/);
});

test("validateMigrationSource rejects dynamic TRUNCATE SQL", () => {
  const errors = validateMigrationSource(
    "202607250008_dynamic_truncate.sql",
    `begin;
do $$
begin
  execute 'truncate table public.example_records';
end
$$;
insert into public.faolla_schema_migrations (version, name)
values (202607250008, 'dynamic_truncate');
commit;
`,
  );
  assert.match(errors.join("\n"), /truncate/);
});

test("validateMigrationSource permits exact read-only privilege predicates without masking executable SQL", () => {
  const wrap = sql => validMigration().replace("commit;", `${sql}\ncommit;`);
  for (const predicate of ["has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
    "pg_catalog.has_table_privilege(role_name, t, 'truncate')"]) {
    assert.deepEqual(validateMigrationSource("202607250001_example_records.sql", wrap(`select ${predicate};`)), []);
    for (const sql of ["truncate table public.example_records;", "do $$ begin execute 'TRUNCATE' || ' TABLE public.example_records'; end $$;",
      "do $$ begin execute 'truncate table public.example_records'; end $$;"]) {
      assert.match(validateMigrationSource("202607250001_example_records.sql", wrap(`select ${predicate};\n${sql}`)).join("\n"), /truncate/);
    }
  }
  for (const malformed of ["has_table_privilege(role_name,t,'TRUNCATE TABLE example_records')",
    "has_table_privilege(role_name,t,'TRUNCATE' || ' TABLE example_records')",
    "has_table_privilege(role_name,t,'SELECT,TRUNCATE; DELETE FROM example_records')"]) {
    assert.match(validateMigrationSource("202607250001_example_records.sql", wrap(`select ${malformed};`)).join("\n"), /truncate/);
  }
});

test("privilege-predicate exemption never masks a pseudo call used as dynamic SQL data", () => {
  const wrap = sql => validMigration().replace("commit;", `${sql}\ncommit;`);
  for (const data of ["$text$has_table_privilege(a,b,'TRUNCATE')$text$", "$text$pg_catalog.has_table_privilege(a,b,'TRUNCATE')$text$",
    "'has_table_privilege(a,b,''TRUNCATE'')'", "$$has_table_privilege(a,b,'TRUNCATE')$$"]) {
    const sql = `DO $outer$ BEGIN EXECUTE split_part(${data}, chr(39), 2) || ' public.example_table'; END; $outer$;`;
    assert.match(validateMigrationSource("202607250001_example_records.sql", wrap(sql)).join("\n"), /truncate/);
  }
  const predicate = "has_table_privilege(role_name,t,'SELECT,TRUNCATE')";
  for (const sql of [`DO $outer$ BEGIN PERFORM ${predicate}; END; $outer$;`,
    `CREATE FUNCTION example_check() RETURNS bool LANGUAGE SQL AS $function$ SELECT ${predicate}; $function$;`]) {
    assert.deepEqual(validateMigrationSource("202607250001_example_records.sql", wrap(sql)), []);
  }
});

test("migration guard permits exact read-only trigger event equality and lists in executable bodies", () => {
  const wrap = sql => validMigration().replace("commit;", `${sql}\ncommit;`);
  for (const predicate of ["tg_op='TRUNCATE'", "tg_op in('DELETE','TRUNCATE')", "tg_op IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')"]) {
    for (const sql of [`DO $guard$ BEGIN IF (${predicate}) THEN RAISE EXCEPTION 'immutable'; END IF; END; $guard$;`,
      `CREATE FUNCTION example_check() RETURNS boolean LANGUAGE SQL AS $fn$ SELECT ${predicate}; $fn$;`]) {
      assert.deepEqual(validateMigrationSource("202607250001_example_records.sql", wrap(sql)), []);
    }
  }
  for (const data of ["'EXECUTE'", "'quoted ''EXECUTE'' token'", "$text$EXECUTE$text$", String.raw`E'quoted \' EXECUTE'`]) {
    const sql = `DO $guard$ BEGIN PERFORM ${data}; IF tg_op='TRUNCATE' THEN RAISE EXCEPTION 'immutable'; END IF; END; $guard$;`;
    assert.deepEqual(validateMigrationSource("202607250001_example_records.sql", wrap(sql)), []);
  }
  const siblings = "CREATE FUNCTION guard() RETURNS trigger LANGUAGE plpgsql AS $a$ BEGIN IF tg_op='TRUNCATE' THEN RAISE EXCEPTION 'immutable'; END IF; RETURN NULL; END; $a$;\n" +
    "CREATE FUNCTION harmless() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN EXECUTE 'SELECT 1'; END; $b$;";
  assert.deepEqual(validateMigrationSource("202607250001_example_records.sql", wrap(siblings)), []);
});

test("migration guard rejects malformed trigger predicates instead of masking their literal prefixes", () => {
  const wrap = predicate => validMigration().replace("commit;", `DO $$ BEGIN IF ${predicate} THEN NULL; END IF; END; $$;\ncommit;`);
  for (const predicate of ["tg_op='TRUNCATE' || ' TABLE example_records'", "tg_op in('TRUNCATE','UNKNOWN')",
    "tg_op in('TRUNCATE',)", "tg_op='TRUNCATE TABLE'", "other.tg_op='TRUNCATE'", "tg_op in('TRUNCATE' || ' TABLE example_records')"]) {
    assert.match(validateMigrationSource("202607250001_example_records.sql", wrap(predicate)).join("\n"), /truncate/);
  }
});

test("trigger event predicate exemption never enters quoted or dynamic SQL data", () => {
  const wrap = sql => validMigration().replace("commit;", `${sql}\ncommit;`);
  for (const data of ["'tg_op=''TRUNCATE'''", "$text$tg_op='TRUNCATE'$text$", "$$tg_op in('DELETE','TRUNCATE')$$"]) {
    for (const sql of [`SELECT ${data};`, `DO $outer$ BEGIN EXECUTE ${data}; END; $outer$;`]) {
      assert.match(validateMigrationSource("202607250001_example_records.sql", wrap(sql)).join("\n"), /truncate/);
    }
  }
  const ddl = "CREATE TRIGGER x BEFORE TRUNCATE ON public.other_records FOR EACH STATEMENT EXECUTE FUNCTION guard();";
  for (const body of ["IF tg_op='TRUNCATE' THEN EXECUTE tg_op || ' TABLE public.example_records'; END IF;",
    "EXECUTE tg_op || ' TABLE public.example_records'; IF tg_op='TRUNCATE' THEN RETURN NULL; END IF;",
    "IF tg_op='TRUNCATE' THEN DO $inner$ BEGIN EXECUTE 'SELECT 1'; END; $inner$; END IF;"]) {
    const sql = `CREATE FUNCTION guard() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN ${body} RETURN NULL; END; $guard$;\n${ddl}`;
    assert.match(validateMigrationSource("202607250001_example_records.sql", wrap(sql)).join("\n"), /truncate/);
  }
});

test("migration guard permits only complete unquoted pg_temp-only template cleanup statements", () => {
  const wrap = sql => validMigration().replace("commit;", `${sql}\ncommit;`);
  for (const sql of ["drop table pg_temp.expected_settings;", "DROP TABLE pg_temp.expected_settings, pg_temp.expected_employees;",
    "DO $cleanup$ BEGIN DROP TABLE pg_temp.expected_settings; END; $cleanup$;"]) {
    assert.deepEqual(validateMigrationSource("202607250001_example_records.sql", wrap(sql)), []);
  }
});

test("temporary cleanup exemption rejects permanent, mixed, quoted and extended DROP statements", () => {
  const wrap = sql => validMigration().replace("commit;", `${sql}\ncommit;`);
  for (const sql of ["drop table public.example_records;", "drop table pg_temp.a,public.example_records;", "drop table example_records;",
    "drop table pg_temp.a, b;", "drop table pg_temp.a cascade;", "drop table pg_temp.a restrict;", "drop table if exists pg_temp.a;",
    'drop table pg_temp."a";', 'drop table "pg_temp".a;', "drop table pg_temp.a,;", "drop table pg_temp.a$extension;"]) {
    assert.match(validateMigrationSource("202607250001_example_records.sql", wrap(sql)).join("\n"), /drop table/);
  }
});

test("temporary cleanup exemption never enters single-quoted or dollar-quoted dynamic SQL", () => {
  const wrap = sql => validMigration().replace("commit;", `${sql}\ncommit;`);
  for (const data of ["'drop table pg_temp.a;'", "$text$drop table pg_temp.a;$text$", "$$DROP TABLE pg_temp.a,pg_temp.b;$$"]) {
    for (const sql of [`SELECT ${data};`, `DO $outer$ BEGIN EXECUTE ${data}; END; $outer$;`, `DO $outer$ BEGIN EXECUTE format(${data}); END; $outer$;`]) {
      assert.match(validateMigrationSource("202607250001_example_records.sql", wrap(sql)).join("\n"), /drop table/);
    }
  }
  for (const sql of [String.raw`DO $outer$ BEGIN PERFORM '\'; EXECUTE replace('DROP TABLE pg_temp.a;', 'pg_temp.', 'public.'); END; $outer$;`,
    String.raw`DO $outer$ BEGIN PERFORM E'\\'; EXECUTE replace('DROP TABLE pg_temp.a;', 'pg_temp.', 'public.'); END; $outer$;`,
    String.raw`DO $outer$ BEGIN PERFORM E'quoted \' token'; EXECUTE replace('DROP TABLE pg_temp.a;', 'pg_temp.', 'public.'); END; $outer$;`,
    "DO $outer$ BEGIN PERFORM 'quoted ''token'''; EXECUTE replace('DROP TABLE pg_temp.a;', 'pg_temp.', 'public.'); END; $outer$;",
    String.raw`SET LOCAL standard_conforming_strings=off; DO $outer$ BEGIN EXECUTE replace(split_part('x\' AS $data$DROP TABLE pg_temp.a;$data$ y', '$data$', 2), 'pg_temp.', 'public.'); END; $outer$;`]) {
    assert.match(validateMigrationSource("202607250001_example_records.sql", wrap(sql)).join("\n"), /drop table/);
  }
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
