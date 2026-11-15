import { normalizePublicAssetUrl } from "./publicAssetUrl";

export type GalleryVideoProps = {
  galleryMedia?: "images" | "background-video" | "video";
  galleryVideoUrl?: string;
  galleryVideoMobileUrl?: string;
  galleryVideoPosterUrl?: string;
  galleryVideoPosition?: string;
};
export function publicGalleryVideoUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 4096 || /^(?:data|blob):/i.test(value.trim())) return "";
  const url = normalizePublicAssetUrl(value);
  try {
    const parsed = new URL(url, "https://gallery-video.invalid");
    return !parsed.username && !parsed.password && /\.(?:mp4|webm)$/i.test(parsed.pathname) ? url : "";
  } catch { return ""; }
}
export function galleryVideoSettings(props: GalleryVideoProps, fallbackPoster = "") {
  const media = props.galleryMedia === "background-video" || props.galleryMedia === "video" ? props.galleryMedia : "images";
  const position = typeof props.galleryVideoPosition === "string" && /^(?:100|\d{1,2})% (?:100|\d{1,2})%$/.test(props.galleryVideoPosition)
    ? props.galleryVideoPosition : "50% 50%";
  return { media, url: publicGalleryVideoUrl(props.galleryVideoUrl), mobileUrl: publicGalleryVideoUrl(props.galleryVideoMobileUrl),
    poster: normalizePublicAssetUrl(props.galleryVideoPosterUrl || "") || normalizePublicAssetUrl(fallbackPoster), position };
}
