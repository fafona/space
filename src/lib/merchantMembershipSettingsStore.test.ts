import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyMerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import {
  loadStoredMerchantMembershipSettings,
  saveStoredMerchantMembershipSettings,
  type MerchantMembershipSettingsStoreClient,
} from "@/lib/merchantMembershipSettingsStore";

const siteId = "10000000";
const previousStamp = "2026-09-08T10:00:00.000Z";
const databaseStamp = "2026-09-08T10:00:00.123456+00:00";
const settings = createEmptyMerchantMembershipSettings(siteId);

function readClient(result: { data?: unknown; error?: unknown }): MerchantMembershipSettingsStoreClient {
  const pending = Promise.resolve(result);
  const query = {
    select() { return query; },
    eq() { return query; },
    then: pending.then.bind(pending),
  };
  return { from: () => query };
}

test("settings save sends its original explicit revision to the shared RPC without a fresh read or direct write", async () => {
  let calls = 0;
  const result = await saveStoredMerchantMembershipSettings({
    from: () => { assert.fail("Settings saves must not read again or directly write pages/history"); },
    rpc: async (name, args) => {
      calls += 1;
      assert.equal(name, "faolla_commit_redemption_v1");
      assert.equal(args.p_site_id, siteId);
      const mutation = args.p_mutation as { settings: { expectedUpdatedAt: string; next: typeof settings } };
      assert.equal(mutation.settings.expectedUpdatedAt, previousStamp);
      assert.equal(mutation.settings.next.siteId, siteId);
      return { data: { updatedAt: databaseStamp, replayed: false, versions: { settings: databaseStamp } }, error: null };
    },
  }, { siteId, settings, expectedUpdatedAt: previousStamp, updatedAt: "2026-09-08T00:00:00.000Z" });
  assert.deepEqual(result, { error: null, updatedAt: databaseStamp });
  assert.equal(calls, 1);
});

test("settings save refuses an omitted or undefined expected version before calling the backend", async () => {
  const client: MerchantMembershipSettingsStoreClient = {
    from: () => assert.fail("No reads/writes are permitted without a caller snapshot"),
    rpc: async () => assert.fail("No unversioned RPC is permitted"),
  };
  assert.deepEqual(await saveStoredMerchantMembershipSettings(client, { siteId, settings }),
    { error: "merchant_membership_settings_conflict" });
  assert.deepEqual(await saveStoredMerchantMembershipSettings(client, { siteId, settings, expectedUpdatedAt: undefined }),
    { error: "merchant_membership_settings_conflict" });
});

test("first settings creation preserves an explicit null absence guard", async () => {
  const result = await saveStoredMerchantMembershipSettings({
    from: () => assert.fail("No read can replace the absence snapshot"),
    rpc: async (_name, args) => {
      assert.equal((args.p_mutation as { settings: { expectedUpdatedAt: unknown } }).settings.expectedUpdatedAt, null);
      return { data: { updatedAt: databaseStamp, replayed: false, versions: { settings: databaseStamp } }, error: null };
    },
  }, { siteId, settings, expectedUpdatedAt: null });
  assert.equal(result.error, null);
});

test("settings conflicts stay conflicts and a missing RPC never falls back to direct pages writes", async () => {
  const forbiddenRead = () => assert.fail("There is no legacy direct write fallback");
  const conflict = await saveStoredMerchantMembershipSettings({ from: forbiddenRead,
    rpc: async () => ({ data: null, error: { message: "merchant_membership_settings_conflict" } }),
  }, { siteId, settings, expectedUpdatedAt: previousStamp });
  assert.deepEqual(conflict, { error: "merchant_membership_settings_conflict" });
  const missing = await saveStoredMerchantMembershipSettings({ from: forbiddenRead },
    { siteId, settings, expectedUpdatedAt: previousStamp });
  assert.deepEqual(missing, { error: "merchant_transaction_unavailable" });
});

test("settings reads report backend failures instead of creating default empty settings", async () => {
  await assert.rejects(loadStoredMerchantMembershipSettings(readClient({ data: null,
    error: { message: "network_unavailable" },
  }), siteId), /merchant_membership_settings_read_failed:network_unavailable/);
  await assert.rejects(loadStoredMerchantMembershipSettings(readClient({ data: { unexpected: true }, error: null }), siteId),
    /merchant_membership_settings_read_failed:invalid_rows/);
});

test("settings reads preserve the physical database timestamp rather than stale blocks.updatedAt", async () => {
  const loaded = await loadStoredMerchantMembershipSettings(readClient({ data: [{
    id: "00000000-0000-4000-8000-000000000001", slug: `__merchant_membership_settings__:${siteId}`,
    blocks: { ...settings, updatedAt: previousStamp }, updated_at: databaseStamp,
  }], error: null }), siteId);
  assert.equal(loaded?.updatedAt, databaseStamp);
});
