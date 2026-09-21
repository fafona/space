import { renderBusinessCardQrSvg, type BusinessCardQrAppearance } from "./merchantBusinessCardQr";

export async function createBusinessCardQrSvg(target: string, options: BusinessCardQrAppearance & { size?: number } = {}) {
  const { default: QRCode } = await import("qrcode");
  const code = QRCode.create(target, { errorCorrectionLevel: "H" });
  return renderBusinessCardQrSvg(code.modules, options);
}

export function businessCardQrSvgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
