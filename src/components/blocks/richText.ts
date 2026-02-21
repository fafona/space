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
