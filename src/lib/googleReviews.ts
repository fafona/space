import type { GoogleReviewItem } from "@/data/homeBlocks";

const STAR_RATING_VALUES: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function trimText(value: unknown, maxLength = 1200) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function normalizeHttpUrl(value: unknown) {
  const text = trimText(value, 2000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeIsoLikeTime(value: unknown) {
  const text = trimText(value, 80);
  if (!text) return "";
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : text;
}

export function createGoogleReviewItemId() {
  return `google-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeGoogleReviewRating(value: unknown, fallback = 0) {
  const mapped =
    typeof value === "string"
      ? STAR_RATING_VALUES[value.trim().toUpperCase()] ?? Number.parseFloat(value)
      : typeof value === "number"
        ? value
        : fallback;
  if (!Number.isFinite(mapped)) return Math.max(0, Math.min(5, fallback));
  return Math.max(0, Math.min(5, Math.round(mapped)));
}

export function normalizeGoogleReviewAverage(value: unknown, fallback = 0) {
  const numericValue = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(numericValue)) return Math.max(0, Math.min(5, fallback));
  return Math.max(0, Math.min(5, Math.round(numericValue * 10) / 10));
}

export function normalizeGoogleReviewTotalCount(value: unknown, fallback = 0) {
  const numericValue = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(numericValue)) return Math.max(0, Math.round(fallback));
  return Math.max(0, Math.round(numericValue));
}

function normalizeReviewItem(value: unknown, index: number): GoogleReviewItem | null {
  const record = toRecord(value);
  if (!record) {
    const comment = trimText(value);
    return comment ? { id: `google-review-${index + 1}`, reviewerName: "", rating: 5, comment } : null;
  }

  const reviewer = toRecord(record.reviewer);
  const reviewReply = toRecord(record.reviewReply);
  const reviewerName =
    trimText(record.reviewerName, 160) ||
    trimText(record.authorName, 160) ||
    trimText(reviewer?.displayName, 160) ||
    trimText(reviewer?.name, 160);
  const comment = trimText(record.comment ?? record.text ?? record.reviewText);
  const rating = normalizeGoogleReviewRating(record.rating ?? record.starRating, 0);
  const replyComment = trimText(record.replyComment ?? reviewReply?.comment);
  const id =
    trimText(record.id, 160) ||
    trimText(record.reviewId, 160) ||
    trimText(record.name, 240) ||
    `google-review-${index + 1}`;

  if (!reviewerName && !comment && rating <= 0) return null;

  return {
    id,
    reviewerName,
    reviewerPhotoUrl:
      normalizeHttpUrl(record.reviewerPhotoUrl) ||
      normalizeHttpUrl(record.profilePhotoUrl) ||
      normalizeHttpUrl(reviewer?.profilePhotoUrl),
    reviewerProfileUrl:
      normalizeHttpUrl(record.reviewerProfileUrl) ||
      normalizeHttpUrl(record.authorUrl) ||
      normalizeHttpUrl(reviewer?.profileUrl),
    rating,
    comment,
    createTime: normalizeIsoLikeTime(record.createTime ?? record.createdAt ?? record.time),
    updateTime: normalizeIsoLikeTime(record.updateTime ?? record.updatedAt),
    languageCode: trimText(record.languageCode, 24),
    replyComment,
    replyTime: normalizeIsoLikeTime(record.replyTime ?? reviewReply?.updateTime),
  };
}

export function normalizeGoogleReviewItems(value: unknown, maxItems = 24): GoogleReviewItem[] {
  if (!Array.isArray(value)) return [];
  const limit = Math.max(1, Math.min(100, Math.round(maxItems)));
  return value
    .slice(0, limit)
    .map((item, index) => normalizeReviewItem(item, index))
    .filter((item): item is GoogleReviewItem => !!item);
}

export function normalizeGoogleBusinessProfileReview(value: unknown): GoogleReviewItem | null {
  return normalizeReviewItem(value, 0);
}

export function normalizeGoogleBusinessProfileReviewList(value: unknown) {
  const record = toRecord(value);
  const reviews = normalizeGoogleReviewItems(record?.reviews, 100);
  const averageRating = normalizeGoogleReviewAverage(record?.averageRating);
  const totalReviewCount = normalizeGoogleReviewTotalCount(record?.totalReviewCount, reviews.length);
  return {
    reviews,
    averageRating,
    totalReviewCount,
    nextPageToken: trimText(record?.nextPageToken, 500),
  };
}
