import type { Block } from "@/data/homeBlocks";
import { normalizePublicAssetUrl } from "./publicAssetUrl";

export type PublicSiteImageResourceHints = {
  imageUrls: string[];
  preconnectOrigins: string[];
};

type LooseRecord = Record<string, unknown>;

const DEFAULT_IMAGE_HINT_LIMIT = 3;
const DEFAULT_PRECONNECT_LIMIT = 4;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === "object" ? (value as LooseRecord) : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readRecordString(record: LooseRecord | null | undefined, key: string) {
  return readString(record?.[key]);
}

function isPreloadableImageUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^(data|blob|javascript):/i.test(trimmed)) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readAbsoluteOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function addImageUrl(target: string[], seen: Set<string>, value: unknown, preferredOrigin?: string) {
  const normalized = normalizePublicAssetUrl(readString(value), preferredOrigin);
  if (!isPreloadableImageUrl(normalized) || seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
}

function readGalleryImageUrl(item: unknown) {
  if (typeof item === "string") return item;
  return readRecordString(asRecord(item), "url");
}

function collectBlockContentImages(block: Block, target: string[], seen: Set<string>, preferredOrigin?: string) {
  const props = asRecord(block.props);
  if (!props) return;

  if (block.type === "gallery") {
    const images = Array.isArray(props.images) ? props.images : [];
    addImageUrl(target, seen, readGalleryImageUrl(images[0]), preferredOrigin);
    return;
  }

  if (block.type === "merchant-list") {
    const merchants = Array.isArray(props.publishedMerchantSnapshot) ? props.publishedMerchantSnapshot : [];
    const merchant = asRecord(merchants[0]);
    addImageUrl(
      target,
      seen,
      readRecordString(merchant, "merchantCardImageUrl") || readRecordString(merchant, "chatAvatarImageUrl"),
      preferredOrigin,
    );
    return;
  }

  if (block.type === "google-reviews") {
    const reviews = Array.isArray(props.googleReviewItems) ? props.googleReviewItems : [];
    addImageUrl(target, seen, readRecordString(asRecord(reviews[0]), "reviewerPhotoUrl"), preferredOrigin);
  }
}

export function collectPublicSiteImageResourceHints(
  blocks: Block[] | undefined | null,
  options: { imageLimit?: number; preconnectLimit?: number; preferredOrigin?: string } = {},
): PublicSiteImageResourceHints {
  const imageLimit = Math.max(0, Math.min(8, Math.round(options.imageLimit ?? DEFAULT_IMAGE_HINT_LIMIT)));
  const preconnectLimit = Math.max(0, Math.min(8, Math.round(options.preconnectLimit ?? DEFAULT_PRECONNECT_LIMIT)));
  if (!Array.isArray(blocks) || blocks.length === 0 || imageLimit <= 0) {
    return { imageUrls: [], preconnectOrigins: [] };
  }

  const imageUrls: string[] = [];
  const seenImages = new Set<string>();
  const firstProps = asRecord(blocks[0]?.props);
  addImageUrl(imageUrls, seenImages, readRecordString(firstProps, "pageBgImageUrl"), options.preferredOrigin);

  for (const block of blocks) {
    if (!block || imageUrls.length >= imageLimit) break;
    const props = asRecord(block.props);
    if (readRecordString(props, "blockOpenMode") === "button") continue;
    addImageUrl(imageUrls, seenImages, readRecordString(props, "bgImageUrl"), options.preferredOrigin);
    if (imageUrls.length >= imageLimit) break;
    collectBlockContentImages(block, imageUrls, seenImages, options.preferredOrigin);
  }

  const limitedImageUrls = imageUrls.slice(0, imageLimit);
  const preconnectOrigins = Array.from(
    limitedImageUrls.reduce<Set<string>>((origins, imageUrl) => {
      const origin = readAbsoluteOrigin(imageUrl);
      if (origin) origins.add(origin);
      return origins;
    }, new Set<string>()),
  ).slice(0, preconnectLimit);

  return {
    imageUrls: limitedImageUrls,
    preconnectOrigins,
  };
}
