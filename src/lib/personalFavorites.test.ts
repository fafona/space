import test from "node:test";
import assert from "node:assert/strict";
import { projectMembershipFavorite, normalizePersonalFavorites, readFavoriteSiteId, favoriteMatchesMerchant } from "./personalFavorites";

const first = { id: "10909095", name: "Venue", url: "https://faolla.com/site/10909095", subtitle: "", addedAt: "2026-11-01" };
const other = { ...first, id: "10000000", url: "https://faolla.com/site/10000000" };
test("a membership favorite is idempotent and preserves unrelated profile, card, coupon and history fields", () => {
  const metadata = { role: "personal", personal_profile: { displayName: "Visitor", phone: "123", favoriteSites: [other] },
    personal_memberships: [{ memberNo: "existing" }], personal_coupons: [{ id: "coupon" }], history: [{ points: 80, order: "original" }] };
  const once = projectMembershipFavorite(metadata, { siteId: first.id, favorite: first });
  const twice = projectMembershipFavorite(once, { siteId: first.id, favorite: { ...first, addedAt: "2026-11-13" } });
  assert.deepEqual(once, twice);
  assert.deepEqual(twice.personal_profile, { ...metadata.personal_profile, favoriteSites: [first, other] });
  assert.deepEqual(twice.history, metadata.history);
  assert.deepEqual(twice.personal_memberships, metadata.personal_memberships);
  assert.deepEqual(twice.personal_coupons, metadata.personal_coupons);
  const removed = projectMembershipFavorite(twice, { siteId: first.id, remove: true });
  assert.deepEqual(removed.personal_profile, metadata.personal_profile);
});
test("legacy domain bookmarks can be removed by their exact saved ID without dropping other favorites", () => {
  const legacy = { ...first, id: "https://cyberspace.faolla.com/", url: "https://cyberspace.faolla.com/" };
  const result = projectMembershipFavorite({ personal_profile: { favoriteSites: [legacy, other] } }, { siteId: first.id, previousId: legacy.id, remove: true });
  assert.deepEqual((result.personal_profile as { favoriteSites: unknown }).favoriteSites, [other]);
});
test("favorite normalization rejects executable URLs and preserves the existing addedAt format", () => {
  assert.deepEqual(normalizePersonalFavorites([{ ...first, url: "javascript:alert(1)" }, { ...first, url: "https://user:pass@faolla.com/" }]), []);
  assert.equal(readFavoriteSiteId(first), first.id);
  assert.equal(readFavoriteSiteId({ id: "merchant:10909095", url: "https://cyberspace.faolla.com/" }), first.id);
  assert.equal(readFavoriteSiteId({ id: "legacy", url: "/site/10909095?uiLocale=es-ES" }), first.id);
});
test("legacy domain favorites match only the authoritative tenant, never a different numeric merchant or a sibling domain", () => {
  const origin = "https://cyberspace.faolla.com";
  assert.equal(favoriteMatchesMerchant({ id: origin, url: origin + "/?page=page-2" }, first.id, origin), true);
  assert.equal(favoriteMatchesMerchant({ id: "merchant:10000000", url: origin }, first.id, origin), false);
  assert.equal(favoriteMatchesMerchant({ id: "legacy", url: "https://other.faolla.com" }, first.id, origin), false);
  const legacy = { ...first, id: origin, url: origin };
  const original = { personal_profile: { favoriteSites: [legacy, other] } };
  const updated = projectMembershipFavorite(original, { siteId: first.id, previousId: legacy.id, favorite: first });
  assert.deepEqual(updated.personal_profile.favoriteSites, [first, other]);
  assert.deepEqual(original.personal_profile.favoriteSites, [legacy, other], "read-time compatibility never migrates user data");
});
