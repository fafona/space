import type { Font } from "opentype.js";
import { BUSINESS_CARD_QR_TEXT_FONTS, normalizeBusinessCardQrText, type BusinessCardQrTextFont, type BusinessCardQrTextOptions } from "./merchantBusinessCardQrText";

type FontLoader = (file: string) => Promise<ArrayBuffer>;
const fonts = new Map<string, Promise<Font>>();
const downloadFont: FontLoader = async file => {
  const response = await fetch(`/fonts/qr/${file}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("二维码字体加载失败，请重试。");
  return response.arrayBuffer();
};

async function loadFont(id: BusinessCardQrTextFont, loader: FontLoader): Promise<Font> {
  const file = BUSINESS_CARD_QR_TEXT_FONTS.find(font => font.id === id)!.file;
  // Only immutable bundled assets; user input never controls a fetch path.
  const read = async () => {
    const [module, bytes] = await Promise.all([import("opentype.js"), loader(file)]);
    return (module.default ?? module).parse(bytes);
  };
  if (loader !== downloadFont) return read();
  if (!fonts.has(file)) fonts.set(file, read().catch(error => { fonts.delete(file); throw error; }));
  return fonts.get(file)!;
}

// Convert just the chosen caption glyphs to vectors. No external fonts are needed by
// the SVG image, PNG canvas, saved card image, or a recipient's device.
export async function embedBusinessCardQrTextPaths(svg: string, options: BusinessCardQrTextOptions, loader: FontLoader = downloadFont): Promise<string> {
  for (const position of ["top", "bottom"] as const) {
    const value = normalizeBusinessCardQrText(position === "top" ? options.topText : options.bottomText);
    if (!value.enabled || !value.text.trim()) continue;
    const pattern = new RegExp(`<text data-qr-text="${position}"[^>]*>[^<]*<\\/text>`);
    const marker = svg.match(pattern)?.[0];
    if (!marker) continue;
    const centerY = Number(marker.match(/ y="([\d.]+)"/)?.[1]);
    const font = await loadFont(value.font, loader);
    const needsFallback = Array.from(value.text).some(char => !font.charToGlyphIndex(char));
    const fallback = needsFallback ? await loadFont("kuaile", loader) : font;
    const fontSize = value.fontSize * 1000 / 300;
    let x = 0;
    const pieces: { path: ReturnType<Font["getPath"]>; x: number }[] = [];
    // Preserve shaping/kerning for a supported full string, including connected scripts.
    const runs: { font: Font; text: string }[] = [];
    for (const char of value.text) {
      const selected = font.charToGlyphIndex(char) ? font : fallback;
      if (!selected.charToGlyphIndex(char)) throw new Error("字体不支持部分字符，请更换文字（暂不支持表情符号及部分生僻字）。");
      if (runs.at(-1)?.font === selected) runs[runs.length - 1].text += char;
      else runs.push({ font: selected, text: char });
    }
    for (const run of runs) {
      const path = run.font.getPath(run.text, x, 0, fontSize);
      pieces.push({ path, x });
      x += run.font.getAdvanceWidth(run.text, fontSize);
    }
    const bounds = pieces.map(piece => piece.path.getBoundingBox());
    const left = Math.min(...bounds.map(b => b.x1));
    const right = Math.max(...bounds.map(b => b.x2));
    const top = Math.min(...bounds.map(b => b.y1));
    const bottom = Math.max(...bounds.map(b => b.y2));
    const scale = Math.min(1, 880 / Math.max(1, right - left), fontSize * 1.3 / Math.max(1, bottom - top));
    const transform = `translate(${500 - (left + right) * scale / 2} ${centerY - (top + bottom) * scale / 2}) scale(${scale})`;
    const paths = pieces.map(piece => `<path d="${piece.path.toPathData(3)}"/>`).join("");
    svg = svg.replace(pattern, `<g data-qr-text="${position}" data-font="${value.font}" fill="${value.color}" transform="${transform}">${paths}</g>`);
  }
  return svg;
}
