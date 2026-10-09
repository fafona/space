// Static release regression only: no SQL execution, database, process or network.
// Frozen source hashes make the primary proof portable without the local archive.
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
    "name": "202610070181_merchant_attendance_outage_relations.sql",
    "originalSha256": "953535932e7ab94d6f795ef79a62795518499bebfe41bd5fd5b27612a5552215",
    "originalBytes": 37227,
    "tables": [
      "merchant_attendance_outage_relation_operations"
    ],
    "anchor": "revoke all on public.merchant_attendance_outage_relation_operations from public,anon,authenticated,service_role;"
  },
  {
    "name": "202610070182_merchant_attendance_retention.sql",
    "originalSha256": "1fa95ce71901e368944c8a5f4b8340422ab1b5917c30eaf569b3925cb0004ccc",
    "originalBytes": 47585,
    "tables": [
      "merchant_attendance_retention_policy_operations",
      "merchant_attendance_preservation_operations"
    ],
    "anchor": "revoke all on public.merchant_attendance_retention_policy_operations,public.merchant_attendance_preservation_operations from public,anon,authenticated,service_role;"
  },
  {
    "name": "202610080183_merchant_attendance_period_continuation.sql",
    "originalSha256": "d8060f51db46692dd1e0026b64967b27d4c8ca59b5643c9ef61c4d48d8e15f1f",
    "originalBytes": 98880,
    "tables": [
      "merchant_attendance_period_storage",
      "merchant_attendance_period_artifact_metadata"
    ],
    "anchor": "revoke all on public.merchant_attendance_period_storage,public.merchant_attendance_period_artifact_metadata from public,anon,authenticated,service_role;"
  },
  {
    "name": "202610080185_merchant_attendance_period_delegations.sql",
    "originalSha256": "80233f83742600017e2b2c451e3e39a0d0548deaddc04bec7c4597902c9bdcb4",
    "originalBytes": 93974,
    "tables": [
      "merchant_attendance_period_delegations",
      "merchant_attendance_period_delegation_revocations",
      "merchant_attendance_period_delegation_operations"
    ],
    "anchor": "do $period_delegation_security$"
  },
  {
    "name": "202610080188_merchant_attendance_owner_notifications.sql",
    "originalSha256": "0fb1ff8630df571380daf1ffcd3958245c3005de3c62a0d11badaf1528b24765",
    "originalBytes": 42133,
    "tables": [
      "merchant_attendance_owner_notifications",
      "merchant_attendance_owner_notification_reads",
      "merchant_attendance_owner_notification_operations"
    ],
    "anchor": "do $owner_notification_storage$"
  },
  {
    "name": "202610080191_merchant_attendance_operational_rules.sql",
    "originalSha256": "6a7da4d6175ee49b972e9eba8cdf8f8d9502d678263635afd5b68a5433e20477",
    "originalBytes": 95277,
    "tables": [
      "merchant_attendance_operational_rule_streams",
      "merchant_attendance_operational_rule_operations",
      "merchant_attendance_operational_rule_publications"
    ],
    "anchor": "do $operational_security$"
  },
  {
    "name": "202610080193_merchant_attendance_operational_punch.sql",
    "originalSha256": "f8a8ce8d2834ae77af6f7e7e5865a3b0118a12d7c86b3ce07c0cfe2835854ff3",
    "originalBytes": 172110,
    "tables": [
      "merchant_attendance_operational_punch_activations",
      "merchant_attendance_operational_punch_sessions",
      "merchant_attendance_operational_punch_operations"
    ],
    "anchor": "do $punch_security$"
  },
  {
    "name": "202610080194_merchant_attendance_application_window.sql",
    "originalSha256": "cae58cb6b9f646ae8a02ab9fa33ec62d575de8133dead518821c48c44ec88309",
    "originalBytes": 84625,
    "tables": [
      "merchant_attendance_operational_consumer_activations",
      "merchant_attendance_application_window_proofs"
    ],
    "anchor": "do $window_security$"
  },
  {
    "name": "202610080195_merchant_attendance_administrative_closure.sql",
    "originalSha256": "4b316703618483053f53127c6b1589e757a17826e77f54f708ea26dcbdf7b187",
    "originalBytes": 165712,
    "tables": [
      "merchant_attendance_administrative_closures",
      "merchant_attendance_administrative_closure_entries"
    ],
    "anchor": "do $administrative_storage$"
  },
  {
    "name": "202610080196_merchant_attendance_independent_workers.sql",
    "originalSha256": "901c8f4132379e863a0f74247914a6c295ad968cfe1754b87c0802f201ac91d0",
    "originalBytes": 190737,
    "tables": [
      "merchant_attendance_independent_subjects",
      "merchant_attendance_independent_entries",
      "merchant_attendance_independent_credentials",
      "merchant_attendance_independent_leases",
      "merchant_attendance_independent_event_sources",
      "merchant_attendance_independent_member_bindings"
    ],
    "anchor": "do $independent_storage$"
  },
  {
    "name": "202610080197_merchant_attendance_retention_disposal.sql",
    "originalSha256": "395ade353bae838969c9630189294c146f63ed5b9df1562f449b48a0772a1b44",
    "originalBytes": 106002,
    "tables": [
      "merchant_attendance_disposal_event_coverage",
      "merchant_attendance_disposal_artifact_coverage",
      "merchant_attendance_disposal_artifact_event_refs",
      "merchant_attendance_disposal_approvals",
      "merchant_attendance_disposal_executions"
    ],
    "anchor": "do $disposal_private_tables$"
  },
  {
    "name": "202610080198_merchant_attendance_review_routing.sql",
    "originalSha256": "3f64f4ccf288368160da116858a67acbf35ecffd08b8ed49caa275ff23b47a1c",
    "originalBytes": 169594,
    "tables": [
      "merchant_attendance_review_responsibility_entries",
      "merchant_attendance_review_responsibility_heads"
    ],
    "anchor": "do $routing_security$"
  },
  {
    "name": "202610080199_merchant_attendance_day_reviews.sql",
    "originalSha256": "1e4c99b5e1d82dec4e7756ccfefc5362e9418605014d5ba69914131fe0a4235e",
    "originalBytes": 201123,
    "tables": [
      "merchant_attendance_day_review_cases",
      "merchant_attendance_day_review_entries"
    ],
    "anchor": "revoke all on public.merchant_attendance_day_review_cases,public.merchant_attendance_day_review_entries from public,anon,authenticated,service_role;"
  },
  {
    "name": "202610080200_merchant_attendance_operational_cycle.sql",
    "originalSha256": "5a44bdd939b6672e8375edd19f2c2d2d5063abb1de598eacaf09a4f885886510",
    "originalBytes": 211887,
    "tables": [
      "merchant_attendance_cycle_intents",
      "merchant_attendance_cycle_operations",
      "merchant_attendance_cycle_frame_heads",
      "merchant_attendance_period_cycle_adoptions"
    ],
    "anchor": "revoke all on public.merchant_attendance_cycle_intents,public.merchant_attendance_cycle_operations,public.merchant_attendance_cycle_frame_heads,public.merchant_attendance_period_cycle_adoptions from public,anon,authenticated,service_role;"
  },
  {
    "name": "202610080201_merchant_attendance_reminders.sql",
    "originalSha256": "4c7582f36e9233278458900cb31b7ec86a828486db2d9bfa021c523c4727052a",
    "originalBytes": 190684,
    "tables": [
      "merchant_attendance_reminder_plans",
      "merchant_attendance_reminder_heads",
      "merchant_attendance_reminder_events",
      "merchant_attendance_reminder_batches",
      "merchant_attendance_reminder_operations"
    ],
    "anchor": "-- BEGIN REMINDER FINALIZE"
  },
  {
    "name": "202610080202_merchant_attendance_management_delegations.sql",
    "originalSha256": "b682643101f44bdf5f340a6c12bfc5c3653b12af9aaebd78bad813de3c6946c4",
    "originalBytes": 152173,
    "tables": [
      "merchant_attendance_management_delegations",
      "merchant_attendance_management_delegation_revocations",
      "merchant_attendance_management_delegation_operations"
    ],
    "anchor": "do $management_security$"
  },
  {
    "name": "202610080203_merchant_attendance_delegated_audit.sql",
    "originalSha256": "9c1092b9a6857113c03ff310eb8e9ba57c63e894772a16af52103a45bbe07692",
    "originalBytes": 121647,
    "tables": [
      "merchant_attendance_management_audit_exports"
    ],
    "anchor": "revoke all on public.merchant_attendance_management_audit_exports from public,anon,authenticated,service_role;"
  },
  {
    "name": "202610080207_merchant_attendance_delegated_credentials.sql",
    "originalSha256": "1a7357a61b07e8a24007c0bab3b7ad0e5dd4d5753c790b05fa4c374da0c5ede3",
    "originalBytes": 295498,
    "tables": [
      "merchant_attendance_delegated_credential_proofs"
    ],
    "anchor": "revoke all on public.merchant_attendance_delegated_credential_proofs from public,anon,authenticated,service_role;"
  }
];

