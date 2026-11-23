import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Fast DDL/final-state proof in WASM. Real existing domain writers, races and
// the full refund transaction are tested separately using local PostgreSQL.
test("private legacy final-state constraint compiles, defers to commit, preserves legacy data and has no session capability bypass", { timeout: 60000 }, async () => {
  const db = new PGlite(), site = "10909095", op = "a".repeat(64), slug = `__merchant_orders__:${site}:chunk:0`;
  const record = { id: "O-test", siteId: site, customerAccountId: "50010105", customerUserId: "synthetic-user", status: "pending", items: [], totalQuantity: 1, totalAmount: 0 };
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema faolla_checkout_design;
      create table public.pages(id uuid primary key,merchant_id text,slug text,blocks jsonb);
      create table faolla_checkout_design.bundle_results(site_id text,operation_key text,principal_key text,resource_kind text,resource_id text,receipt jsonb,primary key(site_id,operation_key));
      create table faolla_checkout_design.bundle_cancellations(site_id text,operation_key text,receipt jsonb,primary key(site_id,operation_key));
      create function faolla_checkout_design.reject_historical_change() returns trigger language plpgsql as $$begin raise exception 'checkout_history_immutable';end;$$;`);
    await db.query("insert into pages values('12345678-1234-4234-8234-123456789abc',$1,$2,$3)", [site, slug, JSON.stringify([record])]);
    await db.query("insert into faolla_checkout_design.bundle_results values($1,$2,'account:50010105:synthetic-user','order','O-test',$3)", [site, op, JSON.stringify({ resourceTerms: { items: [], totalQuantity: 1, totalAmount: 0 } })]);
    const ddl = await fs.readFile(path.resolve("database/proposals/20261123_member_checkout_legacy_boundary.sql"), "utf8");
    const statements = ddl.replace(/^--.*$/gm, "");
    assert.ok(!/\bGRANT\s|set_config|current_setting|DISABLE\s+TRIGGER/i.test(statements));
    assert.equal((statements.match(/SECURITY DEFINER/g) ?? []).length, 1);
    await db.exec(ddl);
    for (const patch of [{ status: "cancelled" }, { totalAmount: 10 }, { customerAccountId: "50010106" }]) {
      await assert.rejects(db.query("update pages set blocks=$1 where slug=$2", [JSON.stringify([{ ...record, ...patch }]), slug]), /checkout_original_cancellation_required|checkout_change_requires_review|checkout_resource_locked/);
      assert.deepEqual((await db.query<{ blocks: unknown }>("select blocks from pages where slug=$1", [slug])).rows[0].blocks, [record]);
    }
    const legacy = { id: "O-legacy", siteId: site, status: "pending" };
    await db.query("update pages set blocks=$1 where slug=$2", [JSON.stringify([record, legacy]), slug]);
    await db.query("update pages set blocks=$1 where slug=$2", [JSON.stringify([record, { ...legacy, status: "cancelled" }]), slug]);
    await db.transaction(async tx => {
      await tx.query("update pages set blocks=$1 where slug=$2", [JSON.stringify([{ ...record, status: "cancelled" }, legacy]), slug]);
      // Synthetic admin fact only: proves deferred ordering, not the actual
      // refund procedure. The real PG acceptance invokes cancel_bundle.
      await tx.query("insert into faolla_checkout_design.bundle_cancellations values($1,$2,'{}')", [site, op]);
    });
    await assert.rejects(db.query("update pages set blocks=$1 where slug=$2", [JSON.stringify([record, legacy]), slug]), /checkout_original_cancellation_required/);
    assert.equal((await db.query<{ blocks: Array<{ status: string }> }>("select blocks from pages where slug=$1", [slug])).rows[0].blocks[0].status, "cancelled");
    await db.exec("create role synthetic_guard_without_bypass nologin;grant usage,create on schema faolla_checkout_design to synthetic_guard_without_bypass;alter function faolla_checkout_design.guard_legacy_resource_final_state() owner to synthetic_guard_without_bypass;");
    // Even an otherwise allowed no-op cannot silently evade a ledger hidden
    // by forced RLS after an accidental trigger-owner configuration change.
    await assert.rejects(db.query("update pages set blocks=blocks where slug=$1", [slug]), /checkout_resource_locked/);
  } finally { await db.close(); }
});
