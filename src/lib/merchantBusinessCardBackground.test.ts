import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createDefaultMerchantSortConfig } from "@/data/platformControlStore";
import { createDefaultMerchantBusinessCardDraft, mergeMerchantBusinessCardAssets, normalizeMerchantBusinessCardDraft, type MerchantBusinessCardAsset, type MerchantBusinessCardDraft } from "./merchantBusinessCards";
import { normalizePublicAssetUrl } from "./publicAssetUrl";
import { buildPlatformMerchantSnapshotBlocks, readPlatformMerchantSnapshotFromBlocks } from "./platformMerchantSnapshot";

// Exercise the actual editor's draft initialization without mounting its network
// or save effects. No synthetic replacement of the recovery algorithm.
const source = readFileSync(new URL("../components/admin/MerchantBusinessCardManager.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("manager.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["isSameAssetUrl", "buildEditableBusinessCardDraftFromAsset"];
const functions = names.map(name => {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node); return node.getText(ast);
}).join("\n");
const context = { normalizeMerchantBusinessCardDraft, normalizePublicAssetUrl,
  normalizeText: (value: unknown) => typeof value === "string" ? value.trim() : "",
  edit: null as unknown as (card: MerchantBusinessCardAsset) => MerchantBusinessCardDraft };
runInNewContext(ts.transpileModule(`${functions}\nedit = buildEditableBusinessCardDraftFromAsset;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
function card(patch: Partial<MerchantBusinessCardAsset> = {}): MerchantBusinessCardAsset {
  return { ...createDefaultMerchantBusinessCardDraft({}), id: "background-test", createdAt: "2026-09-22T00:00:00Z", imageUrl: "https://example.test/front.png", shareImageUrl: "https://example.test/front.png", targetUrl: "https://example.test", ...patch };
}

test("legacy missing source uses existing front, never treats it as editable original", () => {
  const original = card({ backgroundImageSourceKnown: undefined, backgroundImageUrl: "", backgroundImageSnapshotOnly: false });
  const before = JSON.stringify(original);
  const draft = context.edit(original);
  assert.equal(draft.backgroundImageUrl, original.imageUrl);
  assert.equal(draft.backgroundImageSnapshotOnly, true);
  assert.equal(draft.backgroundImageSourceKnown, false);
  assert.equal(draft.backgroundImageScale, 1);
  assert.equal(JSON.stringify(original), before);
  assert.equal(context.edit({ ...original, ...draft }).backgroundImageSnapshotOnly, true);
});

test("intentional empty background stays empty when reopened or merged", () => {
  const cleared = card({ backgroundImageSourceKnown: true, backgroundImageUrl: "" });
  assert.equal(context.edit(cleared).backgroundImageUrl, "");
  assert.equal(context.edit(cleared).backgroundImageSnapshotOnly, false);
  const merged = mergeMerchantBusinessCardAssets(cleared, card({ backgroundImageUrl: "https://example.test/old.jpg" }), { prefer: "primary" });
  assert.equal(merged.backgroundImageUrl, "");
  assert.equal(merged.backgroundImageSnapshotOnly, false);
});

test("raw background and transforms survive snapshot save/read then edit", () => {
  for (const url of ["https://example.test/background.jpg", "data:image/png;base64,YmFja2dyb3VuZA=="]) {
    const original = card({ backgroundImageUrl: url, backgroundImageX: 24, backgroundImageY: -18, backgroundImageScale: 1.4, backgroundImageOpacity: .65 });
    const blocks = buildPlatformMerchantSnapshotBlocks({ revision: "test-background", defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {}, snapshot: [{ id: "10000000", name: "Synthetic", domain: "synthetic", category: "服务", industry: "服务", location: { countryCode: "ES", country: "Spain", provinceCode: "AN", province: "Sevilla", city: "Sevilla" }, sortConfig: createDefaultMerchantSortConfig(), createdAt: original.createdAt, businessCards: [original] }] });
    const restored = readPlatformMerchantSnapshotFromBlocks(JSON.parse(JSON.stringify(blocks)))?.snapshot[0]?.businessCards?.[0];
    assert.ok(restored);
    const draft = context.edit(restored);
    assert.equal(draft.backgroundImageUrl, url);
    assert.equal(draft.backgroundImageSnapshotOnly, false);
    assert.equal(draft.backgroundImageX, 24);
    assert.equal(draft.backgroundImageY, -18);
    assert.equal(draft.backgroundImageScale, 1.4);
    assert.equal(draft.backgroundImageOpacity, .65);
  }
});

test("recoverable source wins over legacy missing source; existing front is not regenerated for snapshot mode", () => {
  const legacy = card({ backgroundImageSourceKnown: false, backgroundImageSnapshotOnly: true, backgroundImageUrl: "https://example.test/front.png" });
  const merged = mergeMerchantBusinessCardAssets(legacy, card({ backgroundImageUrl: "https://example.test/background.jpg" }), { prefer: "primary" });
  assert.equal(merged.backgroundImageUrl, "https://example.test/background.jpg");
  assert.equal(merged.backgroundImageSnapshotOnly, false);
  assert.match(source, /const shouldRefreshFrontImage\s*=\s*Boolean\(options\?\.refreshFrontImage\)\s*&&\s*!nextDraft\.backgroundImageSnapshotOnly/);
});
