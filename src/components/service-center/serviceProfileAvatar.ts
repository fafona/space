import { PERSONAL_AVATAR_MAX_BYTES } from "@/lib/personalAvatarValue";

export async function prepareServiceAvatar(file: File): Promise<string> {
  if (!/^(image\/jpeg|image\/png|image\/webp)$/i.test(file.type)) throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  if (file.size > 10 * 1024 * 1024) throw new Error("请选择不超过 10 MB 的头像图片。");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("无法读取图片，请换一张图片。")); image.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("图片尺寸过大，请选择较小的图片。");
    for (const side of [512, 384, 256]) {
      const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d"); if (!context) throw new Error("浏览器暂不支持图片处理。");
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.7, 0.5]) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.startsWith("data:image/jpeg;base64,") && (dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4 <= PERSONAL_AVATAR_MAX_BYTES) return dataUrl;
      }
    }
    throw new Error("图片压缩后仍然过大，请换一张图片。");
  } finally { URL.revokeObjectURL(url); }
}
