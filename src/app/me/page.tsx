"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useI18n } from "@/components/I18nProvider";
import { readMerchantSessionMerchantIds } from "@/lib/authSessionRecovery";
import {
  getEuropeCityOptions,
  getEuropeCountryOptions,
  getEuropeProvinceOptions,
} from "@/lib/europeLocationOptions";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import { buildFaollaShellHref, isFaollaSectionSearch, readFaollaEntryUrlFromSearch } from "@/lib/faollaEntry";
import { buildMerchantBusinessCardShareUrl, resolveMerchantBusinessCardShareOrigin } from "@/lib/merchantBusinessCardShare";
import { buildMerchantFrontendHref } from "@/lib/siteRouting";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import SupportMessageContent from "@/components/support/SupportMessageContent";
import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import type { MerchantContactVisibility, SiteLocation } from "@/data/platformControlStore";
import {
  findMerchantPeerThreadForMerchants,
  type MerchantPeerContactSummary,
  type MerchantPeerThread,
} from "@/lib/merchantPeerInbox";
import { type PlatformSupportMessage, type PlatformSupportThread } from "@/lib/platformSupportInbox";
import {
  formatSupportConversationPreview,
  parseSupportMessageAttachmentPreview,
} from "@/lib/supportMessageAttachments";

type MeSessionPayload = {
  authenticated?: unknown;
  accountType?: unknown;
  accountId?: unknown;
  merchantId?: unknown;
  merchantIds?: unknown;
  user?: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
    app_metadata?: Record<string, unknown> | null;
  } | null;
};

type DesktopSection = "conversations" | "bookings" | "orders" | "favorites" | "cards" | "faolla" | "profile";
type MobileTab = "conversations" | "consumption" | "faolla" | "self";
type ConsumptionSection = "bookings" | "orders";
type MobileConversationView = "list" | "thread";
type MobileSelfSection = "home" | "profile" | "cards" | "notifications";

type MenuItem = {
  key: DesktopSection;
  label: string;
  description: string;
  badge?: string;
};

type SupportResponsePayload = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  thread?: PlatformSupportThread | null;
};

type MerchantPeerResponsePayload = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  contact?: {
    merchantId?: unknown;
    merchantName?: unknown;
    merchantEmail?: unknown;
  } | null;
  contacts?: MerchantPeerContactSummary[];
  threads?: MerchantPeerThread[];
};

type PersonalConversationKey = "official" | `merchant:${string}`;

type PersonalVisibleSupportMessage = Pick<PlatformSupportMessage, "id" | "text" | "createdAt"> & {
  isSelf: boolean;
  senderLabel: string;
};

type SupportContactRow = {
  key: PersonalConversationKey;
  name: string;
  badge?: string;
  subtitle: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  avatarLabel: string;
  avatarImageUrl: string;
  accountType?: "merchant" | "personal";
  isOfficial: boolean;
};

type ConversationInfoItem = {
  label: string;
  value: string;
  href?: string;
  openInNewTab?: boolean;
};

type PersonalLocationField = "country" | "province" | "city";

type PersonalLocationOption = {
  value: string;
  label: string;
};

type PersonalProfileDraft = {
  displayName: string;
  avatarUrl: string;
  signature: string;
  phone: string;
  email: string;
  contactCard: string;
  birthday: string;
  gender: string;
  country: string;
  province: string;
  city: string;
  address: string;
};

type PersonalProfileResponsePayload = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  user?: MeSessionPayload["user"] | null;
  profile?: Partial<PersonalProfileDraft> | null;
};

const OFFICIAL_CONVERSATION_KEY: PersonalConversationKey = "official";
const SUPPORT_PHOTO_PICKER_ACCEPT = "image/png,image/jpeg,image/webp,image/heic,image/heif,image/gif";
const PERSONAL_LOCATION_TYPEAHEAD_LIMIT = 30;
const SUPPORT_FILE_PICKER_ACCEPT = [
  ".pdf",
  ".txt",
  ".csv",
  ".json",
  ".zip",
  ".rar",
  ".7z",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
].join(",");
const PERSONAL_AVATAR_MAX_BYTES = 512 * 1024;

const EMPTY_PERSONAL_PROFILE: PersonalProfileDraft = {
  displayName: "",
  avatarUrl: "",
  signature: "",
  phone: "",
  email: "",
  contactCard: "",
  birthday: "",
  gender: "",
  country: "",
  province: "",
  city: "",
  address: "",
};

function trimText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readPayloadMessage(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readMetadataString(metadata: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readDisplayName(payload: MeSessionPayload | null) {
  const userMetadata = payload?.user?.user_metadata ?? null;
  const appMetadata = payload?.user?.app_metadata ?? null;
  const profile = userMetadata?.personal_profile;
  if (profile && typeof profile === "object") {
    const profileName = readMetadataString(profile as Record<string, unknown>, "displayName", "display_name", "name");
    if (profileName) return profileName;
  }
  for (const source of [userMetadata, appMetadata]) {
    if (!source || typeof source !== "object") continue;
    for (const key of ["display_name", "displayName", "username", "name"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

function readPersonalProfile(payload: MeSessionPayload | null): PersonalProfileDraft {
  const userMetadata = payload?.user?.user_metadata ?? null;
  const appMetadata = payload?.user?.app_metadata ?? null;
  const profile =
    userMetadata?.personal_profile && typeof userMetadata.personal_profile === "object"
      ? (userMetadata.personal_profile as Record<string, unknown>)
      : {};
  const read = (...keys: string[]) =>
    readMetadataString(profile, ...keys) || readMetadataString(userMetadata, ...keys) || readMetadataString(appMetadata, ...keys);

  return {
    displayName: read("displayName", "display_name", "username", "name"),
    avatarUrl: read("avatarUrl", "avatar_url", "personalAvatarUrl", "chatAvatarImageUrl"),
    signature: read("signature", "bio"),
    phone: read("phone", "contact_phone", "contactPhone"),
    email: read("email", "contact_email", "contactEmail") || trimText(payload?.user?.email),
    contactCard: read("contactCard", "contact_card", "businessCardUrl", "business_card_url"),
    birthday: read("birthday", "birthdate"),
    gender: read("gender"),
    country: read("country"),
    province: read("province", "state"),
    city: read("city"),
    address: read("address", "contactAddress"),
  };
}

function mergePersonalProfileDraft(base: PersonalProfileDraft, patch: Partial<PersonalProfileDraft> | null | undefined) {
  const next = { ...EMPTY_PERSONAL_PROFILE, ...base };
  if (!patch || typeof patch !== "object") return next;
  (Object.keys(EMPTY_PERSONAL_PROFILE) as Array<keyof PersonalProfileDraft>).forEach((key) => {
    const value = patch[key];
    if (typeof value === "string") next[key] = value;
  });
  return next;
}

function getInitialLabel(value: unknown) {
  const trimmed = trimText(value);
  if (!trimmed) return "我";
  const first = Array.from(trimmed)[0] ?? "我";
  return first.toUpperCase();
}

function getSupportContactAvatarLabel(value: unknown, fallback = "商") {
  const trimmed = trimText(value);
  if (!trimmed) return fallback;
  const first = Array.from(trimmed)[0] ?? fallback;
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  return first;
}

function normalizePersonalLocationValue(value: unknown) {
  return trimText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function buildPersonalLocationOptions(
  options: PersonalLocationOption[],
  inputValue: string,
  limit = PERSONAL_LOCATION_TYPEAHEAD_LIMIT,
) {
  const normalized = normalizePersonalLocationValue(inputValue);
  if (!normalized) return options.slice(0, limit);

  const starts: PersonalLocationOption[] = [];
  const includes: PersonalLocationOption[] = [];
  for (const item of options) {
    const normalizedLabel = normalizePersonalLocationValue(item.label);
    const normalizedValue = normalizePersonalLocationValue(item.value);
    if (normalizedLabel.startsWith(normalized) || normalizedValue.startsWith(normalized)) {
      starts.push(item);
      continue;
    }
    if (normalizedLabel.includes(normalized) || normalizedValue.includes(normalized)) {
      includes.push(item);
    }
    if (starts.length + includes.length >= limit * 3) break;
  }
  return [...starts, ...includes].slice(0, limit);
}

function sanitizeMerchantPeerMessage(value: unknown): MerchantPeerThread["messages"][number] | null {
  const record = readRecord(value);
  if (!record) return null;

  const senderMerchantId = trimText(record.senderMerchantId);
  const text = trimText(record.text);
  const createdAt = trimText(record.createdAt);
  const id = trimText(record.id) || [senderMerchantId, createdAt, text.slice(0, 24)].filter(Boolean).join(":");
  if (!id && !text && !createdAt) return null;

  return {
    id: id || `message:${Date.now()}`,
    senderMerchantId,
    text,
    createdAt,
  };
}

function sanitizeMerchantPeerContactSummary(value: unknown): MerchantPeerContactSummary | null {
  const record = readRecord(value);
  if (!record) return null;

  const merchantId = trimText(record.merchantId);
  if (!merchantId) return null;

  const accountType =
    record.accountType === "personal" || record.accountType === "merchant" ? record.accountType : undefined;
  const savedAt = trimText(record.savedAt);
  const chatBusinessCard = readRecord(record.chatBusinessCard)
    ? (record.chatBusinessCard as MerchantPeerContactSummary["chatBusinessCard"])
    : null;

  const contact: MerchantPeerContactSummary = {
    merchantId,
    merchantName: trimText(record.merchantName) || merchantId,
    merchantEmail: trimText(record.merchantEmail),
    savedAt,
    updatedAt: trimText(record.updatedAt) || savedAt,
    lastMessage: sanitizeMerchantPeerMessage(record.lastMessage),
  };

  if (accountType) contact.accountType = accountType;
  const avatarImageUrl = trimText(record.avatarImageUrl);
  const chatAvatarImageUrl = trimText(record.chatAvatarImageUrl);
  const signature = trimText(record.signature);
  const industry = trimText(record.industry);
  const contactName = trimText(record.contactName);
  const contactPhone = trimText(record.contactPhone);
  const contactCard = trimText(record.contactCard);
  const contactAddress = trimText(record.contactAddress);
  const domain = trimText(record.domain);
  const domainPrefix = trimText(record.domainPrefix);
  const domainSuffix = trimText(record.domainSuffix);
  const merchantCardImageUrl = trimText(record.merchantCardImageUrl);
  const locationRecord = readRecord(record.location);
  if (avatarImageUrl) contact.avatarImageUrl = avatarImageUrl;
  if (chatAvatarImageUrl) contact.chatAvatarImageUrl = chatAvatarImageUrl;
  if (signature) contact.signature = signature;
  if (industry) contact.industry = industry;
  if (contactName) contact.contactName = contactName;
  if (contactPhone) contact.contactPhone = contactPhone;
  if (contactCard) contact.contactCard = contactCard;
  if (contactAddress) contact.contactAddress = contactAddress;
  if (domain) contact.domain = domain;
  if (domainPrefix) contact.domainPrefix = domainPrefix;
  if (domainSuffix) contact.domainSuffix = domainSuffix;
  if (merchantCardImageUrl) contact.merchantCardImageUrl = merchantCardImageUrl;
  if (locationRecord) {
    contact.location = {
      countryCode: trimText(locationRecord.countryCode),
      country: trimText(locationRecord.country),
      provinceCode: trimText(locationRecord.provinceCode),
      province: trimText(locationRecord.province),
      city: trimText(locationRecord.city),
    };
  }
  if (record.contactVisibility !== undefined) {
    contact.contactVisibility = normalizeConversationContactVisibility(record.contactVisibility);
  }
  if (chatBusinessCard) contact.chatBusinessCard = chatBusinessCard;

  return contact;
}

function sanitizeMerchantPeerThread(value: unknown): MerchantPeerThread | null {
  const record = readRecord(value);
  if (!record) return null;

  const merchantAId = trimText(record.merchantAId);
  const merchantBId = trimText(record.merchantBId);
  const messages = Array.isArray(record.messages)
    ? record.messages
        .map(sanitizeMerchantPeerMessage)
        .filter((message): message is MerchantPeerThread["messages"][number] => message !== null)
    : [];

  if (!merchantAId && !merchantBId && messages.length === 0) return null;

  return {
    threadKey: trimText(record.threadKey) || [merchantAId, merchantBId].filter(Boolean).join(":"),
    merchantAId,
    merchantAName: trimText(record.merchantAName) || merchantAId,
    merchantAEmail: trimText(record.merchantAEmail),
    merchantBId,
    merchantBName: trimText(record.merchantBName) || merchantBId,
    merchantBEmail: trimText(record.merchantBEmail),
    updatedAt: trimText(record.updatedAt),
    messages,
  };
}

function buildVisibleSupportMessageKey(message: Pick<PersonalVisibleSupportMessage, "id" | "createdAt">) {
  return `${message.id}:${normalizeSupportMessageTimestamp(message.createdAt) || message.createdAt}`;
}

function normalizeSupportMessageTimestamp(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function compareSupportMessages(left: Pick<PersonalVisibleSupportMessage, "createdAt" | "id">, right: Pick<PersonalVisibleSupportMessage, "createdAt" | "id">) {
  const leftTs = new Date(normalizeSupportMessageTimestamp(left.createdAt) || left.createdAt).getTime();
  const rightTs = new Date(normalizeSupportMessageTimestamp(right.createdAt) || right.createdAt).getTime();
  if (leftTs !== rightTs) return leftTs - rightTs;
  return left.id.localeCompare(right.id, "en");
}

function formatSupportClockTime(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      })
    : normalized;
}

function formatSupportConversationTime(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  const date = new Date(normalized);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return normalized;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfTarget) / 86400000);

  if (dayDiff === 0) return formatSupportClockTime(normalized);
  if (dayDiff === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function formatSupportThreadDateLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const date = new Date(normalized);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return normalized;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfTarget) / 86400000);

  if (dayDiff === 0) return "今天";
  if (dayDiff === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("zh-CN", {
      month: "long",
      day: "numeric",
    });
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function isSameSupportCalendarDay(left: string | null | undefined, right: string | null | undefined) {
  const leftDate = new Date(String(left ?? "").trim());
  const rightDate = new Date(String(right ?? "").trim());
  if (!Number.isFinite(leftDate.getTime()) || !Number.isFinite(rightDate.getTime())) return false;
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("file_read_failed"));
    });
    reader.readAsDataURL(file);
  });
}

