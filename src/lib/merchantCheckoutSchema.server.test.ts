import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Isolated, in-memory PostgreSQL engine only. This is DDL/constraint evidence,
// NOT proof of real multi-connection CAS, legacy ledger integration or rollout.
const site = "10909095", offerId = "abcdefab-abcd-4abc-8abc-abcdefabcdef", revision = "87654321-4321-4321-8321-cba987654321";
const op = "a".repeat(64), requestHash = "b".repeat(64);
const json = { version: 1, id: offerId, revision, siteId: site, source: { kind: "booking" } };

test("private checkout design compiles and enforces scope, units, history and role boundaries", { timeout: 60_000 }, async t => {
  const db = new PGlite();
  const insert = (key: string, method = "points", resource = `booking-${key.slice(0, 4)}`) => db.query(
    `INSERT INTO faolla_checkout_design.settlements(site_id,operation_key,request_hash,principal_key,offer_id,offer_revision,resource_kind,resource_id,method,total_points,currency,total_minor,initial_due_minor)
      VALUES($1,$2,$3,$4,$5,$6,'booking',$7,$8,$9,$10,$11,$12)`,
    [site, key, requestHash, "account:50010105:synthetic-user", offerId, revision, resource, method,
      method === "points" ? 500 : null, method === "points" ? null : "eur", method === "points" ? null : 10000, method === "points" ? null : 3000]);
  const fact = (id: string, key: string, kind: string, provider: string, scope = "member-synthetic") => db.query(
    `INSERT INTO faolla_checkout_design.facts(id,site_id,operation_key,kind,points,amount_minor,provider_scope,provider_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, site, key, kind, kind.startsWith("points") ? 500 : null, kind.startsWith("cash") ? 3000 : null, scope, provider]);
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    await db.exec(await fs.readFile(path.resolve("database/proposals/20261122_member_checkout_design.sql"), "utf8"));
    await db.query("INSERT INTO faolla_checkout_design.offer_versions(site_id,offer_id,revision,source_kind,source_key,snapshot) VALUES($1,$2,$3,'booking','service-synthetic',$4::jsonb)", [site, offerId, revision, JSON.stringify(json)]);
    await t.test("new offers start disabled; a historical quote is append-only", async () => {
      await db.query("INSERT INTO faolla_checkout_design.offer_heads(site_id,offer_id,revision) VALUES($1,$2,$3)", [site, offerId, revision]);
      assert.equal((await db.query<{ enabled: boolean }>("SELECT enabled FROM faolla_checkout_design.offer_heads")).rows[0].enabled, false);
      await assert.rejects(db.query("UPDATE faolla_checkout_design.offer_versions SET snapshot='{}'"), /checkout_history_immutable/);
      await assert.rejects(db.query("DELETE FROM faolla_checkout_design.offer_versions"), /checkout_history_immutable/);
    });
    await t.test("missing JSON identity cannot bypass CHECK using SQL NULL", async () => {
      await assert.rejects(db.query("INSERT INTO faolla_checkout_design.offer_versions(site_id,offer_id,revision,source_kind,source_key,snapshot) VALUES($1,$2,$3,'booking','other','{}')",
        [site, "12345678-1234-4234-8234-123456789abc", revision]), /check constraint/);
    });
    await t.test("a resource cannot be separately settled twice or cross merchant scope", async () => {
      await insert(op);
      await assert.rejects(insert("c".repeat(64), "points", "booking-aaaa"), /unique constraint/);
      await assert.rejects(db.query("INSERT INTO faolla_checkout_design.offer_heads(site_id,offer_id,revision) VALUES('10909096',$1,$2)", [offerId, revision]), /foreign key constraint/);
      await assert.rejects(db.query(`INSERT INTO faolla_checkout_design.settlements(site_id,operation_key,request_hash,principal_key,offer_id,offer_revision,resource_kind,resource_id,method,total_points)
        VALUES($1,$2,$3,'account:synthetic',$4,$5,'order','order-wrong-kind','points',500)`,
        [site, "8".repeat(64), requestHash, offerId, revision]), /foreign key constraint/);
    });
    await t.test("points and cash can never be recorded in the same units", async () => {
      await assert.rejects(db.query("UPDATE faolla_checkout_design.settlements SET total_minor=1 WHERE operation_key=$1", [op]), /checkout_operation_immutable/);
      await assert.rejects(fact("11111111-1111-4111-8111-111111111111", op, "cash_captured", "pi-wrong"), /checkout_fact_method_mismatch/);
      await fact("22222222-2222-4222-8222-222222222222", op, "points_debited", "points-tx-1");
      await assert.rejects(fact("33333333-3333-4333-8333-333333333333", op, "points_debited", "points-tx-2"), /unique constraint/);
    });
    await t.test("historical facts cannot be changed or deleted", async () => {
      await assert.rejects(db.query("DELETE FROM faolla_checkout_design.facts"), /checkout_history_immutable/);
      await assert.rejects(db.query("UPDATE faolla_checkout_design.facts SET points=1"), /checkout_history_immutable/);
    });
    await t.test("a cancelled operation cannot be reopened by retrying", async () => {
      const key = "d".repeat(64); await insert(key);
      await db.query("UPDATE faolla_checkout_design.settlements SET state='cancelled' WHERE operation_key=$1", [key]);
      await assert.rejects(db.query("UPDATE faolla_checkout_design.settlements SET state='committed',receipt='{}' WHERE operation_key=$1", [key]), /checkout_operation_immutable/);
    });
    await t.test("duplicate provider evidence is consumed only once, including another resource", async () => {
      const key = "e".repeat(64); await insert(key, "online");
      await fact("44444444-4444-4444-8444-444444444444", key, "cash_captured", "pi-synthetic-1", "acct-synthetic");
      await assert.rejects(fact("55555555-5555-4555-8555-555555555555", key, "cash_captured", "pi-synthetic-1", "acct-synthetic"), /unique constraint/);
      const another = "9".repeat(64); await insert(another, "online");
      await assert.rejects(fact("77777777-7777-4777-8777-777777777777", another, "cash_captured", "pi-synthetic-1", "acct-synthetic"), /unique constraint/);
    });
    await t.test("a failed ledger write rolls its new settlement row back", async () => {
      const key = "f".repeat(64);
      await assert.rejects(db.transaction(async tx => {
        await tx.query(`INSERT INTO faolla_checkout_design.settlements(site_id,operation_key,request_hash,principal_key,offer_id,offer_revision,resource_kind,resource_id,method,total_points)
          VALUES($1,$2,$3,'account:test-owner',$4,$5,'booking','rollback-synthetic','points',500)`, [site, key, requestHash, offerId, revision]);
        await tx.query("INSERT INTO faolla_checkout_design.facts(id,site_id,operation_key,kind,points,provider_scope,provider_reference) VALUES('66666666-6666-4666-8666-666666666666',$1,$2,'points_debited',0,'member-test','bad')", [site, key]);
      }), /check constraint/);
      assert.equal((await db.query("SELECT 1 FROM faolla_checkout_design.settlements WHERE operation_key=$1", [key])).rows.length, 0);
    });
    await t.test("browser/API roles have neither private schema access nor exposed write functions", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await db.exec(`SET ROLE ${role}`);
        try {
          await assert.rejects(db.query("SELECT * FROM faolla_checkout_design.settlements"), /permission denied/);
          await assert.rejects(db.query("DELETE FROM faolla_checkout_design.facts"), /permission denied/);
          await assert.rejects(db.query("SELECT faolla_checkout_design.guard_fact_method()"), /permission denied/);
        } finally { await db.exec("RESET ROLE"); }
      }
      const tables = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='faolla_checkout_design' AND c.relkind='r'`);
      assert.equal(tables.rows.length, 4); assert.ok(tables.rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
      assert.equal((await db.query("SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='faolla_checkout_design' AND prosecdef")).rows.length, 0);
    });
  } finally { await db.close(); }
});
