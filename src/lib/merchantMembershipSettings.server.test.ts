import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyMerchantMembershipSettings,
  normalizeMerchantMembershipSettings,
  type MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";
import {
  releaseMerchantMembershipRedemptionStock,
  reserveMerchantMembershipRedemptionStock,
  updateMerchantMembershipPrintSettings,
  updateMerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings.server";
import type { MerchantMembershipSettingsStoreClient } from "@/lib/merchantMembershipSettingsStore";

const siteId = "10000000";
const originalStamp = "2026-09-08T10:00:00.000Z";

function fixture(input?: { onRead?: () => void; firstConflict?: boolean }) {
  let settings = normalizeMerchantMembershipSettings(siteId, {
    ...createEmptyMerchantMembershipSettings(siteId), updatedAt: originalStamp,
    redemptionItems: [{ id: "item-1", name: "Synthetic item", enabled: true, pointsCost: 10, stock: 5 }],
  });
  let stamp = originalStamp;
  let calls = 0;
  const client: MerchantMembershipSettingsStoreClient = {
    from: () => {
      input?.onRead?.();
      const pending = Promise.resolve({ data: [{ id: "00000000-0000-4000-8000-000000000001",
        slug: `__merchant_membership_settings__:${siteId}`, blocks: structuredClone(settings), updated_at: stamp,
      }], error: null });
      const query = { select() { return query; }, eq() { return query; }, then: pending.then.bind(pending) };
      return query;
    },
    rpc: async (name, args) => {
      calls += 1;
      assert.equal(name, "faolla_commit_redemption_v1");
      const mutation = args.p_mutation as { settings: { expectedUpdatedAt: string | null; next: MerchantMembershipSettings } };
      if ((input?.firstConflict && calls === 1) || mutation.settings.expectedUpdatedAt !== stamp) {
        stamp = new Date(Date.parse(stamp) + 1).toISOString();
        return { data: null, error: { message: "merchant_membership_settings_conflict" } };
      }
      settings = structuredClone(mutation.settings.next);
      stamp = new Date(Date.parse(stamp) + 1).toISOString();
      return { data: { updatedAt: stamp, replayed: false, versions: { settings: stamp } }, error: null };
    },
  };
  return { client, calls: () => calls, current: () => ({ ...settings, updatedAt: stamp }) };
}

test("admin settings rejects omitted and stale browser versions without writing", async () => {
  const mock = fixture();
  await assert.rejects(updateMerchantMembershipSettings({ siteId, settings: mock.current(), view: "redemptionItems" }, mock.client),
    /merchant_membership_settings_conflict/);
  await assert.rejects(updateMerchantMembershipSettings({ siteId, settings: mock.current(), view: "redemptionItems",
    expectedUpdatedAt: "2026-09-07T00:00:00.000Z",
  }, mock.client), /merchant_membership_settings_conflict/);
  assert.equal(mock.calls(), 0);
});

test("admin settings reauthorizes after reading/preparing and before the commit", async () => {
  let authorized = true;
  let assertions = 0;
  const mock = fixture({ onRead: () => { authorized = false; } });
  await assert.rejects(updateMerchantMembershipSettings({ siteId, settings: mock.current(), view: "redemptionItems",
    expectedUpdatedAt: originalStamp,
    assertAuthorizationCurrent: async () => {
      assertions += 1;
      if (!authorized) throw new Error("permission_denied");
    },
  }, mock.client), /permission_denied/);
  assert.equal(assertions, 2);
  assert.equal(mock.calls(), 0);
});

test("admin settings returns the real committed version for the next browser save", async () => {
  const mock = fixture();
  const first = await updateMerchantMembershipSettings({ siteId, settings: mock.current(), view: "redemptionItems",
    expectedUpdatedAt: originalStamp,
  }, mock.client);
  assert.equal(first.updatedAt, "2026-09-08T10:00:00.001Z");
  const second = await updateMerchantMembershipSettings({ siteId, settings: first, view: "redemptionItems",
    expectedUpdatedAt: first.updatedAt,
  }, mock.client);
  assert.equal(second.updatedAt, "2026-09-08T10:00:00.002Z");
  assert.equal(mock.calls(), 2);
});

test("print settings reauthorizes before each CAS retry and returns the physical revision", async () => {
  const mock = fixture({ firstConflict: true });
  let assertions = 0;
  const saved = await updateMerchantMembershipPrintSettings({ siteId, printSettings: { copies: 2 },
    assertAuthorizationCurrent: async () => { assertions += 1; },
  }, mock.client);
  assert.equal(mock.calls(), 2);
  assert.equal(assertions, 3); // Enter process lock, then each actual commit attempt.
  assert.equal(saved.updatedAt, "2026-09-08T10:00:00.002Z");
  assert.equal(saved.redemptionItems[0]?.stock, 5);
});

test("print revocation after preparation blocks the first write", async () => {
  let authorized = true;
  const mock = fixture({ onRead: () => { authorized = false; } });
  await assert.rejects(updateMerchantMembershipPrintSettings({ siteId, printSettings: { copies: 2 },
    assertAuthorizationCurrent: async () => { if (!authorized) throw new Error("permission_denied"); },
  }, mock.client), /permission_denied/);
  assert.equal(mock.calls(), 0);
});

test("stock reserve/release use versioned shared commits and return physical revisions", async () => {
  const mock = fixture();
  const reserved = await reserveMerchantMembershipRedemptionStock({ siteId, operationId: "test-stock-1",
    deltas: [{ itemId: "item-1", quantity: 2 }], expectedUpdatedAt: originalStamp,
  }, mock.client);
  assert.equal(reserved.redemptionItems[0]?.stock, 3);
  assert.equal(reserved.updatedAt, "2026-09-08T10:00:00.001Z");
  const released = await releaseMerchantMembershipRedemptionStock({ siteId, operationId: "test-stock-1",
    deltas: [{ itemId: "item-1", quantity: 2 }],
  }, mock.client);
  assert.equal(released.redemptionItems[0]?.stock, 5);
  assert.equal(released.updatedAt, "2026-09-08T10:00:00.002Z");
  assert.equal(mock.calls(), 2);
});
