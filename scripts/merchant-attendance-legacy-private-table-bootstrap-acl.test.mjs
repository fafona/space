// Static release regression only: no SQL execution, database, process or network.
// The exact legacy dependencies are 24 tables and one view, not all old private tables.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { validateMigrationSource } from "./check-supabase-migrations.mjs";

const archive = new URL("../.runtime/attendance-pilot-schema-20261009/", import.meta.url);
const sourceRoot = new URL("./supabase-migrations/", import.meta.url);
const manifestUrl = new URL("schema-manifest.json", archive);
const manifestBytes = existsSync(manifestUrl) ? readFileSync(manifestUrl) : null;
const manifest = manifestBytes ? JSON.parse(manifestBytes) : null;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const frozenManifestSha256 = "a1516d87ecb40cabdd8b9ab239b2d8753b21b29c94c0d66c7f0c8e5a4832712d";
const marker = "$pilot_private_table_bootstrap_acl$";
const comment = "-- Revoke the bootstrap role only when it is not the private table owner.";
const cases = [
  {
    "index": 65,
    "name": "202609290064_merchant_attendance_owner_configuration.sql",
    "tables": [
      "merchant_attendance_config_operations"
    ],
    "anchor": "revoke all on public.merchant_attendance_config_operations from public,anon,authenticated,service_role;",
    "originalSHA": "c4662915ddc42fdb7b635e817b034c4e58807d39155b8c624a8929fb6053a1b6",
    "size": 18086
  },
  {
    "index": 92,
    "name": "202610010091_merchant_attendance_revision_requests.sql",
    "tables": [
      "merchant_attendance_revision_requests"
    ],
    "anchor": "revoke all on public.merchant_attendance_revision_requests from public,anon,authenticated,service_role;",
    "originalSHA": "c0b7f570dc5c3fe4f055802c9b6cc34dd71fae0aa63cb3b91c31b0aa29924d3e",
    "size": 20049
  },
  {
    "index": 94,
    "name": "202610010093_merchant_attendance_versioned_reports.sql",
    "tables": [
      "merchant_attendance_effect_versions",
      "merchant_attendance_effect_current_v2"
    ],
    "anchor": "revoke all on public.merchant_attendance_effect_current_v2 from public,anon,authenticated,service_role;",
    "originalSHA": "7da4066733597f972c7963619cd4c969a49580ed5a2b256d6964260ccbcec784",
    "size": 94443
  },
  {
    "index": 95,
    "name": "202610010094_merchant_attendance_revision_decision_core.sql",
    "tables": [
      "merchant_attendance_revision_decisions"
    ],
    "anchor": "revoke all on public.merchant_attendance_revision_decisions from public,anon,authenticated,service_role;",
    "originalSHA": "063951a9dfd5e9f7380a8425614196abf360eeaa343522db0084b0738bf1d4d8",
    "size": 50687
  },
  {
    "index": 100,
    "name": "202610010099_merchant_attendance_schedule.sql",
    "tables": [
      "merchant_attendance_schedule_cancellations",
      "merchant_attendance_schedule_commands",
      "merchant_attendance_schedule_slots"
    ],
    "anchor": "revoke all on public.merchant_attendance_schedule_commands,public.merchant_attendance_schedule_slots,public.merchant_attendance_schedule_cancellations from public,anon,authenticated,service_role;",
    "originalSHA": "b1a4fa86a3c72f3e9dad64dde6254767f7cba7b1897987178e0835ff2c691297",
    "size": 17274
  },
  {
    "index": 105,
    "name": "202610010104_merchant_attendance_terminals.sql",
    "tables": [
      "merchant_attendance_terminal_audit",
      "merchant_attendance_terminals"
    ],
    "anchor": "revoke all on public.merchant_attendance_terminal_audit from public,anon,authenticated,service_role;",
    "originalSHA": "8bc3463f91ca21a12d1f0168b4dd6844a8e5b9b2ed0308308721cde4145d18cb",
    "size": 13853
  },
  {
    "index": 107,
    "name": "202610010106_merchant_attendance_pin_credentials.sql",
    "tables": [
      "merchant_attendance_pin_attempts",
      "merchant_attendance_pin_audit",
      "merchant_attendance_pin_credentials"
    ],
    "anchor": "revoke all on public.merchant_attendance_pin_credentials,public.merchant_attendance_pin_audit,public.merchant_attendance_pin_attempts from public,anon,authenticated,service_role;",
    "originalSHA": "d0113975d6f827a5aadc76780e8a0381922ef2cebed7e8e9d7fde55e0a85f872",
    "size": 17110
  },
  {
    "index": 125,
    "name": "202610030124_merchant_attendance_groups.sql",
    "tables": [
      "merchant_attendance_group_assignment_operations",
      "merchant_attendance_group_assignments",
      "merchant_attendance_group_operations",
      "merchant_attendance_groups"
    ],
    "anchor": "revoke all on public.merchant_attendance_groups,public.merchant_attendance_group_operations,public.merchant_attendance_group_assignments,public.merchant_attendance_group_assignment_operations from public,anon,authenticated,service_role;",
    "originalSHA": "7a057cc5bc1e72a80e822aa5e3da9965c1749f1219ea1a82fcc46d9b4a8597ff",
    "size": 37395
  },
  {
    "index": 128,
    "name": "202610040127_merchant_attendance_rule_versions.sql",
    "tables": [
      "merchant_attendance_rule_operations",
      "merchant_attendance_rule_streams"
    ],
    "anchor": "revoke all on public.merchant_attendance_rule_streams,public.merchant_attendance_rule_operations from public,anon,authenticated,service_role;",
    "originalSHA": "f97ce807d7919070a358fb5175a47275cfa3bcac71c8fc8b728fa6fec3d34773",
    "size": 35442
  },
  {
    "index": 130,
    "name": "202610040129_merchant_attendance_personal_rules.sql",
    "tables": [
      "merchant_attendance_personal_rule_operations",
      "merchant_attendance_personal_rule_streams"
    ],
    "anchor": "revoke all on public.merchant_attendance_personal_rule_streams,public.merchant_attendance_personal_rule_operations from public,anon,authenticated,service_role;",
    "originalSHA": "dc197a766fd04a5a47921a7e2a2bb3743ea885fcdfaa633f06e63621b6f2d34e",
    "size": 34703
  },
  {
    "index": 137,
    "name": "202610050136_merchant_attendance_schedule_publication_evidence.sql",
    "tables": [
      "merchant_attendance_schedule_publication_evidence"
    ],
    "anchor": "revoke all on public.merchant_attendance_schedule_publication_evidence from public,anon,authenticated,service_role;",
    "originalSHA": "dcfc88846ad6a3502d735bd3ad553ac7642ff21d444e8816a5f4c7cabcc4636f",
    "size": 24660
  },
  {
    "index": 148,
    "name": "202610050147_merchant_attendance_plan_exception_review.sql",
    "tables": [
      "merchant_attendance_plan_exception_cases",
      "merchant_attendance_plan_exception_entries",
      "merchant_attendance_plan_exception_reads"
    ],
    "anchor": "revoke all on public.merchant_attendance_plan_exception_cases,public.merchant_attendance_plan_exception_entries,public.merchant_attendance_plan_exception_reads from public,anon,authenticated,service_role;",
    "originalSHA": "e108e701d3a82082a7c09a262158a0ee278fa6b1f4d84cf72b7e6160f7d4b69f",
    "size": 51886
  }
];

