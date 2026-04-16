"use client";

import type { ReactNode } from "react";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import {
  normalizeSupportLinkHref,
  parseSupportMessageAttachmentPreview,
  splitSupportLinkToken,
} from "@/lib/supportMessageAttachments";

export type SupportMessageImageActivatePayload = {
  rawText: string;
  imageUrl: string;
  linkUrl: string;
};

function renderSupportMessageText(value: string) {
  const text = String(value ?? "");
  if (!text) return text;
  const parts: ReactNode[] = [];
  const pattern = /((?:https?:\/\/|www\.)[^\s]+)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    const matched = match[0] ?? "";
    const startIndex = match.index;
    if (startIndex > lastIndex) {
      parts.push(text.slice(lastIndex, startIndex));
    }

    const { link, trailing } = splitSupportLinkToken(matched);
    const href = normalizeSupportLinkHref(link);
    if (href) {
      parts.push(
        <a
          key={`support-link-${startIndex}-${link}`}
          className="break-all underline underline-offset-4"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {link}
        </a>,
      );
      if (trailing) {
        parts.push(trailing);
      }
    } else {
      parts.push(matched);
    }

    lastIndex = startIndex + matched.length;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

type SupportMessageContentProps = {
  value: string;
  isSelf?: boolean;
  onImageActivate?: (payload: SupportMessageImageActivatePayload) => void;
};

export default function SupportMessageContent({
  value,
  isSelf = false,
  onImageActivate,
}: SupportMessageContentProps) {
  const attachmentPreview = parseSupportMessageAttachmentPreview(value);

  if (!attachmentPreview) {
    return (
      <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[15px] leading-6">
        {renderSupportMessageText(value)}
      </div>
    );
  }

  const normalizedImageUrl = normalizePublicAssetUrl(attachmentPreview.imageUrl);
  const linkUrl = attachmentPreview.linkUrl;

  const openImagePreview = () => {
    if (onImageActivate) {
      onImageActivate({
        rawText: value,
        imageUrl: normalizedImageUrl,
        linkUrl,
      });
      return;
    }

    if (typeof window !== "undefined") {
      window.open(normalizedImageUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="support-preserve-light-surface block w-full overflow-hidden rounded-[20px] bg-white p-1 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
        onClick={openImagePreview}
        aria-label="查看图片大图"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={normalizedImageUrl}
          alt={linkUrl ? "名片图片" : "聊天图片"}
          className="support-preserve-light-surface block h-auto max-h-[18rem] w-full rounded-[16px] bg-white object-contain"
        />
      </button>
      {linkUrl ? (
        <a
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className={`block break-all text-sm underline underline-offset-4 ${
            isSelf ? "text-white/90" : "text-slate-700"
          }`}
        >
          {linkUrl}
        </a>
      ) : null}
    </div>
  );
}
