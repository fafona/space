import { isIP } from "node:net";

const ERROR = "maintenance_public_gateway_unverified";
const fail = () => { throw new Error(ERROR); };
const FIXED_GATEWAY = "https://faolla.com/";

function publicIpv4(host) {
  if (isIP(host) !== 4) return false;
  const [a, b, c] = host.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}

/**
 * Select a candidate, not a routing or maintenance proof. The control caller
 * must read raw from the frozen runtime and prove this HTTPS origin routes via
 * the selected Nginx configuration to the frozen Kong before saving state.
 * This models only the existing browser's HTTPS Faolla-origin branch for the
 * observed raw HTTP IPv4:8000 root layout; it never upgrades an arbitrary URL.
 */
export function selectMaintenancePublicGateway(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 1000 || raw.trim() !== raw || /[\s\\\0]/.test(raw)) fail();
  let url;
  try { url = new URL(raw); } catch { fail(); }
  if (url.username || url.password || url.search || url.hash || raw.includes("?") || raw.includes("#") ||
      !/^[a-z0-9.-]+$/.test(url.hostname) || !/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(url.pathname) ||
      url.pathname.includes("/api/supabase-proxy")) fail();
  // Preserve the existing HTTPS value, including its optional trailing slash.
  // Existing consumers perform their own common URL.href hash normalization.
  if (url.protocol === "https:") return raw;
  const observed = raw.match(/^http:\/\/((?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}):8000\/?$/);
  if (url.protocol !== "http:" || !observed || observed[1] !== url.hostname || !publicIpv4(url.hostname) ||
      url.port !== "8000" || url.pathname !== "/") fail();
  return FIXED_GATEWAY;
}

/** Only call with the gateway obtained from a validated private context. */
export function bindMaintenancePublicSupabaseUrl(raw, expectedGatewayOrNull) {
  if (expectedGatewayOrNull === null) return raw;
  if (typeof expectedGatewayOrNull !== "string") fail();
  const selected = selectMaintenancePublicGateway(raw);
  if (selected !== expectedGatewayOrNull) fail();
  return selected;
}
