const BLOCK_END_TAG_PATTERN = /<\/(?:address|article|aside|blockquote|div|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)\s*>/gi;
const DANGEROUS_ELEMENT_PATTERN = /<(script|style|template|svg|math|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\u00a0",
  quot: '"',
};

function decodeHtmlEntity(entity: string) {
  const normalized = entity.toLowerCase();
  if (normalized in NAMED_ENTITIES) return NAMED_ENTITIES[normalized];
  if (!normalized.startsWith("#")) return `&${entity};`;

  const isHex = normalized.startsWith("#x");
  const digits = normalized.slice(isHex ? 2 : 1);
  if (!digits || !/^[0-9a-f]+$/i.test(digits)) return `&${entity};`;
  const codePoint = Number.parseInt(digits, isHex ? 16 : 10);
  if (
    !Number.isFinite(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return "\ufffd";
  }
  return String.fromCodePoint(codePoint);
}

export function toPlainRichText(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(DANGEROUS_ELEMENT_PATTERN, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(BLOCK_END_TAG_PATTERN, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|amp|apos|gt|lt|nbsp|quot);/gi, (_match, entity: string) =>
      decodeHtmlEntity(entity),
    )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function escapePlainTextAsHtml(value: unknown) {
  return toPlainRichText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br />");
}

export function containsRichMarkup(value: string) {
  return /<(?:!--|\/?[a-z][^>]*>)/i.test(value);
}
