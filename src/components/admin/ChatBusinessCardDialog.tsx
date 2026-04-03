"use client";

import { createPortal } from "react-dom";
import {
  buildMerchantBusinessCardShareUrl,
  resolveMerchantBusinessCardShareOrigin,
  type MerchantBusinessCardShareContact,
} from "@/lib/merchantBusinessCardShare";
import { type MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";

type ChatBusinessCardDialogProps = {
  open: boolean;
  merchantName: string;
  subtitle?: string;
  card: MerchantBusinessCardAsset | null;
  loading?: boolean;
  error?: string;
  onClose: () => void;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildCardShareContact(card: MerchantBusinessCardAsset): MerchantBusinessCardShareContact {
  return {
    displayName: normalizeText(card.contacts.contactName) || normalizeText(card.name),
    organization: normalizeText(card.name),
    title: normalizeText(card.title),
    phone: normalizeText(card.contacts.phone),
    phones: Array.isArray(card.contacts.phones) ? card.contacts.phones.filter(Boolean) : [],
    contactFieldOrder: card.contactFieldOrder,
    contactOnlyFields: card.contactOnlyFields,
    email: normalizeText(card.contacts.email),
    address: normalizeText(card.contacts.address),
    wechat: normalizeText(card.contacts.wechat),
    whatsapp: normalizeText(card.contacts.whatsapp),
    twitter: normalizeText(card.contacts.twitter),
    weibo: normalizeText(card.contacts.weibo),
    telegram: normalizeText(card.contacts.telegram),
    linkedin: normalizeText(card.contacts.linkedin),
    discord: normalizeText(card.contacts.discord),
    facebook: normalizeText(card.contacts.facebook),
    instagram: normalizeText(card.contacts.instagram),
    tiktok: normalizeText(card.contacts.tiktok),
    douyin: normalizeText(card.contacts.douyin),
    xiaohongshu: normalizeText(card.contacts.xiaohongshu),
    websiteUrl: normalizeText(card.targetUrl),
  };
}

function buildChatCardLink(card: MerchantBusinessCardAsset | null) {
  if (!card || card.mode !== "link") return "";
  const targetUrl = normalizeText(card.targetUrl);
  if (!targetUrl) return "";
  return buildMerchantBusinessCardShareUrl({
    origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
    shareKey: normalizeText(card.shareKey),
    name: normalizeText(card.name),
    imageUrl: normalizeText(card.shareImageUrl) || normalizeText(card.imageUrl),
    detailImageUrl: normalizeText(card.contactPagePublicImageUrl) || normalizeText(card.contactPageImageUrl),
    detailImageHeight: card.contactPageImageHeight,
    targetUrl,
    contact: buildCardShareContact(card),
  });
}

export default function ChatBusinessCardDialog({
  open,
  merchantName,
  subtitle = "",
  card,
  loading = false,
  error = "",
  onClose,
}: ChatBusinessCardDialogProps) {
  if (!open || typeof document === "undefined") return null;
  const shareUrl = buildChatCardLink(card);

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[2147483400] bg-black/50"
        onClick={onClose}
        aria-label="关闭名片弹窗"
      />
      <div className="fixed inset-0 z-[2147483401] flex items-center justify-center p-4">
        <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-slate-900">{merchantName || "名片"}</div>
              {subtitle ? <div className="truncate text-xs text-slate-500">{subtitle}</div> : null}
            </div>
            <button
              type="button"
              className="shrink-0 rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-5">
            {loading ? (
              <div className="rounded-2xl border border-dashed bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                正在加载聊天名片...
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-10 text-center text-sm text-rose-600">
                {error}
              </div>
            ) : card ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-2xl border bg-slate-50 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.imageUrl}
                    alt={card.name}
                    className="mx-auto block h-auto max-h-[60vh] w-auto max-w-full bg-transparent object-contain"
                  />
                </div>
                <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                  <div className="text-sm font-medium text-slate-900">{card.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {card.mode === "link" ? "链接模式名片" : "图片模式名片"}
                  </div>
                  {shareUrl ? (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs font-medium text-slate-600">名片链接</div>
                      <a
                        href={shareUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all text-sm text-blue-600 underline underline-offset-4"
                      >
                        {shareUrl}
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                这个商户当前没有设置用于聊天展示的名片。
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
