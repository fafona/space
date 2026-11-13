import test from "node:test";
import assert from "node:assert/strict";
import { handleFavoriteMutation, handleFavoriteRead, favoriteDependencies } from "./route-handler";
import type { PersonalAccountSession } from "@/lib/personalAccountSession.server";
import { normalizeMerchantMembershipRecord } from "@/lib/merchantMemberships";

const origin = "https://launch.faolla.com", siteId = "10909095";
const member = normalizeMerchantMembershipRecord({ siteId, accountId: "50010105", joinedAt: "2026-01-01", pointBalance: 80, balanceAmount: 25, transactions: [{ id: "original", type: "recharge", at: "2026-01-01", pointDelta: 80 }] })!;
const session = { accountId: "50010105", userId: "synthetic-user", email: "visitor@example.invalid", user: { id: "synthetic-user", user_metadata: { personal_profile: { favoriteSites: [{ id: "legacy-domain", url: "https://cyberspace.faolla.com", name: "Venue", addedAt: "2026-01-01" }] } } } } as unknown as PersonalAccountSession;
function request(body: Record<string,unknown>, sourceOrigin = origin) { return new Request(origin + "/api/personal-favorites", { method: "POST", headers: { host: "launch.faolla.com", origin: sourceOrigin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
async function withCanonical(task: () => Promise<void>) { const value = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = origin; try { await task(); } finally { if(value === undefined) delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = value; } }
test("favorite uses the existing membership join with a combined metadata projection; unfavorite marks left without deletion", async () => withCanonical(async () => {
  const original = structuredClone(member);
  let joins = 0, leaves = 0;
  const dependencies = { ...favoriteDependencies, resolveSession: async () => session,
    loadSite: async () => ({ id: siteId, merchantName: "Synthetic venue", domainPrefix: "cyberspace" }) as Awaited<ReturnType<typeof favoriteDependencies.loadSite>>,
    resolveTarget: async () => ({ siteId }) as Awaited<ReturnType<typeof favoriteDependencies.resolveTarget>>,
    join: async (input: Parameters<typeof favoriteDependencies.join>[0]) => { joins++; assert.equal(input.session, session); assert.equal(input.favorite?.id, siteId); assert.equal(input.favorite?.name, "Synthetic venue"); assert.equal(input.previousFavoriteId, "legacy-domain"); return member; },
    leave: async (input: Parameters<typeof favoriteDependencies.leave>[0]) => { leaves++; assert.equal(input.removeFavorite, true); assert.equal(input.previousFavoriteId, "legacy-domain"); return { ...member, status: "left" as const }; },
  };
  const joined = await handleFavoriteMutation(request({ action: "favorite", siteId, siteName: "Untrusted label" }), dependencies);
  assert.equal(joined.status, 200); assert.equal((await joined.json()).favorited, true);
  const left = await handleFavoriteMutation(request({ action: "unfavorite", siteId, favoriteId: "legacy-domain" }), dependencies);
  const result = await left.json(); assert.equal(result.membership.status, "left"); assert.equal(result.favorited, false);
  assert.equal(joins, 1); assert.equal(leaves, 1); assert.deepEqual(member, original, "no points, balances, transaction or order deletion");
}));
test("no cross-origin mutation, wrong-site cancellation, guest mutation or unavailable join can claim success", async () => withCanonical(async () => {
  const noWrite = async (): Promise<never> => { assert.fail("write must be unreachable"); };
  const dependencies = { ...favoriteDependencies, resolveSession: async () => session, join: noWrite, leave: noWrite,
    resolveTarget: async () => ({ siteId }) as Awaited<ReturnType<typeof favoriteDependencies.resolveTarget>> };
  assert.equal((await handleFavoriteMutation(request({ action: "favorite", siteId }, "https://cyberspace.faolla.com"), dependencies)).status, 403);
  assert.equal((await handleFavoriteMutation(request({ action: "unfavorite", siteId: "10000000", favoriteId: "legacy-domain" }), dependencies)).status, 400);
  assert.equal((await handleFavoriteMutation(request({ action: "favorite", siteId }), { ...dependencies, resolveSession: async () => null })).status, 401);
  const failed = await handleFavoriteMutation(request({ action: "favorite", siteId }), { ...dependencies,
    loadSite: async () => ({ id: siteId }) as Awaited<ReturnType<typeof favoriteDependencies.loadSite>>,
    join: async () => { throw new Error("synthetic secret error must never leak"); } });
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /synthetic secret/);
}));
test("private identity stays canonical and is never exposed through CORS", async () => withCanonical(async () => {
  const response = await handleFavoriteRead(new Request(origin + "/api/personal-favorites", { headers: { host: "cyberspace.faolla.com" } }), { ...favoriteDependencies, resolveSession: async () => { assert.fail(); } });
  assert.equal(response.status, 421); assert.equal(response.headers.has("access-control-allow-origin"), false);
}));
