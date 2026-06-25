"use client";

import type { CSSProperties } from "react";
import type { GoogleReviewDisplayMode, GoogleReviewItem, GoogleReviewsProps } from "@/data/homeBlocks";
import {
  normalizeGoogleReviewAverage,
  normalizeGoogleReviewItems,
  normalizeGoogleReviewTotalCount,
} from "@/lib/googleReviews";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { resolveMobileFitCardClass, resolveMobileFitSectionClass } from "./mobileFrame";
import { toRichHtml } from "./richText";

function normalizeDisplayMode(value: GoogleReviewDisplayMode | undefined): GoogleReviewDisplayMode {
  return value === "list" || value === "compact" ? value : "cards";
}

function clampMaxItems(value: unknown) {
  const numericValue = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(numericValue)) return 6;
  return Math.max(1, Math.min(12, Math.round(numericValue)));
}

function formatReviewDate(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function deriveAverageRating(items: GoogleReviewItem[]) {
  const ratings = items
    .map((item) => (typeof item.rating === "number" && Number.isFinite(item.rating) ? item.rating : 0))
    .filter((rating) => rating > 0);
  if (ratings.length === 0) return 0;
  return normalizeGoogleReviewAverage(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length);
}

function photoBackgroundStyle(photoUrl: string | undefined): CSSProperties {
  if (!photoUrl) return {};
  return {
    backgroundImage: `url("${photoUrl.replaceAll('"', "%22")}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

function StarRating({ rating, compact = false }: { rating: number; compact?: boolean }) {
  const percentage = `${Math.max(0, Math.min(100, (rating / 5) * 100)).toFixed(0)}%`;
  const sizeClass = compact ? "text-sm" : "text-base";
  return (
    <span className={`relative inline-block leading-none ${sizeClass}`} aria-label={`${rating} / 5`}>
      <span className="text-slate-300">★★★★★</span>
      <span className="absolute inset-0 overflow-hidden text-amber-500" style={{ width: percentage }}>
        ★★★★★
      </span>
    </span>
  );
}

function ReviewCard({
  item,
  compact,
  showAuthorPhoto,
  showDate,
  showReply,
}: {
  item: GoogleReviewItem;
  compact: boolean;
  showAuthorPhoto: boolean;
  showDate: boolean;
  showReply: boolean;
}) {
  const reviewerName = item.reviewerName?.trim() || "Google 用户";
  const rating = normalizeGoogleReviewAverage(item.rating, 0);
  const createDate = formatReviewDate(item.createTime);
  const replyDate = formatReviewDate(item.replyTime);
  const avatar = showAuthorPhoto ? (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600 ring-1 ring-slate-200"
      style={photoBackgroundStyle(item.reviewerPhotoUrl)}
      aria-hidden="true"
    >
      {item.reviewerPhotoUrl ? null : reviewerName.slice(0, 1).toUpperCase()}
    </span>
  ) : null;
  const author = item.reviewerProfileUrl ? (
    <a className="font-semibold text-slate-900 hover:text-blue-700" href={item.reviewerProfileUrl} target="_blank" rel="noreferrer">
      {reviewerName}
    </a>
  ) : (
    <span className="font-semibold text-slate-900">{reviewerName}</span>
  );

  return (
    <article className="rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {author}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Google</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {rating > 0 ? <StarRating rating={rating} compact={compact} /> : null}
            {showDate && createDate ? <span className="text-xs text-slate-500">{createDate}</span> : null}
          </div>
        </div>
      </div>
      {item.comment ? (
        <p className={`mt-3 whitespace-pre-wrap break-words text-slate-700 ${compact ? "text-sm leading-6" : "text-sm leading-6"}`}>
          {item.comment}
        </p>
      ) : null}
      {showReply && item.replyComment ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span>商家回复</span>
            {replyDate ? <span>{replyDate}</span> : null}
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words leading-6">{item.replyComment}</div>
        </div>
      ) : null}
    </article>
  );
}

export default function GoogleReviewsBlock({
  heading = "Google 评论",
  text = "来自 Google 的客户评价。",
  googleReviewItems = [],
  googleReviewAverageRating,
  googleReviewTotalCount,
  googleReviewUrl = "",
  googleReviewWriteUrl = "",
  googleReviewSourceLabel = "Google",
  googleReviewDisplayMode = "cards",
  googleReviewMaxItems = 6,
  googleReviewShowAuthorPhoto = true,
  googleReviewShowDates = true,
  googleReviewShowReplies = true,
  googleReviewEmptyText = "暂无可展示的 Google 评论",
  googleReviewSyncedAt = "",
  ...backgroundProps
}: GoogleReviewsProps) {
  const mobileFitScreenWidth = backgroundProps.mobileFitScreenWidth === true;
  const displayMode = normalizeDisplayMode(googleReviewDisplayMode);
  const maxItems = clampMaxItems(googleReviewMaxItems);
  const items = normalizeGoogleReviewItems(googleReviewItems, maxItems);
  const derivedAverage = deriveAverageRating(items);
  const hasExplicitAverage = typeof googleReviewAverageRating === "number" && Number.isFinite(googleReviewAverageRating);
  const averageRating = hasExplicitAverage ? normalizeGoogleReviewAverage(googleReviewAverageRating) : derivedAverage;
  const totalCount = normalizeGoogleReviewTotalCount(googleReviewTotalCount, items.length);
  const cardStyle = getBackgroundStyle({
    imageUrl: backgroundProps.bgImageUrl,
    fillMode: backgroundProps.bgFillMode,
    position: backgroundProps.bgPosition,
    color: backgroundProps.bgColor,
    opacity: backgroundProps.bgOpacity,
    imageOpacity: backgroundProps.bgImageOpacity,
    colorOpacity: backgroundProps.bgColorOpacity,
  });
  const blockWidth =
    typeof backgroundProps.blockWidth === "number" && Number.isFinite(backgroundProps.blockWidth)
      ? Math.max(240, Math.round(backgroundProps.blockWidth))
      : undefined;
  const blockHeight =
    typeof backgroundProps.blockHeight === "number" && Number.isFinite(backgroundProps.blockHeight)
      ? Math.max(120, Math.round(backgroundProps.blockHeight))
      : undefined;
  const sizeStyle = {
    width: blockWidth ? `${blockWidth}px` : undefined,
    height: blockHeight ? `${blockHeight}px` : undefined,
    overflow: blockHeight ? ("auto" as const) : undefined,
  };
  const offsetX =
    typeof backgroundProps.blockOffsetX === "number" && Number.isFinite(backgroundProps.blockOffsetX)
      ? Math.round(backgroundProps.blockOffsetX)
      : 0;
  const offsetY =
    typeof backgroundProps.blockOffsetY === "number" && Number.isFinite(backgroundProps.blockOffsetY)
      ? Math.round(backgroundProps.blockOffsetY)
      : 0;
  const blockLayer =
    typeof backgroundProps.blockLayer === "number" && Number.isFinite(backgroundProps.blockLayer)
      ? Math.max(1, Math.round(backgroundProps.blockLayer))
      : 1;
  const offsetStyle = {
    position: "relative" as const,
    transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
    zIndex: blockLayer,
  };
  const borderClass = getBlockBorderClass(backgroundProps.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(backgroundProps.blockBorderStyle, backgroundProps.blockBorderColor);
  const isTightBlock = typeof blockWidth === "number" && blockWidth < 430;
  const cardPaddingClass = isTightBlock ? "p-4" : "p-6";
  const headerGridStyle: CSSProperties = {
    gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
  };
  const reviewMinColumnWidth = displayMode === "compact" ? 220 : 300;
  const reviewGridStyle: CSSProperties = {
    gridTemplateColumns:
      displayMode === "list"
        ? "minmax(0, 1fr)"
        : `repeat(auto-fit, minmax(min(${reviewMinColumnWidth}px, 100%), 1fr))`,
  };
  const gridClass =
    displayMode === "list"
      ? "grid gap-3"
      : displayMode === "compact"
        ? "grid gap-3"
        : "grid gap-4";
  const syncedLabel = formatReviewDate(googleReviewSyncedAt);
  const sourceLabel = googleReviewSourceLabel.trim() || "Google";

  return (
    <section className={resolveMobileFitSectionClass("max-w-6xl mx-auto px-6 py-6", mobileFitScreenWidth)} style={offsetStyle}>
      <div
        className={resolveMobileFitCardClass(`bg-white rounded-xl shadow-sm ${cardPaddingClass} overflow-hidden ${borderClass}`, mobileFitScreenWidth)}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        <div className="grid items-start gap-4" style={headerGridStyle}>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: toRichHtml(heading, "Google 评论") }} />
            <div
              className="mt-2 text-sm text-slate-600 whitespace-pre-wrap break-words"
              dangerouslySetInnerHTML={{ __html: toRichHtml(text, "来自 Google 的客户评价。") }}
            />
          </div>
          <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-2xl font-bold text-slate-950">{averageRating > 0 ? averageRating.toFixed(1) : "-"}</span>
              {averageRating > 0 ? <StarRating rating={averageRating} /> : null}
            </div>
            <div className="mt-1 break-words text-xs text-slate-500">
              {totalCount > 0 ? `${totalCount} 条${sourceLabel}评论` : sourceLabel}
            </div>
            {syncedLabel ? <div className="mt-1 text-[11px] text-slate-400">更新于 {syncedLabel}</div> : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {googleReviewUrl ? (
            <a
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-800 hover:bg-slate-50"
              href={googleReviewUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看 Google 评论
            </a>
          ) : null}
          {googleReviewWriteUrl ? (
            <a
              className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700"
              href={googleReviewWriteUrl}
              target="_blank"
              rel="noreferrer"
            >
              写评价
            </a>
          ) : null}
        </div>

        {items.length > 0 ? (
          <div className={`mt-5 ${gridClass}`} style={reviewGridStyle}>
            {items.map((item, index) => (
              <ReviewCard
                key={item.id || `google-review-${index}`}
                item={item}
                compact={displayMode === "compact"}
                showAuthorPhoto={googleReviewShowAuthorPhoto !== false}
                showDate={googleReviewShowDates !== false}
                showReply={googleReviewShowReplies !== false}
              />
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            {googleReviewEmptyText}
          </div>
        )}
      </div>
    </section>
  );
}
