import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";

export type ProfileOption = { value: string; label: string; keywords?: string };
export function normalizeProfileSearch(value: string) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
export function filterProfileOptions(options: ProfileOption[], query: string) {
  const term = normalizeProfileSearch(query);
  if (!term) return options;
  return options.map(option => {
    const candidates = [option.value, option.label, ...(option.keywords || "").split(/\s+/)].map(normalizeProfileSearch);
    const score = Math.min(...candidates.map(value => value === term ? 0 : value.startsWith(term) ? 1 : value.includes(term) ? 2 : 3));
    return { option, score };
  }).filter(match => match.score < 3).sort((a, b) => a.score - b.score).map(match => match.option);
}
export function validProfileBirthday(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function profileContactCardOptions(cards: MerchantBusinessCardAsset[]): ProfileOption[] {
  // Only previously saved, public contact pages are selectable. Do not create
  // share keys, republish cards, or turn an image/website card into a contact page.
  return cards.filter(card => card.mode === "link" && /^[a-z0-9][a-z0-9_-]{5,63}$/i.test(card.shareKey || ""))
    .map(card => ({ value: `https://faolla.com/card/${card.shareKey}`, label: card.name || "未命名联系卡" }));
}
