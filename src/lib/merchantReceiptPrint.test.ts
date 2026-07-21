import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyMerchantMembershipSettings } from "./merchantMembershipSettings";
import {
  comparePrintHelperVersions,
  isPrintHelperUpdateAvailable,
  isPrintHelperVersionOutdated,
  normalizePrintHelperUpdateManifest,
  normalizeReceiptPrintSettingsForClient,
  resolveOfficialPrintHelperDownloadUrl,
  shouldUseReceiptImageForLocalBridge,
  type PrintHelperUpdateManifest,
} from "./merchantReceiptPrint";

const manifest: PrintHelperUpdateManifest = {
  ok: true,
  name: "faolla-print-helper",
  version: "1.5.5",
  minimumVersion: "1.5.3",
  package: {
    url: "/downloads/print-helper/FAOLLA-print-helper-1.5.5.zip",
    sha256: "a".repeat(64),
    sizeBytes: 100,
  },
};

test("separates incompatible helpers from compatible updates", () => {
  assert.equal(comparePrintHelperVersions("1.5.4", "1.5.3"), 1);
  assert.equal(isPrintHelperVersionOutdated("1.5.2", manifest), true);
  assert.equal(isPrintHelperUpdateAvailable("1.5.2", manifest), false);
  assert.equal(isPrintHelperVersionOutdated("1.5.4", manifest), false);
  assert.equal(isPrintHelperUpdateAvailable("1.5.4", manifest), true);
  assert.equal(isPrintHelperUpdateAvailable("1.5.5", manifest), false);
});

test("validates helper manifests and official download paths", () => {
  assert.ok(normalizePrintHelperUpdateManifest(manifest));
  assert.equal(normalizePrintHelperUpdateManifest({ ...manifest, name: "another-service" }), null);
  assert.equal(normalizePrintHelperUpdateManifest({ ...manifest, package: { ...manifest.package, sha256: "bad" } }), null);
  assert.equal(
    resolveOfficialPrintHelperDownloadUrl("/downloads/print-helper/FAOLLA-print-helper-1.5.5.zip?v=1"),
    "/downloads/print-helper/FAOLLA-print-helper-1.5.5.zip?v=1",
  );
  assert.equal(resolveOfficialPrintHelperDownloadUrl("https://example.com/helper.zip"), "");
});

test("normalizes client bridge settings to loopback", () => {
  const settings = createEmptyMerchantMembershipSettings("10000000").printSettings;
  assert.equal(
    normalizeReceiptPrintSettingsForClient({ ...settings, localPrintBridgeUrl: "http://192.168.1.8:17658" })
      .localPrintBridgeUrl,
    "http://127.0.0.1:17658",
  );
});

test("uses bitmap receipts when the thermal text code page could lose content", () => {
  const settings = createEmptyMerchantMembershipSettings("10000000").printSettings;
  assert.equal(shouldUseReceiptImageForLocalBridge({ ...settings, receiptLocale: "zh" }, "会员：张三"), false);
  assert.equal(shouldUseReceiptImageForLocalBridge({ ...settings, receiptLocale: "zh" }, "会员：João"), true);
  assert.equal(shouldUseReceiptImageForLocalBridge({ ...settings, receiptLocale: "es" }, "Cliente: Ana"), true);
});
