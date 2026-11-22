import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { buildConfiguredCheckoutOffer, type CheckoutConfigurationEdit, type CheckoutConfigurationOptions } from "./merchantCheckoutConfiguration";

test("private configuration proposal is versioned, append-only, scoped and API-denied", { timeout: 60000 }, async t => {
  const db = new PGlite(), site = "10909095", id = "12345678-1234-4234-8234-123456789abc", revision = "87654321-4321-4321-8321-cba987654321", version = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
  const options: CheckoutConfigurationOptions = { sources: [{ key: "a".repeat(64), sourceVersion: "b".repeat(64), title: "Synthetic play", kind: "booking", viewport: "mobile", blockId: "booking-test", store: "Synthetic", item: "Play", cashMinor: null }], stockItems: [], vouchers: [] };
  const edit: CheckoutConfigurationEdit = { offerId: null, sourceKey: options.sources[0].key, sourceVersion: options.sources[0].sourceVersion,
    title: "Synthetic play", enabled: false, cashMinor: 10000, unitPoints: 500, allowOnSite: true, maxQuantity: 1, timeZone: "Europe/Madrid", stockItemId: null, voucherCouponIds: [], durationMinutes: 60,
    pointsReturnOnCancel: true, couponReturnOnCancel: false, cancellationAdvanceMinutes: 60 };
  const offer = buildConfiguredCheckoutOffer({ siteId: site, edit, options, current: { version: null, offers: [] }, newId: id, newRevision: revision });
  const snapshot = async () => (await db.query<{ result: unknown }>("select public.faolla_member_checkout_catalog_snapshot_v1($1) as result", [site])).rows[0].result;
  const save = async (next: string, previous: string | null, value = offer, actor = "owner:synthetic-owner") => (await db.query<{ result: { version: string; offers: typeof offer[] } }>(
    "select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5) as result", [site, previous, next, actor, JSON.stringify(value)])).rows[0].result;
  try {
    await db.exec("create role anon;create role authenticated;create role service_role;");
    for (const file of ["database/proposals/20261122_member_checkout_design.sql", "database/proposals/20261122_member_checkout_catalog.sql"]) await db.exec(await readFile(path.resolve(file), "utf8"));
    await t.test("missing config is an explicit empty snapshot; first save is durable and repeat returns original result", async () => {
      assert.deepEqual(await snapshot(), { version: null, offers: [] });
      const first = await save(version, null); assert.equal(first.version, version); assert.deepEqual(first.offers, [offer]);
      assert.deepEqual(await save(version, null), first);
      assert.equal((await db.query<{ count: number }>("select count(*)::int as count from faolla_checkout_design.offer_versions")).rows[0].count, 1);
    });
    await t.test("stale edits and identity-mismatched operation replay cannot overwrite a config", async () => {
      const before = await snapshot();
      await assert.rejects(save("22222222-2222-4222-8222-222222222222", null), /checkout_configuration_conflict/);
      await assert.rejects(save(version, null, offer, "owner:different-owner"), /checkout_configuration_conflict/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("editing adds a new quote version without changing historical price or return policy", async () => {
      const next = { ...offer, revision: "33333333-3333-4333-8333-333333333333", unitPoints: 800, couponReturnOnCancel: true };
      await save("44444444-4444-4444-8444-444444444444", version, next);
      const historical = await db.query<{ snapshot: typeof offer }>("select snapshot from faolla_checkout_design.offer_versions where revision=$1", [revision]);
      assert.equal(historical.rows[0].snapshot.unitPoints, 500); assert.equal(historical.rows[0].snapshot.couponReturnOnCancel, false);
      assert.equal((await db.query<{ count: number }>("select count(*)::int as count from faolla_checkout_design.catalog_versions")).rows[0].count, 2);
      assert.deepEqual((await save(version, null)).offers, [offer], "old operation receipt remains original even after a later edit");
    });
    await t.test("a duplicate source or source rebind cannot leave a partial new offer version", async () => {
      const currentVersion = "44444444-4444-4444-8444-444444444444", before = await snapshot();
      const fresh = "55555555-5555-4555-8555-555555555555";
      await assert.rejects(save(fresh, currentVersion, { ...offer, id: fresh, revision: fresh }), /checkout_source_already_configured/);
      await assert.rejects(save(fresh, currentVersion, { ...offer, revision: fresh, checkoutBinding: { ...offer.checkoutBinding, sourceKey: "c".repeat(64) } }), /checkout_source_rebinding_forbidden/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("history cannot be rewritten and another merchant cannot read these offers", async () => {
      await assert.rejects(db.exec("delete from faolla_checkout_design.catalog_versions"), /checkout_history_immutable/);
      const other = await db.query<{ result: unknown }>("select public.faolla_member_checkout_catalog_snapshot_v1('10909096') as result");
      assert.deepEqual(other.rows[0].result, { version: null, offers: [] });
    });
    await t.test("new functions are security-invoker and all browser/API roles are denied until a separate rollout", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await db.exec(`set role ${role}`);
        try { await assert.rejects(snapshot(), /permission denied/); await assert.rejects(save("66666666-6666-4666-8666-666666666666", null), /permission denied/); }
        finally { await db.exec("reset role"); }
      }
      assert.equal((await db.query("select 1 from pg_proc where proname like 'faolla_member_checkout_catalog_%' and prosecdef")).rows.length, 0);
    });
  } finally { await db.close(); }
});
