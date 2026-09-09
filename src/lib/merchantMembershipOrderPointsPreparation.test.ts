import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantOrder, type MerchantOrderRecord } from "./merchantOrders";
import { normalizeMerchantMembershipRecord, type MerchantMembershipRecord } from "./merchantMemberships";
import { createEmptyMerchantMembershipSettings } from "./merchantMembershipSettings";
import {
  awardOrderPointsToMembership,
  prepareMerchantMembershipPointsForOrderTransitions,
  syncMerchantMembershipPointsForOrderTransitions,
  type PreparedMerchantMembershipOrderPoints,
} from "./merchantMemberships.server";

const SITE_ID = "10000000";
const VERSION = "2026-09-08T10:00:00.000Z";
const NOW = "2026-09-08T10:01:00.000Z";

function fixture() {
  const membership = normalizeMerchantMembershipRecord({
    id: "membership-1", siteId: SITE_ID, siteName: "Merchant", memberNo: "10000000000001",
    serial: 1, accountId: "account-1", userId: "user-1", email: "member@example.test",
    status: "active", joinedAt: VERSION, updatedAt: VERSION, pointBalance: 0, growthValue: 0, transactions: [],
  });
  assert.ok(membership);
  const settings = createEmptyMerchantMembershipSettings(SITE_ID);
  settings.pointsRules.paidAmount = 1;
  settings.pointsRules.paidPoints = 1;
  settings.growthRules.spendAmountGrowth = 1;
  const previous = createMerchantOrder({
    siteId: SITE_ID, customerAccountId: "account-1",
    items: [{ productId: "p1", name: "Product", quantity: 1, unitPrice: 100 }],
  }, { id: "order-1", createdAt: VERSION, updatedAt: VERSION });
  previous.status = "confirmed";
  const next: MerchantOrderRecord = { ...previous, status: "completed", completedAt: NOW, updatedAt: NOW };
  return { membership, settings, previous, next };
}

function dependencies(memberships: MerchantMembershipRecord[], settings = fixture().settings) {
  const calls: string[] = [];
  return {
    calls,
    overrides: {
      loadMemberships: async (siteId: string) => {
        assert.equal(siteId, SITE_ID);
        calls.push("read-memberships");
        return { siteId, memberships, updatedAt: VERSION };
      },
      loadSettings: async (siteId: string) => {
        assert.equal(siteId, SITE_ID);
        calls.push("read-settings");
        return settings;
      },
      now: () => NOW,
    },
  };
}

test("order point preparation reads and computes without persisting or mutating its source", async () => {
  const { membership, settings, previous, next } = fixture();
  const original = structuredClone({ membership, settings, previous, next });
  const deps = dependencies([membership], settings);
  const prepared = await prepareMerchantMembershipPointsForOrderTransitions([{ previous, next }], deps.overrides);
  assert.ok(prepared);
  assert.equal(prepared.mutation.expectedUpdatedAt, VERSION);
  assert.equal(prepared.mutation.next[0].pointBalance, 100);
  assert.equal(prepared.mutation.next[0].growthValue, 100);
  assert.match(prepared.mutation.next[0].transactions[0].note, /\[order-points:order-1\]/);
  assert.equal(prepared.previousMemberships[0].pointBalance, 0);
  assert.deepEqual({ membership, settings, previous, next }, original);
  assert.deepEqual(deps.calls, ["read-memberships", "read-settings"]);
});

test("orders without a completed-state boundary require no membership reads or writes", async () => {
  const { previous } = fixture();
  const prepared = await prepareMerchantMembershipPointsForOrderTransitions([
    { previous, next: { ...previous, status: "cancelled" } },
  ], {
    loadMemberships: async () => { throw new Error("unexpected_read"); },
    loadSettings: async () => { throw new Error("unexpected_settings"); },
  });
  assert.equal(prepared, null);
});

test("missing membership document still produces an explicit absence CAS snapshot", async () => {
  const { previous, next } = fixture();
  assert.deepEqual(await prepareMerchantMembershipPointsForOrderTransitions([{ previous, next }], {
    loadMemberships: async () => null,
    loadSettings: async () => { throw new Error("no_matching_member_needs_no_settings"); },
  }), { mutation: { expectedUpdatedAt: null, next: [] }, previousMemberships: [] });
});

test("inactive or unmatched membership keeps its version for join/reactivation races", async () => {
  const { membership, previous, next } = fixture();
  for (const member of [
    { ...membership, status: "left" as const },
    { ...membership, accountId: "another-account" },
  ]) {
    const deps = dependencies([member]);
    const prepared = await prepareMerchantMembershipPointsForOrderTransitions([{ previous, next }], deps.overrides);
    assert.ok(prepared);
    assert.equal(prepared.mutation.expectedUpdatedAt, VERSION);
    assert.equal(prepared.mutation.next[0].pointBalance, 0);
    assert.deepEqual(prepared.mutation.next, prepared.previousMemberships);
    assert.deepEqual(deps.calls, ["read-memberships"]);
  }
});

