import { renderBusinessCardQrSvg, type BusinessCardQrAppearance } from "./merchantBusinessCardQr";
import { hasBusinessCardQrText } from "./merchantBusinessCardQrText";

export async function createBusinessCardQrSvg(target: string, options: BusinessCardQrAppearance & { size?: number } = {}) {
  const { default: QRCode } = await import("qrcode");
  const code = QRCode.create(target, { errorCorrectionLevel: "H" });
  const svg = renderBusinessCardQrSvg(code.modules, options);
  if (!hasBusinessCardQrText(options)) return svg;
  const { embedBusinessCardQrTextPaths } = await import("./merchantBusinessCardQrTextPaths");
  return embedBusinessCardQrTextPaths(svg, options);
}

export function businessCardQrSvgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Verify decorated downloads in the user's actual browser, not just the unit-test rasterizer.
export async function verifyBusinessCardQrSvg(svg: string, target: string): Promise<boolean> {
  const { default: jsQR } = await import("jsqr");
  const image = new Image();
  const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("qr_image_load_failed")); image.src = source; });
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = Math.round(768 * image.naturalHeight / image.naturalWidth);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data === target;
  } finally { URL.revokeObjectURL(source); }
}

export async function businessCardQrPng(svg: string, size: 2048 | 4096): Promise<Blob> {
  const image = new Image();
  const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("qr_image_load_failed"));
      image.src = source;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = Math.round(size * image.naturalHeight / image.naturalWidth);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("qr_canvas_unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("qr_png_failed")), "image/png"));
  } finally {
    URL.revokeObjectURL(source);
  }
}