function block(tables) {
  return [
    comment,
    "do " + marker,
    "declare target regclass;",
    "begin",
    "  for target in",
    "    select c.oid::regclass from pg_catalog.pg_class c",
    "    where c.oid=any(array[",
    ...tables.map((table, index) => "      'public." + table + "'::regclass" + (index < tables.length - 1 ? "," : "")),
    "    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')",
    "  loop",
    "    execute format('revoke all privileges on table %s from postgres',target);",
    "  end loop;",
    "end;",
    marker + ";",
    "",
    "",
  ].join("\n");
}

test("finite review evidence binds exactly 12 creation sources and 25 distinct strict-guard dependencies", () => {
  if (manifest) {
    assert.equal(sha256(manifestBytes), frozenManifestSha256);
    assert.equal(manifest.schemaOnly, true);
    assert.equal(manifest.productionDataCopied, false);
  }
  assert.equal(cases.length, 12);
  assert.equal(new Set(cases.map(item => item.name)).size, 12);
  const tables = cases.flatMap(item => item.tables);
  assert.equal(tables.length, 25);
  assert.equal(new Set(tables).size, 25);
  assert(cases.every(item => /^[0-9a-f]{64}$/.test(item.originalSHA)
    && Number.isSafeInteger(item.size) && item.size > 0
    && Number.isSafeInteger(item.index)));
  assert.deepEqual(cases.map(item => Number(item.name.slice(8, 12))),
    [64,91,93,94,99,104,106,124,127,129,136,147]);
  assert.deepEqual(cases.map(item => item.index), [65,92,94,95,100,105,107,125,128,130,137,148]);
  assert(!cases.some(item => item.name.includes("0126_") || item.name.includes("0189_")));
});

