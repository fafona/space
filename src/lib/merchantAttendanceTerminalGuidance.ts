// Presentation only: entry visibility is not server authorization. Do not use
// these descriptions to enable actions or infer permissions from pairing.
export const TERMINAL_PAIRING_GUIDANCE = "此处只管理终端配对，不会直接打卡。PIN 打卡和现场码展示使用独立入口；具体入口及可用状态以终端页和服务端校验为准。配对本身不能证明设备在店内，也不会限制操作系统或产生考勤记录。";
export const PIN_ADMIN_GUIDANCE = "仅当前负责人管理。员工需已有有效账号、考勤档案和本人打卡权限。此页仅管理独立 PIN，不产生打卡记录；打卡须在门店专用浏览器的已开放 PIN 打卡入口验证本人并明确确认动作。不支持未绑定账号的人员。";
export const PIN_VERIFICATION_GUIDANCE = "这不是打卡成功；本页仅验证 PIN，不会产生打卡记录。如需打卡，请使用已开放的独立 PIN 打卡入口，重新验证本人并明确确认动作。";

function visibleClockEntries(pinClockEntry: boolean, onsiteEntry: boolean): string | null {
  if (pinClockEntry && onsiteEntry) return "PIN 打卡和现场码展示两个独立入口";
  if (pinClockEntry) return "独立 PIN 打卡入口";
  if (onsiteEntry) return "现场码展示入口";
  return null;
}

export function terminalEntryGuidance(pinClockEntry: boolean, onsiteEntry: boolean): string {
  const entries = visibleClockEntries(pinClockEntry, onsiteEntry);
  if (!entries) return "本页未提供 PIN 打卡或现场码展示入口。配对本身不会产生打卡；PIN 验证页只验证身份，不记录考勤。";
  const pin = pinClockEntry ? "PIN 打卡需在门店专用浏览器验证本人并明确确认动作。" : "";
  const onsite = onsiteEntry ? "现场码由员工在自己的手机扫描、登录并明确确认动作。" : "";
  return `配对后可从本页进入${entries}。${pin}${onsite}入口可见不代表获准打卡，仍须服务端核对开关、设备和本人权限。`;
}

export function pairedTerminalGuidance(pinClockEntry: boolean, onsiteEntry: boolean, moduleEnabled: boolean): string {
  // The display terminal never reads an employee's receipt. QR operations and
  // recovery stay on the employee's own phone, unlike the terminal PIN flow.
  const entries = pinClockEntry
    ? (onsiteEntry ? "独立 PIN 打卡入口或员工本人手机上的现场码打卡页" : "独立 PIN 打卡入口")
    : (onsiteEntry ? "员工本人手机上的现场码打卡页" : null);
  if (!moduleEnabled) return "设备凭证仍有效，但平台已暂停新增考勤。" + (entries
    ? `能否结束已有班次或核对原操作，请到${entries}重新核对权限与状态。`
    : "本页未提供 PIN 打卡或现场码展示入口；结束已有班次或核对原操作仍须在相应授权入口重新核对。");
  return "此浏览器已配对；" + (entries
    ? `请到${entries}核对权限与状态，再由本人明确确认动作。配对本身不会产生打卡。`
    : "本页未提供 PIN 打卡或现场码展示入口。配对不代表其他入口已获授权，也不会产生打卡。");
}

export function terminalConfigurationGuidance(attendanceEnabled: boolean): string {
  return attendanceEnabled
    ? "企业考勤配置已启用；这不等于所有打卡方式已开放，实际动作仍须由对应入口进行服务端校验。"
    : "企业考勤配置未启用；这与平台暂停是不同状态，实际可用动作仍须由对应入口进行服务端校验。";
}
