export const SERVICE_FRAME_PATH = "/service-center";
export const SERVICE_FRAME_EVENT = "faolla:merchant-service";
export type ServiceSection = "conversations" | "orders" | "account" | "favorite";
export const isServiceSection = (value: unknown): value is ServiceSection =>
  ["conversations", "orders", "account", "favorite"].includes(String(value));

export function servicePortalOrigin(configured = "", currentOrigin = "") {
  try {
    const current = new URL(currentOrigin);
    if (["localhost", "127.0.0.1", "[::1]"].includes(current.hostname)) return current.origin;
  } catch { /* Use the server-supplied public origin. */ }
  try { const url = new URL(configured); if (url.protocol === "https:") return url.origin; } catch { /* Safe configured default. */ }
  return "https://launch.faolla.com";
}

export function buildServiceFrameUrl(input: { origin: string; parentOrigin: string; siteId: string; section: ServiceSection; nonce: string; locale: string; returnTo?: string }) {
  const url = new URL(SERVICE_FRAME_PATH, input.origin);
  url.search = new URLSearchParams({ parentOrigin: input.parentOrigin, siteId: input.siteId, section: input.section,
    nonce: input.nonce, uiLocale: input.locale, ...(input.returnTo ? { returnTo: input.returnTo } : {}) }).toString();
  return url.toString();
}

export function isServiceFrameMessage(event: Pick<MessageEvent, "origin" | "source" | "data">,
  binding: { origin: string; source: MessageEventSource | null; nonce: string; siteId: string }) {
  const data = event.data;
  return Boolean(binding.source && event.source === binding.source && event.origin === binding.origin && data &&
    typeof data === "object" && data.type === SERVICE_FRAME_EVENT && data.nonce === binding.nonce && data.siteId === binding.siteId);
}
