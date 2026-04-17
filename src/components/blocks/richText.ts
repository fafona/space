export function toRichHtml(value: string | undefined, fallback: string): string {
  const source = value && value.length ? value : fallback;
  if (/<[a-z][\s\S]*>/i.test(source)) {
    return source;
  }

  const escaped = source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return escaped.replaceAll("\n", "<br />");
}

const TEXT_COLOR_STYLE_PROPERTIES = new Set([
  "color",
  "background-image",
  "background-clip",
  "-webkit-background-clip",
  "-webkit-text-fill-color",
  "text-fill-color",
]);

const INLINE_HEADING_STYLE_PROPERTIES = new Set([
  "font-family",
  "font-weight",
  "font-style",
  "font-size",
  "line-height",
  "letter-spacing",
  "text-transform",
  "text-decoration",
  "color",
  "background-image",
  "background-clip",
  "-webkit-background-clip",
  "-webkit-text-fill-color",
  "text-fill-color",
]);

function clampInlineHeadingSize(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?\d*\.?\d+)(px|rem|em)$/i);
  if (!match) return trimmed;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) return trimmed;

  if (unit === "px") {
    return `${Math.max(14, Math.min(26, amount))}px`;
  }

  return `${Math.max(0.875, Math.min(1.625, amount))}${unit}`;
}

function stripTextColorDeclarations(styleValue: string): string {
  return styleValue
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => {
      const colonIndex = declaration.indexOf(":");
      if (colonIndex <= 0) return true;
      const property = declaration.slice(0, colonIndex).trim().toLowerCase();
      return !TEXT_COLOR_STYLE_PROPERTIES.has(property);
    })
    .join("; ");
}

function keepInlineHeadingDeclarations(styleValue: string): string {
  return styleValue
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colonIndex = declaration.indexOf(":");
      if (colonIndex <= 0) return null;
      const property = declaration.slice(0, colonIndex).trim().toLowerCase();
      if (!INLINE_HEADING_STYLE_PROPERTIES.has(property)) return null;
      const rawValue = declaration.slice(colonIndex + 1).trim();
      if (!rawValue) return null;
      if (property === "font-size") {
        return `${property}: ${clampInlineHeadingSize(rawValue)}`;
      }
      return `${property}: ${rawValue}`;
    })
    .filter(Boolean)
    .join("; ");
}

export function stripInlineTextColorStylesFromHtml(html: string): string {
  if (!html) return html;

  return html
    .replace(/\sstyle=(['"])(.*?)\1/gi, (_match, quote: string, styleValue: string) => {
      const strippedStyle = stripTextColorDeclarations(styleValue);
      return strippedStyle ? ` style=${quote}${strippedStyle}${quote}` : "";
    })
    .replace(/\scolor=(['"])(.*?)\1/gi, "");
}

export function toInlineHeadingHtml(value: string | undefined, fallback: string): string {
  const source = toRichHtml(value, fallback);
  if (!source) return source;

  const normalized = source
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<\/(div|p|h[1-6]|section|article|header|footer|aside|nav|ul|ol|li|figure|figcaption|blockquote)>/gi, "</span><br />")
    .replace(/<(div|p|h[1-6]|section|article|header|footer|aside|nav|ul|ol|li|figure|figcaption|blockquote)([^>]*)>/gi, "<span$2>")
    .replace(/<br\s*\/?>/gi, "<br />");

  const firstSegment = normalized.split(/<br\s*\/?>/i)[0] ?? normalized;

  return firstSegment
    .replace(/\sstyle=(['"])(.*?)\1/gi, (_match, quote: string, styleValue: string) => {
      const keptStyle = keepInlineHeadingDeclarations(styleValue);
      return keptStyle ? ` style=${quote}${keptStyle}${quote}` : "";
    })
    .replace(/\sclass=(['"])(.*?)\1/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
