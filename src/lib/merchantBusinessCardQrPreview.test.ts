import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeBusinessCardQrPreview, selectBusinessCardQrPreview, type BusinessCardQrPreview } from "./merchantBusinessCardQrPreview";

const old: BusinessCardQrPreview = { key: "old", scope: "merchant:card", target: "https://example.test", url: "data:image/svg+xml,old", appearance: { frame: "none", backgroundColor: "#ffffff" } };

test("parameter changes retain last decoded image and matching frame but never authorize stale save", () => {
  const pending = selectBusinessCardQrPreview(old, "new", old.target, old.scope, true);
  assert.equal(pending.display, old);
  assert.equal(pending.display?.appearance.frame, "none");
  assert.equal(pending.currentUrl, "");
  const next = { ...old, key: "new", url: "data:image/svg+xml,new" };
  assert.equal(selectBusinessCardQrPreview(next, "new", old.target, old.scope, true).currentUrl, next.url);
});

test("never retain another destination/card/merchant, closed editor or invalid settings", () => {
  for (const [target, scope, enabled] of [["https://other.test", old.scope, true], [old.target, "merchant:other-card", true], [old.target, "other-merchant:card", true], [old.target, old.scope, false]] as const) {
    assert.deepEqual(selectBusinessCardQrPreview(old, "new", target, scope, enabled), { display: null, currentUrl: "" });
  }
  assert.deepEqual(selectBusinessCardQrPreview(null, "new", old.target, old.scope, true), { display: null, currentUrl: "" });
});

test("preload waits for image decode and propagates decode failure", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Image");
  let src = "", complete!: () => void;
  const decoded = new Promise<void>(resolve => { complete = resolve; });
  class ImageStub { set src(value: string) { src = value; } decode() { return decoded; } }
  Object.defineProperty(globalThis, "Image", { value: ImageStub, configurable: true });
  try {
    let ready = false;
    const loading = decodeBusinessCardQrPreview("data:image/svg+xml,new").then(() => { ready = true; });
    await Promise.resolve();
    assert.equal(src, "data:image/svg+xml,new"); assert.equal(ready, false);
    complete(); await loading; assert.equal(ready, true);
    ImageStub.prototype.decode = () => Promise.reject(new Error("decode_failed"));
    await assert.rejects(decodeBusinessCardQrPreview("broken"), /decode_failed/);
  } finally {
    if (original) Object.defineProperty(globalThis, "Image", original);
    else Reflect.deleteProperty(globalThis, "Image");
  }
});

test("actual editor keeps export strict, and hook cancels superseded work even after decode", () => {
  const source = readFileSync(new URL("../components/admin/MerchantBusinessCardManager.tsx", import.meta.url), "utf8");
  assert.match(source, /currentUrl: qrCodeUrl, display: qrDisplayPreview/);
  assert.match(source, /hiddenPreviewRef}><CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl}/);
  assert.match(source, /draft={qrDisplayDraft}\s+websiteUrl={websiteUrl}\s+qrCodeUrl={qrDisplayPreview\?\.url \?\? ""}/);
  assert.match(source, /const qrReadyForCurrentDraft = !invalidWebsiteAddress && \(!draft.showQr \|\| !!qrCodeUrl\)/);
  const hook = readFileSync(new URL("../components/admin/useBusinessCardQrPreview.ts", import.meta.url), "utf8");
  assert.match(hook, /await decodeBusinessCardQrPreview\(url\);\s+if \(!cancelled\) setPreview/);
  assert.match(hook, /return \(\) => { cancelled = true; window.clearTimeout\(timer\); }/);
});
