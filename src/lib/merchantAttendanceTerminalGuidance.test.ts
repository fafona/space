import assert from "node:assert/strict";
import test from "node:test";
import {
  PIN_ADMIN_GUIDANCE,
  PIN_VERIFICATION_GUIDANCE,
  TERMINAL_PAIRING_GUIDANCE,
  pairedTerminalGuidance,
  terminalConfigurationGuidance,
  terminalEntryGuidance,
} from "./merchantAttendanceTerminalGuidance";

const entryCases = [
  { name: "neither", pin: false, onsite: false },
  { name: "PIN only", pin: true, onsite: false },
  { name: "onsite only", pin: false, onsite: true },
  { name: "both", pin: true, onsite: true },
] as const;

for (const entry of entryCases) {
  test(`terminal guidance describes ${entry.name} as visible entries, not authorization`, () => {
    const guidance = terminalEntryGuidance(entry.pin, entry.onsite);
    if (!entry.pin && !entry.onsite) {
      assert.match(guidance, /本页未提供.*入口/);
      assert.match(guidance, /配对.*不会产生打卡/);
      assert.match(guidance, /PIN 验证页.*不记录考勤/);
      return;
    }

    assert.match(guidance, /本页.*入口/);
    assert.match(guidance, /入口可见不代表获准打卡/);
    assert.match(guidance, /服务端.*开关.*设备.*本人权限/);
    if (entry.pin) {
      assert.match(guidance, /PIN 打卡.*门店专用浏览器.*验证本人.*明确确认动作/);
    } else {
      assert.doesNotMatch(guidance, /PIN/);
    }
    if (entry.onsite) {
      assert.match(guidance, /现场码.*自己的手机.*扫描.*登录.*明确确认动作/);
    } else {
      assert.doesNotMatch(guidance, /现场码/);
    }
    if (entry.pin && entry.onsite) assert.match(guidance, /两个独立入口/);
  });

  test(`paused ${entry.name} guidance requires fresh checks for finishing or original-operation recovery`, () => {
    const guidance = pairedTerminalGuidance(entry.pin, entry.onsite, false);
    assert.match(guidance, /设备凭证仍有效/);
    assert.match(guidance, /平台.*暂停新增考勤/);
    assert.match(guidance, /结束已有班次/);
    assert.match(guidance, /核对原操作/);
    assert.match(guidance, /重新核对/);
    assert.doesNotMatch(guidance, /不能打卡|无法打卡|所有.*(?:禁止|关闭)/);

    if (!entry.pin && !entry.onsite) {
      assert.match(guidance, /本页未提供.*入口/);
      assert.match(guidance, /相应授权入口/);
    } else {
      assert.match(guidance, /能否.*重新核对权限与状态/);
      assert.equal(guidance.includes("PIN"), entry.pin);
      assert.equal(guidance.includes("现场码"), entry.onsite);
      if (entry.onsite) assert.match(guidance, /员工本人手机上的现场码打卡页/);
    }
  });
}

test("paired and platform-enabled status never grants permission merely from pairing", () => {
  for (const entry of entryCases) {
    const guidance = pairedTerminalGuidance(entry.pin, entry.onsite, true);
    assert.match(guidance, /此浏览器已配对/);
    assert.match(guidance, /不会产生打卡/);
    assert.doesNotMatch(guidance, /平台.*暂停/);
    if (entry.pin || entry.onsite) {
      assert.match(guidance, /核对权限与状态.*本人明确确认动作/);
      assert.equal(guidance.includes("PIN"), entry.pin);
      assert.equal(guidance.includes("现场码"), entry.onsite);
      if (entry.onsite) assert.match(guidance, /员工本人手机上的现场码打卡页/);
    } else {
      assert.match(guidance, /本页未提供.*入口/);
      assert.match(guidance, /配对不代表.*已获授权/);
    }
  }
});

test("enabled enterprise configuration does not imply that every clock channel is enabled", () => {
  const guidance = terminalConfigurationGuidance(true);
  assert.match(guidance, /企业考勤配置已启用/);
  assert.match(guidance, /不等于所有打卡方式已开放/);
  assert.match(guidance, /对应入口.*服务端校验/);
  assert.doesNotMatch(guidance, /暂停|未启用/);
});

test("disabled enterprise configuration remains distinct from a platform admission pause", () => {
  const guidance = terminalConfigurationGuidance(false);
  assert.match(guidance, /企业考勤配置未启用/);
  assert.match(guidance, /平台暂停.*不同状态/);
  assert.match(guidance, /实际可用动作.*对应入口.*服务端校验/);
  assert.doesNotMatch(guidance, /仍可结束|允许结束|设备凭证.*无效/);
});

test("pairing management defers channel availability and does not promise physical or operating-system security", () => {
  assert.match(TERMINAL_PAIRING_GUIDANCE, /只管理终端配对.*不会直接打卡/);
  assert.match(TERMINAL_PAIRING_GUIDANCE, /PIN 打卡.*现场码.*独立入口/);
  assert.match(TERMINAL_PAIRING_GUIDANCE, /可用状态.*终端页.*服务端校验/);
  assert.match(TERMINAL_PAIRING_GUIDANCE, /不能证明设备在店内/);
  assert.match(TERMINAL_PAIRING_GUIDANCE, /不会限制操作系统或产生考勤记录/);
});

test("PIN administration describes credential management rather than a clock operation", () => {
  assert.match(PIN_ADMIN_GUIDANCE, /仅当前负责人管理/);
  assert.match(PIN_ADMIN_GUIDANCE, /有效账号.*考勤档案.*本人打卡权限/);
  assert.match(PIN_ADMIN_GUIDANCE, /此页仅管理独立 PIN.*不产生打卡记录/);
  assert.match(PIN_ADMIN_GUIDANCE, /已开放.*PIN 打卡入口.*验证本人.*明确确认动作/);
  assert.match(PIN_ADMIN_GUIDANCE, /不支持未绑定账号/);
});

test("independent PIN verification is not a punch and does not authorize a later action", () => {
  assert.match(PIN_VERIFICATION_GUIDANCE, /本页仅验证 PIN.*不会产生打卡记录/);
  assert.match(PIN_VERIFICATION_GUIDANCE, /已开放的独立 PIN 打卡入口/);
  assert.match(PIN_VERIFICATION_GUIDANCE, /重新验证本人.*明确确认动作/);
});

test("no guidance restores the obsolete global claim that PIN or onsite clocking is not implemented", () => {
  const messages = [
    TERMINAL_PAIRING_GUIDANCE,
    PIN_ADMIN_GUIDANCE,
    PIN_VERIFICATION_GUIDANCE,
    terminalConfigurationGuidance(false),
    terminalConfigurationGuidance(true),
    ...entryCases.flatMap(entry => [
      terminalEntryGuidance(entry.pin, entry.onsite),
      pairedTerminalGuidance(entry.pin, entry.onsite, false),
      pairedTerminalGuidance(entry.pin, entry.onsite, true),
    ]),
  ];
  for (const guidance of messages) {
    assert.doesNotMatch(guidance, /本阶段|此阶段|尚未开放|尚未接入|尚不能|不能打卡/);
  }
});