function block(tables, newline) {
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
  ].join(newline);
}

test("review evidence binds exact original source hashes, with 18 migrations and 50 distinct private tables", () => {
  if (manifest) {
    assert.equal(sha256(manifestBytes), frozenManifestSha256);
    assert.equal(manifest.schemaOnly, true);
    assert.equal(manifest.productionDataCopied, false);
  }
  assert.equal(cases.length, 18);
  assert.equal(new Set(cases.map(item => item.name)).size, 18);
  const tables = cases.flatMap(item => item.tables);
  assert.equal(tables.length, 50);
  assert.equal(new Set(tables).size, 50);
  assert(cases.every(item => /^[0-9a-f]{64}$/.test(item.originalSha256)
    && Number.isSafeInteger(item.originalBytes) && item.originalBytes > 0));
  assert(!cases.some(item => item.name.includes("0189_")));
  assert.deepEqual(cases.map(item => Number(item.name.slice(8, 12))),
    [181,182,183,185,188,191,193,194,195,196,197,198,199,200,201,202,203,207]);
});

for (const { name, tables, anchor, originalSha256, originalBytes: originalSize } of cases) {
  test(name + ": complete exact new-table coverage, postgres-owner exclusion, original business/ACL/RLS/guards unchanged", () => {
    const currentBytes = readFileSync(new URL(name, sourceRoot));
    const current = currentBytes.toString("utf8");
    // Every reviewed original used LF. The SHA below also rejects EOL changes.
    const addition = block(tables, "\n");
    assert.equal(current.split("do " + marker).length, 2, "exactly one top-level bootstrap DO");
    assert.equal(current.split(addition).length, 2, "the complete conditional block matches the reviewed template");
    const original = current.replace(addition, "");
    const originalBytes = Buffer.from(original, "utf8");
    assert.equal(originalBytes.length, originalSize);
    assert.equal(sha256(originalBytes), originalSha256,
      "removing only the inserted DO must restore the frozen original source bytes");
    if (manifest) {
      const entry = manifest.files.find(file => file.name === name);
      assert(entry, "original manifest entry missing");
      assert.equal(entry.bytes, originalSize);
      assert.equal(entry.sha256, originalSha256);
      assert.deepEqual(originalBytes, readFileSync(new URL(name, archive)),
        "optional local evidence independently matches the same frozen bytes");
    }
    assert.equal(original.split(anchor).length, 2, "the original insertion anchor is unique");
    assert.equal(current, original.replace(anchor, addition + anchor), "no unrelated byte or original line-ending changed");
    assert.deepEqual(Buffer.from(current.replace(addition, ""), "utf8"), originalBytes,
      "removing only the inserted DO preserves every original function body, function grant, RLS, guard and default ACL byte");

    const created = [...original.matchAll(/create table(?: if not exists)?\s+public\.([a-z0-9_]+)/g)];
    assert.deepEqual(created.map(match => match[1]), tables, "all and only this migration's new private tables");
    const additionIndex = current.indexOf(addition);
    assert(created.every(match => match.index < additionIndex), "all listed tables are already created");
    assert.deepEqual([...addition.matchAll(/'public\.([a-z0-9_]+)'::regclass/g)].map(match => match[1]), tables);
    assert.match(addition, /c\.relowner<>\(select oid from pg_catalog\.pg_roles where rolname='postgres'\)/,
      "postgres itself must not be revoked when it is the table owner");
    assert.doesNotMatch(addition, /cascade|grant\s|alter\s|create\s|insert\s|update\s|delete\s|default privileges/i,
      "the additional code may only revoke this named non-owner bootstrap role");
    assert.deepEqual(validateMigrationSource(name, current), []);
  });
}

