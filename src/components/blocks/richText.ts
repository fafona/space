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
  "text-decoration",
  "color",
  "background-image",
  "background-clip",
  "-webkit-background-clip",
  "-webkit-text-fill-color",
  "text-fill-color",
]);

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
    .filter((declaration) => {
      const colonIndex = declaration.indexOf(":");
      if (colonIndex <= 0) return false;
      const property = declaration.slice(0, colonIndex).trim().toLowerCase();
      return INLINE_HEADING_STYLE_PROPERTIES.has(property);
    })
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

  return source
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<(div|p|h[1-6]|section|article|header|footer|aside|nav|ul|ol|li|figure|figcaption|blockquote)([^>]*)>/gi, "<span$2>")
    .replace(/<\/(div|p|h[1-6]|section|article|header|footer|aside|nav|ul|ol|li|figure|figcaption|blockquote)>/gi, "</span> ")
    .replace(/\sstyle=(['"])(.*?)\1/gi, (_match, quote: string, styleValue: string) => {
      const keptStyle = keepInlineHeadingDeclarations(styleValue);
      return keptStyle ? ` style=${quote}${keptStyle}${quote}` : "";
    })
    .replace(/\sclass=(['"])(.*?)\1/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