test("existing award and duplicate completed transitions do not duplicate points", async () => {
  const { membership, settings, previous, next } = fixture();
  const duplicate = await prepareMerchantMembershipPointsForOrderTransitions([
    { previous, next }, { previous, next },
  ], dependencies([membership], settings).overrides);
  assert.equal(duplicate?.mutation.next[0].pointBalance, 100);
  assert.equal(duplicate?.mutation.next[0].transactions.length, 1);
  const awarded = awardOrderPointsToMembership({ membership, order: next, settings, now: NOW });
  const noChange = await prepareMerchantMembershipPointsForOrderTransitions([{ previous, next }], dependencies([awarded], settings).overrides);
  assert.ok(noChange);
  assert.equal(noChange.mutation.expectedUpdatedAt, VERSION);
  assert.deepEqual(noChange.mutation.next, noChange.previousMemberships);
});

test("preparation preserves zero-point growth-only awards and exact reversal amounts", async () => {
  const { membership, settings, previous, next } = fixture();
  settings.pointsRules.paidPoints = 0;
  const growth = await prepareMerchantMembershipPointsForOrderTransitions([{ previous, next }], dependencies([membership], settings).overrides);
  assert.equal(growth?.mutation.next[0].pointBalance, 0);
  assert.equal(growth?.mutation.next[0].growthValue, 100);
  const reversal = await prepareMerchantMembershipPointsForOrderTransitions([
    { previous: next, next: previous },
  ], dependencies(growth!.mutation.next, settings).overrides);
  assert.equal(reversal?.mutation.next[0].pointBalance, 0);
  assert.equal(reversal?.mutation.next[0].growthValue, 0);
  settings.pointsRules.paidPoints = 1;
  const awarded = awardOrderPointsToMembership({ membership, order: next, settings, now: NOW });
  settings.pointsRules.paidPoints = 10;
  const reversed = await prepareMerchantMembershipPointsForOrderTransitions([
    { previous: next, next: previous },
  ], dependencies([awarded], settings).overrides);
  assert.equal(reversed?.mutation.next[0].pointBalance, 0);
  const reawarded = await prepareMerchantMembershipPointsForOrderTransitions([{ previous, next }], dependencies(reversed!.mutation.next, settings).overrides);
  assert.equal(reawarded?.mutation.next[0].pointBalance, 1000);
});

test("cross-site completed transitions reject before any read", async () => {
  const { previous, next } = fixture();
  await assert.rejects(prepareMerchantMembershipPointsForOrderTransitions([
    { previous, next: { ...next, siteId: "20000000" } },
  ], { loadMemberships: async () => { throw new Error("unexpected_read"); } }), /invalid_site_id/);
});

test("read and settings failures are propagated without a partial prepared result", async () => {
  const { membership, previous, next } = fixture();
  await assert.rejects(prepareMerchantMembershipPointsForOrderTransitions([{ previous, next }], {
    loadMemberships: async () => { throw new Error("membership_read_failed"); },
  }), /membership_read_failed/);
  await assert.rejects(prepareMerchantMembershipPointsForOrderTransitions([{ previous, next }], {
    ...dependencies([membership]).overrides,
    loadSettings: async () => { throw new Error("settings_read_failed"); },
  }), /settings_read_failed/);
});

test("insufficient reversal during a batch does not mutate earlier prepared awards", async () => {
  const { membership, settings, previous, next } = fixture();
  const spent = { ...awardOrderPointsToMembership({ membership, order: next, settings, now: NOW }), pointBalance: 50 };
  const otherMember = { ...membership, id: "membership-2", accountId: "account-2", memberNo: "10000000000002", serial: 2 };
  const sourceMemberships = [spent, otherMember];
  const original = structuredClone(sourceMemberships);
  const earlierOrder = { ...next, id: "order-2", customerAccountId: "account-2" };
  await assert.rejects(prepareMerchantMembershipPointsForOrderTransitions([
    { previous: { ...earlierOrder, status: "confirmed" }, next: earlierOrder },
    { previous: next, next: previous },
  ], dependencies(sourceMemberships, settings).overrides), /membership_recharge_cancel_balance_insufficient/);
  assert.deepEqual(sourceMemberships, original);
});

test("standalone point sync reparses a fresh snapshot on CAS conflict, at most three attempts", async () => {
  const { previous, next } = fixture();
  let preparations = 0;
  const versions: (string | null)[] = [];
  const result = await syncMerchantMembershipPointsForOrderTransitions([{ previous, next }], {
    prepare: async () => {
      preparations += 1;
      return { mutation: { expectedUpdatedAt: `version-${preparations}`, next: [] }, previousMemberships: [] };
    },
    save: async (siteId, prepared) => {
      assert.equal(siteId, SITE_ID);
      versions.push(prepared.mutation.expectedUpdatedAt);
      return { error: versions.length < 3 ? "merchant_memberships_conflict" : null };
    },
  });
  assert.deepEqual(result, []);
  assert.equal(preparations, 3);
  assert.deepEqual(versions, ["version-1", "version-2", "version-3"]);
});

test("standalone sync never retries ambiguous failures or runs inverse compensation", async () => {
  const { previous, next } = fixture();
  const prepared: PreparedMerchantMembershipOrderPoints = {
    mutation: { expectedUpdatedAt: VERSION, next: [] }, previousMemberships: [],
  };
  for (const error of ["merchant_transaction_unavailable", "merchant_memberships_conflict"]) {
    let saves = 0;
    await assert.rejects(syncMerchantMembershipPointsForOrderTransitions([{ previous, next }], {
      prepare: async (transitions) => { assert.deepEqual(transitions, [{ previous, next }]); return prepared; },
      save: async () => { saves += 1; return { error }; },
    }), new RegExp(error));
    assert.equal(saves, error === "merchant_memberships_conflict" ? 3 : 1);
  }
});
