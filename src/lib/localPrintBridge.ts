export const LOCAL_PRINT_BRIDGE_DEFAULT_PORT = 17658;
export const LOCAL_PRINT_BRIDGE_DEFAULT_URL = `http://127.0.0.1:${LOCAL_PRINT_BRIDGE_DEFAULT_PORT}`;

function normalizeLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === "127.0.0.1" || normalized === "localhost" || normalized === "[::1]" || normalized === "::1") {
    return "127.0.0.1";
  }
  return "";
}

export function normalizeLocalPrintBridgePort(value: unknown) {
  const port = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : LOCAL_PRINT_BRIDGE_DEFAULT_PORT;
}

export function normalizeLocalPrintBridgeUrl(value: unknown) {
  const input = String(value ?? "").trim();
  if (!input) return LOCAL_PRINT_BRIDGE_DEFAULT_URL;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "http:" ||
      !normalizeLoopbackHostname(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== "/")
    ) {
      return LOCAL_PRINT_BRIDGE_DEFAULT_URL;
    }
    const port = normalizeLocalPrintBridgePort(url.port || LOCAL_PRINT_BRIDGE_DEFAULT_PORT);
    return `http://127.0.0.1:${port}`;
  } catch {
    return LOCAL_PRINT_BRIDGE_DEFAULT_URL;
  }
}

export function getLocalPrintBridgePort(value: unknown) {
  try {
    return normalizeLocalPrintBridgePort(new URL(normalizeLocalPrintBridgeUrl(value)).port);
  } catch {
    return LOCAL_PRINT_BRIDGE_DEFAULT_PORT;
  }
}