test("the conditional target query models the real public defaults without revoking a postgres-owned fixture or unknown roles", () => {
  const bootstrapRole = 100;
  const apiRoles = [101, 102, 103];
  const unknownRole = 104;
  const acl = new Set([bootstrapRole, ...apiRoles, unknownRole]);
  const queryTarget = owner => owner !== bootstrapRole;
  const applyConditionalRevoke = owner => {
    const after = new Set(acl);
    if (queryTarget(owner)) after.delete(bootstrapRole);
    return after;
  };
  assert.deepEqual(applyConditionalRevoke(bootstrapRole), acl, "fixture owner retains its own privileges");
  assert.deepEqual(applyConditionalRevoke(200), new Set([...apiRoles, unknownRole]),
    "non-owner postgres is the only removed entry; unknown grants remain for the unchanged strict guard to reject");
  for (const item of cases) {
    const addition = block(item.tables, "\n");
    assert.equal((addition.match(/execute format\(/g) ?? []).length, 1);
    assert(addition.indexOf("c.relowner<>") < addition.indexOf("execute format("));
    assert.equal(addition.split("from postgres").length, 2);
  }
});

test("189 remains outside this strict-guard compatibility fix and matches its frozen original SHA", () => {
  const name = "202610080189_merchant_attendance_correction_delegation.sql";
  const bytes = readFileSync(new URL(name, sourceRoot));
  assert.equal(sha256(bytes), "81ab06aecc5093cf992d6a57dd9c8c46ea130d3f5b92073b11616b90d5bdd818");
  if (manifest) assert.deepEqual(bytes, readFileSync(new URL(name, archive)));
});

