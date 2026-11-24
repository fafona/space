import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { cartQuoteFixture } from "../../scripts/fixtures/member-checkout-cart-quote";
import { createMerchantOrder } from "./merchantOrders";
import { awardOrderPointsToMembership, prepareMerchantMembershipPointsForOrderTransitions } from "./merchantMemberships.server";

// WASM diagnosis of the actual unchanged legacy preparer and CAS. Ledger
// facts are synthetic here; real financial writers are covered by owned PG.
test("legacy reward boundary rejects checkout gifts without replacing old SQL or blocking ordinary rewards", { timeout: 60000 }, async t => {
  const db = new PGlite(), f = cartQuoteFixture(), site = f.siteId, op = "a".repeat(64);
  const order = createMerchantOrder({ siteId: site, customerAccountId: f.principal.accountId, customerUserId: f.principal.userId,
    customer: { name: "Synthetic", email: "synthetic@example.invalid" }, pricePrefix: "€",
    items: [{ productId: "synthetic-product", name: "Synthetic", quantity: 1, unitPrice: 10 }] }, { id: "O-rollback-synthetic" });
  const completed = { ...order, status: "completed" as const, completedAt: new Date().toISOString() };
  f.settings.pointsRules.paidAmount = 1; f.settings.pointsRules.paidPoints = 2;
  const historical = awardOrderPointsToMembership({ membership: f.member, order: completed, settings: f.settings, now: completed.completedAt });
  f.member.transactions = historical.transactions.map(tx => ({ ...tx, status: "cancelled", cancelledAt: completed.completedAt, cancellationNote: "Synthetic old history" }));
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema faolla_checkout_design;
      create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
      create table public.faolla_schema_migrations(version bigint primary key,name text not null);
      create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
      create trigger set_pages_updated_at before update on public.pages for each row execute function public.set_pages_updated_at();
      create table faolla_checkout_design.bundle_results(site_id text,operation_key text,principal_key text,resource_kind text,resource_id text,receipt jsonb,primary key(site_id,operation_key));
      create table faolla_checkout_design.bundle_cancellations(site_id text,operation_key text,receipt jsonb,primary key(site_id,operation_key));
      create function faolla_checkout_design.reject_historical_change() returns trigger language plpgsql as $$begin raise exception 'checkout_history_immutable';end;$$;`);
    await db.exec(await fs.readFile(path.resolve("scripts/supabase-migrations/202609080045_order_membership_atomic_mutation.sql"), "utf8"));
    await db.exec(await fs.readFile(path.resolve("database/proposals/20261123_member_checkout_legacy_boundary.sql"), "utf8"));
    await db.query("insert into pages(merchant_id,slug,blocks) values($1,$2,$3),($1,$4,$5)",
      [site, `__merchant_orders__:${site}`, JSON.stringify([order]), `__merchant_memberships__:${site}`, JSON.stringify([f.member])]);
    await db.query("insert into faolla_checkout_design.bundle_results values($1,$2,$3,'order',$4,$5)",
      [site, op, `account:${f.principal.accountId}:${f.principal.userId}`, order.id,
        JSON.stringify({ resourceTerms: { items: order.items, totalQuantity: order.totalQuantity, totalAmount: order.totalAmount } })]);
    const definitions = async () => (await db.query("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','faolla_checkout_design') and p.prokind='f' and p.proname<>'guard_legacy_checkout_order_rewards' order by name")).rows;
    const originalDefinitions = await definitions(), ddl = await fs.readFile(path.resolve("database/proposals/20261124_member_checkout_legacy_order_rewards.sql"), "utf8");
    const statements = ddl.replace(/^--.*$/gm, "");
    assert.ok(!/\bGRANT\s|CREATE\s+OR\s+REPLACE|set_config|DISABLE\s+TRIGGER|DROP\s|ALTER\s/i.test(statements));
    assert.equal((statements.match(/SECURITY DEFINER/g) ?? []).length, 1);
    await db.exec(ddl);
    const state = async () => (await db.query("select to_jsonb(p) value from pages p order by id")).rows;
    const cas = (mutation: unknown) => db.query("select public.faolla_commit_order_membership_v1($1,$2)", [site, mutation]);
    const memberRow = (await db.query<{ updated_at: Date }>("select updated_at from pages where slug=$1", [`__merchant_memberships__:${site}`])).rows[0];
    const prepared = await prepareMerchantMembershipPointsForOrderTransitions([{ previous: order, next: completed }], {
      loadMemberships: async () => ({ siteId: site, memberships: [f.member], updatedAt: memberRow.updated_at.toISOString() }),
      loadSettings: async () => f.settings, now: () => new Date().toISOString(),
    });
    assert.ok(prepared); assert.equal(prepared.mutation.next[0].pointBalance, f.member.pointBalance + 20);
    const rows = (await db.query("select id,slug,blocks,updated_at from pages where slug=$1", [`__merchant_orders__:${site}`])).rows;
    await t.test("actual old preparer plus order/member CAS rolls back the extra reward and all history", async () => {
      const before = await state();
      await assert.rejects(cas({ orders: { expectedRows: rows, next: [completed] }, memberships: prepared.mutation }), /checkout_resource_locked/);
      assert.deepEqual(await state(), before);
    });
    await t.test("membership-only writes and reversal markers cannot bypass the unchanged order", async () => {
      const before = await state();
      await assert.rejects(cas({ memberships: prepared.mutation }), /checkout_resource_locked/);
      const reversal = structuredClone(prepared.mutation);
      reversal.next[0].transactions[0].note = "Synthetic reversal";
      reversal.next[0].transactions[0].cancellationOperationMarker = `[order-points-reversal:${order.id}]`;
      await assert.rejects(cas({ memberships: reversal }), /checkout_resource_locked/);
      assert.deepEqual(await state(), before);
    });
    await t.test("ordinary reward markers at a checkout merchant still use the real old CAS successfully", async () => {
      const ordinary = structuredClone(prepared.mutation);
      ordinary.next[0].transactions[0].note = "Synthetic ordinary gift [order-points:O-ordinary]";
      await cas({ memberships: ordinary });
      assert.deepEqual((await db.query<{ blocks: unknown }>("select blocks from pages where slug=$1", [`__merchant_memberships__:${site}`])).rows[0].blocks, ordinary.next);
      assert.deepEqual((await db.query<{ blocks: unknown }>("select blocks from pages where slug=$1", [`__merchant_orders__:${site}`])).rows[0].blocks, [order]);
    });
    await t.test("unchanged historical markers may reorder but cannot be edited, removed, duplicated or moved to another member", async () => {
      const member = structuredClone(prepared.mutation.next[0]);
      member.transactions[0].note = "Synthetic ordinary gift [order-points:O-ordinary]";
      const slug = `__merchant_memberships__:${site}`;
      await db.query("update pages set blocks=$1 where slug=$2", [JSON.stringify([{ ...member, transactions: [...member.transactions].reverse() }]), slug]);
      for (const mode of ["edit", "remove", "duplicate", "move"] as const) {
        const altered = structuredClone(member), legacy = altered.transactions[1];
        if (mode === "edit") legacy.pointDelta++;
        if (mode === "remove") altered.transactions.pop();
        if (mode === "duplicate") altered.transactions.push(structuredClone(legacy));
        if (mode === "move") altered.id = "different-member";
        const before = await state();
        await assert.rejects(db.query("update pages set blocks=$1 where slug=$2", [JSON.stringify([altered]), slug]), /checkout_resource_locked/);
        assert.deepEqual(await state(), before);
      }
    });
    await t.test("unlinked merchant rewards and a membership page with no marker changes are not frozen", async () => {
      const member = structuredClone(f.member); member.siteId = "10909993";
      member.transactions = structuredClone(prepared.mutation.next[0].transactions);
      await db.query("insert into pages(merchant_id,slug,blocks) values($1,$2,$3)", [member.siteId, `__merchant_memberships__:${member.siteId}`, JSON.stringify([member])]);
      await db.query("update pages set blocks=blocks where slug=$1", [`__merchant_memberships__:${site}`]);
    });
    await t.test("trigger capability is not granted to API roles and every old function definition stays exact", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) assert.equal((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'faolla_checkout_design.guard_legacy_checkout_order_rewards()','EXECUTE') allowed", [role])).rows[0].allowed, false);
      assert.deepEqual(await definitions(), originalDefinitions);
      await db.exec("create role synthetic_reward_guard_without_bypass nologin;grant usage,create on schema faolla_checkout_design to synthetic_reward_guard_without_bypass;alter function faolla_checkout_design.guard_legacy_checkout_order_rewards() owner to synthetic_reward_guard_without_bypass;");
      const before = await state();
      await assert.rejects(db.query("update pages set blocks=blocks where slug=$1", [`__merchant_memberships__:${site}`]), /checkout_resource_locked/);
      assert.deepEqual(await state(), before);
    });
  } finally { await db.close(); }
});
