import test from "node:test";
import assert from "node:assert/strict";
import { joinMerchantMembership, leaveMerchantMembership } from "./merchantMemberships.server";
import { normalizeMerchantMembershipRecord, type MerchantMembershipRecord } from "./merchantMemberships";
import type { StoredMerchantMemberships } from "./merchantMembershipsStore";
import type { PersonalAccountSession } from "./personalAccountSession.server";
import { createEmptyMerchantMembershipSettings } from "./merchantMembershipSettings";

function fixture() {
  const initial = normalizeMerchantMembershipRecord({ id: "99990001:50010105", siteId: "99990001", accountId: "50010105", userId: "synthetic-user", joinedAt: "2026-01-01", pointBalance: 80, balanceAmount: 25,
    transactions: [{ id: "original", type: "recharge", at: "2026-01-01", pointDelta: 80, note: "original credit" }] })!;
  let stored: StoredMerchantMemberships = { siteId: initial.siteId, memberships: [initial], updatedAt: "2026-01-01" };
  let failMetadata = false, forceConflict = false, writes = 0;
  const profile = { nickname: "Synthetic visitor", name: "Synthetic visitor", phone: "000", email: "visitor@example.invalid", birthday: "01-01", birthdayMonthDayOnly: true };
  const session = { accountId: initial.accountId, userId: initial.userId, email: profile.email, user: { id: initial.userId, user_metadata: { personal_profile: { ...profile, favoriteSites: [] }, unrelated: { order: "ORIGINAL" } } } } as unknown as PersonalAccountSession;
  session.adminSupabase = { auth: { admin: { updateUserById: async (_id: string, patch: { user_metadata: Record<string,unknown> }) => {
    if (failMetadata) { failMetadata = false; return { error: new Error("synthetic metadata outage") }; }
    session.user.user_metadata = patch.user_metadata; return { error: null };
  } } } } as unknown as PersonalAccountSession["adminSupabase"];
  const dependencies: NonNullable<Parameters<typeof joinMerchantMembership>[1]> = {
    client: () => ({}) as ReturnType<NonNullable<Parameters<typeof joinMerchantMembership>[1]>["client"]>, settings: async () => null,
    load: async () => structuredClone(stored),
    save: async (_client, next) => {
      if (forceConflict || next.expectedUpdatedAt !== stored.updatedAt) return { error: "merchant_memberships_conflict" };
      stored = { siteId: next.siteId, memberships: structuredClone(next.memberships), updatedAt: next.updatedAt ?? null }; writes++; return { error: null };
    },
  };
  const favorite = { id: initial.siteId, name: "Venue", url: `https://faolla.com/site/${initial.siteId}`, subtitle: "", addedAt: "2026-11-13" };
  return { initial, session, dependencies, profile, favorite, stored: () => stored, writes: () => writes,
    failMetadata: () => { failMetadata = true; }, conflict: () => { forceConflict = true; } };
}
function finances(member: MerchantMembershipRecord) { return { points: member.pointBalance, balance: member.balanceAmount, transactions: member.transactions }; }
test("actual join/leave implementation projects favorites and preserves balances, transactions and member identity on rejoin", async () => {
  const f = fixture(), input = { siteId: f.initial.siteId, siteName: "Venue", session: f.session, profile: f.profile, favorite: f.favorite };
  const joined = await joinMerchantMembership(input, f.dependencies);
  assert.deepEqual(finances(joined), finances(f.initial));
  assert.deepEqual((f.session.user.user_metadata?.personal_profile as { favoriteSites: unknown }).favoriteSites, [f.favorite]);
  const left = await leaveMerchantMembership({ siteId: input.siteId, session: f.session, removeFavorite: true }, f.dependencies);
  assert.equal(left.status, "left"); assert.deepEqual(finances(left), finances(f.initial));
  assert.deepEqual((f.session.user.user_metadata?.personal_profile as { favoriteSites: unknown }).favoriteSites, []);
  const rejoined = await joinMerchantMembership(input, f.dependencies);
  assert.equal(rejoined.id, f.initial.id); assert.equal(f.stored().memberships.length, 1); assert.deepEqual(finances(rejoined), finances(f.initial));
  assert.deepEqual(f.session.user.user_metadata?.unrelated, { order: "ORIGINAL" });
});
test("partial metadata failures remain retryable: no duplicate member, no second leave write, no history deletion", async () => {
  const f = fixture(), input = { siteId: f.initial.siteId, siteName: "Venue", session: f.session, profile: f.profile, favorite: f.favorite };
  f.failMetadata(); await assert.rejects(joinMerchantMembership(input, f.dependencies), /synthetic metadata outage/);
  await joinMerchantMembership(input, f.dependencies); assert.equal(f.stored().memberships.length, 1);
  f.failMetadata(); await assert.rejects(leaveMerchantMembership({ siteId: input.siteId, session: f.session, removeFavorite: true }, f.dependencies));
  const writes = f.writes();
  const left = await leaveMerchantMembership({ siteId: input.siteId, session: f.session, removeFavorite: true }, f.dependencies);
  assert.equal(f.writes(), writes); assert.deepEqual(finances(left), finances(f.initial));
  assert.deepEqual((f.session.user.user_metadata?.personal_profile as { favoriteSites: unknown }).favoriteSites, []);
});
test("version conflicts never silently confirm a favorite or update metadata", async () => {
  const f = fixture(), before = structuredClone(f.session.user.user_metadata); f.conflict();
  await assert.rejects(joinMerchantMembership({ siteId: f.initial.siteId, siteName: "Venue", session: f.session, profile: f.profile, favorite: f.favorite }, f.dependencies), /merchant_memberships_conflict/);
  assert.deepEqual(f.session.user.user_metadata, before); assert.equal(f.writes(), 0);
});
test("an interrupted favorite retry or later rejoin cannot award the join gift twice", async () => {
  const f = fixture();
  const settings = createEmptyMerchantMembershipSettings(f.initial.siteId); settings.pointsRules.joinPoints = 10;
  f.dependencies.settings = async () => settings;
  const input = { siteId: f.initial.siteId, siteName: "Venue", session: f.session, profile: f.profile, favorite: f.favorite };
  f.failMetadata(); await assert.rejects(joinMerchantMembership(input, f.dependencies));
  const retried = await joinMerchantMembership(input, f.dependencies);
  assert.equal(retried.pointBalance, 90); assert.equal(retried.transactions.filter(row => row.note.includes("[join-points]")).length, 1);
  await leaveMerchantMembership({ siteId: input.siteId, session: f.session, removeFavorite: true }, f.dependencies);
  const rejoined = await joinMerchantMembership(input, f.dependencies);
  assert.equal(rejoined.pointBalance, 90); assert.equal(rejoined.balanceAmount, 25);
  assert.equal(rejoined.transactions.filter(row => row.note.includes("[join-points]")).length, 1);
});
