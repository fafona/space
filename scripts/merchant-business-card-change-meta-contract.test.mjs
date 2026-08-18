import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const readSource = (...parts) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

const cardTypesSource = readSource("src", "lib", "merchantBusinessCards.ts");
const managerSource = readSource("src", "components", "admin", "MerchantBusinessCardManager.tsx");
const profileDialogSource = readSource("src", "components", "admin", "MerchantProfileDialog.tsx");

test("business card changes expose a shared metadata contract", () => {
  for (const changeType of ["create", "update", "delete", "select_chat", "system_sync", "normalize"]) {
    assert.ok(cardTypesSource.includes(`"${changeType}"`), `missing business card change type: ${changeType}`);
  }
  assert.match(cardTypesSource, /export type BusinessCardChangeMeta = \{[\s\S]*type: BusinessCardChangeType;/);
  assert.match(cardTypesSource, /cardId\?: string;/);
  assert.match(cardTypesSource, /cardName\?: string;/);
  assert.match(
    managerSource,
    /onCardsChange: \(cards: MerchantBusinessCardAsset\[\], meta\?: BusinessCardChangeMeta\)/,
  );
});

test("business card manager labels user changes and background changes separately", () => {
  assert.match(managerSource, /type: existingCard \? "update" : "create"/);
  assert.match(managerSource, /type: "delete"/);
  assert.match(managerSource, /type: "select_chat"/);
  assert.match(managerSource, /type: "system_sync"/);
  assert.match(managerSource, /type: "normalize"/);
  assert.match(managerSource, /persistBusinessCardList\(nextCards, \{[\s\S]{0,120}type: "update"/);
});

test("merchant profile dialog forwards business card change metadata", () => {
  assert.match(
    profileDialogSource,
    /onCardsChange\?: \(cards: MerchantBusinessCardAsset\[\], meta\?: BusinessCardChangeMeta\) => void/,
  );
  assert.match(profileDialogSource, /onCardsChange=\{\(cards, meta\) => \{/);
  assert.match(profileDialogSource, /onCardsChange\?\.\(cards, meta\)/);
});