function readDataUrlByteLength(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_load_failed"));
    };
    image.src = url;
  });
}

async function compressPersonalAvatarFile(file: File) {
  if (file.size > 0 && file.size <= PERSONAL_AVATAR_MAX_BYTES) return fileToDataUrl(file);
  const image = await loadImageElement(file);
  const longestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1);
  const steps = [
    { maxSide: 512, quality: 0.82 },
    { maxSide: 384, quality: 0.76 },
    { maxSide: 320, quality: 0.7 },
    { maxSide: 256, quality: 0.64 },
    { maxSide: 192, quality: 0.58 },
  ];
  let smallest = "";
  let smallestBytes = Number.POSITIVE_INFINITY;
  for (const step of steps) {
    const scale = Math.min(1, step.maxSide / longestSide);
    const width = Math.max(1, Math.round((image.naturalWidth || image.width || 1) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", step.quality);
    const bytes = readDataUrlByteLength(dataUrl);
    if (bytes < smallestBytes) {
      smallest = dataUrl;
      smallestBytes = bytes;
    }
    if (bytes <= PERSONAL_AVATAR_MAX_BYTES) return dataUrl;
  }
  if (smallest && smallestBytes <= PERSONAL_AVATAR_MAX_BYTES) return smallest;
  throw new Error(`头像压缩后仍有 ${Math.ceil(smallestBytes / 1024)}KB，请换一张更小的图片`);
}

function formatSupportAttachmentFileSize(bytes: number) {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

function buildSupportPhotoMessageText(label: "照片" | "拍照", fileName: string, url: string) {
  return [`${label}：${fileName || "图片"}`, url].filter(Boolean).join("\n");
}

function buildSupportFileMessageText(file: File, url: string) {
  const fileName = file.name.trim() || "文件";
  return [`文件：${fileName} (${formatSupportAttachmentFileSize(file.size)})`, url].join("\n");
}

function buildSupportLocationMapPreviewUrl(latitude: number, longitude: number) {
  const lat = latitude.toFixed(6);
  const lng = longitude.toFixed(6);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function buildSupportLocationMessageText(latitude: number, longitude: number, accuracy: number | null) {
  const lat = latitude.toFixed(6);
  const lng = longitude.toFixed(6);
  const accuracyLabel =
    typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0
      ? `（约 ${Math.round(accuracy)} 米）`
      : "";
  return [`位置：${lat}, ${lng}${accuracyLabel}`, buildSupportLocationMapPreviewUrl(latitude, longitude)].join("\n");
}

function languageFlagImageUrl(countryCode: string) {
  return `https://flagcdn.com/${countryCode.toLowerCase()}.svg`;
}

function normalizeExternalInfoUrl(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "-") return "";
  if (/^(https?:|mailto:|tel:)/i.test(normalized)) return normalized;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return `mailto:${normalized}`;
  if (/^\+?[\d\s().-]{5,}$/.test(normalized)) return `tel:${normalized.replace(/\s+/g, "")}`;
  return `https://${normalized.replace(/^\/+/, "")}`;
}

const DEFAULT_MERCHANT_CONTACT_VISIBILITY: MerchantContactVisibility = {
  phoneHidden: false,
  emailHidden: false,
  businessCardHidden: false,
};

function normalizeConversationDetailText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeConversationDisplayValue(value: unknown) {
  const normalized = normalizeConversationDetailText(value);
  return normalized && normalized !== "-" ? normalized : "";
}

function normalizeConversationContactVisibility(value: unknown): MerchantContactVisibility {
  const source = readRecord(value);
  return {
    phoneHidden:
      typeof source?.phoneHidden === "boolean" ? source.phoneHidden : DEFAULT_MERCHANT_CONTACT_VISIBILITY.phoneHidden,
    emailHidden:
      typeof source?.emailHidden === "boolean" ? source.emailHidden : DEFAULT_MERCHANT_CONTACT_VISIBILITY.emailHidden,
    businessCardHidden:
      typeof source?.businessCardHidden === "boolean"
        ? source.businessCardHidden
        : DEFAULT_MERCHANT_CONTACT_VISIBILITY.businessCardHidden,
  };
}

function buildConversationMerchantCardShareContact(card: MerchantBusinessCardAsset) {
  const contacts =
    card.contacts && typeof card.contacts === "object"
      ? (card.contacts as Partial<MerchantBusinessCardAsset["contacts"]>)
      : {};
  const invoice =
    card.invoice && typeof card.invoice === "object"
      ? (card.invoice as Partial<MerchantBusinessCardAsset["invoice"]>)
      : {};
  return {
    displayName: normalizeConversationDetailText(contacts.contactName) || normalizeConversationDetailText(card.name),
    organization: normalizeConversationDetailText(card.name),
    title: normalizeConversationDetailText(card.title),
    phone: normalizeConversationDetailText(contacts.phone),
    phones: Array.isArray(contacts.phones) ? contacts.phones.filter(Boolean) : [],
    contactFieldOrder: card.contactFieldOrder,
    contactOnlyFields: card.contactOnlyFields,
    email: normalizeConversationDetailText(contacts.email),
    address: normalizeConversationDetailText(contacts.address),
    invoiceName: normalizeConversationDetailText(invoice.name),
    invoiceTaxNumber: normalizeConversationDetailText(invoice.taxNumber),
    invoiceAddress: normalizeConversationDetailText(invoice.address),
    wechat: normalizeConversationDetailText(contacts.wechat),
    whatsapp: normalizeConversationDetailText(contacts.whatsapp),
    twitter: normalizeConversationDetailText(contacts.twitter),
    weibo: normalizeConversationDetailText(contacts.weibo),
    telegram: normalizeConversationDetailText(contacts.telegram),
    linkedin: normalizeConversationDetailText(contacts.linkedin),
    discord: normalizeConversationDetailText(contacts.discord),
    facebook: normalizeConversationDetailText(contacts.facebook),
    instagram: normalizeConversationDetailText(contacts.instagram),
    tiktok: normalizeConversationDetailText(contacts.tiktok),
    douyin: normalizeConversationDetailText(contacts.douyin),
    xiaohongshu: normalizeConversationDetailText(contacts.xiaohongshu),
    websiteUrl: normalizeConversationDetailText(card.targetUrl),
  };
}

function buildConversationMerchantCardShareInput(card: MerchantBusinessCardAsset | null) {
  if (!card) return null;
  const targetUrl = normalizeConversationDetailText(card.targetUrl);
  if (!targetUrl) return null;
  return {
    origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
    shareKey: normalizeConversationDetailText(card.shareKey),
    name: normalizeConversationDetailText(card.name),
    imageUrl: normalizeConversationDetailText(card.shareImageUrl) || normalizeConversationDetailText(card.imageUrl),
    detailImageUrl:
      normalizeConversationDetailText(card.contactPagePublicImageUrl) ||
      normalizeConversationDetailText(card.contactPageImageUrl),
    detailImageHeight: card.contactPageImageHeight,
    targetUrl,
    contact: buildConversationMerchantCardShareContact(card),
  };
}

function buildConversationMerchantCardLink(card: MerchantBusinessCardAsset | null) {
  if (!card || card.mode !== "link") return "";
  const input = buildConversationMerchantCardShareInput(card);
  if (!input) return "";
  return buildMerchantBusinessCardShareUrl(input);
}

function normalizeConversationExternalUrl(value: string | null | undefined, fallbackOrigin?: string | null) {
  const normalized = normalizeConversationDetailText(value);
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/")) {
    const baseOrigin =
      normalizeConversationDetailText(fallbackOrigin) ||
      (typeof window !== "undefined" ? normalizeConversationDetailText(window.location.origin) : "");
    if (!baseOrigin) return normalized;
    try {
      return new URL(normalized, baseOrigin).toString();
    } catch {
      return normalized;
    }
  }
  return `https://${normalized}`;
}

function formatConversationUrlLabel(value: string | null | undefined) {
  const normalized = normalizeConversationDetailText(value);
  if (!normalized) return "-";
  try {
    const url = new URL(normalizeConversationExternalUrl(normalized));
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`.replace(/\/+$/g, "") || normalized;
  } catch {
    return normalized.replace(/^https?:\/\//i, "").replace(/\/+$/g, "") || normalized;
  }
}

function isConversationIpOrLocalHost(value: string) {
  return (
    /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/i.test(value) ||
    /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value)
  );
}

function buildConversationFallbackMerchantCardHref(input: {
  merchantId?: string | null;
  merchantName?: string | null;
  imageUrl?: string | null;
  websiteHref?: string | null;
  industry?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  contactAddress?: string | null;
  location?: Partial<SiteLocation> | null;
}) {
  const targetUrl = normalizeConversationExternalUrl(input.websiteHref);
  if (!targetUrl) return "";

  const merchantName =
    normalizeConversationDetailText(input.merchantName) ||
    normalizeConversationDetailText(input.merchantId) ||
    "商户";
  const imageUrl = normalizeConversationDetailText(input.imageUrl);
  const phone = normalizeConversationDetailText(input.phone);
  const email = normalizeConversationDetailText(input.email);
  const address = [
    normalizeConversationDetailText(input.contactAddress),
    normalizeConversationDetailText(input.location?.city),
    normalizeConversationDetailText(input.location?.province),
    normalizeConversationDetailText(input.location?.country),
  ]
    .filter(Boolean)
    .join(" / ");

  return buildMerchantBusinessCardShareUrl({
    origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
    name: merchantName,
    imageUrl: imageUrl || undefined,
    detailImageUrl: imageUrl || undefined,
    targetUrl,
    contact: {
      displayName: normalizeConversationDetailText(input.contactName) || merchantName,
      organization: merchantName,
      title: normalizeConversationDetailText(input.industry),
      phone,
      phones: phone ? [phone] : [],
      email,
      address,
      websiteUrl: targetUrl,
    },
  });
}

function Icon({ name }: { name: "chat" | "shop" | "shield" | "user" | "calendar" | "order" | "star" | "card" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      {name === "chat" ? (
        <path
          d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 16H10l-4 3v-3.2A2.8 2.8 0 0 1 3.5 13V7.5A2.5 2.5 0 0 1 6 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "shop" ? (
        <path
          d="M4 10.5 12 5l8 5.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-7.5ZM9 19.5v-5h6v5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "shield" ? (
        <path
          d="M12 4 5.8 6.4v5.8c0 3.7 2.7 6.7 6.2 7.4 3.5-.7 6.2-3.7 6.2-7.4V6.4L12 4Zm0 4.1v4.4m0 0 2.3 2.2M12 12.5 9.7 14.7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "user" ? (
        <>
          <circle cx="12" cy="8.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M6.2 18.2a5.8 5.8 0 0 1 11.6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : null}
      {name === "calendar" ? (
        <>
          <path d="M7 4.5v3M17 4.5v3M5.5 9h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="4.5" y="6" width="15" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        </>
      ) : null}
      {name === "order" ? (
        <>
          <path d="M7 6.5h10M7 11h10M7 15.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        </>
      ) : null}
      {name === "star" ? (
        <path
          d="m12 4.4 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L12 4.4Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "card" ? (
        <>
          <rect x="4" y="6" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M7.5 10h5M7.5 14h8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}

function EmptyFeatureCard({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_44px_rgba(15,23,42,0.06)]">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold text-slate-950">{title}</div>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
          {action ? <div className="mt-5">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

function PersonalLocationInput({
  field,
  label,
  value,
  placeholder,
  disabled,
  countryValue,
  provinceValue,
  onChange,
}: {
  field: PersonalLocationField;
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  countryValue: string;
  provinceValue: string;
  onChange: (field: keyof PersonalProfileDraft, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const countryOptions = useMemo(() => getEuropeCountryOptions(), []);
  const selectedCountryCode = useMemo(() => {
    const normalized = normalizePersonalLocationValue(countryValue);
    if (!normalized) return "";
    return (
      countryOptions.find(
        (item) => normalizePersonalLocationValue(item.name) === normalized || normalizePersonalLocationValue(item.code) === normalized,
      )?.code ?? ""
    );
  }, [countryOptions, countryValue]);
  const provinceOptions = useMemo(() => getEuropeProvinceOptions(selectedCountryCode), [selectedCountryCode]);
  const selectedProvinceCode = useMemo(() => {
    const normalized = normalizePersonalLocationValue(provinceValue);
    if (!normalized) return "";
    return (
      provinceOptions.find(
        (item) => normalizePersonalLocationValue(item.name) === normalized || normalizePersonalLocationValue(item.code) === normalized,
      )?.code ?? ""
    );
  }, [provinceOptions, provinceValue]);
  const cityOptions = useMemo(
    () => getEuropeCityOptions(selectedCountryCode, selectedProvinceCode),
    [selectedCountryCode, selectedProvinceCode],
  );

  const options = useMemo<PersonalLocationOption[]>(() => {
    if (field === "country") return countryOptions.map((item) => ({ value: item.name, label: item.name }));
    if (field === "province") return provinceOptions.map((item) => ({ value: item.name, label: item.name }));
    return cityOptions.map((item) => ({ value: item, label: item }));
  }, [cityOptions, countryOptions, field, provinceOptions]);
  const filteredOptions = useMemo(() => buildPersonalLocationOptions(options, value), [options, value]);

  const selectValue = (nextValue: string) => {
    onChange(field, nextValue);
    if (field === "country") {
      onChange("province", "");
      onChange("city", "");
    }
    if (field === "province") {
      onChange("city", "");
    }
    setOpen(false);
  };

  return (
    <label className="relative min-w-0">
      <span className="text-[11px] font-semibold tracking-[0.08em] text-slate-400">{label}</span>
      <input
        className="mt-2 w-full rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white disabled:text-slate-500"
        value={value}
        placeholder={placeholder}
        maxLength={80}
        autoComplete="off"
        onChange={(event) => {
          const next = event.target.value;
          onChange(field, next);
          if (field === "country" && !next.trim()) {
            onChange("province", "");
            onChange("city", "");
          }
          if (field === "province" && !next.trim()) {
            onChange("city", "");
          }
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = filteredOptions[0];
          if (first) selectValue(first.value);
          else setOpen(false);
        }}
        disabled={disabled}
      />
      {open && filteredOptions.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-30 max-h-56 overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_18px_44px_rgba(15,23,42,0.16)]">
          {filteredOptions.map((item) => (
            <button
              key={`${field}:${item.value}`}
              type="button"
              className="block w-full truncate rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
              onMouseDown={(event) => {
                event.preventDefault();
                selectValue(item.value);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </label>
  );
}

function PersonalBirthdayInput({
  value,
  disabled,
  inputClass,
  labelClass,
  onChange,
}: {
  value: string;
  disabled: boolean;
  inputClass: string;
  labelClass: string;
  onChange: (value: string) => void;
}) {
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const pickerValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

  const openPicker = () => {
    if (disabled) return;
    const picker = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      try {
        picker.showPicker();
        return;
      } catch {
        // Fall back to focus/click below when the browser blocks showPicker.
      }
    }
    picker.focus();
    picker.click();
  };

  return (
    <label className="relative min-w-0">
      <span className={labelClass}>生日</span>
      <input
        className={`${inputClass} pr-12`}
        type="text"
        value={value}
        placeholder="YYYY-MM-DD"
        maxLength={10}
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <input
        ref={pickerRef}
        className="absolute right-4 top-[2.45rem] h-5 w-5 opacity-0"
        type="date"
        value={pickerValue}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <button
        type="button"
        className="absolute right-3 top-[2.28rem] inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={openPicker}
        disabled={disabled}
        aria-label="选择生日"
      >
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" aria-hidden="true">
          <path
            d="M7 4v3M17 4v3M5 9h14M7 20h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </label>
  );
}

function PersonalProfileEditor({
  accountId,
  email,
  draft,
  saving,
  message,
  showSaveButton = true,
  compact = false,
  onChange,
  onSave,
}: {
  accountId: string;
  email: string;
  draft: PersonalProfileDraft;
  saving: boolean;
  message: string;
  showSaveButton?: boolean;
  compact?: boolean;
  onChange: (field: keyof PersonalProfileDraft, value: string) => void;
  onSave: () => void;
}) {
  const inputClass =
    "mt-2 w-full rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white disabled:text-slate-500";
  const labelClass = "text-[11px] font-semibold tracking-[0.08em] text-slate-400";

  return (
    <div
      className={
        compact
          ? "bg-transparent"
          : "rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.06)] md:p-6"
      }
    >
      <div className={`flex flex-wrap items-center justify-between gap-4 ${compact ? "hidden" : ""}`}>
        <div>
          <div className="text-sm font-semibold text-slate-950">我的资料</div>
        </div>
        {showSaveButton ? (
          <button
            type="button"
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存资料"}
          </button>
        ) : null}
      </div>
      {message ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {message}
        </div>
      ) : null}
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <label className="min-w-0">
          <span className={labelClass}>个人 ID</span>
          <input className={`${inputClass} cursor-default bg-slate-100`} value={accountId || "-"} readOnly disabled />
        </label>
        <label className="min-w-0">
          <span className={labelClass}>昵称</span>
          <input
            className={inputClass}
            value={draft.displayName}
            placeholder="请输入昵称"
            maxLength={80}
            autoComplete="nickname"
            onChange={(event) => onChange("displayName", event.target.value)}
            disabled={saving}
          />
        </label>
        <label className="min-w-0">
          <span className={labelClass}>邮箱</span>
          <input
            className={inputClass}
            value={draft.email}
            placeholder={email || "请输入邮箱"}
            maxLength={160}
            autoComplete="email"
            onChange={(event) => onChange("email", event.target.value)}
            disabled={saving}
          />
          {email ? <span className="mt-1 block text-[11px] text-slate-400">登录邮箱：{email}</span> : null}
        </label>
        <label className="min-w-0">
          <span className={labelClass}>电话</span>
          <input
            className={inputClass}
            value={draft.phone}
            placeholder="请输入电话"
            maxLength={64}
            autoComplete="tel"
            onChange={(event) => onChange("phone", event.target.value)}
            disabled={saving}
          />
        </label>
        <PersonalBirthdayInput
          value={draft.birthday}
          disabled={saving}
          inputClass={inputClass}
          labelClass={labelClass}
          onChange={(value) => onChange("birthday", value)}
        />
        <label className="min-w-0">
          <span className={labelClass}>性别</span>
          <select
            className={inputClass}
            value={draft.gender}
            onChange={(event) => onChange("gender", event.target.value)}
            disabled={saving}
          >
            <option value="">不选择</option>
            <option value="female">女</option>
            <option value="male">男</option>
            <option value="other">其他</option>
          </select>
        </label>
        <PersonalLocationInput
          field="country"
          label="国家"
          value={draft.country}
          placeholder="输入国家"
          disabled={saving}
          countryValue={draft.country}
          provinceValue={draft.province}
          onChange={onChange}
        />
        <PersonalLocationInput
          field="province"
          label="省份"
          value={draft.province}
          placeholder="输入省份"
          disabled={saving}
          countryValue={draft.country}
          provinceValue={draft.province}
          onChange={onChange}
        />
        <PersonalLocationInput
          field="city"
          label="城市"
          value={draft.city}
          placeholder="输入城市"
          disabled={saving}
          countryValue={draft.country}
          provinceValue={draft.province}
          onChange={onChange}
        />
        <label className="min-w-0">
          <span className={labelClass}>地址</span>
          <input
            className={inputClass}
            value={draft.address}
            placeholder="请输入详细地址"
            maxLength={240}
            autoComplete="street-address"
            onChange={(event) => onChange("address", event.target.value)}
            disabled={saving}
          />
        </label>
        <label className="min-w-0">
          <span className={labelClass}>联系卡</span>
          <input
            className={inputClass}
            value={draft.contactCard}
            placeholder="请输入联系卡链接或说明"
            maxLength={1200}
            autoComplete="off"
            onChange={(event) => onChange("contactCard", event.target.value)}
            disabled={saving}
          />
        </label>
        <label className="min-w-0 md:col-span-2">
          <span className={labelClass}>个性签名</span>
          <textarea
            className={`${inputClass} h-24 resize-none leading-6`}
            value={draft.signature}
            placeholder="请输入个性签名"
            maxLength={160}
            autoComplete="off"
            onChange={(event) => onChange("signature", event.target.value)}
            disabled={saving}
          />
        </label>
      </div>
    </div>
  );
}

function DesktopMenuButton({
  active,
  item,
  onClick,
}: {
  active: boolean;
  item: MenuItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
        active
          ? "border-slate-950 bg-slate-950 text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
          : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
      }`}
      onClick={onClick}
    >
      <span>{item.label}</span>
      {item.badge ? (
        <span className="inline-flex min-w-[1.45rem] items-center justify-center rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold leading-none text-white">
          {item.badge}
        </span>
      ) : null}
    </button>
  );
}

