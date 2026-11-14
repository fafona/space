import test from "node:test";
import assert from "node:assert/strict";
import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import { normalizePersonalGuestProfile } from "@/lib/personalGuestSession";
import { boundedPersonalAvatarDataUrl } from "@/lib/personalAvatarValue";
import { filterProfileOptions, profileContactCardOptions, validProfileBirthday } from "./serviceProfileOptions";

test("profile search matches case, accents, partial names, translated aliases and stable values", () => {
  const options = [{ value: "Spain", label: "Spain · 西班牙", keywords: "ES España" }, { value: "France", label: "France · 法国", keywords: "FR" }];
  for (const query of ["espa", "ESPAÑA", "西班", "spai", "ES"]) assert.equal(filterProfileOptions(options, query)[0]?.value, "Spain");
  assert.equal(filterProfileOptions([{ value: "female", label: "女" }, { value: "male", label: "男" }], "male")[0]?.value, "male");
  assert.deepEqual(filterProfileOptions(options, "unknown"), []);
});
test("birthdays preserve blank dates and real leap days but reject malformed, impossible or partially entered dates", () => {
  for (const date of ["", "2000-01-01", "2024-02-29"]) assert.equal(validProfileBirthday(date), true);
  for (const date of ["01-01", "2023-02-29", "2026-13-01", "2026-04-31", "2026-1-1", "0000-01-01", "乱码"]) assert.equal(validProfileBirthday(date), false);
});
test("contact choices only use already saved public contact cards without altering any card", () => {
  const cards = [{ name: "My contact card", mode: "link", shareKey: "synthetic-card-01" }, { name: "Image card", mode: "image", shareKey: "synthetic-card-02" }, { name: "Unsaved", mode: "link", shareKey: "" }] as MerchantBusinessCardAsset[];
  const original = structuredClone(cards);
  assert.deepEqual(profileContactCardOptions(cards), [{ value: "https://faolla.com/card/synthetic-card-01", label: "My contact card" }]);
  assert.deepEqual(profileContactCardOptions([]), []);assert.deepEqual(cards, original);
});
test("bounded local guest avatar data survives normalization rather than being truncated to URL length", () => {
  const dataUrl = "data:image/jpeg;base64," + "a".repeat(4000);
  assert.equal(boundedPersonalAvatarDataUrl(dataUrl), dataUrl);
  const profile = normalizePersonalGuestProfile({ avatarUrl: dataUrl, country: "Saved custom country", province: "Saved province", city: "Saved city", contactCard: "Saved card" });
  assert.equal(profile.avatarUrl, dataUrl);
  assert.equal(profile.country, "Saved custom country");assert.equal(profile.contactCard, "Saved card");
  assert.equal(normalizePersonalGuestProfile({ avatarUrl: "https://example.invalid/avatar.jpg" }).avatarUrl, "https://example.invalid/avatar.jpg");
});
test("the local-avatar exception is limited to bounded raster base64, not arbitrary long strings or active SVG", () => {
  for (const value of ["data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,abcd", "data:image/jpeg;base64," + "a".repeat(90_000), "https://example.invalid/image", "data:image/png;base64,<script>"]) assert.equal(boundedPersonalAvatarDataUrl(value), "");
});
