import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Panel, { RetentionDisposalPreviewView, RetentionDisposalReceiptView } from "../components/enterprise/MerchantAttendanceRetentionDisposalPanel";
import Launcher from "../components/enterprise/MerchantAttendanceRetentionDisposalLauncher";
import { KnownAttendanceRecoveryEntry, AttendanceRecoveryReceiptView } from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import { disposalActor, disposalSite, disposalPreview, disposalReceipt } from "../../scripts/fixtures/attendance-retention-disposal-execution-model";
test("local-only launcher and initial panel perform no HTTP; ordinary merchant never has a fresh disposal launcher", () => {
  let calls = 0; const props = { siteId: disposalSite, authUserId: disposalActor, apiFetch: async () => { calls++; throw Error(); }, enabled: false, isCurrentAuth: () => true, beforeOpen: () => true, onClose: () => {} };
  assert.match(renderToStaticMarkup(<Launcher {...props}/>), /本地单条定位处置验收/);
  assert.equal(renderToStaticMarkup(<Launcher {...props} siteId="12345678" enabled/>), "");
  const panel = renderToStaticMarkup(<Panel {...props}/>); assert.match(panel, /读取单条处置预览/); assert.doesNotMatch(panel, /仅保存批准/); assert.equal(calls, 0);
});
test("candidate and unknown receipt are clearly labelled without raw precision values", async () => {
  const p = await disposalPreview(), markup = renderToStaticMarkup(<RetentionDisposalPreviewView preview={p}/>); assert.match(markup, /尚未批准或执行/); assert.match(markup, /不返回这三个原值/);
  const unknown = renderToStaticMarkup(<RetentionDisposalReceiptView receipt={null}/>); assert.match(unknown, /不能据此认定失败/);
});
test("shared minimal approval receipt never claims actual execution or includes reason/source body", async () => {
  const receipt = { kind: "retention-disposal" as const, ...await disposalReceipt() }, r = renderToStaticMarkup(<AttendanceRecoveryReceiptView receipt={receipt}/>);
  assert.match(r, /尚不表示已执行/); assert.match(r, /不显示定位精度、理由或关联归档/); assert.doesNotMatch(r, /明确批准此合成资料/);
  const e = renderToStaticMarkup(<KnownAttendanceRecoveryEntry entry={{ kind: "retention-disposal", storageKey: "synthetic", siteId: disposalSite, authUserId: disposalActor, operationId: receipt.operationId, commandFingerprint: receipt.commandFingerprint }}/>);
  assert.match(e, /本地单条处置原操作/);
});
