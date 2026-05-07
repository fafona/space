export type FaollaQrAccountType = "merchant" | "personal";

type QrTokenApiPayload = {
  ok?: unknown;
  token?: unknown;
  message?: unknown;
  error?: unknown;
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readPayloadMessage(payload: QrTokenApiPayload | null, fallback: string) {
  return trimText(payload?.message || payload?.error) || fallback;
}

export function buildFaollaQrConnectUrl(input: {
  origin: string;
  type: FaollaQrAccountType;
  id: string;
  name?: string;
  token?: string;
  url?: string;
}) {
  const url = new URL("/connect", input.origin);
  url.searchParams.set("type", input.type);
  url.searchParams.set("id", input.id);
  const name = trimText(input.name, 80);
  const token = trimText(input.token, 128);
  const targetUrl = trimText(input.url, 1200);
  if (name) url.searchParams.set("name", name);
  if (token) url.searchParams.set("token", token);
  if (targetUrl) url.searchParams.set("url", targetUrl);
  return url.toString();
}

export async function fetchFaollaQrToken(type: FaollaQrAccountType, id: string) {
  const params = new URLSearchParams({ type, id, ensure: "1" });
  const response = await fetch(`/api/faolla-qr-token?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as QrTokenApiPayload | null;
  const token = trimText(payload?.token, 128);
  if (!response.ok || !token) {
    throw new Error(readPayloadMessage(payload, "二维码令牌获取失败，请稍后重试"));
  }
  return token;
}

export async function resetFaollaQrToken(type: FaollaQrAccountType, id: string) {
  const response = await fetch("/api/faolla-qr-token", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ action: "reset", type, id }),
  });
  const payload = (await response.json().catch(() => null)) as QrTokenApiPayload | null;
  const token = trimText(payload?.token, 128);
  if (!response.ok || !token) {
    throw new Error(readPayloadMessage(payload, "二维码重置失败，请稍后重试"));
  }
  return token;
}

export async function openScannedQrValue(
  value: string,
  fallbackOrigin: string,
  onMessage?: (message: string) => void,
) {
  const raw = trimText(value);
  if (!raw) {
    onMessage?.("没有识别到二维码内容");
    return;
  }

  const openHref = (href: string) => {
    window.location.href = href;
  };

  try {
    if (/^(?:javascript|data|blob):/i.test(raw)) {
      throw new Error("blocked_scheme");
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      const url = new URL(raw);
      openHref(url.toString());
      return;
    }
    if (raw.startsWith("/") || /^[\w.-]+\.[a-z]{2,}(?:[/?#]|$)/i.test(raw)) {
      const href = raw.startsWith("/") ? new URL(raw, fallbackOrigin).toString() : `https://${raw}`;
      openHref(href);
      return;
    }
  } catch {
    if (/^(?:javascript|data|blob):/i.test(raw)) {
      onMessage?.("此二维码内容不安全，已阻止打开");
      return;
    }
  }

  try {
    await navigator.clipboard?.writeText(raw);
    onMessage?.("已识别二维码内容并复制");
  } catch {
    onMessage?.(`已识别二维码内容：${raw.slice(0, 80)}`);
  }
}
