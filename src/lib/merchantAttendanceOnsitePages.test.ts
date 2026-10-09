import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MerchantAttendanceTerminalDevice from "../components/enterprise/MerchantAttendanceTerminalDevice";

test("paired-terminal entry leaves onsite navigation off by default and adds it only when explicitly enabled", () => {
  const render = (onsiteEnabled?: boolean) => renderToStaticMarkup(React.createElement<{ onsiteEnabled?: boolean }>(MerchantAttendanceTerminalDevice, { onsiteEnabled }));
  assert.doesNotMatch(render(), /href="\/enterprise\/attendance-terminal\/onsite"/);
  assert.doesNotMatch(render(false), /href="\/enterprise\/attendance-terminal\/onsite"/);
  assert.match(render(true), /href="\/enterprise\/attendance-terminal\/onsite"/);
  assert.match(render(true), /员工在自己的手机.*扫描.*登录.*明确确认动作/);
});

test("actual terminal header follows all four visible-entry combinations without promising authorization", () => {
  const key = "NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED", previous = process.env[key];
  try {
    for (const pin of [false, true]) for (const onsiteEnabled of [false, true]) {
      process.env[key] = pin ? "1" : "0";
      const html = renderToStaticMarkup(React.createElement<{ onsiteEnabled?: boolean }>(MerchantAttendanceTerminalDevice, { onsiteEnabled }));
      assert.equal(html.includes('href="/enterprise/attendance-terminal/onsite"'), onsiteEnabled);
      if (pin || onsiteEnabled) {
        assert.match(html, /入口可见不代表获准打卡.*服务端核对/);
        assert.equal(html.includes("PIN 打卡需在门店专用浏览器"), pin);
        assert.equal(html.includes("现场码由员工在自己的手机"), onsiteEnabled);
        if (pin && onsiteEnabled) assert.match(html, /两个独立入口/);
      } else assert.match(html, /本页未提供 PIN 打卡或现场码展示入口/);
      assert.doesNotMatch(html, /尚未开放|尚不能|尚未接入/);
      assert.match(html, /不要在此登录企业负责人账号/);
    }
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  }
});

test("both onsite pages require all server-side flags and disable search indexing/referrer", async () => {
  for (const path of ["../app/enterprise/attendance-terminal/onsite/page.tsx", "../app/enterprise/attendance-scan/page.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    for (const key of ["SELF", "TERMINALS", "ONSITE_QR"]) assert.match(source, new RegExp(`process\\.env\\.FAOLLA_ATTENDANCE_${key}_ENABLED !== "1"`));
    assert.match(source, /notFound\(\)/); assert.match(source, /referrer: "no-referrer"/);
    assert.match(source, /robots: \{ index: false, follow: false \}/);
  }
});