for (const { index, name, tables, anchor, originalSHA, size } of cases) {
  test(name + ": only exact non-owner bootstrap ACL block added; all original bytes remain frozen", () => {
    const currentBytes = readFileSync(new URL(name, sourceRoot));
    const current = currentBytes.toString("utf8");
    const addition = block(tables);
    assert.equal(current.split("do " + marker).length, 2, "exactly one top-level compatibility DO");
    assert.equal(current.split(addition).length, 2, "the full conditional template and exact relation list match");
    const original = current.replace(addition, "");
    const originalBytes = Buffer.from(original, "utf8");
    assert.equal(originalBytes.length, size);
    assert.equal(sha256(originalBytes), originalSHA,
      "without the inserted DO every original business function, grant, RLS, guard and default ACL byte is unchanged");
    if (manifest) {
      const entry = manifest.files[index];
      assert(entry, "original manifest index missing");
      assert.equal(entry.name, name);
      assert.equal(entry.bytes, size);
      assert.equal(entry.sha256, originalSHA);
      assert.deepEqual(originalBytes, readFileSync(new URL(name, archive)));
    }
    assert.equal(original.split(anchor).length, 2, "the original insertion anchor is unique");
    assert.equal(current, original.replace(anchor, addition + anchor),
      "insertion only, including original line endings and all surrounding bytes");

    const created = [...original.matchAll(/create\s+(?:or replace\s+)?(table|view)(?: if not exists)?\s+public\.([a-z0-9_]+)/g)];
    const insertionIndex = original.indexOf(anchor);
    for (const relation of tables) {
      const matches = created.filter(match => match[2] === relation);
      assert.equal(matches.length, 1, "each scoped table/view is created exactly once: " + relation);
      assert(matches[0].index < insertionIndex, "all scoped relations exist before the added DO");
      assert.equal(matches[0][1], relation === "merchant_attendance_effect_current_v2" ? "view" : "table");
    }
    assert.deepEqual([...addition.matchAll(/'public\.([a-z0-9_]+)'::regclass/g)].map(match => match[1]), tables);
    assert.match(addition, /c\.relowner<>\(select oid from pg_catalog\.pg_roles where rolname='postgres'\)/);
    assert.doesNotMatch(addition, /cascade|grant\s|alter\s|create\s|insert\s|update\s|delete\s|default privileges/i);
    assert.deepEqual(validateMigrationSource(name, current), []);
  });
}

test("064 preserves legal service_role SELECT and does not change other owner-configuration relations", () => {
  const item = cases.find(item => item.name.includes("0064_"));
  assert.deepEqual(item.tables, ["merchant_attendance_config_operations"]);
  const source = readFileSync(new URL(item.name, sourceRoot), "utf8");
  assert.match(source, /grant select on public\.merchant_attendance_config_operations to service_role;/);
  assert(source.indexOf(block(item.tables)) < source.indexOf(item.anchor));
  assert(source.indexOf(item.anchor) < source.indexOf("grant select on public.merchant_attendance_config_operations to service_role;"));
});

test("093 scopes the original effect table plus its view, without broad all-table cleanup", () => {
  const item = cases.find(item => item.name.includes("0093_"));
  assert.deepEqual(item.tables, ["merchant_attendance_effect_versions", "merchant_attendance_effect_current_v2"]);
  const source = readFileSync(new URL(item.name, sourceRoot), "utf8");
  const insertionIndex = source.indexOf(block(item.tables));
  assert(source.indexOf("create table public.merchant_attendance_effect_versions") < insertionIndex);
  assert(source.indexOf("create view public.merchant_attendance_effect_current_v2") < insertionIndex);
});

test("conditional targeting retains postgres-owned native fixtures and unknown role grants", () => {
  const postgres = 100;
  const serviceRole = 101;
  const unknownRole = 102;
  const before = new Set([postgres, serviceRole, unknownRole]);
  const applyConditionalRevoke = owner => {
    const after = new Set(before);
    if (owner !== postgres) after.delete(postgres);
    return after;
  };
  assert.deepEqual(applyConditionalRevoke(postgres), before);
  assert.deepEqual(applyConditionalRevoke(200), new Set([serviceRole, unknownRole]),
    "only non-owner postgres is removed; the untouched strict guards still reject unknown grants");
  for (const item of cases) {
    const addition = block(item.tables);
    assert.equal((addition.match(/execute format\(/g) ?? []).length, 1);
    assert(addition.indexOf("c.relowner<>") < addition.indexOf("execute format("));
    assert.equal(addition.split("from postgres").length, 2);
  }
});

test("189 stays outside both bootstrap ACL fixes and retains its original source SHA", () => {
  const name = "202610080189_merchant_attendance_correction_delegation.sql";
  const bytes = readFileSync(new URL(name, sourceRoot));
  assert.equal(sha256(bytes), "81ab06aecc5093cf992d6a57dd9c8c46ea130d3f5b92073b11616b90d5bdd818");
  if (manifest) assert.deepEqual(bytes, readFileSync(new URL(name, archive)));
});

