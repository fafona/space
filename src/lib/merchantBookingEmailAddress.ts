// A single mailbox only: never accept display names, lists or header syntax
// from a merchant-controlled Reply-To field. From remains platform-controlled.
export function normalizeMerchantBookingReplyTo(value: unknown) {
  if (typeof value !== "string") return "";
  const address = value.trim();
  if (!address || address.length > 254 || /[\s<>(),;:\u0000-\u001f\u007f]/u.test(address)) return "";
  const parts = address.split("@");
  if (parts.length !== 2) return "";
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "";
  if (!domain || !domain.includes(".") || domain.length > 253 || domain.split(".").some((label) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) return "";
  return `${local}@${domain.toLowerCase()}`;
}
