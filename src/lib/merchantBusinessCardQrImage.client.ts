import { BUSINESS_CARD_QR_IMAGE_FILE_MAX_BYTES, BUSINESS_CARD_QR_IMAGE_MAX_SIDE, isBusinessCardQrUploadRaster, normalizeBusinessCardQrImage } from "./merchantBusinessCardQrImage";

/** Decode and re-encode every upload, including small PNGs. Strip metadata and
 * animation, preserve transparency/aspect ratio, and never embed the source file. */
export async function prepareBusinessCardQrImage(file: File): Promise<string> {
  if (!file.size || file.size > BUSINESS_CARD_QR_IMAGE_FILE_MAX_BYTES) throw new Error("请选择不超过 8 MB 的 PNG、JPG 或 WebP 图片。");
  if (!isBusinessCardQrUploadRaster(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) throw new Error("只支持 PNG、JPG 或 WebP 图片，请勿上传 SVG 或其他文件。");
  const url = URL.createObjectURL(file);
  const image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    image.src = url;
    await Promise.race([image.decode(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("图片读取超时，请换一张较小的图片。")), 12_000);
    })]);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 8192 || height > 8192 || width * height > 20_000_000) throw new Error("图片尺寸过大，请缩小后重试。");
    const canvas = document.createElement("canvas");
    for (const side of [BUSINESS_CARD_QR_IMAGE_MAX_SIDE, 112, 96, 80, 64]) {
      canvas.width = side; canvas.height = side;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器暂不支持处理图片，请更换浏览器后重试。");
      const scale = Math.min(side / width, side / height);
      context.drawImage(image, (side - width * scale) / 2, (side - height * scale) / 2, width * scale, height * scale);
      const result = normalizeBusinessCardQrImage(canvas.toDataURL("image/png"));
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    throw new Error("图片处理后仍然过大，请选择简洁的标志或图案。");
  } finally {
    clearTimeout(timer);
    image.src = "";
    URL.revokeObjectURL(url);
  }
}
