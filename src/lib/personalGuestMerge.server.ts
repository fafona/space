import { createHash } from "crypto";

function trimText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizePersonalGuestMergeToken(value: unknown) {
  const token = trimText(value, 180);
  return /^[A-Za-z0-9:_-]{16,180}$/.test(token) ? token : "";
}

export function hashPersonalGuestMergeToken(value: unknown) {
  const token = normalizePersonalGuestMergeToken(value);
  if (!token) return "";
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