function MobileBottomNav({
  activeTab,
  onChange,
}: {
  activeTab: MobileTab;
  onChange: (tab: MobileTab) => void;
}) {
  const items: Array<{ key: MobileTab; label: string; icon: ReactNode }> = [
    { key: "conversations", label: "会话", icon: <Icon name="chat" /> },
    { key: "consumption", label: "消费", icon: <Icon name="shop" /> },
    { key: "faolla", label: "Faolla", icon: <Icon name="shield" /> },
    { key: "self", label: "自己", icon: <Icon name="user" /> },
  ];

  return (
    <div className="support-mobile-nav-shell pointer-events-none fixed bottom-0 left-1/2 z-[2147483298] w-full max-w-md -translate-x-1/2 overscroll-none touch-none transition duration-200 md:hidden">
      <div
        className="pointer-events-auto relative px-4 pt-3 touch-manipulation"
        style={{ paddingBottom: "calc((env(safe-area-inset-bottom) / 2) + 0.03rem)" }}
      >
        <div className="flex items-center gap-1 rounded-[28px] border border-slate-200/80 bg-white/95 px-1.5 py-1.5 shadow-[0_18px_36px_rgba(15,23,42,0.12)] backdrop-blur">
          {items.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] px-2 py-1.5 text-[10.5px] font-medium transition ${
                  active ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
                onClick={() => onChange(item.key)}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SupportAvatarBadge({
  label,
  imageUrl = "",
  imageAlt = "",
  className = "",
  labelClassName = "",
  showMerchantBadge = false,
}: {
  label: string;
  imageUrl?: string;
  imageAlt?: string;
  className?: string;
  labelClassName?: string;
  showMerchantBadge?: boolean;
}) {
  const normalizedImageUrl = normalizePublicAssetUrl(imageUrl);
  return (
    <div className={`relative flex shrink-0 items-center justify-center rounded-2xl font-semibold ${className}`}>
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit]">
        {normalizedImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={normalizedImageUrl} alt={imageAlt || label} className="h-full w-full object-cover" />
        ) : (
          <span className={labelClassName}>{label}</span>
        )}
      </div>
      {showMerchantBadge ? <MerchantAvatarBadge /> : null}
    </div>
  );
}

function MerchantAvatarBadge() {
  return (
    <span className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded-[9px] border-2 border-white bg-[linear-gradient(135deg,#020617_0%,#1e293b_62%,#f59e0b_180%)] text-[10px] font-black leading-none tracking-[-0.08em] text-amber-200 shadow-[0_7px_16px_rgba(15,23,42,0.28)] ring-1 ring-slate-950/10">
      M
    </span>
  );
}

export default function MePage() {
  const { locale, setLocale } = useI18n();
  const [payload, setPayload] = useState<MeSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [desktopSection, setDesktopSection] = useState<DesktopSection>(() =>
    typeof window !== "undefined" && isFaollaSectionSearch(window.location.search) ? "faolla" : "conversations",
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>(() =>
    typeof window !== "undefined" && isFaollaSectionSearch(window.location.search) ? "faolla" : "conversations",
  );
  const [faollaEmbedHref] = useState(() =>
    typeof window !== "undefined" ? readFaollaEntryUrlFromSearch(window.location.search, window.location.origin) || "/" : "/",
  );
  const [consumptionSection, setConsumptionSection] = useState<ConsumptionSection>("bookings");
  const [mobileConversationView, setMobileConversationView] = useState<MobileConversationView>("list");
  const [mobileSelfSection, setMobileSelfSection] = useState<MobileSelfSection>("home");
  const [mobileSelfLanguageMenuOpen, setMobileSelfLanguageMenuOpen] = useState(false);
  const [conversationInfoOpen, setConversationInfoOpen] = useState(false);
  const [selectedConversationKey, setSelectedConversationKey] = useState<PersonalConversationKey>(OFFICIAL_CONVERSATION_KEY);
  const [supportThread, setSupportThread] = useState<PlatformSupportThread | null>(null);
  const [peerContacts, setPeerContacts] = useState<MerchantPeerContactSummary[]>([]);
  const [peerThreads, setPeerThreads] = useState<MerchantPeerThread[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [peerLoading, setPeerLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportAttachmentBusy, setSupportAttachmentBusy] = useState(false);
  const [supportAttachmentMenuOpen, setSupportAttachmentMenuOpen] = useState(false);
  const [supportSearching, setSupportSearching] = useState(false);
  const [supportError, setSupportError] = useState("");
  const [supportSearchError, setSupportSearchError] = useState("");
  const [supportDraft, setSupportDraft] = useState("");
  const [supportContactKeyword, setSupportContactKeyword] = useState("");
  const [personalProfileDraft, setPersonalProfileDraft] = useState<PersonalProfileDraft>(EMPTY_PERSONAL_PROFILE);
  const [personalProfileSaving, setPersonalProfileSaving] = useState(false);
  const [personalAvatarUploading, setPersonalAvatarUploading] = useState(false);
  const [personalProfileMessage, setPersonalProfileMessage] = useState("");
  const supportMessagesViewportRef = useRef<HTMLDivElement | null>(null);
  const supportInputRef = useRef<HTMLTextAreaElement | null>(null);
  const supportSendingRef = useRef(false);
  const supportSendPointerHandledRef = useRef(false);
  const personalAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSelfLanguageRootRef = useRef<HTMLDivElement | null>(null);
  const mobileSelfLanguageMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const response = await fetch("/api/auth/merchant-session", {
          method: "GET",
          cache: "no-store",
        });
        const nextPayload = (await response.json().catch(() => null)) as MeSessionPayload | null;
        if (cancelled) return;
        if (!response.ok || nextPayload?.authenticated !== true || !nextPayload?.user) {
          window.location.replace("/login?redirect=/me");
          return;
        }
        if (nextPayload.accountType !== "personal") {
          const merchantIds = readMerchantSessionMerchantIds(nextPayload);
          const merchantId =
            (typeof nextPayload.merchantId === "string" ? nextPayload.merchantId.trim() : "") || merchantIds[0] || "";
          window.location.replace(merchantId ? `/${merchantId}/admin` : "/admin");
          return;
        }
        setPayload(nextPayload);
      } catch {
        if (!cancelled) {
          window.location.replace("/login?redirect=/me");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mobileSelfLanguageMenuOpen || typeof document === "undefined") return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (mobileSelfLanguageRootRef.current?.contains(target)) return;
      if (mobileSelfLanguageMenuRef.current?.contains(target)) return;
      setMobileSelfLanguageMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [mobileSelfLanguageMenuOpen]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPersonalProfileDraft(readPersonalProfile(payload));
      setPersonalProfileMessage("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [payload]);

  useEffect(() => {
    setConversationInfoOpen(false);
  }, [selectedConversationKey]);

  useEffect(() => {
    if (!conversationInfoOpen) return;
    const conversationsVisible =
      desktopSection === "conversations" || (mobileTab === "conversations" && mobileConversationView === "thread");
    if (!conversationsVisible) {
      setConversationInfoOpen(false);
    }
  }, [conversationInfoOpen, desktopSection, mobileConversationView, mobileTab]);

  const accountId =
    payload && typeof payload.accountId === "string" && /^\d{8}$/.test(payload.accountId.trim())
      ? payload.accountId.trim()
      : "";
  const email = trimText(payload?.user?.email);
  const personalProfile = useMemo(() => readPersonalProfile(payload), [payload]);
  const displayName = personalProfile.displayName || readDisplayName(payload);
  const profileName = displayName || email.split("@")[0] || accountId || "个人用户";
  const avatarLabel = getInitialLabel(profileName);
  const personalAvatarImageUrl = personalProfileDraft.avatarUrl || personalProfile.avatarUrl;
  const mobileSelfSelectedLanguage = useMemo(
    () => LANGUAGE_OPTIONS.find((item) => item.code === locale) ?? LANGUAGE_OPTIONS[0],
    [locale],
  );
  const mobileSelfProfileSummary = [
    personalProfileDraft.displayName || displayName || accountId,
    personalProfileDraft.phone,
    personalProfileDraft.email || email,
  ]
    .filter(Boolean)
    .join(" / ");
  const mobileSelfCardsSummary = "个人名片夹会在下一步接入。";
  const mobileSelfNotificationSummary = "系统通知、提示音和震动设置。";

  const faollaTargetHref = useMemo(
    () =>
      buildFaollaShellHref(
        faollaEmbedHref,
        locale,
        typeof window !== "undefined" ? window.location.origin : "https://faolla.com",
      ),
    [faollaEmbedHref, locale],
  );

  const desktopMenuItems: MenuItem[] = useMemo(
    () => [
      { key: "conversations", label: "会话", description: "查看和商户、Faolla 的对话。" },
      { key: "bookings", label: "预约", description: "查看你提交给商户的预约记录。" },
      { key: "orders", label: "订单", description: "查看你在商户网站提交的订单。" },
      { key: "favorites", label: "收藏", description: "保存常用商户、页面和产品。" },
      { key: "cards", label: "名片夹", description: "管理收到或保存的名片。" },
      { key: "faolla", label: "Faolla", description: "Faolla" },
    ],
    [],
  );
  const officialVisibleSupportMessages = useMemo<PersonalVisibleSupportMessage[]>(
    () =>
      (supportThread?.messages ?? [])
        .map((message) => ({
          id: message.id,
          text: message.text,
          createdAt: message.createdAt,
          isSelf: message.sender === "merchant",
          senderLabel: message.sender === "merchant" ? "我" : "Faolla",
        }))
        .sort(compareSupportMessages),
    [supportThread?.messages],
  );
  const selectedConversationIsOfficial = selectedConversationKey === OFFICIAL_CONVERSATION_KEY;
  const selectedPeerMerchantId = selectedConversationKey.startsWith("merchant:")
    ? selectedConversationKey.slice("merchant:".length).trim()
    : "";
  const selectedPeerContact = peerContacts.find((contact) => contact.merchantId === selectedPeerMerchantId) ?? null;
  const selectedPeerThread = useMemo(
    () =>
      accountId && selectedPeerMerchantId
        ? findMerchantPeerThreadForMerchants(
            {
              contacts: [],
              threads: peerThreads,
            },
            accountId,
            selectedPeerMerchantId,
          )
        : null,
    [accountId, peerThreads, selectedPeerMerchantId],
  );
  const peerVisibleSupportMessages = useMemo<PersonalVisibleSupportMessage[]>(
    () =>
      selectedPeerMerchantId
        ? (selectedPeerThread?.messages ?? [])
            .map((message) => ({
              id: message.id,
              text: message.text,
              createdAt: message.createdAt,
              isSelf: message.senderMerchantId === accountId,
              senderLabel:
                message.senderMerchantId === accountId
                  ? "我"
                  : selectedPeerContact?.merchantName || selectedPeerMerchantId,
            }))
            .sort(compareSupportMessages)
        : [],
    [accountId, selectedPeerContact?.merchantName, selectedPeerMerchantId, selectedPeerThread?.messages],
  );
  const visibleSupportMessages = selectedConversationIsOfficial ? officialVisibleSupportMessages : peerVisibleSupportMessages;
  const latestVisibleSupportMessage = visibleSupportMessages[visibleSupportMessages.length - 1] ?? null;
  const latestVisibleSupportMessageKey = latestVisibleSupportMessage ? buildVisibleSupportMessageKey(latestVisibleSupportMessage) : "";
  const latestSupportMessage = officialVisibleSupportMessages[officialVisibleSupportMessages.length - 1] ?? null;
  const supportContactPreview =
    formatSupportConversationPreview(latestSupportMessage?.text) || "还没有留言记录，可以直接给 Faolla 留言。";
  const supportContactUpdatedAt = latestSupportMessage?.createdAt || "";
  const supportContactMatchesSearch = useMemo(() => {
    const keyword = supportContactKeyword.trim().toLowerCase();
    if (!keyword) return true;
    return ["faolla", "官方", "客服"].some((item) => item.toLowerCase().includes(keyword) || keyword.includes(item.toLowerCase()));
  }, [supportContactKeyword]);
  const selectedPeerContactName = trimText(selectedPeerContact?.merchantName) || selectedPeerMerchantId || "商户";
  const selectedPeerContactEmail = trimText(selectedPeerContact?.merchantEmail);
  const selectedPeerContactSignature = trimText(selectedPeerContact?.signature);
  const selectedPeerContactPhone = trimText(selectedPeerContact?.contactPhone);
  const selectedPeerContactCard = trimText(selectedPeerContact?.contactCard);
  const selectedPeerContactIsMerchant =
    !selectedConversationIsOfficial && (selectedPeerContact?.accountType ?? "merchant") === "merchant";
  const selectedPeerContactVisibility = selectedPeerContactIsMerchant
    ? normalizeConversationContactVisibility(selectedPeerContact?.contactVisibility)
    : DEFAULT_MERCHANT_CONTACT_VISIBILITY;
  const selectedPeerMerchantEmail = selectedPeerContactVisibility.emailHidden
    ? "已隐藏"
    : selectedPeerContactEmail || "-";
  const selectedPeerMerchantPhone = selectedPeerContactVisibility.phoneHidden
    ? "已隐藏"
    : selectedPeerContactPhone || "-";
  const selectedPeerMerchantIndustry =
    normalizeConversationDisplayValue(selectedPeerContact?.industry) || "未设置行业";
  const selectedPeerMerchantCity = normalizeConversationDisplayValue(selectedPeerContact?.location?.city) || "-";
  const selectedPeerMerchantPrefix =
    normalizeConversationDisplayValue(selectedPeerContact?.domainPrefix) ||
    normalizeConversationDisplayValue(selectedPeerContact?.domainSuffix);
  const selectedPeerContactAvatarImageUrl =
    trimText(selectedPeerContact?.avatarImageUrl) ||
    trimText(selectedPeerContact?.chatAvatarImageUrl) ||
    trimText(selectedPeerContact?.merchantCardImageUrl);
  const selectedPeerResolvedBusinessCard = selectedPeerContact?.chatBusinessCard ?? null;
  const selectedPeerMerchantWebsiteHref = useMemo(() => {
    if (!selectedPeerContactIsMerchant) return "";
    const publicBaseDomain = normalizeConversationDisplayValue(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
    const explicitDomain = normalizeConversationDisplayValue(selectedPeerContact?.domain);
    if (selectedPeerMerchantId && selectedPeerMerchantPrefix) {
      const runtimeHref = normalizeConversationExternalUrl(
        buildMerchantFrontendHref(selectedPeerMerchantId, selectedPeerMerchantPrefix),
      );
      if (runtimeHref && !isConversationIpOrLocalHost(runtimeHref)) {
        return runtimeHref;
      }
      if (publicBaseDomain) {
        const publicHref = normalizeConversationExternalUrl(
          buildMerchantFrontendHref(selectedPeerMerchantId, selectedPeerMerchantPrefix, publicBaseDomain),
          `https://${publicBaseDomain.replace(/^https?:\/\//i, "")}`,
        );
        if (publicHref) return publicHref;
      }
    }
    if (explicitDomain && !isConversationIpOrLocalHost(normalizeConversationExternalUrl(explicitDomain))) {
      return normalizeConversationExternalUrl(
        explicitDomain,
        publicBaseDomain ? `https://${publicBaseDomain.replace(/^https?:\/\//i, "")}` : undefined,
      );
    }
    if (!selectedPeerMerchantId) return "";
    return normalizeConversationExternalUrl(explicitDomain);
  }, [
    selectedPeerContact?.domain,
    selectedPeerContactIsMerchant,
    selectedPeerMerchantId,
    selectedPeerMerchantPrefix,
  ]);
  const selectedPeerMerchantWebsiteLabel = selectedPeerMerchantWebsiteHref
    ? formatConversationUrlLabel(selectedPeerMerchantWebsiteHref)
    : "-";
  const selectedPeerFallbackCardHref = useMemo(
    () =>
      selectedPeerContactIsMerchant
        ? buildConversationFallbackMerchantCardHref({
            merchantId: selectedPeerMerchantId,
            merchantName: selectedPeerContactName,
            imageUrl: selectedPeerContactAvatarImageUrl,
            websiteHref: selectedPeerMerchantWebsiteHref,
            industry: selectedPeerMerchantIndustry,
            contactName: normalizeConversationDisplayValue(selectedPeerContact?.contactName) || selectedPeerContactName,
            phone: selectedPeerContactPhone,
            email: selectedPeerContactEmail,
            contactAddress: selectedPeerContact?.contactAddress,
            location: selectedPeerContact?.location,
          })
        : "",
    [
      selectedPeerContact?.contactAddress,
      selectedPeerContact?.contactName,
      selectedPeerContact?.location,
      selectedPeerContactAvatarImageUrl,
      selectedPeerContactEmail,
      selectedPeerContactIsMerchant,
      selectedPeerContactName,
      selectedPeerContactPhone,
      selectedPeerMerchantId,
      selectedPeerMerchantIndustry,
      selectedPeerMerchantWebsiteHref,
    ],
  );
  const selectedPeerMerchantCardHref = useMemo(
    () =>
      selectedPeerContactVisibility.businessCardHidden
        ? ""
        : buildConversationMerchantCardLink(selectedPeerResolvedBusinessCard) || selectedPeerFallbackCardHref,
    [
      selectedPeerContactVisibility.businessCardHidden,
      selectedPeerFallbackCardHref,
      selectedPeerResolvedBusinessCard,
    ],
  );
  const selectedPeerMerchantCardLabel = selectedPeerContactVisibility.businessCardHidden
    ? "已隐藏"
    : selectedPeerMerchantCardHref
      ? formatConversationUrlLabel(selectedPeerMerchantCardHref)
      : "-";
  const selectedConversationName = selectedConversationIsOfficial ? "Faolla" : selectedPeerContactName;
  const selectedConversationMeta = selectedConversationIsOfficial
    ? "www.faolla.com"
    : selectedPeerContactIsMerchant
      ? [selectedPeerMerchantId, selectedPeerMerchantEmail !== "-" ? selectedPeerMerchantEmail : ""]
          .filter(Boolean)
          .join(" | ")
      : [selectedPeerMerchantId, selectedPeerContactEmail].filter(Boolean).join(" / ");
  const selectedConversationAvatarLabel = selectedConversationIsOfficial
    ? "FA"
    : getSupportContactAvatarLabel(selectedConversationName, "商");
  const selectedConversationAvatarImageUrl = selectedConversationIsOfficial
    ? ""
    : selectedPeerContactAvatarImageUrl;
  const selectedConversationInfoSubtitle = selectedConversationIsOfficial
    ? "官方客服"
    : selectedPeerContactIsMerchant
      ? selectedPeerMerchantIndustry
      : selectedPeerContactSignature || selectedConversationMeta || "个人资料";
  const selectedConversationInfoItems = useMemo<ConversationInfoItem[]>(() => {
    if (selectedConversationIsOfficial) {
      return [
        { label: "身份", value: "官方客服" },
        { label: "名称", value: "Faolla" },
        {
          label: "官网",
          value: "www.faolla.com",
          href: "https://www.faolla.com",
          openInNewTab: true,
        },
      ];
    }

    if (selectedPeerContactIsMerchant) {
      return [
        { label: "ID", value: selectedPeerMerchantId || "-" },
        { label: "电话", value: selectedPeerMerchantPhone },
        { label: "邮箱", value: selectedPeerMerchantEmail },
        {
          label: "联系卡",
          value: selectedPeerMerchantCardLabel,
          href: selectedPeerMerchantCardHref,
          openInNewTab: false,
        },
        { label: "城市", value: selectedPeerMerchantCity },
        {
          label: "官网",
          value: selectedPeerMerchantWebsiteLabel,
          href: selectedPeerMerchantWebsiteHref,
          openInNewTab: true,
        },
      ];
    }

    const items: ConversationInfoItem[] = [
      { label: "ID", value: selectedPeerMerchantId || "-" },
      { label: "类型", value: selectedPeerContact?.accountType === "personal" ? "个人用户" : "商户" },
      {
        label: "电话",
        value: selectedPeerContactPhone || "-",
        href: selectedPeerContactPhone ? normalizeExternalInfoUrl(selectedPeerContactPhone) : "",
      },
      {
        label: "邮箱",
        value: selectedPeerContactEmail || "-",
        href: selectedPeerContactEmail ? normalizeExternalInfoUrl(selectedPeerContactEmail) : "",
      },
      {
        label: "联系卡",
        value: selectedPeerContactCard || "-",
        href: selectedPeerContactCard ? normalizeExternalInfoUrl(selectedPeerContactCard) : "",
        openInNewTab: true,
      },
      { label: "个性签名", value: selectedPeerContactSignature || "-" },
    ];
    return items;
  }, [
    selectedConversationIsOfficial,
    selectedPeerContact?.accountType,
    selectedPeerContactCard,
    selectedPeerContactIsMerchant,
    selectedPeerContactEmail,
    selectedPeerContactPhone,
    selectedPeerContactSignature,
    selectedPeerMerchantCardHref,
    selectedPeerMerchantCardLabel,
    selectedPeerMerchantCity,
    selectedPeerMerchantEmail,
    selectedPeerMerchantId,
    selectedPeerMerchantPhone,
    selectedPeerMerchantWebsiteHref,
    selectedPeerMerchantWebsiteLabel,
  ]);
  const selectedConversationLoading = selectedConversationIsOfficial ? supportLoading : peerLoading;
  const selectedConversationEmptyText = selectedConversationIsOfficial
    ? "还没有留言记录，可以直接在下方给 Faolla 留言。"
    : "还没有聊天记录，可以直接在下方发送第一条消息。";
  const selectedSupportSendButtonLabel = selectedConversationIsOfficial ? "发送留言" : "发送消息";
  const supportComposerAvailable = selectedConversationIsOfficial || !!selectedPeerContact;
  const supportComposerBusy = supportSending || supportAttachmentBusy;
  const supportCanSend = !!supportDraft.trim() && supportComposerAvailable;
  const supportContactRows: SupportContactRow[] = [
    {
      key: OFFICIAL_CONVERSATION_KEY,
      name: "Faolla",
      badge: "官方",
      subtitle: "www.faolla.com",
      preview: supportContactPreview || "还没有留言记录，可以直接在右侧给 Faolla 留言。",
      updatedAt: supportContactUpdatedAt,
      unread: false,
      avatarLabel: "FA",
      avatarImageUrl: "",
      isOfficial: true,
    },
    ...peerContacts.flatMap((contact): SupportContactRow[] => {
      const contactId = trimText(contact.merchantId);
      if (!contactId) return [];
      const contactName = trimText(contact.merchantName) || contactId;
      const avatarImageUrl = trimText(contact.avatarImageUrl) || trimText(contact.chatAvatarImageUrl);
      return [
        {
          key: `merchant:${contactId}`,
          name: contactName,
          subtitle: contactId,
          preview: formatSupportConversationPreview(contact.lastMessage?.text) || "还没有聊天记录，可以直接开始对话。",
          updatedAt: trimText(contact.updatedAt) || trimText(contact.savedAt),
          unread: false,
          avatarLabel: getSupportContactAvatarLabel(contactName || contactId, "商"),
          avatarImageUrl,
          accountType: contact.accountType ?? "merchant",
          isOfficial: false,
        },
      ];
    }),
  ];
  const mobileSupportContactListSummary = `全部 ${supportContactRows.length} 个会话已读`;

  const loadSupportThread = useCallback(async (options?: { silent?: boolean }) => {
    if (!accountId) return;
    if (!options?.silent) setSupportLoading(true);
    setSupportError("");
    try {
      const params = new URLSearchParams({
        siteId: accountId,
      });
      if (email) params.set("merchantEmail", email);
      if (profileName) params.set("merchantName", profileName);
      const response = await fetch(`/api/support-messages?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const result = (await response.json().catch(() => null)) as SupportResponsePayload | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : "support_load_failed");
      }
      setSupportThread(result.thread ?? null);
    } catch {
      setSupportError("会话加载失败，请稍后重试。");
    } finally {
      if (!options?.silent) setSupportLoading(false);
    }
  }, [accountId, email, profileName]);

  const loadPeerInbox = useCallback(async (options?: { silent?: boolean }) => {
    if (!accountId) return;
    if (!options?.silent) setPeerLoading(true);
    setSupportError("");
    try {
      const params = new URLSearchParams({
        siteId: accountId,
      });
      if (email) params.set("merchantEmail", email);
      if (profileName) params.set("merchantName", profileName);
      const response = await fetch(`/api/merchant-peer-messages?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const result = (await response.json().catch(() => null)) as MerchantPeerResponsePayload | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : "peer_load_failed");
      }
      const nextContacts = Array.isArray(result.contacts)
        ? result.contacts
            .map(sanitizeMerchantPeerContactSummary)
            .filter((contact): contact is MerchantPeerContactSummary => contact !== null)
        : [];
      const nextThreads = Array.isArray(result.threads)
        ? result.threads
            .map(sanitizeMerchantPeerThread)
            .filter((thread): thread is MerchantPeerThread => thread !== null)
        : [];
      setPeerContacts(nextContacts);
      setPeerThreads(nextThreads);
    } catch {
      setSupportError("商户会话加载失败，请稍后重试。");
    } finally {
      if (!options?.silent) setPeerLoading(false);
    }
  }, [accountId, email, profileName]);

  async function searchConversation() {
    const query = supportContactKeyword.trim();
    setSupportSearchError("");
    if (!query) {
      setSelectedConversationKey(OFFICIAL_CONVERSATION_KEY);
      await Promise.all([loadSupportThread({ silent: true }), loadPeerInbox({ silent: true })]);
      return;
    }

    if (supportContactMatchesSearch) {
      setSelectedConversationKey(OFFICIAL_CONVERSATION_KEY);
      return;
    }

    if (!accountId || supportSearching) return;
    setSupportSearching(true);
    setSupportError("");
    try {
      const response = await fetch("/api/merchant-peer-messages", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          action: "search",
          query,
          siteId: accountId,
          merchantEmail: email,
          merchantName: profileName,
        }),
      });
      const result = (await response.json().catch(() => null)) as MerchantPeerResponsePayload | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(readPayloadMessage(result?.message, "没有找到匹配的商户，请输入完整 8 位商户 ID 或邮箱。"));
      }
      setPeerContacts(Array.isArray(result.contacts) ? result.contacts : []);
      setPeerThreads(Array.isArray(result.threads) ? result.threads : []);
      const merchantId = trimText(result.contact?.merchantId);
      if (merchantId) {
        setSelectedConversationKey(`merchant:${merchantId}`);
        setMobileConversationView("thread");
      }
    } catch (error) {
      setSupportSearchError(error instanceof Error ? error.message : "商户搜索失败，请稍后重试。");
    } finally {
      setSupportSearching(false);
    }
  }

  async function sendSupportTextPayload(rawText: string, options?: { clearDraft?: boolean }) {
    if (supportSending || supportSendingRef.current) return false;
    const text = rawText.trim();
    if (!text) return;
    if (!accountId) {
      setSupportError("个人账号信息还没准备好，请刷新后重试。");
      return false;
    }
    if (!selectedConversationIsOfficial && !selectedPeerMerchantId) {
      setSupportError("请先选择要聊天的商户。");
      return false;
    }

    supportSendingRef.current = true;
    setSupportSending(true);
    setSupportError("");
    setSupportAttachmentMenuOpen(false);
    if (options?.clearDraft) {
      setSupportDraft("");
    }
    try {
      const response = await fetch(selectedConversationIsOfficial ? "/api/support-messages" : "/api/merchant-peer-messages", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(
          selectedConversationIsOfficial
            ? {
                text,
                siteId: accountId,
                merchantEmail: email,
                merchantName: profileName,
              }
            : {
                action: "send",
                recipientMerchantId: selectedPeerMerchantId,
                text,
                siteId: accountId,
                merchantEmail: email,
                merchantName: profileName,
              },
        ),
      });
      const result = (await response.json().catch(() => null)) as (SupportResponsePayload & MerchantPeerResponsePayload) | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : "support_send_failed");
      }
      if (selectedConversationIsOfficial) {
        setSupportThread(result.thread ?? null);
      } else {
        setPeerContacts(Array.isArray(result.contacts) ? result.contacts : []);
        setPeerThreads(Array.isArray(result.threads) ? result.threads : []);
      }
      if (!options?.clearDraft) {
        setSupportDraft("");
      }
      return true;
    } catch {
      setSupportError("消息发送失败，请稍后重试。");
      return false;
    } finally {
      supportSendingRef.current = false;
      setSupportSending(false);
    }
  }

  async function sendSupportMessage() {
    await sendSupportTextPayload(supportDraft, { clearDraft: true });
  }

  function focusSupportInput() {
    window.setTimeout(() => supportInputRef.current?.focus({ preventScroll: true }), 0);
  }

  function focusSupportInputImmediately() {
    supportInputRef.current?.focus({ preventScroll: true });
  }

  function openSupportContactThread(key: PersonalConversationKey) {
    setSelectedConversationKey(key);
    setMobileConversationView("thread");
    focusSupportInput();
  }

  function toggleSupportAttachmentMenu() {
    if (!supportComposerAvailable || supportComposerBusy) return;
    setSupportAttachmentMenuOpen((current) => !current);
  }

  async function uploadSupportAssetDataUrl(
    dataUrl: string,
    folder: "merchant-assets" | "merchant-files" = "merchant-assets",
  ) {
    const response = await fetch("/api/assets/upload", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        dataUrl,
        merchantHint: accountId || "personal",
        folder,
        usage: folder === "merchant-files" ? "support-file" : "support-image",
      }),
    });
    const payload = (await response.json().catch(() => null)) as { ok?: unknown; url?: unknown; message?: unknown } | null;
    const uploadedUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
    if (response.ok && uploadedUrl) {
      return { ok: true as const, url: uploadedUrl, message: "" };
    }
    return {
      ok: false as const,
      url: "",
      message: typeof payload?.message === "string" ? payload.message.trim() : "",
    };
  }

  function updatePersonalProfileDraft(field: keyof PersonalProfileDraft, value: string) {
    setPersonalProfileMessage("");
    setPersonalProfileDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function savePersonalProfile(targetProfile = personalProfileDraft, successMessage = "资料已保存") {
    if (personalProfileSaving) return false;
    setPersonalProfileSaving(true);
    setPersonalProfileMessage("");
    try {
      const response = await fetch("/api/personal-profile", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          profile: targetProfile,
        }),
      });
      const result = (await response.json().catch(() => null)) as PersonalProfileResponsePayload | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(readPayloadMessage(result?.message, "资料保存失败，请稍后重试。"));
      }
      const nextProfile = mergePersonalProfileDraft(targetProfile, result.profile);
      setPersonalProfileDraft(nextProfile);
      setPayload((current) => {
        if (!current) return current;
        const currentUser = current.user ?? {};
        const currentMetadata = currentUser.user_metadata && typeof currentUser.user_metadata === "object" ? currentUser.user_metadata : {};
        const resultUserMetadata =
          result.user?.user_metadata && typeof result.user.user_metadata === "object" ? result.user.user_metadata : {};
        const user = {
          ...currentUser,
          ...(result.user ?? {}),
          user_metadata: {
            ...currentMetadata,
            ...resultUserMetadata,
            personal_profile: {
              ...(currentMetadata.personal_profile && typeof currentMetadata.personal_profile === "object"
                ? (currentMetadata.personal_profile as Record<string, unknown>)
                : {}),
              ...(resultUserMetadata.personal_profile && typeof resultUserMetadata.personal_profile === "object"
                ? (resultUserMetadata.personal_profile as Record<string, unknown>)
                : {}),
              ...nextProfile,
              bio: nextProfile.signature,
            },
            display_name: nextProfile.displayName,
            displayName: nextProfile.displayName,
            avatar_url: nextProfile.avatarUrl,
            avatarUrl: nextProfile.avatarUrl,
            signature: nextProfile.signature,
            bio: nextProfile.signature,
            phone: nextProfile.phone,
            contact_phone: nextProfile.phone,
            contactPhone: nextProfile.phone,
            email: nextProfile.email,
            contact_email: nextProfile.email,
            contactEmail: nextProfile.email,
            contact_card: nextProfile.contactCard,
            contactCard: nextProfile.contactCard,
            birthday: nextProfile.birthday,
            gender: nextProfile.gender,
            country: nextProfile.country,
            province: nextProfile.province,
            city: nextProfile.city,
            address: nextProfile.address,
          },
        };
        return {
          ...current,
          user,
        };
      });
      setPersonalProfileMessage(successMessage);
      return true;
    } catch (error) {
      setPersonalProfileMessage(error instanceof Error ? error.message : "资料保存失败，请稍后重试。");
      return false;
    } finally {
      setPersonalProfileSaving(false);
    }
  }

  function openPersonalAvatarPicker() {
    if (personalAvatarUploading || personalProfileSaving) return;
    personalAvatarInputRef.current?.click();
  }

  async function handlePersonalAvatarInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    setPersonalAvatarUploading(true);
    setPersonalProfileMessage("");
    try {
      const avatarDataUrl = await compressPersonalAvatarFile(file);
      const uploadResult = await uploadSupportAssetDataUrl(avatarDataUrl, "merchant-assets");
      if (!uploadResult.ok || !uploadResult.url) {
        throw new Error(uploadResult.message || "头像上传失败，请稍后重试");
      }
      await savePersonalProfile(
        {
          ...personalProfileDraft,
          avatarUrl: uploadResult.url,
        },
        "头像已更新",
      );
    } catch (error) {
      setPersonalProfileMessage(error instanceof Error ? error.message : "头像上传失败，请稍后重试");
    } finally {
      setPersonalAvatarUploading(false);
    }
  }

  async function handleSupportImageAttachment(file: File, label: "照片" | "拍照") {
    if (supportComposerBusy) return;
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    try {
      const uploadResult = await uploadSupportAssetDataUrl(await fileToDataUrl(file), "merchant-files");
      if (!uploadResult.ok || !uploadResult.url) {
        throw new Error(uploadResult.message || `${label}上传失败，请稍后重试`);
      }
      await sendSupportTextPayload(buildSupportPhotoMessageText(label, file.name.trim() || `${label}.jpg`, uploadResult.url));
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : `${label}发送失败，请稍后重试`);
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  async function handleSupportFileAttachment(file: File) {
    if (supportComposerBusy) return;
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    try {
      const uploadResult = await uploadSupportAssetDataUrl(await fileToDataUrl(file), "merchant-files");
      if (!uploadResult.ok || !uploadResult.url) {
        throw new Error(uploadResult.message || "文件上传失败，请稍后重试");
      }
      await sendSupportTextPayload(buildSupportFileMessageText(file, uploadResult.url));
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : "文件发送失败，请稍后重试");
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  async function pickSupportFileViaTemporaryInput(options: {
    accept: string;
    capture?: "environment";
    onFile: (file: File) => Promise<void>;
  }) {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    if (options.capture) input.capture = options.capture;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "0";
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        cleanup();
        if (!file) return;
        void options.onFile(file);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  }

  async function openSupportPhotoPicker() {
    if (supportComposerBusy) return;
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    await pickSupportFileViaTemporaryInput({
      accept: SUPPORT_PHOTO_PICKER_ACCEPT,
      onFile: async (file) => handleSupportImageAttachment(file, "照片"),
    });
  }

  async function openSupportCameraPicker() {
    if (supportComposerBusy) return;
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    await pickSupportFileViaTemporaryInput({
      accept: SUPPORT_PHOTO_PICKER_ACCEPT,
      capture: "environment",
      onFile: async (file) => handleSupportImageAttachment(file, "拍照"),
    });
  }

  async function openSupportFilePicker() {
    if (supportComposerBusy) return;
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    await pickSupportFileViaTemporaryInput({
      accept: SUPPORT_FILE_PICKER_ACCEPT,
      onFile: async (file) => handleSupportFileAttachment(file),
    });
  }

  async function handleSupportLocationAttachment() {
    if (supportComposerBusy) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setSupportError("当前设备不支持位置发送");
      return;
    }
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 60000,
        });
      });
      await sendSupportTextPayload(
        buildSupportLocationMessageText(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
        ),
      );
    } catch (error) {
      const message =
        error && typeof error === "object" && "code" in error && Number((error as { code?: unknown }).code) === 1
          ? "定位权限被拒绝，请先允许浏览器访问位置"
          : "位置发送失败，请稍后重试";
      setSupportError(message);
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  useEffect(() => {
    if (!accountId) return;
    void loadSupportThread();
    void loadPeerInbox({ silent: true });
  }, [accountId, loadPeerInbox, loadSupportThread]);

  useEffect(() => {
    const viewport = supportMessagesViewportRef.current;
    if (!viewport) return;
    if (typeof window === "undefined") {
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }
    const rafIds = new Set<number>();
    const timers = [0, 80, 240, 600].map((delay) =>
      window.setTimeout(() => {
        const rafId = window.requestAnimationFrame(() => {
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
        });
        rafIds.add(rafId);
      }, delay),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      rafIds.forEach((rafId) => window.cancelAnimationFrame(rafId));
    };
  }, [latestVisibleSupportMessageKey, mobileConversationView, desktopSection, selectedConversationKey]);

  async function requestLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/merchant-logout", {
        method: "POST",
        cache: "no-store",
      }).catch(() => null);
    } finally {
      window.location.replace("/login?loggedOut=1");
    }
  }

  function renderSupportMessageList(className: string) {
    return (
      <div ref={supportMessagesViewportRef} className={className}>
        {selectedConversationLoading ? (
          <div className="rounded-2xl border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-500">正在加载聊天记录...</div>
        ) : visibleSupportMessages.length ? (
          <div className="min-w-0 space-y-3">
            {visibleSupportMessages.map((message, index) => {
              const previousMessage = index > 0 ? visibleSupportMessages[index - 1] : null;
              const showDateDivider = !previousMessage || !isSameSupportCalendarDay(previousMessage.createdAt, message.createdAt);
              const messageKey = buildVisibleSupportMessageKey(message);
              const messageMeta = formatSupportClockTime(message.createdAt);
              return (
                <div key={messageKey} className="space-y-3">
                  {showDateDivider ? (
                    <div className="flex justify-center">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-500 shadow-sm">
                        {formatSupportThreadDateLabel(message.createdAt)}
                      </span>
                    </div>
                  ) : null}
                  <div className={`flex min-w-0 ${message.isSelf ? "justify-end" : "justify-start"}`}>
                    <div className={`flex max-w-[82%] min-w-0 items-end ${message.isSelf ? "flex-row" : "flex-row-reverse"}`}>
                      <div
                        className={`min-w-0 rounded-2xl shadow-sm ${
                          parseSupportMessageAttachmentPreview(message.text)
                            ? "border border-transparent bg-transparent px-0 py-0"
                            : message.isSelf
                              ? "bg-slate-900 px-4 py-3 text-white"
                              : "border bg-white px-4 py-3 text-slate-900"
                        }`}
                      >
                        <SupportMessageContent value={message.text} isSelf={message.isSelf} />
                        <div className={`mt-2 text-right text-[10px] ${message.isSelf ? "text-white/70" : "text-slate-400"}`}>
                          {messageMeta}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-500">
            {selectedConversationEmptyText}
          </div>
        )}
      </div>
    );
  }

  function renderDesktopSupportComposer(className = "") {
    return (
      <div className={`min-w-0 shrink-0 space-y-3 border-t border-slate-200 bg-white px-5 py-4 ${className}`}>
        {supportError ? <div className="text-sm text-rose-600">{supportError}</div> : null}
        <textarea
          ref={supportInputRef}
          rows={4}
          className="w-full max-w-full min-w-0 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 caret-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
          placeholder=""
          value={supportDraft}
          onChange={(event) => setSupportDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !event.ctrlKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void sendSupportMessage();
          }}
          disabled={supportComposerBusy || !supportComposerAvailable}
        />
        <div className="flex min-w-0 justify-end">
          <button
            type="button"
            className="shrink-0 rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
            onClick={() => void sendSupportMessage()}
            disabled={supportComposerBusy || !supportCanSend}
          >
            {supportComposerBusy ? "发送中..." : selectedSupportSendButtonLabel}
          </button>
        </div>
      </div>
    );
  }

  function renderMobileSupportComposer() {
    return (
      <div className="shrink-0 overscroll-none border-t border-slate-200/80 bg-[#edf1f7]/98 px-3 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
        {supportAttachmentMenuOpen ? (
          <div className="mb-2 rounded-[28px] bg-white px-3 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80">
            <div className="grid grid-cols-5 gap-2">
              {[
                {
                  key: "photo",
                  label: "照片",
                  color: "bg-blue-50 text-blue-500",
                  onClick: () => void openSupportPhotoPicker(),
                  icon: (
                    <>
                      <path d="M6 8h2.3l1.2-1.7A1 1 0 0 1 10.3 6h3.4a1 1 0 0 1 .8.3L15.7 8H18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="13" r="3.1" stroke="currentColor" strokeWidth="1.8" />
                    </>
                  ),
                },
                {
                  key: "camera",
                  label: "拍照",
                  color: "bg-slate-100 text-slate-700",
                  onClick: () => void openSupportCameraPicker(),
                  icon: (
                    <>
                      <path d="M4 9a2 2 0 0 1 2-2h1.8l1.2-1.8A1 1 0 0 1 9.8 5h4.4a1 1 0 0 1 .8.2L16.2 7H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="12.5" r="3.1" stroke="currentColor" strokeWidth="1.8" />
                    </>
                  ),
                },
                {
                  key: "location",
                  label: "位置",
                  color: "bg-emerald-50 text-emerald-500",
                  onClick: () => void handleSupportLocationAttachment(),
                  icon: (
                    <>
                      <path d="M12 20s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="10" r="2.2" fill="currentColor" />
                    </>
                  ),
                },
                {
                  key: "card",
                  label: "名片",
                  color: "bg-violet-50 text-violet-500",
                  onClick: () => setSupportError("名片夹发送下一步接入"),
                  icon: (
                    <>
                      <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.5v-9Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M8.5 16a3.5 3.5 0 0 1 7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </>
                  ),
                },
                {
                  key: "file",
                  label: "文件",
                  color: "bg-amber-50 text-amber-500",
                  onClick: () => void openSupportFilePicker(),
                  icon: (
                    <>
                      <path d="M8 4.5h5.2L18 9.3V18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M13 4.8V9h4.2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </>
                  ),
                },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="flex flex-col items-center gap-2 rounded-2xl px-1 py-2 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  onClick={item.onClick}
                  disabled={supportComposerBusy}
                >
                  <span className={`flex h-12 w-12 items-center justify-center rounded-full ${item.color}`}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                      {item.icon}
                    </svg>
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {supportError ? <div className="mb-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{supportError}</div> : null}
        <div className="flex items-end gap-2">
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 transition ${
              supportAttachmentMenuOpen ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
            }`}
            onClick={toggleSupportAttachmentMenu}
            disabled={!supportComposerAvailable || supportComposerBusy}
            aria-label="打开附件菜单"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
          <div className="flex min-h-11 min-w-0 flex-1 items-end overflow-hidden rounded-[28px] bg-white px-3 py-2 shadow-[0_8px_18px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80">
            <textarea
              ref={supportInputRef}
              rows={1}
              className="min-h-[24px] w-full resize-none overflow-y-hidden bg-transparent px-1 py-0 text-base leading-6 outline-none transition placeholder:text-slate-400"
              placeholder=""
              value={supportDraft}
              onChange={(event) => setSupportDraft(event.target.value)}
              onFocus={() => setSupportAttachmentMenuOpen(false)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !event.ctrlKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void sendSupportMessage();
              }}
              disabled={!supportComposerAvailable}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="enter"
            />
          </div>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-[0_10px_22px_rgba(34,197,94,0.28)] transition ${
              supportComposerBusy || supportCanSend
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-slate-300 shadow-none"
            }`}
            onPointerDown={(event) => {
              if (supportSendPointerHandledRef.current || supportComposerBusy || !supportCanSend) return;
              if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
              event.preventDefault();
              supportSendPointerHandledRef.current = true;
              focusSupportInputImmediately();
              void sendSupportMessage();
              window.setTimeout(() => {
                supportSendPointerHandledRef.current = false;
              }, 600);
            }}
            onClick={() => {
              if (supportSendPointerHandledRef.current) {
                supportSendPointerHandledRef.current = false;
                return;
              }
              void sendSupportMessage();
            }}
            disabled={supportComposerBusy || !supportCanSend}
            aria-label={supportComposerBusy ? "发送中" : selectedSupportSendButtonLabel}
          >
            {supportComposerBusy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                <path
                  d="M5 12.5 18.2 5.8c.7-.36 1.5.28 1.29 1.04l-2.84 10.2c-.18.66-.97.92-1.5.5l-3.7-2.94a1 1 0 0 1-.27-1.17l1.63-3.62-4.46 3.54a1 1 0 0 1-.84.2L5.64 13.2A.77.77 0 0 1 5 12.5Z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    );
  }

  function renderSupportContactRow(contactRow: SupportContactRow, options?: { mobile?: boolean }) {
    const active = selectedConversationKey === contactRow.key;
    return (
      <button
        type="button"
        className={
          options?.mobile
            ? `w-full rounded-[26px] border px-3 py-3.5 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition ${
                active ? "border-slate-900 bg-white" : "border-slate-200 bg-white/90 hover:bg-white"
              }`
            : `w-full rounded-2xl border px-3 py-3 text-left transition ${
                active ? "border-blue-300 bg-blue-50" : "bg-white hover:bg-slate-50"
              }`
        }
        onClick={() => {
          if (options?.mobile) {
            openSupportContactThread(contactRow.key);
          } else {
            setSelectedConversationKey(contactRow.key);
            focusSupportInput();
          }
        }}
      >
        <div className="flex items-start gap-3">
          <SupportAvatarBadge
            label={contactRow.avatarLabel}
            imageUrl={contactRow.avatarImageUrl}
            imageAlt={contactRow.name}
            className={`mt-0.5 h-12 w-12 text-sm shadow-sm ${
              contactRow.isOfficial || contactRow.unread
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
            showMerchantBadge={contactRow.accountType === "merchant"}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className={`truncate text-sm ${options?.mobile ? "font-semibold" : "font-medium"} text-slate-900`}>
                    {contactRow.name}
                  </div>
                  {!contactRow.isOfficial ? (
                    <span className="truncate text-[11px] font-medium text-slate-400">{contactRow.subtitle}</span>
                  ) : null}
                  {contactRow.badge ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                      {contactRow.badge}
                    </span>
                  ) : null}
                  {contactRow.unread ? (
                    <span aria-label="有未读消息" className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" />
                  ) : null}
                </div>
                {contactRow.isOfficial ? (
                  <div className={`${options?.mobile ? "mt-1" : ""} truncate text-[11px] text-slate-500`}>
                    {contactRow.subtitle}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-[11px] text-slate-400">
                {contactRow.updatedAt ? formatSupportConversationTime(contactRow.updatedAt) : options?.mobile ? "未开始" : "未聊天"}
              </div>
            </div>
            <div className={`${options?.mobile ? "text-[13px]" : "text-xs"} mt-2 truncate leading-5 text-slate-600`}>
              {contactRow.preview}
            </div>
          </div>
        </div>
      </button>
    );
  }

  function renderConversationInfoOverlay() {
    if (!conversationInfoOpen) return null;
    const renderInfoContent = (isMobile: boolean) => (
      <>
        <div className={`flex items-start justify-between ${isMobile ? "gap-3" : "gap-4"}`}>
          <div className="flex min-w-0 items-center gap-3">
            <SupportAvatarBadge
              label={selectedConversationAvatarLabel}
              imageUrl={selectedConversationAvatarImageUrl}
              imageAlt={selectedConversationName}
              className={
                isMobile
                  ? "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white"
                  : "flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-slate-900 text-base font-semibold text-white shadow-sm"
              }
              labelClassName={isMobile ? "text-sm font-semibold text-white" : "text-base font-semibold text-white"}
              showMerchantBadge={selectedPeerContactIsMerchant}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className={`truncate font-semibold text-slate-900 ${isMobile ? "text-base" : "text-lg"}`}>
                  {selectedConversationName}
                </div>
                {selectedConversationIsOfficial ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                    官方
                  </span>
                ) : null}
              </div>
              <div className={`mt-1 text-slate-500 ${isMobile ? "text-xs" : "text-sm"}`}>
                {isMobile ? selectedConversationInfoSubtitle : selectedConversationMeta}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            onClick={() => setConversationInfoOpen(false)}
          >
            关闭
          </button>
        </div>
        <div
          className={`divide-y divide-slate-100 overflow-hidden rounded-[24px] border border-slate-100 ${
            isMobile ? "mt-4 bg-slate-50/70" : "mt-5 bg-slate-50/80"
          }`}
        >
          {selectedConversationInfoItems.map((item) => (
            <div key={item.label} className={isMobile ? "px-4 py-3" : "px-5 py-4"}>
              <div className="text-[11px] font-medium tracking-[0.08em] text-slate-400">{item.label}</div>
              <div className="mt-1 text-sm leading-6 text-slate-900">
                {item.href ? (
                  <a
                    href={item.href}
                    target={item.openInNewTab ? "_blank" : undefined}
                    rel={item.openInNewTab ? "noreferrer" : undefined}
                    className="break-all text-slate-900 underline decoration-slate-300 underline-offset-4"
                  >
                    {item.value}
                  </a>
                ) : (
                  <span className="break-words">{item.value}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </>
    );

    return (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[2147483400] bg-slate-950/40 backdrop-blur-[1px]"
          onClick={() => setConversationInfoOpen(false)}
          aria-label="关闭资料"
        />
        <div className="fixed inset-x-0 bottom-0 z-[2147483401] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:hidden">
          <div className="mx-auto w-full max-w-md rounded-[30px] bg-white px-4 pb-4 pt-3 shadow-[0_24px_80px_rgba(15,23,42,0.2)]">
            <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
            <div className="mt-4">{renderInfoContent(true)}</div>
          </div>
        </div>
        <div className="fixed inset-0 z-[2147483401] hidden items-center justify-center p-4 md:flex">
          <div className="w-full max-w-xl rounded-[30px] bg-white px-6 py-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            {renderInfoContent(false)}
          </div>
        </div>
      </>
    );
  }

  function renderDesktopSupportSurface() {
    return (
      <div className="flex h-[calc(100vh-4rem)] min-h-[560px] min-w-0 overflow-hidden rounded-2xl border bg-white shadow-[0_18px_44px_rgba(15,23,42,0.06)] md:grid md:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b bg-white md:border-b-0 md:border-r">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="min-w-0 flex-1 rounded border px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                placeholder="精确搜索ID或邮箱"
                value={supportContactKeyword}
                onChange={(event) => setSupportContactKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void searchConversation();
                }}
              />
              <button
                type="button"
                className="shrink-0 rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={() => void searchConversation()}
                disabled={supportSearching}
              >
                {supportSearching ? "搜索中..." : "搜索"}
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3">
            {supportSearchError ? (
              <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{supportSearchError}</div>
            ) : null}
            <div className="space-y-2">
              {supportContactRows.map((contactRow) => (
                <div key={contactRow.key}>{renderSupportContactRow(contactRow)}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-visible rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
                onClick={() => setConversationInfoOpen(true)}
                aria-label="查看资料"
              >
                <SupportAvatarBadge
                  label={selectedConversationAvatarLabel}
                  imageUrl={selectedConversationAvatarImageUrl}
                  imageAlt={selectedConversationName}
                  className="flex h-full w-full items-center justify-center bg-slate-900 text-white"
                  labelClassName="text-sm font-semibold text-white"
                  showMerchantBadge={selectedPeerContactIsMerchant}
                />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate text-base font-semibold text-slate-900">{selectedConversationName}</div>
                  {selectedConversationIsOfficial ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                      官方
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-slate-500">{selectedConversationMeta || "-"}</div>
              </div>
            </div>
          </div>
          {renderSupportMessageList("min-h-0 min-w-0 flex-1 overflow-y-auto bg-white px-5 py-5")}
          {renderDesktopSupportComposer()}
        </div>
      </div>
    );
  }

  function renderSectionContent(section: DesktopSection) {
    if (section === "conversations") {
      return renderDesktopSupportSurface();
    }
    if (section === "faolla") {
      return (
        <div className="relative h-[calc(100vh-4rem)] min-h-[560px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <iframe title="Faolla" src={faollaTargetHref} className="absolute inset-0 h-full w-full border-0 bg-transparent" />
        </div>
      );
    }
    if (section === "profile") {
      return (
        <PersonalProfileEditor
          accountId={accountId}
          email={email}
          draft={personalProfileDraft}
          saving={personalProfileSaving}
          message={personalProfileMessage}
          onChange={updatePersonalProfileDraft}
          onSave={() => {
            void savePersonalProfile();
          }}
        />
      );
    }

    const item = desktopMenuItems.find((entry) => entry.key === section) ?? desktopMenuItems[0];
    const iconName =
      section === "bookings"
        ? "calendar"
        : section === "orders"
          ? "order"
          : section === "favorites"
            ? "star"
            : section === "cards"
              ? "card"
              : "chat";

    return (
      <EmptyFeatureCard
        icon={<Icon name={iconName} />}
        title={item.label}
        description={`${item.description} 当前先完成个人后台布局，数据接入会在下一步继续补。`}
      />
    );
  }

  function renderConsumptionContent() {
    const isBookings = consumptionSection === "bookings";
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-[24px] border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                className={`rounded-[19px] px-5 py-2.5 text-sm font-semibold transition ${
                  isBookings ? "bg-emerald-500 text-white shadow-sm" : "text-slate-500"
                }`}
                onClick={() => setConsumptionSection("bookings")}
              >
                预约
              </button>
              <button
                type="button"
                className={`rounded-[19px] px-5 py-2.5 text-sm font-semibold transition ${
                  !isBookings ? "bg-slate-950 text-white shadow-sm" : "text-slate-500"
                }`}
                onClick={() => setConsumptionSection("orders")}
              >
                订单
              </button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+5.85rem)] pt-4">
          <EmptyFeatureCard
            icon={<Icon name={isBookings ? "calendar" : "order"} />}
            title={isBookings ? "我的预约" : "我的订单"}
            description={isBookings ? "这里会集中展示你向商户提交的预约。" : "这里会集中展示你在商户网站提交的产品订单。"}
          />
        </div>
      </div>
    );
  }

  function renderMobileConversationsContent() {
    if (mobileConversationView === "thread") {
      return (
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)]">
          <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.55rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-900 hover:bg-slate-100"
                  onClick={() => setMobileConversationView("list")}
                  aria-label="返回会话列表"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                    <path
                      d="M19 12H7M12 7l-5 5 5 5"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="square"
                      strokeLinejoin="miter"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="flex h-11 w-11 shrink-0 items-center justify-center overflow-visible rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
                  onClick={() => setConversationInfoOpen(true)}
                  aria-label="查看资料"
                >
                  <SupportAvatarBadge
                    label={selectedConversationAvatarLabel}
                    imageUrl={selectedConversationAvatarImageUrl}
                    imageAlt={selectedConversationName}
                    className="flex h-full w-full items-center justify-center bg-slate-900 text-white"
                    labelClassName="text-sm font-semibold text-white"
                    showMerchantBadge={selectedPeerContactIsMerchant}
                  />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-[15px] font-semibold text-slate-900">{selectedConversationName}</div>
                    {selectedConversationIsOfficial ? (
                      <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                        官方
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{selectedConversationMeta || "-"}</div>
                </div>
              </div>
            </div>
          </div>
          {renderSupportMessageList("min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-4")}
          {renderMobileSupportComposer()}
        </div>
      );
    }

    return (
      <>
        <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
              会话
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-slate-900">聊天列表</div>
              <div className="mt-1 text-xs text-slate-500">{mobileSupportContactListSummary}</div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex min-h-[41px] min-w-0 flex-1 items-center gap-2.5 rounded-[20px] border border-slate-200 bg-[#f3f4f6] px-3.5 py-2 shadow-sm">
              <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] shrink-0 text-slate-400" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.9" />
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                className="min-w-0 flex-1 bg-transparent text-[14px] leading-5 text-slate-900 outline-none placeholder:text-slate-400"
                placeholder="精确搜索ID或邮箱"
                value={supportContactKeyword}
                onChange={(event) => setSupportContactKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void searchConversation();
                }}
              />
            </div>
            <button
              type="button"
              className="inline-flex h-[41px] shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm shadow-sm hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void searchConversation()}
              disabled={supportSearching}
            >
              {supportSearching ? "搜索中" : "搜索"}
            </button>
          </div>
          {supportSearchError ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {supportSearchError}
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+5.85rem)] pt-3">
          <div className="space-y-2.5">
            {supportContactRows.map((contactRow) => (
              <div key={contactRow.key}>{renderSupportContactRow(contactRow, { mobile: true })}</div>
            ))}
          </div>
        </div>
      </>
    );
  }

  function renderMobileContent() {
    if (mobileTab === "conversations") return renderMobileConversationsContent();
    if (mobileTab === "consumption") return renderConsumptionContent();
    if (mobileTab === "self") {
      const selfMenuItems: Array<{
        key: MobileSelfSection;
        label: string;
        summary: string;
        icon: ReactNode;
      }> = [
        {
          key: "profile",
          label: "我的资料",
          summary: mobileSelfProfileSummary,
          icon: <Icon name="user" />,
        },
        {
          key: "cards",
          label: "名片夹",
          summary: mobileSelfCardsSummary,
          icon: <Icon name="card" />,
        },
        {
          key: "notifications",
          label: "通知",
          summary: mobileSelfNotificationSummary,
          icon: (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path
                d="M12 4.5A4.5 4.5 0 0 0 7.5 9v2.1c0 .6-.2 1.2-.6 1.7L5.8 14a1 1 0 0 0 .8 1.6h10.8a1 1 0 0 0 .8-1.6l-1.1-1.2c-.4-.5-.6-1.1-.6-1.7V9A4.5 4.5 0 0 0 12 4.5Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M10.3 18a1.9 1.9 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ),
        },
      ];
      return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="absolute right-4 top-[calc(env(safe-area-inset-top)+0.7rem)] z-20">
              {mobileSelfSection === "profile" ? (
                <button
                  type="button"
                  className="flex h-11 items-center rounded-full bg-slate-950 px-4 text-xs font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)] disabled:cursor-not-allowed disabled:bg-slate-300"
                  onClick={() => {
                    void savePersonalProfile();
                  }}
                  disabled={personalProfileSaving}
                >
                  {personalProfileSaving ? "保存中..." : "保存资料"}
                </button>
              ) : (
                <div ref={mobileSelfLanguageRootRef} className="relative">
                  <button
                    type="button"
                    className="block h-6 w-9 overflow-hidden rounded-[4px] border border-slate-300/80 bg-transparent p-0 transition hover:brightness-105"
                    onClick={() => setMobileSelfLanguageMenuOpen((current) => !current)}
                    aria-label="切换语言"
                    aria-expanded={mobileSelfLanguageMenuOpen}
                    title={mobileSelfSelectedLanguage.label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={languageFlagImageUrl(mobileSelfSelectedLanguage.countryCode)}
                      alt={mobileSelfSelectedLanguage.label}
                      width={80}
                      height={60}
                      className="block h-full w-full object-cover"
                      loading="eager"
                    />
                  </button>
                  {mobileSelfLanguageMenuOpen ? (
                    <div
                      ref={mobileSelfLanguageMenuRef}
                      className="absolute right-0 top-[calc(100%+0.5rem)] max-h-[55vh] w-[220px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_22px_60px_rgba(15,23,42,0.22)]"
                    >
                      <div className="space-y-1">
                        {LANGUAGE_OPTIONS.map((item) => (
                          <button
                            key={item.code}
                            type="button"
                            className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition ${
                              item.code === locale ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                            }`}
                            onClick={() => {
                              setLocale(item.code);
                              setMobileSelfLanguageMenuOpen(false);
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={languageFlagImageUrl(item.countryCode)}
                              alt={item.label}
                              width={16}
                              height={12}
                              className="rounded-[2px] border border-slate-200 object-cover"
                              loading="lazy"
                            />
                            <span className="truncate">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            {mobileSelfSection === "home" ? (
              <div className="flex flex-col items-center px-4 text-center">
                <button
                  type="button"
                  className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[30px] bg-slate-900 text-xl font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
                  onClick={openPersonalAvatarPicker}
                  disabled={personalAvatarUploading || personalProfileSaving}
                  aria-label="上传头像"
                >
                  <SupportAvatarBadge
                    label={avatarLabel}
                    imageUrl={personalAvatarImageUrl}
                    imageAlt={profileName}
                    className="flex h-full w-full items-center justify-center bg-slate-900 text-white"
                    labelClassName="text-xl font-semibold text-white"
                  />
                  {personalAvatarUploading || personalProfileSaving ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-slate-950/35">
                      <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                    </span>
                  ) : (
                    <span className="absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.18)]">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                        <path
                          d="M8.5 8.5 9.7 7h4.6l1.2 1.5H18A2 2 0 0 1 20 10.5v5A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-5A2 2 0 0 1 6 8.5h2.5Z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M12 14.7a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  )}
                </button>
                <div className="mt-4 max-w-full truncate text-[28px] font-semibold leading-none text-slate-950">{profileName}</div>
                <div className="mt-2 max-w-full truncate text-sm text-slate-500">
                  {personalProfileDraft.signature || accountId || email || "点击头像上传资料照片"}
                </div>
                {personalProfileMessage ? (
                  <div className="mt-3 max-w-full rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                    {personalProfileMessage}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={`flex items-center gap-3 ${mobileSelfSection === "profile" ? "pr-24" : "pr-16"}`}>
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-900 hover:bg-slate-100"
                  onClick={() => setMobileSelfSection("home")}
                  aria-label="返回自己主页"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                    <path d="M19 12H7M12 7l-5 5 5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-semibold text-slate-900">
                    {mobileSelfSection === "profile" ? "我的资料" : mobileSelfSection === "cards" ? "名片夹" : "通知"}
                  </div>
                  {mobileSelfSection === "profile" ? null : (
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {mobileSelfSection === "cards" ? "这里统一管理个人名片夹。" : "这里控制系统消息通知、提示音和震动。"}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+5.85rem)] pt-4">
            <input
              ref={personalAvatarInputRef}
              className="hidden"
              type="file"
              accept="image/*"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                void handlePersonalAvatarInputChange(event);
              }}
            />
            {mobileSelfSection === "home" ? (
              <div className="space-y-4">
                <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                  <div className="divide-y divide-slate-100">
                    {selfMenuItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                        onClick={() => setMobileSelfSection(item.key)}
                      >
                        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                          <span className="mt-1 block truncate text-xs leading-5 text-slate-500">{item.summary}</span>
                        </span>
                        <span className="text-slate-300">
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="overflow-hidden rounded-[28px] border border-rose-200/80 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-rose-50/70 disabled:opacity-50"
                    onClick={() => void requestLogout()}
                    disabled={loggingOut}
                  >
                    <div className="text-sm font-semibold text-rose-600">{loggingOut ? "退出中..." : "退出登录"}</div>
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                        <path d="M14 7h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 8 6 12l4 4M7 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                </section>
              </div>
            ) : mobileSelfSection === "profile" ? (
              <PersonalProfileEditor
                accountId={accountId}
                email={email}
                draft={personalProfileDraft}
                saving={personalProfileSaving}
                message={personalProfileMessage}
                showSaveButton={false}
                compact
                onChange={updatePersonalProfileDraft}
                onSave={() => {
                  void savePersonalProfile();
                }}
              />
            ) : mobileSelfSection === "cards" ? (
              <EmptyFeatureCard
                icon={<Icon name="card" />}
                title="名片夹"
                description="个人名片夹会在下一步接入，这里会统一展示保存和可发送的名片。"
              />
            ) : (
              <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="text-sm font-semibold text-slate-900">通知</div>
                  <div className="mt-1 text-xs text-slate-500">个人用户通知设置会在下一步接入。</div>
                </div>
                <div className="divide-y divide-slate-100">
                  {["系统消息通知", "消息提示音", "震动"].map((label) => (
                    <div key={label} className="flex items-center gap-3 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900">{label}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">暂未开启，后续接入个人通知后可在这里控制。</div>
                      </div>
                      <span className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-slate-200 opacity-55">
                        <span className="inline-block h-5 w-5 translate-x-1 rounded-full bg-white shadow-sm" />
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      );
    }
    if (mobileTab === "faolla") {
      return (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <iframe title="Faolla" src={faollaTargetHref} className="absolute inset-0 h-full w-full border-0 bg-transparent" />
        </div>
      );
    }
    return null;
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 text-sm text-slate-500">
        正在载入个人中心...
      </main>
    );
  }

  return (
    <>
      <main className="hidden min-h-screen bg-slate-50/70 pl-[320px] md:block">
        <aside className="fixed inset-y-0 left-0 z-30 w-[320px] border-r border-slate-200 bg-white/96 shadow-[12px_0_34px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex h-full min-h-0 flex-col p-4">
            <div className="rounded border border-slate-300 bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="max-w-[160px] truncate text-sm font-semibold text-slate-900" title={profileName}>
                    {profileName}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="rounded border bg-white px-3 py-2 text-sm text-slate-900 transition-colors hover:bg-gray-50"
                    onClick={() => setDesktopSection("profile")}
                  >
                    个人信息
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded border bg-white text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                    onClick={() => void requestLogout()}
                    disabled={loggingOut}
                    title={loggingOut ? "退出中..." : "退出登录"}
                    aria-label={loggingOut ? "退出中..." : "退出登录"}
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                      <path d="M14 7h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10 8 6 12l4 4M7 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="grid gap-2">
                {desktopMenuItems.map((item) => (
                  <DesktopMenuButton
                    key={item.key}
                    item={item}
                    active={desktopSection === item.key}
                    onClick={() => setDesktopSection(item.key)}
                  />
                ))}
              </div>
            </div>

            <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">个人中心</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">个人用户后台会逐步接入会话、预约、订单、收藏和名片夹。</p>
            </div>
          </div>
        </aside>

        <section className="min-h-screen">
          <div className="px-6 py-8">{renderSectionContent(desktopSection)}</div>
        </section>
      </main>

      <main className="fixed inset-x-0 top-0 bottom-0 z-[120] flex min-h-0 flex-col overflow-hidden overscroll-none bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)] touch-manipulation md:hidden">
        {renderMobileContent()}
      </main>
      {mobileTab === "conversations" && mobileConversationView === "thread" ? null : (
        <MobileBottomNav activeTab={mobileTab} onChange={setMobileTab} />
      )}
      {renderConversationInfoOverlay()}
    </>
  );
}
