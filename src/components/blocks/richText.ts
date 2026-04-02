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

export function stripInlineTextColorStylesFromHtml(html: string): string {
  if (!html) return html;

  return html
    .replace(/\sstyle=(['"])(.*?)\1/gi, (_match, quote: string, styleValue: string) => {
      const strippedStyle = stripTextColorDeclarations(styleValue);
      return strippedStyle ? ` style=${quote}${strippedStyle}${quote}` : "";
    })
    .replace(/\scolor=(['"])(.*?)\1/gi, "");
}
