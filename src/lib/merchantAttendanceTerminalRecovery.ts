// The origin comes from server configuration, never Host, query parameters,
// local storage or a pending command. This is a LOGIN link, not a clock token.
export function terminalRecoveryUrlFromOrigin(origin: unknown): string | null {
  if (typeof origin !== "string" || origin.length > 512) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || ![url.origin, url.origin + "/"].includes(origin)) return null;
    return url.origin + "/enterprise";
  } catch { return null; }
}
export function parseTerminalRecoveryUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 524) return null;
  try {
    const url = new URL(value), expected = terminalRecoveryUrlFromOrigin(url.origin);
    return expected !== null && value === expected ? expected : null;
  } catch { return null; }
}
export async function createTerminalRecoveryQr(value: unknown): Promise<string> {
  const url = parseTerminalRecoveryUrl(value);
  if (!url) throw Error("attendance_recovery_link_unavailable");
  const {default: QRCode} = await import("qrcode");
  return QRCode.toDataURL(url, {width: 240, margin: 4, errorCorrectionLevel: "M", color: {dark: "#0f172a", light: "#ffffff"}});
}
