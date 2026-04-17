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
    return `${Math.max(14, Math.min(64, amount))}px`;
  }

  return `${Math.max(0.875, Math.min(4, amount))}${unit}`;
}

function parseInlineHeadingDeclarations(styleValue: string) {
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
      return {
        property,
        value: property === "font-size" ? clampInlineHeadingSize(rawValue) : rawValue,
      };
    })
    .filter((entry): entry is { property: string; value: string } => !!entry);
}

function mergeInlineHeadingStyles(outerStyle: string, innerStyle: string) {
  const entries = new Map<string, string>();

  for (const entry of parseInlineHeadingDeclarations(outerStyle)) {
    entries.set(entry.property, entry.value);
  }
  for (const entry of parseInlineHeadingDeclarations(innerStyle)) {
    entries.set(entry.property, entry.value);
  }

  return Array.from(entries.entries())
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

function findSingleRootElement(html: string):
  | { openTag: string; inner: string; closeTag: string }
  | null {
  const trimmed = html.trim();
  if (!trimmed || !trimmed.startsWith("<")) return null;

  const voidTags = new Set(["br", "img", "hr", "meta", "link", "input"]);
  const firstTagEnd = trimmed.indexOf(">");
  if (firstTagEnd <= 0) return null;
  const firstTagContent = trimmed.slice(1, firstTagEnd).trim();
  if (!firstTagContent || firstTagContent.startsWith("/")) return null;
  const rootTagName = firstTagContent.replace(/\/+$/, "").split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!rootTagName || voidTags.has(rootTagName)) return null;

  let index = 0;
  let depth = 0;
  let closeStart = -1;
  let closeEnd = -1;

  while (index < trimmed.length) {
    const tagStart = trimmed.indexOf("<", index);
    if (tagStart < 0) break;
    const tagEnd = trimmed.indexOf(">", tagStart);
    if (tagEnd < 0) break;
    const tagContent = trimmed.slice(tagStart + 1, tagEnd).trim();
    const normalizedTag = tagContent.replace(/^\/+/, "").split(/\s+/)[0]?.toLowerCase() ?? "";
    const isClosing = tagContent.startsWith("/");
    const isSelfClosing = tagContent.endsWith("/") || voidTags.has(normalizedTag);

    if (!isClosing && !isSelfClosing) {
      depth += 1;
    } else if (isClosing && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        closeStart = tagStart;
        closeEnd = tagEnd + 1;
        break;
      }
    }

    index = tagEnd + 1;
  }

  if (closeStart <= firstTagEnd || closeEnd !== trimmed.length) return null;
  return {
    openTag: trimmed.slice(0, firstTagEnd + 1),
    inner: trimmed.slice(firstTagEnd + 1, closeStart),
    closeTag: trimmed.slice(closeStart),
  };
}

function extractFirstTopLevelSegment(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.startsWith("<")) {
    return (trimmed.split(/<br\s*\/?>/i)[0] ?? trimmed).trim();
  }

  const voidTags = new Set(["br", "img", "hr", "meta", "link", "input"]);
  let index = 0;
  let depth = 0;
  let started = false;

  while (index < trimmed.length) {
    const tagStart = trimmed.indexOf("<", index);
    if (tagStart < 0) return started ? trimmed.trim() : trimmed;
    if (!started && tagStart > index) {
      started = true;
      return trimmed.slice(0, tagStart).trim();
    }
    const tagEnd = trimmed.indexOf(">", tagStart);
    if (tagEnd < 0) return trimmed;
    const tagContent = trimmed.slice(tagStart + 1, tagEnd).trim();
    const normalizedTag = tagContent.replace(/^\/+/, "").split(/\s+/)[0]?.toLowerCase() ?? "";
    const isClosing = tagContent.startsWith("/");
    const isSelfClosing = tagContent.endsWith("/") || voidTags.has(normalizedTag);

    started = true;
    if (!isClosing && !isSelfClosing) {
      depth += 1;
    } else if (isClosing && depth > 0) {
      depth -= 1;
    }

    index = tagEnd + 1;
    if (depth === 0 && started) {
      return trimmed.slice(0, index).trim();
    }
  }

  return trimmed;
}

function extractFirstInlineHeadingSegment(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return trimmed;

  const singleRoot = findSingleRootElement(trimmed);
  if (singleRoot) {
    const innerSegment = extractFirstInlineHeadingSegment(singleRoot.inner);
    if (!innerSegment) return "";
    const inheritedStyle = singleRoot.openTag.match(/\sstyle=(['"])(.*?)\1/i)?.[2] ?? "";
    const innerRoot = findSingleRootElement(innerSegment);
    if (!innerRoot) {
      const keptInheritedStyle = keepInlineHeadingDeclarations(inheritedStyle);
      return keptInheritedStyle ? `<span style="${keptInheritedStyle}">${innerSegment}</span>` : innerSegment.trim();
    }

    const innerStyle = innerRoot.openTag.match(/\sstyle=(['"])(.*?)\1/i)?.[2] ?? "";
    const mergedStyle = mergeInlineHeadingStyles(inheritedStyle, innerStyle);
    const nextOpenTag = innerStyle
      ? innerRoot.openTag.replace(/\sstyle=(['"])(.*?)\1/i, (_match, quote: string) => ` style=${quote}${mergedStyle}${quote}`)
      : innerRoot.openTag.replace(/>$/, ` style="${mergedStyle}">`);

    return `${nextOpenTag}${innerRoot.inner}${innerRoot.closeTag}`.trim();
  }

  return extractFirstTopLevelSegment(trimmed);
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
  return parseInlineHeadingDeclarations(styleValue)
    .map((entry) => `${entry.property}: ${entry.value}`)
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

  const firstSegment = extractFirstInlineHeadingSegment(normalized);

  return firstSegment
    .replace(/\sstyle=(['"])(.*?)\1/gi, (_match, quote: string, styleValue: string) => {
      const keptStyle = keepInlineHeadingDeclarations(styleValue);
      return keptStyle ? ` style=${quote}${keptStyle}${quote}` : "";
    })
    .replace(/\sclass=(['"])(.*?)\1/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
