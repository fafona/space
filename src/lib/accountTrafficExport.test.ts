import test from "node:test";
import assert from "node:assert/strict";
import { buildTrafficChannelLink, trafficMedium, type AccountTrafficReport } from "./accountTraffic";
import { buildTrafficCsv, trafficCsvCell } from "./accountTrafficCsv";

export const reportFixture: AccountTrafficReport = {
  timezone: "Europe/Madrid", from: "2026-09-01", to: "2026-09-23", totalEvents: 6, views: 4, exposures: 1, actions: 1,
  firstCollectedAt: null, daily: [], modules: [], sources: [{ key: "google", count: 5 }], media: [{ key: "qr", count: 5 }],
  browsers: [], devices: [], actionTypes: [], objectCount: 55,
  objects: [{ key: "card-1", module: "card", label: '=HYPERLINK("https://evil.test")', count: 6, views: 4, exposures: 1, actions: 1 }],
};
test("medium accepts one bounded tag, never infers from QR words or private query fields", () => {
  for (const medium of ["qr", "share", "nfc", "ad", "unknown"]) assert.equal(trafficMedium(`?faolla_medium=${medium}`), medium);
  for (const search of ["", "?source=qr", "?utm_medium=qr", "?faolla_medium=qr&faolla_medium=share", "?faolla_medium=QR", "?faolla_medium=private@example.com"]) assert.equal(trafficMedium(search), "unknown");
});
test("channel helper creates a separate URL and preserves path, share key and hash", () => {
  const original = "https://faolla.com/share/business-card?shareKey=abc#contact";
  const url = new URL(buildTrafficChannelLink(original, "qr"));
  assert.equal(url.pathname, "/share/business-card"); assert.equal(url.searchParams.get("shareKey"), "abc"); assert.equal(url.hash, "#contact");
  assert.equal(url.searchParams.get("faolla_medium"), "qr"); assert.equal(original.includes("faolla_medium"), false);
  assert.equal(new URL(buildTrafficChannelLink(url.href, "share")).searchParams.getAll("faolla_medium").length, 1);
  for (const value of ["javascript:alert(1)", "http://faolla.com/", "https://faolla.com.evil.test/", "https://evil.test/", "https://x:y@faolla.com/", "https://faolla.com:123/"]) assert.throws(() => buildTrafficChannelLink(value, "qr"));
});
test("CSV escapes formulas, quotes, delimiters and multiline public labels", () => {
  for (const text of ["=1+1", "+SUM(A1)", "-1+2", "@cmd", " \t=1", "\n=1", "\ttext", "\uFEFF=1"]) assert.ok(trafficCsvCell(text).startsWith('"\''));
  assert.equal(trafficCsvCell('你好,"世界"\nnext'), '"你好,""世界""\nnext"');
  assert.equal(trafficCsvCell(123), '"123"');
});
test("export identifies current-page limits, exact scope and separate source/medium dimensions", () => {
  const csv = buildTrafficCsv(reportFixture, { siteId: "10000000", days: 30, offset: 50, module: "card", objectId: null });
  assert.ok(csv.startsWith("\uFEFF")); assert.match(csv, /不是全部对象明细/); assert.match(csv, /"对象偏移","50"/);
  assert.match(csv, /"匹配对象总数","55"/); assert.match(csv, /"本文件对象行数","1"/);
  assert.match(csv, /"'="?/); assert.match(csv, /来路（浏览＋曝光）/); assert.match(csv, /链接渠道（浏览＋曝光）/);
});
