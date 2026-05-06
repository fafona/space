"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import AccountSwitcherDialog from "@/components/AccountSwitcherDialog";
import FaollaQrPanel from "@/components/FaollaQrPanel";
import { useI18n } from "@/components/I18nProvider";
import NoMercyFlagIcon from "@/components/NoMercyFlagIcon";
import ShuangkouToolIcon from "@/components/ShuangkouToolIcon";
import TankBattleIcon from "@/components/TankBattleIcon";
import ToolboxIcon from "@/components/ToolboxIcon";
import {
  FaollaMobileSettingsContent,
  getFaollaMobileSettingsBackView,
  getFaollaMobileSettingsSubtitle,
  getFaollaMobileSettingsTitle,
  isFaollaMobileSettingsView,
  type FaollaMobileSettingsView,
} from "@/components/FaollaMobileSettingsPages";
import {
  clearStoredBrowserSupabaseSessionTokens,
  readMerchantSessionPayload,
  recoverBrowserSupabaseSessionWithRefresh,
  resolveFrontendAuthPayload,
  startMerchantSessionKeepAlive,
  syncMerchantSessionCookies,
} from "@/lib/authSessionRecovery";
import {
  getAccountSwitchEntryKey,
  getAccountSwitchHomeHref,
  readAccountSwitchEntries,
  recordCurrentAccountSwitchSession,
  removeAccountSwitchEntry,
  restoreAccountSwitchEntry,
  type AccountSwitchEntry,
} from "@/lib/accountSwitching";
import { type MerchantContactVisibility, type SiteLocation } from "@/data/platformControlStore";
import {
  buildPersonalAccountPermissionConfig,
  normalizePersonalAccountServiceConfig,
  type PersonalAccountServiceConfig,
} from "@/lib/personalAccountServiceConfig";
import { loadEuropeLocationOptionsApi, type EuropeLocationOptionsApi } from "@/lib/europeLocationOptionsLoader";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import {
  FAOLLA_APP_SHELL_LOCATION_MESSAGE,
  buildFaollaShellHref,
  isFaollaBackendShellUrl,
  isFaollaSectionSearch,
  normalizeFaollaEntryUrl,
  readFaollaEntryUrlFromSearch,
  readStoredFaollaEntryUrl,
  resolveFaollaEntryUrlFromBrowser,
  writeStoredFaollaEntryUrl,
} from "@/lib/faollaEntry";
import { installFrontendAuthBridgeResponder, isTrustedFrontendAuthBridgeOrigin } from "@/lib/frontendAuthBridge";
import { PERSONAL_CONSUMPTION_CHANGED_MESSAGE } from "@/lib/personalConsumptionBridge";
import { buildMerchantBusinessCardShareUrl, resolveMerchantBusinessCardShareOrigin } from "@/lib/merchantBusinessCardShare";
import { buildMerchantFrontendHref } from "@/lib/siteRouting";
import { clearTankBattleLobbyReturnTarget, readTankBattleLobbyReturnTarget } from "@/lib/tankBattleLobbyReturn";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import {
  normalizeMerchantBusinessCards,
  type MerchantBusinessCardAsset,
  type MerchantBusinessCardProfileInput,
} from "@/lib/merchantBusinessCards";
import {
  findMerchantPeerThreadForMerchants,
  type MerchantPeerContactSummary,
  type MerchantPeerThread,
} from "@/lib/merchantPeerInbox";
import { type PlatformSupportMessage, type PlatformSupportThread } from "@/lib/platformSupportInbox";
import {
  formatSupportConversationPreview,
  isSupportShortMerchantCardLink,
  parseSupportMessageAttachmentPreview,
} from "@/lib/supportMessageAttachments";
import type { MerchantBookingEditableInput, MerchantBookingRecord } from "@/lib/merchantBookings";
import { getMerchantBookingDayLabel } from "@/lib/merchantBookingLocale";
import { MOBILE_SWIPE_BACK_EVENT, type MobileSwipeBackEventDetail } from "@/lib/mobileSwipeBack";
import { useFaollaAndroidAppUpdate } from "@/lib/useFaollaAndroidAppUpdate";
import { useMobilePortraitOrientationLock } from "@/lib/useMobilePortraitOrientationLock";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

const MerchantBusinessCardManager = dynamic(() => import("@/components/admin/MerchantBusinessCardManager"), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
      名片夹加载中...
    </div>
  ),
});

const SupportMessageContent = dynamic(() => import("@/components/support/SupportMessageContent"), {
  ssr: false,
  loading: () => null,
});

const MOBILE_FAOLLA_FRAME_STYLE: CSSProperties = {
  WebkitOverflowScrolling: "touch",
  overscrollBehaviorY: "contain",
  touchAction: "pan-y",
};

function readSameOriginFrameHref(frame: HTMLIFrameElement | null) {
  try {
    return frame?.contentWindow?.location.href ?? "";
  } catch {
    return "";
  }
}

type MeSessionPayload = {
  authenticated?: unknown;
  accountType?: unknown;
  accountId?: unknown;
  merchantId?: unknown;
  merchantIds?: unknown;
  personalServiceConfig?: unknown;
  personalServicePaused?: unknown;
  user?: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
    app_metadata?: Record<string, unknown> | null;
  } | null;
};

type DesktopSection = "conversations" | "bookings" | "orders" | "favorites" | "cards" | "faolla" | "profile";
type MobileTab = "conversations" | "consumption" | "faolla" | "self";
type ConsumptionSection = "bookings" | "orders";
type PersonalBookingFilter = "all" | "active" | "confirmed" | "cancelled";
type PersonalOrderFilter = "all" | "pending" | "confirmed" | "cancelled";
type MobileConversationView = "list" | "thread";
type MobileSelfSection = "home" | "profile" | "favorites" | "cards" | "tools" | "games" | "qr" | FaollaMobileSettingsView;

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

type PersonalFavoriteSite = {
  id: string;
  url: string;
  name: string;
  subtitle: string;
  addedAt: string;
};

type PersonalProfileResponsePayload = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  user?: MeSessionPayload["user"] | null;
  profile?: Partial<PersonalProfileDraft> | null;
  businessCards?: MerchantBusinessCardAsset[] | null;
  favoriteSites?: PersonalFavoriteSite[] | null;
};

type PersonalBookingsResponsePayload = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  bookings?: MerchantBookingRecord[];
  merchantContacts?: Record<string, PersonalMerchantContact>;
};

type PersonalOrdersResponsePayload = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  orders?: MerchantOrderRecord[];
  merchantContacts?: Record<string, PersonalMerchantContact>;
};

type PersonalMerchantContact = {
  siteId: string;
  name: string;
  email: string;
  phone: string;
};

type PersonalBookingEditDraft = {
  store: string;
  item: string;
  title: string;
  customerName: string;
  email: string;
  phone: string;
  note: string;
  date: string;
  time: string;
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
const PERSONAL_FAVORITE_SITE_LIMIT = 200;
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

const EMPTY_PERSONAL_BOOKING_EDIT_DRAFT: PersonalBookingEditDraft = {
  store: "",
  item: "",
  title: "",
  customerName: "",
  email: "",
  phone: "",
  note: "",
  date: "",
  time: "",
};

function trimText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function splitPersonalBookingDateTime(value: string | null | undefined): { date: string; time: string } {
  const normalized = trimText(value);
  const matched = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  return {
    date: matched?.[1] ?? "",
    time: matched?.[2] ?? "",
  };
}

function joinPersonalBookingDateTime(date: string, time: string) {
  const normalizedDate = trimText(date);
  const normalizedTime = trimText(time);
  if (!normalizedDate) return "";
  return normalizedTime ? `${normalizedDate}T${normalizedTime}` : normalizedDate;
}

function formatPersonalOrderAmount(amount: number, pricePrefix: string) {
  const normalized = Math.max(0, Number.isFinite(amount) ? amount : 0);
  return `${trimText(pricePrefix)}${normalized.toFixed(2)}`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readPayloadMessage(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function fetchPersonalConsumptionPayload<T extends { ok?: unknown; message?: unknown; error?: unknown }>(
  path: string,
  fallbackMessage: string,
) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const separator = path.includes("?") ? "&" : "?";
      const response = await fetch(`${path}${separator}_=${Date.now()}-${attempt}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
      });
      const payload = (await response.json().catch(() => null)) as T | null;
      if (response.ok && payload?.ok === true) return payload;
      lastError = new Error(readPayloadMessage(payload?.message || payload?.error, fallbackMessage));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(fallbackMessage);
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(fallbackMessage);
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

function mergeNonEmptyPersonalProfileDraft(base: PersonalProfileDraft, patch: Partial<PersonalProfileDraft> | null | undefined) {
  const next = { ...EMPTY_PERSONAL_PROFILE, ...base };
  if (!patch || typeof patch !== "object") return next;
  (Object.keys(EMPTY_PERSONAL_PROFILE) as Array<keyof PersonalProfileDraft>).forEach((key) => {
    const value = patch[key];
    if (typeof value === "string" && value.trim()) next[key] = value;
  });
  return next;
}

function mergePersonalProfileIntoPayload(
  payload: MeSessionPayload | null,
  profile: PersonalProfileDraft,
  userPatch?: MeSessionPayload["user"] | null,
): MeSessionPayload | null {
  const baseUser = payload?.user ?? null;
  const patchUser = userPatch ?? null;
  const user = patchUser ?? baseUser;
  if (!payload || !user) return payload;

  const currentMetadata =
    baseUser?.user_metadata && typeof baseUser.user_metadata === "object" ? baseUser.user_metadata : {};
  const patchMetadata = patchUser?.user_metadata && typeof patchUser.user_metadata === "object" ? patchUser.user_metadata : {};
  const currentProfile = readRecord(currentMetadata.personal_profile) ?? {};
  const patchProfile = readRecord(patchMetadata.personal_profile) ?? {};
  const nextProfile = {
    ...currentProfile,
    ...patchProfile,
    ...profile,
    bio: profile.signature,
  };

  return {
    ...payload,
    user: {
      ...baseUser,
      ...patchUser,
      user_metadata: {
        ...currentMetadata,
        ...patchMetadata,
        personal_profile: nextProfile,
        display_name: profile.displayName,
        displayName: profile.displayName,
        avatar_url: profile.avatarUrl,
        avatarUrl: profile.avatarUrl,
        signature: profile.signature,
        bio: profile.signature,
        phone: profile.phone,
        contact_phone: profile.phone,
        contactPhone: profile.phone,
        email: profile.email,
        contact_email: profile.email,
        contactEmail: profile.email,
        contact_card: profile.contactCard,
        contactCard: profile.contactCard,
        birthday: profile.birthday,
        gender: profile.gender,
        country: profile.country,
        province: profile.province,
        city: profile.city,
        address: profile.address,
      },
    },
  };
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

function isStandaloneDisplayMode() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function shouldOpenFaollaShellInitially() {
  if (typeof window === "undefined") return false;
  return isFaollaSectionSearch(window.location.search) || isStandaloneDisplayMode();
}

function readPersonalMobileViewport() {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(max-width: 767px), (pointer: coarse) and (max-width: 1024px)").matches;
  }
  return window.innerWidth < 768;
}

function readInitialFaollaEmbedHref() {
  if (typeof window === "undefined") return "/";
  const storedHref = readStoredFaollaEntryUrl(window.location.origin) || "/";
  if (!isFaollaSectionSearch(window.location.search)) return storedHref;
  return readFaollaEntryUrlFromSearch(window.location.search, window.location.origin) || storedHref;
}

function normalizePersonalFavoriteSiteUrl(value: unknown, fallbackOrigin = "https://faolla.com") {
  const normalized = normalizeFaollaEntryUrl(value, fallbackOrigin, { allowCrossOrigin: true });
  if (!normalized || isFaollaBackendShellUrl(normalized, fallbackOrigin)) return "";
  try {
    const url = new URL(normalized, fallbackOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.searchParams.delete("appShell");
    url.searchParams.delete("uiLocale");
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function getFavoriteSiteRootUrl(value: string) {
  try {
    const url = new URL(value);
    const normalizedPath = url.pathname.replace(/\/+$/g, "");
    if (/^\/site\/\d{8}$/.test(normalizedPath) || /^\/\d{8}$/.test(normalizedPath)) {
      url.pathname = normalizedPath;
    } else {
      url.pathname = "/";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function getFavoriteSiteDefaultName(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return "商户网站";
  if (normalized.endsWith(".faolla.com")) {
    const prefix = normalized.slice(0, -".faolla.com".length).split(".").filter(Boolean).pop();
    return prefix || normalized;
  }
  return normalized.replace(/^www\./, "");
}

function normalizePersonalFavoriteSites(value: unknown): PersonalFavoriteSite[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: PersonalFavoriteSite[] = [];
  for (const item of value) {
    const record = readRecord(item);
    if (!record) continue;
    const url = normalizePersonalFavoriteSiteUrl(record.url);
    if (!url) continue;
    const rootUrl = getFavoriteSiteRootUrl(url);
    const parsed = new URL(rootUrl);
    const id = trimText(record.id) || parsed.origin;
    if (seen.has(id)) continue;
    seen.add(id);
    output.push({
      id,
      url: rootUrl,
      name: trimText(record.name) || getFavoriteSiteDefaultName(parsed.hostname),
      subtitle: trimText(record.subtitle) || parsed.hostname,
      addedAt: trimText(record.addedAt) || new Date().toISOString(),
    });
    if (output.length >= PERSONAL_FAVORITE_SITE_LIMIT) break;
  }
  return output;
}

function buildCurrentFavoriteSiteFromHref(value: unknown, fallbackOrigin = "https://faolla.com"): PersonalFavoriteSite | null {
  const url = normalizePersonalFavoriteSiteUrl(value, fallbackOrigin);
  if (!url) return null;
  try {
    const rootUrl = getFavoriteSiteRootUrl(url);
    const parsed = new URL(rootUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "faolla.com" || hostname === "www.faolla.com") return null;
    return {
      id: parsed.origin,
      url: rootUrl,
      name: getFavoriteSiteDefaultName(hostname),
      subtitle: hostname,
      addedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
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

function formatPersonalRecordDateTime(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return normalized.replace("T", " ").slice(0, 16);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPersonalBookingStatus(record: Pick<MerchantBookingRecord, "status">): PersonalBookingFilter {
  if (record.status === "active" || record.status === "cancelled") return record.status;
  return "confirmed";
}

function getPersonalOrderStatus(record: Pick<MerchantOrderRecord, "status">): PersonalOrderFilter {
  if (record.status === "pending" || record.status === "cancelled") return record.status;
  return "confirmed";
}

function getPersonalBookingStatusText(status: PersonalBookingFilter) {
  if (status === "all") return "全部";
  if (status === "active") return "待确认";
  if (status === "confirmed") return "已确认";
  return "已取消";
}

function getPersonalOrderStatusText(status: PersonalOrderFilter) {
  if (status === "all") return "全部";
  if (status === "pending") return "待确认";
  if (status === "confirmed") return "已确认";
  return "已取消";
}

function getPersonalStatusBadgeClass(status: PersonalBookingFilter | PersonalOrderFilter) {
  if (status === "active" || status === "pending") return "border border-amber-200 bg-amber-50 text-amber-700";
  if (status === "confirmed") return "border border-sky-200 bg-sky-50 text-sky-700";
  if (status === "cancelled") return "border border-slate-200 bg-slate-100 text-slate-600";
  return "border border-slate-200 bg-white text-slate-600";
}

function getPersonalFilterChipClass(active: boolean, status: PersonalBookingFilter | PersonalOrderFilter) {
  if (status === "active" || status === "pending") {
    return active
      ? "border border-amber-300 bg-amber-100 text-amber-800"
      : "border border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "confirmed") {
    return active
      ? "border border-sky-300 bg-sky-100 text-sky-800"
      : "border border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "cancelled") {
    return active
      ? "border border-slate-300 bg-slate-200 text-slate-800"
      : "border border-slate-200 bg-slate-100 text-slate-600";
  }
  return active ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600";
}

function buildPhoneHref(value: string) {
  const normalized = value.trim();
  return normalized ? `tel:${normalized.replace(/\s+/g, "")}` : "";
}

function hasPersonalMerchantTouch(record: Pick<MerchantBookingRecord | MerchantOrderRecord, "merchantTouchedAt">) {
  return Boolean(trimText(record.merchantTouchedAt));
}

function canCancelPersonalBooking(record: MerchantBookingRecord) {
  return getPersonalBookingStatus(record) === "active" && !hasPersonalMerchantTouch(record);
}

function canEditPersonalBooking(record: MerchantBookingRecord) {
  return getPersonalBookingStatus(record) === "active" && !hasPersonalMerchantTouch(record);
}

function canRestorePersonalBooking(record: MerchantBookingRecord) {
  return getPersonalBookingStatus(record) === "cancelled" && !hasPersonalMerchantTouch(record);
}

function canCancelPersonalOrder(record: MerchantOrderRecord) {
  return getPersonalOrderStatus(record) === "pending" && !hasPersonalMerchantTouch(record);
}

function createPersonalBookingEditDraft(record: MerchantBookingRecord): PersonalBookingEditDraft {
  const appointmentParts = splitPersonalBookingDateTime(record.appointmentAt);
  return {
    store: record.store || "",
    item: record.item || "",
    title: record.title || "",
    customerName: record.customerName || "",
    email: record.email || "",
    phone: record.phone || "",
    note: record.note || "",
    date: appointmentParts.date,
    time: appointmentParts.time,
  };
}

function buildPersonalBookingEditableInput(draft: PersonalBookingEditDraft): Partial<MerchantBookingEditableInput> {
  return {
    store: draft.store,
    item: draft.item,
    title: draft.title,
    customerName: draft.customerName,
    email: draft.email,
    phone: draft.phone,
    note: draft.note,
    appointmentAt: joinPersonalBookingDateTime(draft.date, draft.time),
  };
}

function getTodayDateValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function resolvePersonalBusinessCardPreviewUrl(card: MerchantBusinessCardAsset | null | undefined) {
  if (!card) return "";
  const preferredUrl =
    normalizeConversationDetailText(card.shareImageUrl) || normalizeConversationDetailText(card.imageUrl);
  return normalizePublicAssetUrl(preferredUrl);
}

function buildPersonalBusinessCardImageMessageText(input: {
  card: MerchantBusinessCardAsset;
  imageUrl?: string;
}) {
  return (
    normalizePublicAssetUrl(normalizeConversationDetailText(input.imageUrl)) ||
    resolvePersonalBusinessCardPreviewUrl(input.card)
  );
}

function buildPersonalBusinessCardLinkMessageText(input: {
  card: MerchantBusinessCardAsset;
  shareUrl?: string;
}) {
  const fallbackShareUrl = buildConversationMerchantCardLink(input.card);
  const shareUrl = isSupportShortMerchantCardLink(input.shareUrl ?? "")
    ? normalizeConversationDetailText(input.shareUrl)
    : isSupportShortMerchantCardLink(fallbackShareUrl)
      ? normalizeConversationDetailText(fallbackShareUrl)
      : "";
  return shareUrl ? ["联系卡", shareUrl].join("\n") : "";
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

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: "chat" | "shop" | "shield" | "user" | "calendar" | "order" | "star" | "card";
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
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

function MailIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v9A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5v-9Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m4 6 6 4 6-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M4.25 5.75A1.75 1.75 0 0 1 6 4h8a1.75 1.75 0 0 1 1.75 1.75v5.5A1.75 1.75 0 0 1 14 13H9.15l-3.4 2.6V13.4A1.75 1.75 0 0 1 4.25 11.75v-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M6.62 10.79a15.53 15.53 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.4 21 3 13.6 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.19 2.2z" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6 3.75h5.75L15.25 7v9.25H6A1.25 1.25 0 0 1 4.75 15V5A1.25 1.25 0 0 1 6 3.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M11.75 3.75V7h3.25" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.5 10h5M7.5 12.75h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function FaollaHomeButton({
  className,
  onClick,
}: {
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-full border border-slate-200/90 bg-white/95 text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.14)] backdrop-blur transition hover:-translate-y-[1px] hover:bg-white hover:text-slate-950 ${className ?? ""}`}
      onClick={onClick}
      title="返回 Faolla 总站"
      aria-label="返回 Faolla 总站"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M4.75 10.5 12 4.75l7.25 5.75V18a1.25 1.25 0 0 1-1.25 1.25H6A1.25 1.25 0 0 1 4.75 18V10.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9.25 19.25v-5h5.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </button>
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
  const [locationOptionsApi, setLocationOptionsApi] = useState<EuropeLocationOptionsApi | null>(null);
  const countryOptions = useMemo(() => locationOptionsApi?.getEuropeCountryOptions() ?? [], [locationOptionsApi]);
  useEffect(() => {
    let active = true;
    loadEuropeLocationOptionsApi()
      .then((api) => {
        if (active) setLocationOptionsApi(api);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const selectedCountryCode = useMemo(() => {
    const normalized = normalizePersonalLocationValue(countryValue);
    if (!normalized) return "";
    return (
      countryOptions.find(
        (item) => normalizePersonalLocationValue(item.name) === normalized || normalizePersonalLocationValue(item.code) === normalized,
      )?.code ?? ""
    );
  }, [countryOptions, countryValue]);
  const provinceOptions = useMemo(
    () => locationOptionsApi?.getEuropeProvinceOptions(selectedCountryCode) ?? [],
    [locationOptionsApi, selectedCountryCode],
  );
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
    () => locationOptionsApi?.getEuropeCityOptions(selectedCountryCode, selectedProvinceCode) ?? [],
    [locationOptionsApi, selectedCountryCode, selectedProvinceCode],
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
    <div className="faolla-personal-mobile-bottom-nav support-mobile-nav-shell pointer-events-none fixed bottom-0 left-1/2 z-[2147483298] w-full max-w-md -translate-x-1/2 overscroll-none touch-none transition duration-200 md:hidden">
      <div
        className="pointer-events-auto relative px-3 pt-1.5 touch-manipulation"
        style={{ paddingBottom: "calc(var(--faolla-mobile-safe-bottom) + 0.1rem)" }}
      >
        <div className="flex items-center gap-0 rounded-[22px] border border-slate-200/80 bg-white/95 px-1 py-1 shadow-[0_8px_22px_rgba(15,23,42,0.08)] backdrop-blur">
          {items.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0 rounded-[18px] px-1 py-1 text-[10px] font-medium transition ${
                  active
                    ? "faolla-mobile-nav-tab-active bg-slate-200 text-slate-950 ring-1 ring-slate-950/10 shadow-sm"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
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
    <div className={`faolla-support-avatar relative flex shrink-0 items-center justify-center rounded-full font-semibold ${className}`}>
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
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
  useMobilePortraitOrientationLock();
  const [payload, setPayload] = useState<MeSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [accountSwitchEntries, setAccountSwitchEntries] = useState<AccountSwitchEntry[]>(() => readAccountSwitchEntries());
  const [accountSwitchBusyKey, setAccountSwitchBusyKey] = useState("");
  const [accountSwitchError, setAccountSwitchError] = useState("");
  const [desktopSection, setDesktopSection] = useState<DesktopSection>(() =>
    shouldOpenFaollaShellInitially() ? "faolla" : "conversations",
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>(() =>
    shouldOpenFaollaShellInitially() ? "faolla" : "conversations",
  );
  const [faollaEmbedHref, setFaollaEmbedHref] = useState(readInitialFaollaEmbedHref);
  const [isMobileViewport, setIsMobileViewport] = useState(readPersonalMobileViewport);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewport = () => setIsMobileViewport(readPersonalMobileViewport());
    syncViewport();
    window.addEventListener("resize", syncViewport);
    window.visualViewport?.addEventListener("resize", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
      window.visualViewport?.removeEventListener("resize", syncViewport);
    };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const explicitFaollaSection = isFaollaSectionSearch(window.location.search);
    if (!explicitFaollaSection && !isStandaloneDisplayMode()) return;
    const storedHref = readStoredFaollaEntryUrl(window.location.origin) || "/";
    const nextHref = explicitFaollaSection
      ? resolveFaollaEntryUrlFromBrowser(window.location.search, window.location.origin) || storedHref
      : storedHref;
    setFaollaEmbedHref(nextHref);
    setDesktopSection("faolla");
    setMobileTab("faolla");
  }, []);
  const [consumptionSection, setConsumptionSection] = useState<ConsumptionSection>("bookings");
  const [mobileConversationView, setMobileConversationView] = useState<MobileConversationView>("list");
  const [mobileSelfSection, setMobileSelfSection] = useState<MobileSelfSection>("home");
  const faollaAndroidAppUpdate = useFaollaAndroidAppUpdate();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const targetTab = params.get("mobileTab");
    const targetSection = params.get("selfSection");
    const tankBattleReturnTarget = readTankBattleLobbyReturnTarget("personal");
    if (targetTab !== "self" && !targetSection && !tankBattleReturnTarget) return;
    setMobileTab("self");
    let clearReturnTargetTimer: number | null = null;
    if (
      targetSection === "home" ||
      targetSection === "profile" ||
      targetSection === "favorites" ||
      targetSection === "cards" ||
      targetSection === "tools" ||
      targetSection === "games" ||
      targetSection === "qr"
    ) {
      setMobileSelfSection(targetSection);
    } else if (isFaollaMobileSettingsView(targetSection)) {
      setMobileSelfSection(targetSection);
    } else if (targetSection === "notifications") {
      setMobileSelfSection("settings-notifications");
    } else if (tankBattleReturnTarget) {
      setMobileSelfSection("games");
    }
    if (tankBattleReturnTarget) {
      clearReturnTargetTimer = window.setTimeout(() => clearTankBattleLobbyReturnTarget("personal"), 2500);
    }
    return () => {
      if (clearReturnTargetTimer !== null) window.clearTimeout(clearReturnTargetTimer);
    };
  }, []);
  const [mobileSelfLanguageMenuOpen, setMobileSelfLanguageMenuOpen] = useState(false);
  const [conversationInfoOpen, setConversationInfoOpen] = useState(false);
  const [selectedConversationKey, setSelectedConversationKey] = useState<PersonalConversationKey>(OFFICIAL_CONVERSATION_KEY);
  const pendingQrConnectPeerRef = useRef("");
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
  const [supportSelfCardPickerOpen, setSupportSelfCardPickerOpen] = useState(false);
  const [supportSelfCardPickerCards, setSupportSelfCardPickerCards] = useState<MerchantBusinessCardAsset[]>([]);
  const [personalProfileDraft, setPersonalProfileDraft] = useState<PersonalProfileDraft>(EMPTY_PERSONAL_PROFILE);
  const [personalBusinessCards, setPersonalBusinessCards] = useState<MerchantBusinessCardAsset[]>([]);
  const [personalFavoriteSites, setPersonalFavoriteSites] = useState<PersonalFavoriteSite[]>([]);
  const [personalProfileSaving, setPersonalProfileSaving] = useState(false);
  const [personalAvatarUploading, setPersonalAvatarUploading] = useState(false);
  const [personalProfileMessage, setPersonalProfileMessage] = useState("");
  const [faollaFavoriteToast, setFaollaFavoriteToast] = useState<{
    id: number;
    text: string;
    tone: "success" | "error";
  } | null>(null);
  const [personalBookings, setPersonalBookings] = useState<MerchantBookingRecord[]>([]);
  const [personalOrders, setPersonalOrders] = useState<MerchantOrderRecord[]>([]);
  const [personalMerchantContacts, setPersonalMerchantContacts] = useState<Record<string, PersonalMerchantContact>>({});
  const [personalBookingFilter, setPersonalBookingFilter] = useState<PersonalBookingFilter>("all");
  const [personalOrderFilter, setPersonalOrderFilter] = useState<PersonalOrderFilter>("all");
  const [personalActionBusyKey, setPersonalActionBusyKey] = useState("");
  const [personalBookingSearch, setPersonalBookingSearch] = useState("");
  const [personalBookingEditTargetId, setPersonalBookingEditTargetId] = useState("");
  const [personalBookingDetailTargetId, setPersonalBookingDetailTargetId] = useState("");
  const [personalOrderDetailTargetId, setPersonalOrderDetailTargetId] = useState("");
  const [personalBookingEditDraft, setPersonalBookingEditDraft] = useState<PersonalBookingEditDraft>(
    EMPTY_PERSONAL_BOOKING_EDIT_DRAFT,
  );
  const [personalConsumptionLoading, setPersonalConsumptionLoading] = useState(false);
  const [personalBookingLoadError, setPersonalBookingLoadError] = useState("");
  const [personalOrderLoadError, setPersonalOrderLoadError] = useState("");
  const [personalConsumptionReloadKey, setPersonalConsumptionReloadKey] = useState(0);
  const supportMessagesViewportRef = useRef<HTMLDivElement | null>(null);
  const supportInputRef = useRef<HTMLTextAreaElement | null>(null);
  const supportSendingRef = useRef(false);
  const supportSendPointerHandledRef = useRef(false);
  const supportSelfCardShareBundleRef = useRef<Record<string, { shareUrl: string; shareKey: string; imageUrl: string }>>(
    {},
  );
  const personalBusinessCardsRef = useRef<MerchantBusinessCardAsset[]>([]);
  const personalBusinessCardsSaveRequestIdRef = useRef(0);
  const personalFavoriteSitesRef = useRef<PersonalFavoriteSite[]>([]);
  const personalFavoriteSitesSaveRequestIdRef = useRef(0);
  const personalSessionRecoveryInFlightRef = useRef<Promise<MeSessionPayload | null> | null>(null);
  const personalDesktopFaollaFrameRef = useRef<HTMLIFrameElement | null>(null);
  const personalMobileFaollaFrameRef = useRef<HTMLIFrameElement | null>(null);
  const personalFaollaBackendResetAtRef = useRef(0);
  const personalAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSelfLanguageRootRef = useRef<HTMLDivElement | null>(null);
  const mobileSelfLanguageMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const visible = desktopSection === "conversations";
    document.documentElement.setAttribute("data-desktop-language-switcher", visible ? "show" : "hide");
    window.dispatchEvent(new CustomEvent("merchant-desktop-language-switcher-change", { detail: { visible } }));
    return () => {
      document.documentElement.removeAttribute("data-desktop-language-switcher");
      window.dispatchEvent(new CustomEvent("merchant-desktop-language-switcher-change", { detail: { visible: false } }));
    };
  }, [desktopSection]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const nextPayload = (await resolveFrontendAuthPayload(7200).catch(() => null)) as MeSessionPayload | null;
        if (cancelled) return;
        if (nextPayload?.authenticated !== true || !nextPayload?.user) {
          window.location.replace("/login?redirect=/me");
          return;
        }
        if (nextPayload.accountType !== "personal") {
          window.location.replace("/admin");
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
    if (payload?.authenticated !== true || payload.accountType !== "personal") return;
    return startMerchantSessionKeepAlive({
      timeoutMs: 5200,
    });
  }, [payload?.accountId, payload?.accountType, payload?.authenticated]);

  const ensurePersonalSessionReady = useCallback(async () => {
    if (personalSessionRecoveryInFlightRef.current) return personalSessionRecoveryInFlightRef.current;
    const task = (async (): Promise<MeSessionPayload | null> => {
      const acceptPayload = (candidate: unknown) => {
        const nextPayload = candidate as MeSessionPayload | null;
        if (nextPayload?.authenticated === true && nextPayload.accountType === "personal" && nextPayload.user) {
          setPayload(nextPayload);
          return nextPayload;
        }
        return null;
      };

      const cookiePayload = await readMerchantSessionPayload(5200).catch(() => null);
      const acceptedCookiePayload = acceptPayload(cookiePayload);
      if (acceptedCookiePayload) return acceptedCookiePayload;

      const recoveredSession = await recoverBrowserSupabaseSessionWithRefresh(7200).catch(() => null);
      if (recoveredSession) {
        const syncedPayload = await syncMerchantSessionCookies(recoveredSession, 6200).catch(() => null);
        const acceptedSyncedPayload = acceptPayload(syncedPayload);
        if (acceptedSyncedPayload) return acceptedSyncedPayload;
      }

      const retryPayload = await readMerchantSessionPayload(5200).catch(() => null);
      return acceptPayload(retryPayload);
    })();
    personalSessionRecoveryInFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (personalSessionRecoveryInFlightRef.current === task) {
        personalSessionRecoveryInFlightRef.current = null;
      }
    }
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMobileSwipeBack = (event: Event) => {
      const source = (event as CustomEvent<MobileSwipeBackEventDetail>).detail?.source;
      const isAndroidBack = source === "android-back";
      if (!isMobileViewport) return;
      if (conversationInfoOpen) {
        event.preventDefault();
        setConversationInfoOpen(false);
        return;
      }
      if (mobileTab === "conversations" && mobileConversationView === "thread") {
        event.preventDefault();
        setMobileConversationView("list");
        return;
      }
      if (mobileTab === "self" && mobileSelfSection !== "home") {
        event.preventDefault();
        if (isFaollaMobileSettingsView(mobileSelfSection)) {
          setMobileSelfSection(getFaollaMobileSettingsBackView(mobileSelfSection));
        } else {
          setMobileSelfSection("home");
        }
        return;
      }
      if (!isAndroidBack) {
        event.preventDefault();
      }
    };
    window.addEventListener(MOBILE_SWIPE_BACK_EVENT, handleMobileSwipeBack);
    return () => {
      window.removeEventListener(MOBILE_SWIPE_BACK_EVENT, handleMobileSwipeBack);
    };
  }, [conversationInfoOpen, isMobileViewport, mobileConversationView, mobileSelfSection, mobileTab]);

  const accountId =
    payload && typeof payload.accountId === "string" && /^\d{8}$/.test(payload.accountId.trim())
      ? payload.accountId.trim()
      : "";
  const email = trimText(payload?.user?.email);
  const personalProfile = useMemo(() => readPersonalProfile(payload), [payload]);
  const displayName = personalProfile.displayName || readDisplayName(payload);
  const profileName = displayName || email.split("@")[0] || accountId || "个人用户";
  const personalAccountSwitchCurrentKey = getAccountSwitchEntryKey("personal", accountId);
  useEffect(() => {
    if (payload?.authenticated !== true || payload.accountType !== "personal" || !accountId) return;
    let cancelled = false;
    void recordCurrentAccountSwitchSession({
      displayName: profileName,
      avatarUrl: personalProfile.avatarUrl,
    }).then((entries) => {
      if (!cancelled) setAccountSwitchEntries(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, payload?.accountType, payload?.authenticated, personalProfile.avatarUrl, profileName]);
  const frontendAuthBridgeProfile = useMemo(
    () => mergeNonEmptyPersonalProfileDraft(personalProfile, personalProfileDraft),
    [personalProfile, personalProfileDraft],
  );
  const frontendAuthBridgePayload = useMemo(
    () => mergePersonalProfileIntoPayload(payload, frontendAuthBridgeProfile),
    [frontendAuthBridgeProfile, payload],
  );
  useEffect(() => {
    return installFrontendAuthBridgeResponder(() => frontendAuthBridgePayload);
  }, [frontendAuthBridgePayload]);
  const personalServiceConfig = useMemo(
    () =>
      normalizePersonalAccountServiceConfig(
        (payload?.personalServiceConfig ?? null) as PersonalAccountServiceConfig | null,
      ),
    [payload?.personalServiceConfig],
  );
  const personalBusinessCardPermissionConfig = useMemo(
    () => buildPersonalAccountPermissionConfig(personalServiceConfig),
    [personalServiceConfig],
  );
  const persistPersonalBusinessCards = useCallback(
    async (cards: MerchantBusinessCardAsset[]) => {
      if (!accountId) return;
      const normalizedCards = normalizeMerchantBusinessCards(cards);
      const previousCards = personalBusinessCardsRef.current;
      personalBusinessCardsRef.current = normalizedCards;
      setPersonalBusinessCards(normalizedCards);
      setPersonalProfileMessage("");
      const requestId = personalBusinessCardsSaveRequestIdRef.current + 1;
      personalBusinessCardsSaveRequestIdRef.current = requestId;
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
            businessCards: normalizedCards,
          }),
        });
        const result = (await response.json().catch(() => null)) as PersonalProfileResponsePayload | null;
        if (!response.ok || !result || result.ok !== true) {
          throw new Error(readPayloadMessage(result?.message, "名片保存失败，请稍后重试"));
        }
        const nextCards = normalizeMerchantBusinessCards(result.businessCards);
        if (personalBusinessCardsSaveRequestIdRef.current === requestId) {
          personalBusinessCardsRef.current = nextCards;
          setPersonalBusinessCards(nextCards);
        }
      } catch (error) {
        if (personalBusinessCardsSaveRequestIdRef.current === requestId) {
          personalBusinessCardsRef.current = previousCards;
          setPersonalBusinessCards(previousCards);
          setPersonalProfileMessage(
            error instanceof Error ? error.message : "名片保存失败，请稍后重试",
          );
        }
        throw error;
      }
    },
    [accountId],
  );
  const persistPersonalFavoriteSites = useCallback(
    async (sites: PersonalFavoriteSite[]) => {
      if (!accountId) return;
      const normalizedSites = normalizePersonalFavoriteSites(sites);
      const previousSites = personalFavoriteSitesRef.current;
      const requestId = personalFavoriteSitesSaveRequestIdRef.current + 1;
      personalFavoriteSitesSaveRequestIdRef.current = requestId;
      personalFavoriteSitesRef.current = normalizedSites;
      setPersonalFavoriteSites(normalizedSites);
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
            favoriteSites: normalizedSites,
          }),
        });
        const result = (await response.json().catch(() => null)) as PersonalProfileResponsePayload | null;
        if (!response.ok || !result || result.ok !== true) {
          throw new Error(readPayloadMessage(result?.message, "收藏保存失败，请稍后重试"));
        }
        const nextSites = normalizePersonalFavoriteSites(result.favoriteSites);
        if (personalFavoriteSitesSaveRequestIdRef.current === requestId) {
          personalFavoriteSitesRef.current = nextSites;
          setPersonalFavoriteSites(nextSites);
        }
      } catch (error) {
        if (personalFavoriteSitesSaveRequestIdRef.current === requestId) {
          personalFavoriteSitesRef.current = previousSites;
          setPersonalFavoriteSites(previousSites);
          setPersonalProfileMessage(error instanceof Error ? error.message : "收藏保存失败，请稍后重试");
        }
        throw error;
      }
    },
    [accountId],
  );
  const personalBusinessCardProfile = useMemo(
    () =>
      ({
        merchantName: profileName || accountId || "个人名片",
        domainPrefix: accountId || "personal",
        contactAddress: personalProfileDraft.address,
        contactName: personalProfileDraft.displayName || displayName || accountId,
        contactPhone: personalProfileDraft.phone,
        contactEmail: personalProfileDraft.email || email,
        location: {
          country: personalProfileDraft.country,
          province: personalProfileDraft.province,
          city: personalProfileDraft.city,
        },
      }) satisfies MerchantBusinessCardProfileInput,
    [
      accountId,
      displayName,
      email,
      personalProfileDraft.address,
      personalProfileDraft.city,
      personalProfileDraft.country,
      personalProfileDraft.displayName,
      personalProfileDraft.email,
      personalProfileDraft.phone,
      personalProfileDraft.province,
      profileName,
    ],
  );
  useEffect(() => {
    personalBusinessCardsRef.current = personalBusinessCards;
  }, [personalBusinessCards]);
  useEffect(() => {
    personalFavoriteSitesRef.current = personalFavoriteSites;
  }, [personalFavoriteSites]);
  useEffect(() => {
    supportSelfCardShareBundleRef.current = {};
  }, [personalBusinessCards]);
  const personalBusinessCardTargetUrl = useMemo(() => {
    if (!accountId) return "https://faolla.com";
    if (typeof window !== "undefined") {
      return new URL(`/u/${accountId}`, window.location.origin).toString();
    }
    return `https://faolla.com/u/${accountId}`;
  }, [accountId]);
  const personalBusinessCardManagerCommonProps = useMemo(
    () =>
      accountId
        ? {
            merchantId: accountId,
            siteBaseDomain:
              typeof window !== "undefined" ? window.location.host : process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN || "faolla.com",
            profile: personalBusinessCardProfile,
            cards: personalBusinessCards,
            targetUrlOverride: personalBusinessCardTargetUrl,
            cardLimit: personalBusinessCardPermissionConfig.businessCardLimit,
            allowLinkMode: personalBusinessCardPermissionConfig.allowBusinessCardLinkMode,
            backgroundImageLimitKb: personalBusinessCardPermissionConfig.businessCardBackgroundImageLimitKb,
            contactPageImageLimitKb: personalBusinessCardPermissionConfig.businessCardContactImageLimitKb,
            exportImageLimitKb: personalBusinessCardPermissionConfig.businessCardExportImageLimitKb,
            onCardsChange: persistPersonalBusinessCards,
          }
        : null,
    [
      accountId,
      personalBusinessCardPermissionConfig.allowBusinessCardLinkMode,
      personalBusinessCardPermissionConfig.businessCardBackgroundImageLimitKb,
      personalBusinessCardPermissionConfig.businessCardContactImageLimitKb,
      personalBusinessCardPermissionConfig.businessCardExportImageLimitKb,
      personalBusinessCardPermissionConfig.businessCardLimit,
      personalBusinessCardProfile,
      personalBusinessCardTargetUrl,
      personalBusinessCards,
      persistPersonalBusinessCards,
    ],
  );
  useEffect(() => {
    if (loading) return;
    if (!accountId) {
      setPersonalBusinessCards([]);
      setPersonalFavoriteSites([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/personal-profile", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
          },
        });
        const result = (await response.json().catch(() => null)) as PersonalProfileResponsePayload | null;
        if (!response.ok || !result || result.ok !== true) {
          throw new Error(readPayloadMessage(result?.message, "名片加载失败，请稍后重试"));
        }
        if (cancelled) return;
        if (result.user || result.profile) {
          setPayload((current) => {
            if (!current) return current;
            const payloadWithResultUser = {
              ...current,
              user: result.user ?? current.user,
            } as MeSessionPayload;
            const nextProfile = mergePersonalProfileDraft(readPersonalProfile(payloadWithResultUser), result.profile);
            return mergePersonalProfileIntoPayload(current, nextProfile, result.user);
          });
        }
        const nextCards = normalizeMerchantBusinessCards(result.businessCards);
        personalBusinessCardsRef.current = nextCards;
        setPersonalBusinessCards(nextCards);
        const nextFavoriteSites = normalizePersonalFavoriteSites(result.favoriteSites);
        personalFavoriteSitesRef.current = nextFavoriteSites;
        setPersonalFavoriteSites(nextFavoriteSites);
      } catch {
        if (cancelled) return;
        personalBusinessCardsRef.current = [];
        setPersonalBusinessCards([]);
        personalFavoriteSitesRef.current = [];
        setPersonalFavoriteSites([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, loading]);
  const avatarLabel = getInitialLabel(profileName);
  const personalAvatarImageUrl = personalProfileDraft.avatarUrl || personalProfile.avatarUrl;
  const personalQrUrl = useMemo(() => {
    if (!accountId || typeof window === "undefined") return "";
    const url = new URL("/connect", window.location.origin);
    url.searchParams.set("type", "personal");
    url.searchParams.set("id", accountId);
    if (profileName) url.searchParams.set("name", profileName);
    return url.toString();
  }, [accountId, profileName]);
  const handlePersonalQrScanResult = useCallback((value: string) => {
    try {
      const url = new URL(value, window.location.origin);
      if (url.pathname === "/connect" && url.searchParams.get("id")) {
        window.location.href = url.toString();
        return;
      }
      setPersonalProfileMessage("这不是有效的 Faolla 二维码");
    } catch {
      setPersonalProfileMessage("这不是有效的 Faolla 二维码");
    }
  }, []);
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
  const mobileSelfCardsSummary = "管理个人名片、短链和可发送名片。";
  const mobileSelfNotificationSummary = "系统通知、提示音和震动设置。";

  const refreshPersonalConsumption = useCallback(() => {
    setPersonalConsumptionReloadKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedFrontendAuthBridgeOrigin(event.origin)) return;
      const message = readRecord(event.data);
      if (message?.type === PERSONAL_CONSUMPTION_CHANGED_MESSAGE) {
        refreshPersonalConsumption();
      }
    };
    const handleLocalChange = () => refreshPersonalConsumption();
    window.addEventListener("message", handleMessage);
    window.addEventListener(PERSONAL_CONSUMPTION_CHANGED_MESSAGE, handleLocalChange);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener(PERSONAL_CONSUMPTION_CHANGED_MESSAGE, handleLocalChange);
    };
  }, [refreshPersonalConsumption]);

  useEffect(() => {
    if (!accountId) return;
    if (desktopSection === "bookings" || desktopSection === "orders" || mobileTab === "consumption") {
      refreshPersonalConsumption();
    }
  }, [accountId, consumptionSection, desktopSection, mobileTab, refreshPersonalConsumption]);

  useEffect(() => {
    if (!accountId) {
      setPersonalBookings([]);
      setPersonalOrders([]);
      setPersonalMerchantContacts({});
      setPersonalBookingLoadError("");
      setPersonalOrderLoadError("");
      setPersonalConsumptionLoading(false);
      return;
    }

    let cancelled = false;
    const loadPersonalConsumption = async () => {
      setPersonalConsumptionLoading(true);
      setPersonalBookingLoadError("");
      setPersonalOrderLoadError("");
      await ensurePersonalSessionReady();
      if (cancelled) return;
      const [bookingsResult, ordersResult] = await Promise.allSettled([
        fetchPersonalConsumptionPayload<PersonalBookingsResponsePayload>(
          "/api/bookings?scope=personal",
          "booking_load_failed",
        ),
        fetchPersonalConsumptionPayload<PersonalOrdersResponsePayload>("/api/orders?scope=personal", "order_load_failed"),
      ]);
      if (cancelled) return;

      const nextContacts: Record<string, PersonalMerchantContact> = {};
      if (bookingsResult.status === "fulfilled") {
        const bookingsPayload = bookingsResult.value;
        setPersonalBookings(Array.isArray(bookingsPayload.bookings) ? bookingsPayload.bookings : []);
        Object.assign(
          nextContacts,
          bookingsPayload.merchantContacts && typeof bookingsPayload.merchantContacts === "object"
            ? bookingsPayload.merchantContacts
            : {},
        );
      } else {
        setPersonalBookingLoadError("预约记录加载失败，请稍后重试。");
      }

      if (ordersResult.status === "fulfilled") {
        const ordersPayload = ordersResult.value;
        setPersonalOrders(Array.isArray(ordersPayload.orders) ? ordersPayload.orders : []);
        Object.assign(
          nextContacts,
          ordersPayload.merchantContacts && typeof ordersPayload.merchantContacts === "object"
            ? ordersPayload.merchantContacts
            : {},
        );
      } else {
        setPersonalOrderLoadError("订单记录加载失败，请稍后重试。");
      }

      setPersonalMerchantContacts(nextContacts);
      setPersonalConsumptionLoading(false);
    };

    void loadPersonalConsumption();
    return () => {
      cancelled = true;
    };
  }, [accountId, ensurePersonalSessionReady, personalConsumptionReloadKey]);

  const personalBookingCounts = useMemo(() => {
    const counts: Record<PersonalBookingFilter, number> = { all: personalBookings.length, active: 0, confirmed: 0, cancelled: 0 };
    personalBookings.forEach((booking) => {
      counts[getPersonalBookingStatus(booking)] += 1;
    });
    return counts;
  }, [personalBookings]);

  const personalOrderCounts = useMemo(() => {
    const counts: Record<PersonalOrderFilter, number> = { all: personalOrders.length, pending: 0, confirmed: 0, cancelled: 0 };
    personalOrders.forEach((order) => {
      counts[getPersonalOrderStatus(order)] += 1;
    });
    return counts;
  }, [personalOrders]);

  const filteredPersonalBookings = useMemo(() => {
    const keyword = personalBookingSearch.trim().toLowerCase();
    return personalBookings.filter((booking) => {
      if (personalBookingFilter !== "all" && getPersonalBookingStatus(booking) !== personalBookingFilter) return false;
      if (!keyword) return true;
      const contact = personalMerchantContacts[trimText(booking.siteId)];
      return [
        booking.id,
        booking.siteId,
        booking.siteName,
        booking.store,
        booking.item,
        booking.title,
        booking.customerName,
        booking.email,
        booking.phone,
        booking.note,
        booking.appointmentAt,
        contact?.name,
        contact?.email,
        contact?.phone,
      ]
        .map((value) => trimText(value).toLowerCase())
        .some((value) => value.includes(keyword));
    });
  }, [personalBookingFilter, personalBookingSearch, personalBookings, personalMerchantContacts]);

  const filteredPersonalOrders = useMemo(
    () =>
      personalOrderFilter === "all"
        ? personalOrders
        : personalOrders.filter((order) => getPersonalOrderStatus(order) === personalOrderFilter),
    [personalOrderFilter, personalOrders],
  );

  const resolvePersonalMerchantContact = useCallback(
    (siteId: string, siteName: string) => {
      const normalizedSiteId = trimText(siteId);
      const contact = personalMerchantContacts[normalizedSiteId];
      return {
        siteId: normalizedSiteId,
        name: trimText(contact?.name) || trimText(siteName) || normalizedSiteId || "商户",
        email: trimText(contact?.email),
        phone: trimText(contact?.phone),
      };
    },
    [personalMerchantContacts],
  );

  const personalBookingEditTarget = useMemo(
    () => personalBookings.find((booking) => booking.id === personalBookingEditTargetId) ?? null,
    [personalBookingEditTargetId, personalBookings],
  );
  const personalBookingDetailTarget = useMemo(
    () => personalBookings.find((booking) => booking.id === personalBookingDetailTargetId) ?? null,
    [personalBookingDetailTargetId, personalBookings],
  );
  const personalOrderDetailTarget = useMemo(
    () => personalOrders.find((order) => order.id === personalOrderDetailTargetId) ?? null,
    [personalOrderDetailTargetId, personalOrders],
  );

  const openPersonalBookingEditor = useCallback((booking: MerchantBookingRecord) => {
    setPersonalBookingEditTargetId(booking.id);
    setPersonalBookingEditDraft(createPersonalBookingEditDraft(booking));
    setPersonalBookingLoadError("");
  }, []);

  const closePersonalBookingEditor = useCallback(() => {
    setPersonalBookingEditTargetId("");
    setPersonalBookingEditDraft(EMPTY_PERSONAL_BOOKING_EDIT_DRAFT);
  }, []);

  const updatePersonalBookingEditDraft = useCallback((patch: Partial<PersonalBookingEditDraft>) => {
    setPersonalBookingEditDraft((current) => ({ ...current, ...patch }));
  }, []);

  const cancelPersonalBooking = useCallback(
    async (booking: MerchantBookingRecord) => {
      if (!canCancelPersonalBooking(booking) || personalActionBusyKey) return;
      const busyKey = `booking:${booking.id}:cancel`;
      setPersonalActionBusyKey(busyKey);
      setPersonalBookingLoadError("");
      try {
        const response = await fetch("/api/bookings", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", accept: "application/json" },
          body: JSON.stringify({ scope: "personal", action: "cancel", bookingId: booking.id }),
        });
        const nextPayload = (await response.json().catch(() => null)) as
          | { ok?: unknown; error?: unknown; message?: unknown; booking?: MerchantBookingRecord }
          | null;
        const nextBooking = nextPayload?.booking;
        if (!response.ok || nextPayload?.ok !== true || !nextBooking) {
          throw new Error(readPayloadMessage(nextPayload?.message || nextPayload?.error, "cancel_booking_failed"));
        }
        setPersonalBookings((current) => current.map((record) => (record.id === nextBooking.id ? nextBooking : record)));
        refreshPersonalConsumption();
      } catch {
        setPersonalBookingLoadError("取消预约失败，请稍后重试。");
      } finally {
        setPersonalActionBusyKey((current) => (current === busyKey ? "" : current));
      }
    },
    [personalActionBusyKey, refreshPersonalConsumption],
  );

  const restorePersonalBooking = useCallback(
    async (booking: MerchantBookingRecord) => {
      if (!canRestorePersonalBooking(booking) || personalActionBusyKey) return;
      const busyKey = `booking:${booking.id}:restore`;
      setPersonalActionBusyKey(busyKey);
      setPersonalBookingLoadError("");
      try {
        const response = await fetch("/api/bookings", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", accept: "application/json" },
          body: JSON.stringify({ scope: "personal", action: "restore", bookingId: booking.id }),
        });
        const nextPayload = (await response.json().catch(() => null)) as
          | { ok?: unknown; error?: unknown; message?: unknown; booking?: MerchantBookingRecord }
          | null;
        const nextBooking = nextPayload?.booking;
        if (!response.ok || nextPayload?.ok !== true || !nextBooking) {
          throw new Error(readPayloadMessage(nextPayload?.message || nextPayload?.error, "restore_booking_failed"));
        }
        setPersonalBookings((current) => current.map((record) => (record.id === nextBooking.id ? nextBooking : record)));
        refreshPersonalConsumption();
      } catch (error) {
        setPersonalBookingLoadError(error instanceof Error ? error.message : "恢复预约失败，请稍后重试。");
      } finally {
        setPersonalActionBusyKey((current) => (current === busyKey ? "" : current));
      }
    },
    [personalActionBusyKey, refreshPersonalConsumption],
  );

  const savePersonalBookingEdit = useCallback(async () => {
    const booking = personalBookingEditTarget;
    if (!booking || !canEditPersonalBooking(booking) || personalActionBusyKey) return;
    const busyKey = `booking:${booking.id}:update`;
    setPersonalActionBusyKey(busyKey);
    setPersonalBookingLoadError("");
    try {
      const response = await fetch("/api/bookings", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          scope: "personal",
          action: "update",
          bookingId: booking.id,
          updates: buildPersonalBookingEditableInput(personalBookingEditDraft),
        }),
      });
      const nextPayload = (await response.json().catch(() => null)) as
        | { ok?: unknown; error?: unknown; message?: unknown; booking?: MerchantBookingRecord }
        | null;
      const nextBooking = nextPayload?.booking;
      if (!response.ok || nextPayload?.ok !== true || !nextBooking) {
        throw new Error(readPayloadMessage(nextPayload?.message || nextPayload?.error, "update_booking_failed"));
      }
      setPersonalBookings((current) => current.map((record) => (record.id === nextBooking.id ? nextBooking : record)));
      closePersonalBookingEditor();
      refreshPersonalConsumption();
    } catch (error) {
      setPersonalBookingLoadError(error instanceof Error ? error.message : "修改预约失败，请稍后重试。");
    } finally {
      setPersonalActionBusyKey((current) => (current === busyKey ? "" : current));
    }
  }, [
    closePersonalBookingEditor,
    personalActionBusyKey,
    personalBookingEditDraft,
    personalBookingEditTarget,
    refreshPersonalConsumption,
  ]);

  const downloadPersonalBookingCalendar = useCallback((booking: MerchantBookingRecord) => {
    if (typeof window === "undefined") return;
    const url = `/api/bookings/customer-calendar?scope=personal&bookingId=${encodeURIComponent(booking.id)}&download=1`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const cancelPersonalOrder = useCallback(
    async (order: MerchantOrderRecord) => {
      if (!canCancelPersonalOrder(order) || personalActionBusyKey) return;
      const busyKey = `order:${order.id}:cancel`;
      setPersonalActionBusyKey(busyKey);
      setPersonalOrderLoadError("");
      try {
        const response = await fetch("/api/orders", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", accept: "application/json" },
          body: JSON.stringify({ scope: "personal", action: "cancel", siteId: order.siteId, orderId: order.id }),
        });
        const nextPayload = (await response.json().catch(() => null)) as
          | { ok?: unknown; error?: unknown; message?: unknown; order?: MerchantOrderRecord }
          | null;
        const nextOrder = nextPayload?.order;
        if (!response.ok || nextPayload?.ok !== true || !nextOrder) {
          throw new Error(readPayloadMessage(nextPayload?.message || nextPayload?.error, "cancel_order_failed"));
        }
        setPersonalOrders((current) => current.map((record) => (record.id === nextOrder.id ? nextOrder : record)));
        refreshPersonalConsumption();
      } catch {
        setPersonalOrderLoadError("取消订单失败，请稍后重试。");
      } finally {
        setPersonalActionBusyKey((current) => (current === busyKey ? "" : current));
      }
    },
    [personalActionBusyKey, refreshPersonalConsumption],
  );

  const faollaTargetHref = useMemo(
    () =>
      buildFaollaShellHref(
        faollaEmbedHref || "/",
        locale,
        typeof window !== "undefined" ? window.location.origin : "https://faolla.com",
      ),
    [faollaEmbedHref, locale],
  );
  const faollaHomeTargetHref = useMemo(
    () =>
      buildFaollaShellHref(
        "/",
        locale,
        typeof window !== "undefined" ? window.location.origin : "https://faolla.com",
      ),
    [locale],
  );
  const desktopFaollaTargetHref = faollaTargetHref;
  const mobileFaollaTargetHref = faollaTargetHref;
  const navigatePersonalFaollaHome = useCallback(() => {
    setFaollaEmbedHref("/");
    if (typeof window !== "undefined") {
      writeStoredFaollaEntryUrl(faollaHomeTargetHref, window.location.origin);
    }
    if (!isMobileViewport && personalDesktopFaollaFrameRef.current) {
      personalDesktopFaollaFrameRef.current.src = faollaHomeTargetHref;
    }
    if (isMobileViewport && personalMobileFaollaFrameRef.current) {
      personalMobileFaollaFrameRef.current.src = faollaHomeTargetHref;
    }
  }, [faollaHomeTargetHref, isMobileViewport]);
  const resetPersonalFaollaBackendFrame = useCallback(
    (frame: HTMLIFrameElement | null) => {
      if (typeof window === "undefined") return false;
      const href = readSameOriginFrameHref(frame);
      const normalized = normalizeFaollaEntryUrl(href, window.location.origin, { allowFaollaCrossOrigin: true });
      if (!normalized || !isFaollaBackendShellUrl(normalized, window.location.origin)) return false;

      const now = Date.now();
      if (now - personalFaollaBackendResetAtRef.current < 1200) return true;
      personalFaollaBackendResetAtRef.current = now;
      setFaollaEmbedHref("/");
      writeStoredFaollaEntryUrl(faollaHomeTargetHref, window.location.origin);
      if (frame && frame.src !== faollaHomeTargetHref) {
        frame.src = faollaHomeTargetHref;
      }
      return true;
    },
    [faollaHomeTargetHref],
  );
  const currentFaollaFavoriteSite = useMemo(
    () =>
      buildCurrentFavoriteSiteFromHref(
        faollaEmbedHref,
        typeof window !== "undefined" ? window.location.origin : "https://faolla.com",
      ),
    [faollaEmbedHref],
  );
  const currentFaollaFavoriteSiteId = currentFaollaFavoriteSite?.id ?? "";
  const currentFaollaFavoriteActive = useMemo(
    () => Boolean(currentFaollaFavoriteSiteId && personalFavoriteSites.some((site) => site.id === currentFaollaFavoriteSiteId)),
    [currentFaollaFavoriteSiteId, personalFavoriteSites],
  );
  const openPersonalFavoriteSite = useCallback(
    (site: PersonalFavoriteSite) => {
      const normalizedSite = normalizePersonalFavoriteSites([site])[0];
      if (!normalizedSite) return;
      const nextHref = normalizedSite.url;
      const shellHref = buildFaollaShellHref(
        nextHref,
        locale,
        typeof window !== "undefined" ? window.location.origin : "https://faolla.com",
      );
      setFaollaEmbedHref(nextHref);
      if (typeof window !== "undefined") {
        writeStoredFaollaEntryUrl(nextHref, window.location.origin);
      }
      setDesktopSection("faolla");
      setMobileTab("faolla");
      if (!isMobileViewport && personalDesktopFaollaFrameRef.current) {
        personalDesktopFaollaFrameRef.current.src = shellHref;
      }
      if (isMobileViewport && personalMobileFaollaFrameRef.current) {
        personalMobileFaollaFrameRef.current.src = shellHref;
      }
    },
    [isMobileViewport, locale],
  );
  const removePersonalFavoriteSite = useCallback(
    (siteId: string) => {
      const nextSites = personalFavoriteSites.filter((site) => site.id !== siteId);
      void persistPersonalFavoriteSites(nextSites).catch(() => undefined);
    },
    [persistPersonalFavoriteSites, personalFavoriteSites],
  );
  const showFaollaFavoriteToast = useCallback((text: string, tone: "success" | "error" = "success") => {
    setFaollaFavoriteToast({
      id: Date.now(),
      text,
      tone,
    });
  }, []);
  const toggleCurrentFaollaFavorite = useCallback(() => {
    if (!currentFaollaFavoriteSite) return;
    const removingFavorite = currentFaollaFavoriteActive;
    const nextSites = currentFaollaFavoriteActive
      ? personalFavoriteSites.filter((site) => site.id !== currentFaollaFavoriteSite.id)
      : [
          { ...currentFaollaFavoriteSite, addedAt: new Date().toISOString() },
          ...personalFavoriteSites.filter((site) => site.id !== currentFaollaFavoriteSite.id),
        ].slice(0, PERSONAL_FAVORITE_SITE_LIMIT);
    void persistPersonalFavoriteSites(nextSites)
      .then(() => {
        if (isMobileViewport) {
          showFaollaFavoriteToast(removingFavorite ? "已取消收藏" : "收藏成功");
        }
      })
      .catch(() => {
        if (isMobileViewport) {
          showFaollaFavoriteToast("收藏保存失败，请稍后重试", "error");
        }
      });
  }, [
    currentFaollaFavoriteActive,
    currentFaollaFavoriteSite,
    isMobileViewport,
    persistPersonalFavoriteSites,
    personalFavoriteSites,
    showFaollaFavoriteToast,
  ]);
  const renderFaollaFavoriteButton = (className = "") => (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-[0_12px_30px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/10 transition hover:scale-[1.03] hover:text-amber-500 disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
      onClick={toggleCurrentFaollaFavorite}
      disabled={!currentFaollaFavoriteSite}
      title={currentFaollaFavoriteActive ? "取消收藏" : "收藏商户"}
      aria-label={currentFaollaFavoriteActive ? "取消收藏" : "收藏商户"}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill={currentFaollaFavoriteActive ? "currentColor" : "none"} aria-hidden="true">
        <path
          d="m12 4.4 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L12 4.4Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
  const renderMobileCurrentFavoriteAction = () => {
    if (!currentFaollaFavoriteSite) return null;
    return (
      <section className="overflow-hidden rounded-[28px] border border-amber-200/80 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
        <button
          type="button"
          className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-amber-50/70"
          onClick={toggleCurrentFaollaFavorite}
        >
          <span
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              currentFaollaFavoriteActive ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-600"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill={currentFaollaFavoriteActive ? "currentColor" : "none"}
              aria-hidden="true"
            >
              <path
                d="m12 4.4 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L12 4.4Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">
              {currentFaollaFavoriteActive ? "已收藏当前商户" : "收藏当前商户"}
            </span>
            <span className="mt-1 block truncate text-xs leading-5 text-slate-500">
              {currentFaollaFavoriteSite.name || currentFaollaFavoriteSite.subtitle || "商户网站"}
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">
            {currentFaollaFavoriteActive ? "取消" : "收藏"}
          </span>
        </button>
      </section>
    );
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedFrontendAuthBridgeOrigin(event.origin, window.location.origin)) return;
      const message = readRecord(event.data);
      if (message?.type !== FAOLLA_APP_SHELL_LOCATION_MESSAGE) return;
      const href = typeof message.href === "string" ? message.href.trim() : "";
      const normalized = normalizeFaollaEntryUrl(href, window.location.origin, { allowFaollaCrossOrigin: true });
      if (!normalized) return;
      if (isFaollaBackendShellUrl(normalized, window.location.origin)) {
        resetPersonalFaollaBackendFrame(personalDesktopFaollaFrameRef.current);
        resetPersonalFaollaBackendFrame(personalMobileFaollaFrameRef.current);
        return;
      }
      setFaollaEmbedHref((current) => (current === normalized ? current : normalized));
      writeStoredFaollaEntryUrl(normalized, window.location.origin);
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [resetPersonalFaollaBackendFrame]);
  useEffect(() => {
    if (!faollaFavoriteToast) return;
    const timer = window.setTimeout(() => {
      setFaollaFavoriteToast((current) => (current?.id === faollaFavoriteToast.id ? null : current));
    }, 1800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [faollaFavoriteToast]);
  const openDesktopSection = useCallback((section: DesktopSection) => {
    setDesktopSection(section);
  }, []);
  const openMobileTab = useCallback((tab: MobileTab) => {
    setMobileTab(tab);
  }, []);

  const desktopMenuItems: MenuItem[] = useMemo(
    () => [
      { key: "conversations", label: "会话", description: "查看和商户、Faolla 的对话。" },
      { key: "bookings", label: "预约", description: "查看你提交给商户的预约记录。" },
      { key: "orders", label: "订单", description: "查看你在商户网站提交的订单。" },
      { key: "favorites", label: "收藏", description: "保存常用商户、页面和产品。" },
      { key: "cards", label: "名片夹", description: "管理个人名片、短链和聊天发送用名片。" },
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
      await ensurePersonalSessionReady();
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
  }, [accountId, email, ensurePersonalSessionReady, profileName]);

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
      await ensurePersonalSessionReady();
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
  }, [accountId, email, ensurePersonalSessionReady, profileName]);

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
      await ensurePersonalSessionReady();
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
      await ensurePersonalSessionReady();
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

  async function openPersonalMerchantConversation(target: {
    siteId?: string;
    email?: string;
    name?: string;
  }) {
    const merchantId = trimText(target.siteId);
    const merchantEmail = trimText(target.email).toLowerCase();
    const merchantName = trimText(target.name) || merchantId || "商户";
    if (!merchantId && !merchantEmail) return;

    setSupportError("");
    setSupportSearchError("");
    setSupportContactKeyword("");
    setSupportAttachmentMenuOpen(false);
    setConversationInfoOpen(false);
    setDesktopSection("conversations");
    setMobileTab("conversations");

    const existingContact = peerContacts.find((contact) => {
      const contactId = trimText(contact.merchantId);
      const contactEmail = trimText(contact.merchantEmail).toLowerCase();
      return (merchantId && contactId === merchantId) || (merchantEmail && contactEmail === merchantEmail);
    });
    if (existingContact) {
      setSelectedConversationKey(`merchant:${trimText(existingContact.merchantId)}`);
      setMobileConversationView("thread");
      return;
    }

    if (!accountId) {
      setSupportError("个人账号信息还没准备好，请稍后重试。");
      return;
    }
    if (supportSearching) return;

    setSupportSearching(true);
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
          query: merchantId || merchantEmail,
          siteId: accountId,
          merchantEmail: email,
          merchantName: profileName,
        }),
      });
      const result = (await response.json().catch(() => null)) as MerchantPeerResponsePayload | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(readPayloadMessage(result?.message, `没有找到 ${merchantName} 的会话入口，请稍后重试。`));
      }
      const nextContacts = Array.isArray(result.contacts)
        ? result.contacts
            .map(sanitizeMerchantPeerContactSummary)
            .filter((contact): contact is MerchantPeerContactSummary => contact !== null)
        : [];
      const nextThreads = Array.isArray(result.threads)
        ? result.threads.map(sanitizeMerchantPeerThread).filter((thread): thread is MerchantPeerThread => thread !== null)
        : [];
      setPeerContacts(nextContacts);
      setPeerThreads(nextThreads);
      const foundMerchantId =
        trimText(result.contact?.merchantId) ||
        trimText(
          nextContacts.find((contact) => {
            const contactId = trimText(contact.merchantId);
            const contactEmail = trimText(contact.merchantEmail).toLowerCase();
            return (merchantId && contactId === merchantId) || (merchantEmail && contactEmail === merchantEmail);
          })?.merchantId,
        );
      if (!foundMerchantId) {
        throw new Error(`没有找到 ${merchantName} 的会话入口，请稍后重试。`);
      }
      setSelectedConversationKey(`merchant:${foundMerchantId}`);
      setMobileConversationView("thread");
    } catch (error) {
      const message = error instanceof Error ? error.message : "打开会话失败，请稍后重试。";
      setSupportError(message);
      setSupportSearchError(message);
    } finally {
      setSupportSearching(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || !accountId) return;
    const params = new URLSearchParams(window.location.search);
    const peerId = trimText(params.get("peerMerchantId"));
    if (!/^\d{8}$/.test(peerId) || pendingQrConnectPeerRef.current === peerId) return;
    pendingQrConnectPeerRef.current = peerId;
    void openPersonalMerchantConversation({ siteId: peerId });
  }, [accountId, peerContacts]);

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

  async function ensurePersonalBusinessCardShareBundle(card: MerchantBusinessCardAsset) {
    const cachedBundle = supportSelfCardShareBundleRef.current[card.id];
    if (
      normalizeConversationDetailText(cachedBundle?.imageUrl) &&
      (card.mode !== "link" || normalizeConversationDetailText(cachedBundle?.shareUrl))
    ) {
      return cachedBundle;
    }

    const resolveShareAssetUrl = async (value: string) => {
      const normalized = normalizeConversationDetailText(value);
      if (!normalized) return "";
      if (/^data:image\//i.test(normalized)) {
        const uploadResult = await uploadSupportAssetDataUrl(normalized, "merchant-assets");
        return uploadResult.ok ? normalizePublicAssetUrl(uploadResult.url) : "";
      }
      return normalizePublicAssetUrl(normalized);
    };

    const shareInput = buildConversationMerchantCardShareInput(card);
    const imageUrl =
      normalizeConversationDetailText(cachedBundle?.imageUrl) ||
      (await resolveShareAssetUrl(shareInput?.imageUrl || card.imageUrl));

    if (card.mode !== "link") {
      const nextBundle = {
        shareUrl: "",
        shareKey: normalizeConversationDetailText(card.shareKey),
        imageUrl,
      };
      if (imageUrl) {
        supportSelfCardShareBundleRef.current[card.id] = nextBundle;
      }
      return nextBundle;
    }

    const fallbackShareUrl = buildConversationMerchantCardLink(card);
    if (!shareInput?.targetUrl || !imageUrl) {
      const nextBundle = {
        shareUrl: isSupportShortMerchantCardLink(fallbackShareUrl) ? fallbackShareUrl : "",
        shareKey: normalizeConversationDetailText(card.shareKey),
        imageUrl,
      };
      if (imageUrl || nextBundle.shareUrl) {
        supportSelfCardShareBundleRef.current[card.id] = nextBundle;
      }
      return nextBundle;
    }

    const detailImageUrl = await resolveShareAssetUrl(shareInput.detailImageUrl || "");

    try {
      const response = await fetch("/api/business-card-share", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          key: shareInput.shareKey,
          name: shareInput.name,
          imageUrl,
          detailImageUrl,
          detailImageHeight:
            typeof shareInput.detailImageHeight === "number" ? Math.round(shareInput.detailImageHeight) : undefined,
          targetUrl: shareInput.targetUrl,
          contact: shareInput.contact,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            shareKey?: unknown;
            shareUrl?: unknown;
          }
        | null;
      const shareUrlRaw = typeof payload?.shareUrl === "string" ? payload.shareUrl.trim() : "";
      const shareUrl = isSupportShortMerchantCardLink(shareUrlRaw)
        ? shareUrlRaw
        : isSupportShortMerchantCardLink(fallbackShareUrl)
          ? fallbackShareUrl
          : "";
      const shareKey =
        typeof payload?.shareKey === "string" && payload.shareKey.trim()
          ? payload.shareKey.trim()
          : normalizeConversationDetailText(card.shareKey);
      const nextBundle = {
        shareUrl,
        shareKey,
        imageUrl,
      };
      if (imageUrl || shareUrl) {
        supportSelfCardShareBundleRef.current[card.id] = nextBundle;
      }
      return nextBundle;
    } catch {
      const nextBundle = {
        shareUrl: isSupportShortMerchantCardLink(fallbackShareUrl) ? fallbackShareUrl : "",
        shareKey: normalizeConversationDetailText(card.shareKey),
        imageUrl,
      };
      if (imageUrl || nextBundle.shareUrl) {
        supportSelfCardShareBundleRef.current[card.id] = nextBundle;
      }
      return nextBundle;
    }
  }

  function openSupportSelfCardPicker() {
    setSupportAttachmentMenuOpen(false);
    setSupportError("");
    supportInputRef.current?.blur();
    const nextCards = personalBusinessCardsRef.current;
    if (nextCards.length > 0) {
      setSupportSelfCardPickerCards(nextCards);
      setSupportSelfCardPickerOpen(true);
      return;
    }
    setSupportSelfCardPickerCards([]);
    setSupportError("当前还没有可发送的名片，请先在名片夹里生成名片");
  }

  async function handleSupportBusinessCardAttachment(card: MerchantBusinessCardAsset) {
    if (supportComposerBusy) return;
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    setSupportSelfCardPickerOpen(false);
    supportInputRef.current?.blur();
    try {
      const shareBundle = await ensurePersonalBusinessCardShareBundle(card);
      const imageMessageText = buildPersonalBusinessCardImageMessageText({
        card,
        imageUrl: shareBundle.imageUrl,
      });
      if (!imageMessageText) {
        setSupportError("当前名片暂时无法发送，请稍后重试");
        return;
      }
      const sentImage = await sendSupportTextPayload(imageMessageText);
      if (!sentImage) return;
      if (card.mode === "link") {
        const linkMessageText = buildPersonalBusinessCardLinkMessageText({
          card,
          shareUrl: shareBundle.shareUrl,
        });
        if (!linkMessageText) {
          setSupportError("联系卡短链暂时没生成成功，已先发送名片图片");
          return;
        }
        const sentLink = await sendSupportTextPayload(linkMessageText);
        if (!sentLink) {
          setSupportError("名片图已发送，但联系卡短链发送失败，请稍后重试");
        }
      }
    } finally {
      setSupportAttachmentBusy(false);
    }
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
      if (result.favoriteSites) {
        const nextFavoriteSites = normalizePersonalFavoriteSites(result.favoriteSites);
        personalFavoriteSitesRef.current = nextFavoriteSites;
        setPersonalFavoriteSites(nextFavoriteSites);
      }
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

  async function performLogout() {
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

  function requestLogout() {
    if (loggingOut) return;
    setLogoutConfirmOpen(true);
  }

  async function openAccountSwitcher() {
    setAccountSwitchError("");
    const entries = await recordCurrentAccountSwitchSession({
      displayName: profileName,
      avatarUrl: personalProfile.avatarUrl,
    });
    setAccountSwitchEntries(entries);
    setAccountSwitcherOpen(true);
  }

  async function handleAccountSwitch(entry: AccountSwitchEntry) {
    if (accountSwitchBusyKey || entry.key === personalAccountSwitchCurrentKey) return;
    setAccountSwitchBusyKey(entry.key);
    setAccountSwitchError("");
    try {
      await recordCurrentAccountSwitchSession({
        displayName: profileName,
        avatarUrl: personalProfile.avatarUrl,
      }).then(setAccountSwitchEntries);
      const nextPayload = await restoreAccountSwitchEntry(entry);
      window.location.href = getAccountSwitchHomeHref(nextPayload);
    } catch (error) {
      removeAccountSwitchEntry(entry.key);
      setAccountSwitchEntries(readAccountSwitchEntries());
      setAccountSwitchError(error instanceof Error ? error.message : "账号切换失败，请重新登录。");
      setAccountSwitchBusyKey("");
    }
  }

  async function addAccountFromSwitcher() {
    if (accountSwitchBusyKey) return;
    setAccountSwitchBusyKey("__add__");
    setAccountSwitchError("");
    await recordCurrentAccountSwitchSession({
      displayName: profileName,
      avatarUrl: personalProfile.avatarUrl,
    }).catch(() => null);
    await fetch("/api/auth/merchant-logout", {
      method: "POST",
      cache: "no-store",
    }).catch(() => null);
    clearStoredBrowserSupabaseSessionTokens();
    window.location.href = "/login?loggedOut=1&redirect=/me";
  }

  function renderSupportMessageList(className: string) {
    return (
      <div ref={supportMessagesViewportRef} className={className}>
        {selectedConversationLoading ? (
          <div className="rounded-2xl border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-500">正在加载聊天记录...</div>
        ) : visibleSupportMessages.length ? (
          <div className="min-w-0 space-y-2">
            {visibleSupportMessages.map((message, index) => {
              const previousMessage = index > 0 ? visibleSupportMessages[index - 1] : null;
              const showDateDivider = !previousMessage || !isSameSupportCalendarDay(previousMessage.createdAt, message.createdAt);
              const messageKey = buildVisibleSupportMessageKey(message);
              const messageMeta = formatSupportClockTime(message.createdAt);
              const hasAttachmentPreview = Boolean(parseSupportMessageAttachmentPreview(message.text));
              return (
                <div key={messageKey} className="space-y-2">
                  {showDateDivider ? (
                    <div className="flex justify-center">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-500 shadow-sm">
                        {formatSupportThreadDateLabel(message.createdAt)}
                      </span>
                    </div>
                  ) : null}
                  <div className={`flex min-w-0 ${message.isSelf ? "justify-end" : "justify-start"}`}>
                    <div className={`flex max-w-[82%] min-w-0 items-end ${message.isSelf ? "ml-auto justify-end" : "mr-auto justify-start"}`}>
                      <div
                        className={`faolla-message-bubble max-w-full min-w-0 rounded-[18px] shadow-sm ${
                          hasAttachmentPreview
                            ? `border border-transparent bg-transparent px-0 py-0 ${message.isSelf ? "ml-auto" : "mr-auto"}`
                            : message.isSelf
                              ? "bg-[#d9fdd3] px-3 py-1.5 text-slate-950"
                              : "border border-transparent bg-white px-3 py-1.5 text-slate-950"
                        }`}
                      >
                        <SupportMessageContent value={message.text} isSelf={message.isSelf} />
                        <span className={`faolla-message-time text-[11px] leading-none ${hasAttachmentPreview ? "mt-1 block text-right" : "ml-2 inline-block align-baseline"} ${message.isSelf ? "text-slate-500" : "text-slate-400"}`}>
                          {messageMeta}
                        </span>
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
        <div className="flex min-w-0 justify-end gap-2">
          <button
            type="button"
            className="shrink-0 rounded border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            onClick={openSupportSelfCardPicker}
            disabled={supportComposerBusy || !supportComposerAvailable}
          >
            名片
          </button>
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

  function renderSupportSelfCardPickerOverlay() {
    if (!supportSelfCardPickerOpen) return null;
    return (
      <div className="fixed inset-0 z-[2147483398]">
        <button
          type="button"
          className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]"
          onClick={() => setSupportSelfCardPickerOpen(false)}
          aria-label="关闭名片夹"
        />
        <div className="absolute inset-x-0 bottom-0 flex justify-center px-3 pb-[calc(var(--faolla-mobile-safe-bottom)+0.75rem)] md:inset-0 md:items-center md:pb-0">
          <div className="relative flex w-full max-w-md flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.2)] md:max-w-2xl">
            <div className="border-b border-slate-100 px-4 pb-3 pt-3 md:px-5 md:py-4">
              <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200 md:hidden" />
              <div className="mt-4 flex items-center justify-between gap-3 md:mt-0">
                <div>
                  <div className="text-base font-semibold text-slate-900">我的名片夹</div>
                  <div className="mt-1 text-xs text-slate-500">选择一张直接发送到当前聊天。</div>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  onClick={() => setSupportSelfCardPickerOpen(false)}
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="max-h-[58vh] space-y-2 overflow-y-auto px-3 pb-3 pt-3 md:max-h-[70vh] md:px-5 md:pb-5">
              {supportSelfCardPickerCards.length ? (
                supportSelfCardPickerCards.map((card) => {
                  const cardPreviewUrl = resolvePersonalBusinessCardPreviewUrl(card);
                  const cardModeLabel = card.mode === "link" ? "链接模式" : "图片模式";
                  const cardShareUrl = buildConversationMerchantCardLink(card);
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-[22px] border border-slate-200 bg-slate-50/80 px-3 py-3 text-left transition hover:border-slate-300 hover:bg-white disabled:opacity-50"
                      onClick={() => {
                        void handleSupportBusinessCardAttachment(card);
                      }}
                      disabled={supportComposerBusy}
                    >
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 text-xs font-semibold text-slate-700 shadow-sm">
                        {cardPreviewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cardPreviewUrl} alt={card.name} className="h-full w-full rounded-[12px] bg-white object-contain" />
                        ) : (
                          getInitialLabel(card.name || "名")
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-semibold text-slate-900">{card.name || "未命名名片"}</div>
                          <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white">
                            {cardModeLabel}
                          </span>
                        </div>
                        {card.mode === "link" && isSupportShortMerchantCardLink(cardShareUrl) ? (
                          <div className="mt-1 truncate text-[11px] text-slate-500">{cardShareUrl}</div>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  当前还没有可发送的名片。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderMobileSupportComposer() {
    return (
      <div className="faolla-mobile-composer shrink-0 overscroll-none border-t border-slate-200/80 bg-[#f0f2f5]/98 px-2 pb-[var(--faolla-mobile-safe-bottom)] pt-1 shadow-none backdrop-blur">
        {supportAttachmentMenuOpen ? (
          <div className="faolla-mobile-attachment-menu mb-2 rounded-[20px] bg-white px-2.5 py-2.5 shadow-none ring-1 ring-slate-200/80">
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
                  onClick: () => void openSupportSelfCardPicker(),
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
                  className="faolla-mobile-attachment-button flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 text-[10px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  onClick={item.key === "card" ? openSupportSelfCardPicker : item.onClick}
                  disabled={supportComposerBusy}
                >
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full ${item.color}`}>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
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
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            className={`faolla-mobile-composer-icon flex h-[38px] min-h-[38px] w-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-full p-0 text-slate-700 shadow-none ring-1 ring-slate-200/80 transition ${
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
          <div className="faolla-mobile-input-shell flex min-h-[38px] min-w-0 flex-1 items-end overflow-hidden rounded-[22px] bg-white px-3 py-2 shadow-none ring-1 ring-slate-200/80">
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
            className={`faolla-mobile-composer-send flex h-[38px] min-h-[38px] w-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-full p-0 text-white shadow-none transition ${
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
            ? `faolla-mobile-chat-row w-full rounded-none border-0 border-b border-slate-200/60 bg-transparent px-1 py-3 text-left shadow-none transition ${
                active ? "bg-slate-50" : "hover:bg-slate-50"
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
            className={`faolla-mobile-chat-avatar mt-0.5 h-12 w-12 text-sm shadow-sm ${
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
                  <div className={`faolla-mobile-chat-name truncate text-sm ${options?.mobile ? "font-semibold" : "font-medium"} text-slate-900`} data-no-translate="1">
                    {contactRow.name}
                  </div>
                  {!contactRow.isOfficial ? (
                    <span className="truncate text-[11px] font-medium text-slate-400" data-no-translate="1">{contactRow.subtitle}</span>
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
                  <div className={`${options?.mobile ? "mt-1" : ""} truncate text-[11px] text-slate-500`} data-no-translate="1">
                    {contactRow.subtitle}
                  </div>
                ) : null}
              </div>
              <div className="faolla-mobile-chat-time shrink-0 text-[11px] text-slate-400">
                {contactRow.updatedAt ? formatSupportConversationTime(contactRow.updatedAt) : options?.mobile ? "未开始" : "未聊天"}
              </div>
            </div>
            <div className={`faolla-mobile-chat-preview ${options?.mobile ? "text-[13px]" : "text-xs"} mt-2 truncate leading-5 text-slate-600`} data-no-translate="1">
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
                  ? "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white"
                  : "flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-900 text-base font-semibold text-white shadow-sm"
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
        <div className="fixed inset-x-0 bottom-0 z-[2147483401] px-3 pb-[calc(var(--faolla-mobile-safe-bottom)+0.75rem)] md:hidden">
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
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
                onClick={() => setConversationInfoOpen(true)}
                aria-label="查看资料"
              >
                <SupportAvatarBadge
                  label={selectedConversationAvatarLabel}
                  imageUrl={selectedConversationAvatarImageUrl}
                  imageAlt={selectedConversationName}
                  className="flex h-full w-full items-center justify-center rounded-full bg-slate-900 text-white"
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

  function renderPersonalConsumptionState(kind: ConsumptionSection) {
    const loadError = kind === "bookings" ? personalBookingLoadError : personalOrderLoadError;
    if (personalConsumptionLoading) {
      return (
        <div className="rounded-[28px] border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm font-medium text-slate-500">
          正在加载记录...
        </div>
      );
    }
    if (loadError) {
      return (
        <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-600">
          {loadError}
        </div>
      );
    }
    return (
      <EmptyFeatureCard
        icon={<Icon name={kind === "bookings" ? "calendar" : "order"} />}
        title={kind === "bookings" ? "我的预约" : "我的订单"}
        description={kind === "bookings" ? "还没有登录账号提交的预约。" : "还没有登录账号提交的订单。"}
      />
    );
  }

  function renderPersonalBookingFilters() {
    const options: PersonalBookingFilter[] = ["all", "active", "confirmed", "cancelled"];
    return (
      <div className="flex flex-wrap items-center gap-2">
        {options.map((status) => {
          const active = personalBookingFilter === status;
          return (
            <button
              key={status}
              type="button"
              className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm transition hover:-translate-y-px ${getPersonalFilterChipClass(
                active,
                status,
              )}`}
              onClick={() => setPersonalBookingFilter(status)}
            >
              <span>{getPersonalBookingStatusText(status)}</span>
              <span className={`text-xs ${active && status === "all" ? "text-white/75" : "opacity-70"}`}>
                {personalBookingCounts[status]}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderPersonalOrderFilters() {
    const options: PersonalOrderFilter[] = ["all", "pending", "confirmed", "cancelled"];
    return (
      <div className="flex flex-wrap items-center gap-2">
        {options.map((status) => {
          const active = personalOrderFilter === status;
          return (
            <button
              key={status}
              type="button"
              className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm transition hover:-translate-y-px ${getPersonalFilterChipClass(
                active,
                status,
              )}`}
              onClick={() => setPersonalOrderFilter(status)}
            >
              <span>{getPersonalOrderStatusText(status)}</span>
              <span className={`text-xs ${active && status === "all" ? "text-white/75" : "opacity-70"}`}>
                {personalOrderCounts[status]}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderPersonalAppointmentSummary(appointmentAt: string) {
    const parts = splitPersonalBookingDateTime(appointmentAt);
    const dayLabel = getMerchantBookingDayLabel(parts.date, locale);
    const isTodayAppointment = Boolean(parts.date) && parts.date === getTodayDateValue();
    if (!parts.date && !parts.time) return <div className="text-sm font-semibold text-slate-900">-</div>;
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-900">
        <span
          className={
            isTodayAppointment
              ? "rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700"
              : undefined
          }
        >
          {parts.date || "-"}
        </span>
        {dayLabel ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{dayLabel}</span>
        ) : null}
        {parts.time ? (
          <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">{parts.time}</span>
        ) : null}
      </div>
    );
  }

  function renderPersonalDetailField(label: string, value: ReactNode) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="text-[11px] font-semibold text-slate-400">{label}</div>
        <div className="mt-1 break-words text-sm font-semibold text-slate-900">{value || "-"}</div>
      </div>
    );
  }

  function renderPersonalBookingDetailDialog() {
    const booking = personalBookingDetailTarget;
    if (!booking) return null;
    const status = getPersonalBookingStatus(booking);
    const contact = resolvePersonalMerchantContact(booking.siteId, booking.siteName);
    return (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[2147483380] bg-slate-950/40 backdrop-blur-[1px]"
          onClick={() => setPersonalBookingDetailTargetId("")}
          aria-label="关闭预约详情"
        />
        <div className="fixed inset-0 z-[2147483381] flex items-end justify-center p-3 sm:items-center">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.25)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-black text-slate-950">预约详情</div>
                <div className="mt-1 text-xs text-slate-500">{booking.id}</div>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setPersonalBookingDetailTargetId("")}
              >
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {renderPersonalDetailField("状态", getPersonalBookingStatusText(status))}
              {renderPersonalDetailField("商户", contact.name)}
              {renderPersonalDetailField("店铺", booking.store || "-")}
              {renderPersonalDetailField("项目", booking.item || "-")}
              {renderPersonalDetailField("预约时间", renderPersonalAppointmentSummary(booking.appointmentAt))}
              {renderPersonalDetailField("称谓", booking.title || "-")}
              {renderPersonalDetailField("姓名", booking.customerName || "-")}
              {renderPersonalDetailField("电话", booking.phone || "-")}
              {renderPersonalDetailField("邮箱", booking.email || "-")}
              {renderPersonalDetailField("预约号", booking.id)}
              {renderPersonalDetailField("创建时间", formatPersonalRecordDateTime(booking.createdAt))}
              {renderPersonalDetailField("更新时间", formatPersonalRecordDateTime(booking.updatedAt))}
            </div>
            {booking.note ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="text-[11px] font-semibold text-slate-400">备注</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{booking.note}</div>
              </div>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  function renderPersonalOrderDetailDialog() {
    const order = personalOrderDetailTarget;
    if (!order) return null;
    const status = getPersonalOrderStatus(order);
    const contact = resolvePersonalMerchantContact(order.siteId, order.siteName);
    return (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[2147483380] bg-slate-950/40 backdrop-blur-[1px]"
          onClick={() => setPersonalOrderDetailTargetId("")}
          aria-label="关闭订单详情"
        />
        <div className="fixed inset-0 z-[2147483381] flex items-end justify-center p-3 sm:items-center">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.25)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-black text-slate-950">订单详情</div>
                <div className="mt-1 text-xs text-slate-500">{order.id}</div>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setPersonalOrderDetailTargetId("")}
              >
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {renderPersonalDetailField("状态", getPersonalOrderStatusText(status))}
              {renderPersonalDetailField("商户", contact.name)}
              {renderPersonalDetailField("订单号", order.id)}
              {renderPersonalDetailField("下单时间", formatPersonalRecordDateTime(order.createdAt))}
              {renderPersonalDetailField("总金额", formatPersonalOrderAmount(order.totalAmount, order.pricePrefix))}
              {renderPersonalDetailField("商品数量", order.totalQuantity)}
              {renderPersonalDetailField("姓名", order.customer.name || "-")}
              {renderPersonalDetailField("电话", order.customer.phone || "-")}
              {renderPersonalDetailField("邮箱", order.customer.email || "-")}
            </div>
            {order.customer.note ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="text-[11px] font-semibold text-slate-400">备注</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{order.customer.note}</div>
              </div>
            ) : null}
            <div className="mt-4 space-y-2">
              <div className="text-xs font-semibold text-slate-500">商品明细</div>
              {order.items.length ? (
                order.items.map((item, index) => (
                  <div key={`${item.productId}:${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-semibold text-slate-900">{item.name || "未命名产品"}</div>
                        <div className="mt-1 text-xs text-slate-500">{[item.code, item.tag].filter(Boolean).join(" / ") || "-"}</div>
                      </div>
                      <div className="shrink-0 text-right text-sm font-semibold text-slate-900">
                        {item.unitPriceText || formatPersonalOrderAmount(item.unitPrice, order.pricePrefix)}
                        <div className="mt-1 text-xs text-slate-500">x {item.quantity}</div>
                      </div>
                    </div>
                    {item.description ? <div className="mt-2 break-words text-xs leading-5 text-slate-500">{item.description}</div> : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">暂无商品明细</div>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  function renderPersonalBookingEditDialog() {
    const booking = personalBookingEditTarget;
    if (!booking) return null;
    const busyKey = `booking:${booking.id}:update`;
    const saving = personalActionBusyKey === busyKey;
    return (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[2147483400] bg-slate-950/40 backdrop-blur-[1px]"
          onClick={closePersonalBookingEditor}
          aria-label="关闭修改预约"
        />
        <div className="fixed inset-0 z-[2147483401] flex items-center justify-center p-3">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.25)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-black text-slate-950">修改预约</div>
                <div className="mt-1 text-xs text-slate-500">预约号: {booking.id}</div>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={closePersonalBookingEditor}
              >
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                店铺
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={personalBookingEditDraft.store}
                  onChange={(event) => updatePersonalBookingEditDraft({ store: event.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                项目
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={personalBookingEditDraft.item}
                  onChange={(event) => updatePersonalBookingEditDraft({ item: event.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                日期
                <input
                  type="date"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={personalBookingEditDraft.date}
                  onChange={(event) => updatePersonalBookingEditDraft({ date: event.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                时间
                <input
                  type="time"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={personalBookingEditDraft.time}
                  onChange={(event) => updatePersonalBookingEditDraft({ time: event.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                姓名
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={personalBookingEditDraft.customerName}
                  onChange={(event) => updatePersonalBookingEditDraft({ customerName: event.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                电话
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={personalBookingEditDraft.phone}
                  onChange={(event) => updatePersonalBookingEditDraft({ phone: event.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-500 md:col-span-2">
                邮箱
                <input
                  type="email"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={personalBookingEditDraft.email}
                  onChange={(event) => updatePersonalBookingEditDraft({ email: event.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-500 md:col-span-2">
                备注
                <textarea
                  className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={personalBookingEditDraft.note}
                  onChange={(event) => updatePersonalBookingEditDraft({ note: event.target.value })}
                />
              </label>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={closePersonalBookingEditor}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void savePersonalBookingEdit()}
                disabled={saving || Boolean(personalActionBusyKey && !saving)}
              >
                {saving ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  function renderPersonalBookingCards(compact = false) {
    if (personalConsumptionLoading || personalBookingLoadError) {
      return renderPersonalConsumptionState("bookings");
    }
    const compactActionButtonClassName =
      "faolla-mobile-record-action rounded-full border border-slate-200 bg-white px-2 py-1 text-[10.5px] font-medium leading-none text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
    const compactDangerActionButtonClassName =
      "faolla-mobile-record-action rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10.5px] font-medium leading-none text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50";
    return (
      <div className={compact ? "space-y-3" : "space-y-4"}>
        <input
          type="text"
          className="faolla-mobile-record-search w-full rounded-[20px] border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none transition focus:border-slate-300"
          placeholder="搜索预约编号 / 店铺 / 项目 / 姓名 / 邮箱 / 电话 / 备注"
          value={personalBookingSearch}
          onChange={(event) => setPersonalBookingSearch(event.target.value)}
        />
        {renderPersonalBookingFilters()}
        {personalBookings.length === 0 || filteredPersonalBookings.length === 0 ? (
          renderPersonalConsumptionState("bookings")
        ) : (
          filteredPersonalBookings.map((booking) => {
            const status = getPersonalBookingStatus(booking);
            const contact = resolvePersonalMerchantContact(booking.siteId, booking.siteName);
            const canCancel = canCancelPersonalBooking(booking);
            const canEdit = canEditPersonalBooking(booking);
            const canRestore = canRestorePersonalBooking(booking);
            const cancelBusyKey = `booking:${booking.id}:cancel`;
            const restoreBusyKey = `booking:${booking.id}:restore`;
            const contactEmail = contact.email;
            const contactPhone = contact.phone;
            const canOpenConversation = Boolean(contact.siteId || contactEmail);
            if (compact) {
              return (
                <article
                  key={booking.id}
                  className="faolla-mobile-record-card relative overflow-visible rounded-[18px] border border-slate-200 bg-white p-3 shadow-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getPersonalStatusBadgeClass(status)}`}>
                          {getPersonalBookingStatusText(status)}
                        </span>
                      </div>
                    </div>
                    {canOpenConversation ? (
                      <div className="flex shrink-0 items-center gap-2">
                        {canOpenConversation ? (
                          <button
                            type="button"
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-800"
                            onClick={() =>
                              void openPersonalMerchantConversation({
                                siteId: contact.siteId,
                                email: contactEmail,
                                name: contact.name,
                              })
                            }
                            title="打开与商户的会话"
                            aria-label="打开与商户的会话"
                          >
                            <ChatIcon />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={compactActionButtonClassName}
                      onClick={() => setPersonalBookingDetailTargetId(booking.id)}
                    >
                      详情
                    </button>
                    {status !== "cancelled" ? (
                      <button
                        type="button"
                        className={compactActionButtonClassName}
                        onClick={() => downloadPersonalBookingCalendar(booking)}
                      >
                        导入日历
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        className={compactActionButtonClassName}
                        onClick={() => openPersonalBookingEditor(booking)}
                        disabled={Boolean(personalActionBusyKey)}
                      >
                        修改
                      </button>
                    ) : null}
                    {canRestore ? (
                      <button
                        type="button"
                        className={compactActionButtonClassName}
                        onClick={() => void restorePersonalBooking(booking)}
                        disabled={Boolean(personalActionBusyKey)}
                      >
                        {personalActionBusyKey === restoreBusyKey ? "恢复中..." : "恢复预约"}
                      </button>
                    ) : null}
                    {canCancel ? (
                      <button
                        type="button"
                        className={compactDangerActionButtonClassName}
                        onClick={() => void cancelPersonalBooking(booking)}
                        disabled={Boolean(personalActionBusyKey)}
                      >
                        {personalActionBusyKey === cancelBusyKey ? "取消中..." : "取消预约"}
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3">
                    <div className="grid content-start gap-1">
                      <div className="text-sm text-slate-900">{booking.store || "-"}</div>
                      <div className="text-sm text-slate-900">{booking.item || "-"}</div>
                      {renderPersonalAppointmentSummary(booking.appointmentAt)}
                    </div>
                    <div className="relative flex items-end self-end">
                      {booking.note ? (
                        <div className="pointer-events-none absolute bottom-full right-0 mb-1 flex items-end">
                          <span
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-700"
                            title="有备注"
                            aria-label="有备注"
                          >
                            <NoteIcon />
                          </span>
                        </div>
                      ) : null}
                      <div className="max-w-[9rem] truncate rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                        {booking.customerName || "-"}
                      </div>
                    </div>
                  </div>
                </article>
              );
            }
            return (
              <article
                key={booking.id}
                className="relative overflow-visible rounded-2xl border bg-slate-50 p-3.5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-5 gap-y-2">
                    <div className="min-w-[220px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${getPersonalStatusBadgeClass(status)}`}>
                          {getPersonalBookingStatusText(status)}
                        </span>
                        <div className="truncate text-base font-semibold text-slate-900">{contact.name}</div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>预约号: {booking.id}</span>
                        <span>创建时间: {formatPersonalRecordDateTime(booking.createdAt)}</span>
                      </div>
                    </div>

                    {canOpenConversation || contactEmail ? (
                      <div className="flex min-w-[220px] items-center gap-2 text-[13px] leading-5 text-slate-700">
                        {canOpenConversation ? (
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-800"
                            onClick={() =>
                              void openPersonalMerchantConversation({
                                siteId: contact.siteId,
                                email: contactEmail,
                                name: contact.name,
                              })
                            }
                            title="打开与商户的会话"
                            aria-label="打开与商户的会话"
                          >
                            <ChatIcon />
                          </button>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">商家邮箱: {contactEmail}</span>
                        {contactEmail ? (
                          <a
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-sm transition hover:opacity-90"
                            href={`mailto:${contactEmail}`}
                          title="联系商家邮箱"
                          aria-label="联系商家邮箱"
                        >
                          <MailIcon />
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    {contactPhone ? (
                      <div className="flex min-w-[200px] items-center gap-2 text-[13px] leading-5 text-slate-700">
                        <span className="min-w-0 flex-1 truncate">商家电话: {contactPhone}</span>
                        <a
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-sm transition hover:bg-[#0066D6]"
                          href={buildPhoneHref(contactPhone)}
                          title="拨打商家电话"
                          aria-label="拨打商家电话"
                        >
                          <PhoneIcon />
                        </a>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {status !== "cancelled" ? (
                      <button
                        type="button"
                        className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50"
                        onClick={() => downloadPersonalBookingCalendar(booking)}
                      >
                        导入日历
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => openPersonalBookingEditor(booking)}
                        disabled={Boolean(personalActionBusyKey)}
                      >
                        修改
                      </button>
                    ) : null}
                    {canRestore ? (
                      <button
                        type="button"
                        className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void restorePersonalBooking(booking)}
                        disabled={Boolean(personalActionBusyKey)}
                      >
                        {personalActionBusyKey === restoreBusyKey ? "恢复中..." : "恢复预约"}
                      </button>
                    ) : null}
                    {canCancel ? (
                      <button
                        type="button"
                        className="rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-[13px] leading-5 text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void cancelPersonalBooking(booking)}
                        disabled={Boolean(personalActionBusyKey)}
                      >
                        {personalActionBusyKey === cancelBusyKey ? "取消中..." : "取消预约"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[11px] text-slate-400">店铺</div>
                    <div className="mt-1 break-words text-sm font-semibold text-slate-900">{booking.store || "-"}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[11px] text-slate-400">项目</div>
                    <div className="mt-1 break-words text-sm font-semibold text-slate-900">{booking.item || "-"}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[11px] text-slate-400">预约时间</div>
                    <div className="mt-1">{renderPersonalAppointmentSummary(booking.appointmentAt)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[11px] text-slate-400">姓名</div>
                    <div className="mt-1 break-words text-sm font-semibold text-slate-900">{booking.customerName || "-"}</div>
                  </div>
                </div>
                {booking.note ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="whitespace-pre-wrap break-words text-sm text-slate-700">{booking.note}</div>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    );
  }

  function renderPersonalOrderCards(compact = false) {
    if (personalConsumptionLoading || personalOrderLoadError) {
      return renderPersonalConsumptionState("orders");
    }
    const compactActionButtonClassName =
      "faolla-mobile-record-action rounded-full border border-slate-200 bg-white px-2 py-1 text-[10.5px] font-medium leading-none text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
    const compactDangerActionButtonClassName =
      "faolla-mobile-record-action rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10.5px] font-medium leading-none text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50";
    return (
      <div className={compact ? "space-y-3" : "space-y-4"}>
        {renderPersonalOrderFilters()}
        {personalOrders.length === 0 || filteredPersonalOrders.length === 0 ? (
          renderPersonalConsumptionState("orders")
        ) : (
          filteredPersonalOrders.map((order) => {
            const status = getPersonalOrderStatus(order);
            const contact = resolvePersonalMerchantContact(order.siteId, order.siteName);
            const canCancel = canCancelPersonalOrder(order);
            const busyKey = `order:${order.id}:cancel`;
            const contactEmail = contact.email;
            const contactPhone = contact.phone;
            const canOpenConversation = Boolean(contact.siteId || contactEmail);
            if (compact) {
              return (
                <article
                  key={order.id}
                  className="faolla-mobile-record-card relative overflow-visible rounded-[18px] border border-slate-200 bg-white p-3 shadow-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getPersonalStatusBadgeClass(status)}`}>
                          {getPersonalOrderStatusText(status)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{formatPersonalRecordDateTime(order.createdAt)}</div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="text-right text-lg font-semibold text-slate-900">
                        {formatPersonalOrderAmount(order.totalAmount, order.pricePrefix)}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {canOpenConversation ? (
                          <button
                            type="button"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-800"
                            onClick={() =>
                              void openPersonalMerchantConversation({
                                siteId: contact.siteId,
                                email: contactEmail,
                                name: contact.name,
                              })
                            }
                            title="打开与商户的会话"
                            aria-label="打开与商户的会话"
                          >
                            <ChatIcon />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={compactActionButtonClassName}
                      onClick={() => setPersonalOrderDetailTargetId(order.id)}
                    >
                      详情
                    </button>
                    {canCancel ? (
                      <button
                        type="button"
                        className={compactDangerActionButtonClassName}
                        onClick={() => void cancelPersonalOrder(order)}
                        disabled={Boolean(personalActionBusyKey)}
                      >
                        {personalActionBusyKey === busyKey ? "取消中..." : "取消订单"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            }
          const itemPreview = order.items
            .slice(0, 3)
            .map((item) => [item.code, item.name || "未命名产品"].filter(Boolean).join(" "))
            .join(" / ");
          return (
            <article
              key={order.id}
              className="relative overflow-visible rounded-2xl border bg-slate-50 p-3.5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-5 gap-y-2">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${getPersonalStatusBadgeClass(status)}`}>
                        {getPersonalOrderStatusText(status)}
                      </span>
                      <div className="truncate text-base font-semibold text-slate-900">{contact.name}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>订单号: {order.id}</span>
                      <span>下单时间: {formatPersonalRecordDateTime(order.createdAt)}</span>
                    </div>
                  </div>

                  {canOpenConversation || contactEmail ? (
                    <div className="flex min-w-[220px] items-center gap-2 text-[13px] leading-5 text-slate-700">
                      {canOpenConversation ? (
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-800"
                          onClick={() =>
                            void openPersonalMerchantConversation({
                              siteId: contact.siteId,
                              email: contactEmail,
                              name: contact.name,
                            })
                          }
                          title="打开与商户的会话"
                          aria-label="打开与商户的会话"
                        >
                          <ChatIcon />
                        </button>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">商家邮箱: {contactEmail}</span>
                      {contactEmail ? (
                        <a
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-sm transition hover:opacity-90"
                          href={`mailto:${contactEmail}`}
                        title="联系商家邮箱"
                        aria-label="联系商家邮箱"
                      >
                        <MailIcon />
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {contactPhone ? (
                    <div className="flex min-w-[200px] items-center gap-2 text-[13px] leading-5 text-slate-700">
                      <span className="min-w-0 flex-1 truncate">商家电话: {contactPhone}</span>
                      <a
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-sm transition hover:bg-[#0066D6]"
                        href={buildPhoneHref(contactPhone)}
                        title="拨打商家电话"
                        aria-label="拨打商家电话"
                      >
                        <PhoneIcon />
                      </a>
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="text-right text-lg font-semibold text-slate-900">
                    {formatPersonalOrderAmount(order.totalAmount, order.pricePrefix)}
                  </div>
                  {canCancel ? (
                    <button
                      type="button"
                      className="rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-[13px] leading-5 text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void cancelPersonalOrder(order)}
                      disabled={Boolean(personalActionBusyKey)}
                    >
                      {personalActionBusyKey === busyKey ? "取消中..." : "取消订单"}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <div className="text-[11px] text-slate-400">商品</div>
                  <div className="mt-1 line-clamp-2 break-words font-semibold text-slate-900">{itemPreview || "-"}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <div className="text-[11px] text-slate-400">数量</div>
                  <div className="mt-1 font-semibold text-slate-900">{order.totalQuantity}</div>
                </div>
              </div>
            </article>
          );
          })
        )}
      </div>
    );
  }

  function renderPersonalFavorites(compact = false) {
    if (personalFavoriteSites.length === 0) {
      return (
        <EmptyFeatureCard
          icon={<Icon name="star" />}
          title="收藏"
          description="常用商户网站会显示在这里。"
        />
      );
    }

    return (
      <div className={compact ? "space-y-3" : "space-y-4"}>
        {!compact ? (
          <div className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-white px-5 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
            <div>
              <div className="text-lg font-semibold text-slate-950">收藏</div>
              <div className="mt-1 text-sm text-slate-500">已收藏 {personalFavoriteSites.length} 个商户网站。</div>
            </div>
          </div>
        ) : null}
        <div className={compact ? "space-y-3" : "grid gap-3 md:grid-cols-2 xl:grid-cols-3"}>
          {personalFavoriteSites.map((site) => (
            <article
              key={site.id}
              className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.07)]"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                  <Icon name="star" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold text-slate-950">{site.name || "商户网站"}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{site.subtitle || site.url}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
                      onClick={() => openPersonalFavoriteSite(site)}
                    >
                      打开
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                      onClick={() => removePersonalFavoriteSite(site.id)}
                    >
                      取消收藏
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  function renderSectionContent(section: DesktopSection) {
    if (section === "conversations") {
      return renderDesktopSupportSurface();
    }
    if (section === "faolla") {
      return null;
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
    if (section === "bookings") {
      return renderPersonalBookingCards(false);
    }
    if (section === "orders") {
      return renderPersonalOrderCards(false);
    }
    if (section === "favorites") {
      return renderPersonalFavorites(false);
    }
    if (section === "cards" && personalBusinessCardManagerCommonProps) {
      return <MerchantBusinessCardManager {...personalBusinessCardManagerCommonProps} folderViewMode="page" />;
    }

    const item = desktopMenuItems.find((entry) => entry.key === section) ?? desktopMenuItems[0];

    return (
      <EmptyFeatureCard
        icon={<Icon name="card" />}
        title={item.label}
        description={item.description}
      />
    );
  }

  function renderConsumptionContent() {
    const isBookings = consumptionSection === "bookings";
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="faolla-mobile-list-header shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(var(--faolla-mobile-safe-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(var(--faolla-mobile-safe-bottom)+5.85rem)] pt-4">
          {isBookings ? renderPersonalBookingCards(true) : renderPersonalOrderCards(true)}
        </div>
      </div>
    );
  }

  function renderMobileConversationsContent() {
    if (mobileConversationView === "thread") {
      return (
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)]">
          <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-3 pb-3 pt-[calc(var(--faolla-mobile-safe-top)+0.55rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
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
                  className="faolla-mobile-thread-avatar-button flex h-11 w-11 shrink-0 items-center justify-center overflow-visible rounded-full bg-slate-900 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
                  onClick={() => setConversationInfoOpen(true)}
                  aria-label="查看资料"
                >
                  <SupportAvatarBadge
                    label={selectedConversationAvatarLabel}
                    imageUrl={selectedConversationAvatarImageUrl}
                    imageAlt={selectedConversationName}
                    className="faolla-mobile-thread-avatar flex h-full w-full items-center justify-center rounded-full bg-slate-900 text-white"
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
        <div className="faolla-mobile-list-header shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(var(--faolla-mobile-safe-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="faolla-mobile-list-badge flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
              会话
            </div>
            <div className="min-w-0 flex-1">
              <div className="faolla-mobile-list-title text-[15px] font-semibold text-slate-900">聊天列表</div>
              <div className="faolla-mobile-list-summary mt-1 text-xs text-slate-500">{mobileSupportContactListSummary}</div>
            </div>
          </div>
          <div className="faolla-mobile-search-row mt-4 flex items-center gap-2">
            <div className="faolla-mobile-search-box flex h-[34px] min-h-[34px] min-w-0 flex-1 items-center gap-2.5 rounded-[17px] border border-slate-200 bg-[#f3f4f6] px-3 py-1.5 shadow-sm">
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
              className="faolla-mobile-search-button inline-flex h-[34px] min-h-[34px] shrink-0 items-center justify-center rounded-[17px] border border-slate-200 bg-white px-3 py-0 text-[13px] leading-none shadow-sm hover:bg-slate-50 disabled:opacity-50"
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
        <div className="faolla-mobile-chat-list min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(var(--faolla-mobile-safe-bottom)+5.85rem)] pt-3">
          <div className="flex flex-col">
            {supportContactRows.map((contactRow) => (
              <div key={contactRow.key}>{renderSupportContactRow(contactRow, { mobile: true })}</div>
            ))}
          </div>
        </div>
      </>
    );
  }

  function renderMobileToolsContent() {
    return (
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
        <div className="grid grid-cols-4 gap-x-4 gap-y-5">
          <Link
            href="/me/tools/shuangkoujifen"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex min-w-0 flex-col items-center gap-2.5 text-center"
            onClick={(event) => {
              event.preventDefault();
              const targetUrl = new URL("/me/tools/shuangkoujifen", window.location.origin).toString();
              const openedWindow = window.open(targetUrl, "_blank");
              if (openedWindow) {
                try {
                  openedWindow.opener = null;
                  openedWindow.focus();
                } catch {
                  // Some mobile browsers restrict access to the opened window.
                }
                return;
              }
              window.location.assign(targetUrl);
            }}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-emerald-700 text-white shadow-[0_12px_24px_rgba(4,120,87,0.28)] transition group-active:scale-95">
              <ShuangkouToolIcon />
            </span>
            <span className="w-full truncate text-xs font-semibold text-slate-900">双扣计分</span>
          </Link>
        </div>
      </section>
    );
  }

  function renderMobileGamesContent() {
    const openTankBattleGame = () => {
      const targetUrl = new URL("/me/games/tank-battle", window.location.origin).toString();
      const openedWindow = window.open(targetUrl, "_blank");
      if (openedWindow) {
        try {
          openedWindow.opener = null;
          openedWindow.focus();
        } catch {
          // Some mobile browsers restrict access to the opened window.
        }
        return;
      }
      window.location.assign(targetUrl);
    };
    const openNoMercyFlagGame = () => {
      const targetUrl = new URL("/me/games/bufuzai", window.location.origin).toString();
      const openedWindow = window.open(targetUrl, "_blank");
      if (openedWindow) {
        try {
          openedWindow.opener = null;
          openedWindow.focus();
        } catch {
          // Some mobile browsers restrict access to the opened window.
        }
        return;
      }
      window.location.assign(targetUrl);
    };

    return (
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
        <div className="grid grid-cols-4 gap-x-4 gap-y-5">
          <button
            type="button"
            className="group flex min-w-0 flex-col items-center gap-2.5 text-center"
            onClick={openTankBattleGame}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-lime-700 text-white shadow-[0_12px_24px_rgba(77,124,15,0.28)] transition group-active:scale-95">
              <TankBattleIcon />
            </span>
            <span className="w-full truncate text-xs font-semibold text-slate-900">坦克大战</span>
          </button>
          <button
            type="button"
            className="group flex min-w-0 flex-col items-center gap-2.5 text-center"
            onClick={openNoMercyFlagGame}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-teal-700 text-white shadow-[0_12px_24px_rgba(15,118,110,0.28)] transition group-active:scale-95">
              <NoMercyFlagIcon />
            </span>
            <span className="w-full truncate text-xs font-semibold text-slate-900">不服再试</span>
          </button>
        </div>
      </section>
    );
  }

  function renderMobileContent() {
    if (mobileTab === "conversations") return renderMobileConversationsContent();
    if (mobileTab === "consumption") return renderConsumptionContent();
    if (mobileTab === "self") {
      if (mobileSelfSection === "qr") {
        return (
          <FaollaQrPanel
            profileName={profileName}
            profileSubtitle="Faolla 个人用户"
            avatarUrl={personalAvatarImageUrl}
            avatarFallback={avatarLabel}
            qrUrl={personalQrUrl}
            note="对方扫码后会在 Faolla 会话中添加你。"
            onBack={() => setMobileSelfSection("home")}
            onScanResult={handlePersonalQrScanResult}
          />
        );
      }
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
          key: "favorites",
          label: "收藏",
          summary: personalFavoriteSites.length ? `已收藏 ${personalFavoriteSites.length} 个商户网站` : "保存常用商户网站",
          icon: <Icon name="star" />,
        },
        {
          key: "cards",
          label: "名片夹",
          summary: mobileSelfCardsSummary,
          icon: <Icon name="card" />,
        },
        {
          key: "tools",
          label: "小工具",
          summary: "常用计分和辅助工具。",
          icon: <ToolboxIcon />,
        },
        {
          key: "games",
          label: "游戏大厅",
          summary: "坦克大战等休闲游戏。",
          icon: <TankBattleIcon className="h-5 w-5" />,
        },
        {
          key: "settings",
          label: "设置",
          summary: faollaAndroidAppUpdate.updateAvailable ? "有新版本可更新" : "通知、版本和法律",
          icon: (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="m18.4 13.6.2 1.6 1.5 1-1.8 3.1-1.7-.7-1.3 1H8.7l-1.3-1-1.7.7-1.8-3.1 1.5-1 .2-1.6L4.3 12l1.3-1.6-.2-1.6-1.5-1 1.8-3.1 1.7.7 1.3-1h6.6l1.3 1 1.7-.7 1.8 3.1-1.5 1-.2 1.6 1.3 1.6-1.3 1.6Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          ),
        },
      ];
      return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="faolla-mobile-self-header relative shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(var(--faolla-mobile-safe-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
            {mobileSelfSection === "home" ? (
              <button
                type="button"
                className="absolute left-4 top-[calc(var(--faolla-mobile-safe-top)+0.7rem)] z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.10)]"
                onClick={() => setMobileSelfSection("qr")}
                aria-label="打开二维码"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                  <path d="M5 5h5v5H5V5Zm9 0h5v5h-5V5ZM5 14h5v5H5v-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M14 14h2.5v2.5H19M14 19h2M19 14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
            <div className="absolute right-4 top-[calc(var(--faolla-mobile-safe-top)+0.7rem)] z-20">
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
                    className="faolla-mobile-language-button block h-6 w-[35px] overflow-hidden rounded-[3px] border border-slate-300/80 bg-transparent p-0 transition hover:brightness-105"
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
              <div className="faolla-mobile-self-profile-hero flex flex-col items-center px-4 text-center">
                <button
                  type="button"
                  className="faolla-mobile-self-avatar relative flex h-[98px] w-[98px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-xl font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
                  onClick={openPersonalAvatarPicker}
                  disabled={personalAvatarUploading || personalProfileSaving}
                  aria-label="上传头像"
                >
                  <SupportAvatarBadge
                    label={avatarLabel}
                    imageUrl={personalAvatarImageUrl}
                    imageAlt={profileName}
                    className="faolla-mobile-self-avatar-image flex h-full w-full items-center justify-center rounded-full bg-slate-900 text-white"
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
                <div className="faolla-mobile-self-name mt-4 max-w-full truncate text-[28px] font-semibold leading-none text-slate-950">{profileName}</div>
                <div className="faolla-mobile-self-subtitle mt-2 max-w-full truncate text-sm text-slate-500">
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
                  onClick={() => {
                    if (isFaollaMobileSettingsView(mobileSelfSection)) {
                      setMobileSelfSection(getFaollaMobileSettingsBackView(mobileSelfSection));
                    } else {
                      setMobileSelfSection("home");
                    }
                  }}
                  aria-label="返回自己主页"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                    <path d="M19 12H7M12 7l-5 5 5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-semibold text-slate-900">
                    {mobileSelfSection === "profile"
                      ? "我的资料"
                      : mobileSelfSection === "favorites"
                        ? "收藏"
                        : mobileSelfSection === "cards"
                          ? "名片夹"
                          : mobileSelfSection === "tools"
                            ? "小工具"
                            : mobileSelfSection === "games"
                              ? "游戏大厅"
                              : isFaollaMobileSettingsView(mobileSelfSection)
                                ? getFaollaMobileSettingsTitle(mobileSelfSection)
                                : "通知"}
                  </div>
                  {mobileSelfSection === "profile" ? null : (
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {mobileSelfSection === "favorites"
                        ? "保存常用商户网站。"
                        : mobileSelfSection === "cards"
                           ? "桌面端已接入完整名片夹，当前可在聊天里直接发送已生成名片。"
                           : mobileSelfSection === "tools"
                             ? "常用计分和辅助工具。"
                             : mobileSelfSection === "games"
                               ? "坦克大战等休闲游戏。"
                               : isFaollaMobileSettingsView(mobileSelfSection)
                                 ? getFaollaMobileSettingsSubtitle(mobileSelfSection, mobileSelfNotificationSummary)
                                 : "这里控制系统消息通知、提示音和震动。"}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="faolla-mobile-self-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(var(--faolla-mobile-safe-bottom)+5.85rem)] pt-4">
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
              <div className="faolla-mobile-card-stack space-y-4">
                {renderMobileCurrentFavoriteAction()}
                <section className="faolla-mobile-menu-card overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                  <div className="divide-y divide-slate-100">
                    {selfMenuItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="faolla-mobile-menu-row flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                        onClick={() => setMobileSelfSection(item.key)}
                      >
                        <span className="faolla-mobile-menu-icon inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="faolla-mobile-menu-title flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <span className="truncate">{item.label}</span>
                            {item.key === "settings" && faollaAndroidAppUpdate.updateAvailable ? (
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-50" aria-label="有更新" />
                            ) : null}
                          </span>
                          <span className="faolla-mobile-menu-summary mt-1 block truncate text-xs leading-5 text-slate-500">{item.summary}</span>
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

                <section className="faolla-mobile-menu-card overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                  <div className="grid grid-cols-2 divide-x divide-slate-100">
                    <button
                      type="button"
                      className="faolla-mobile-menu-row flex items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => {
                        void openAccountSwitcher();
                      }}
                      disabled={loggingOut || Boolean(accountSwitchBusyKey)}
                    >
                      <div className="text-sm font-semibold text-slate-800">切换账号</div>
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                          <path d="M8 7.5h7.5a3 3 0 0 1 0 6H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="m11 4.5-3 3 3 3M16 16.5H8.5a3 3 0 0 1 0-6H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="m13 13.5 3 3-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="faolla-mobile-menu-row flex items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-rose-50/70 disabled:opacity-50"
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
                  </div>
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
            ) : mobileSelfSection === "favorites" ? (
              renderPersonalFavorites(true)
            ) : mobileSelfSection === "cards" ? (
              <EmptyFeatureCard
                icon={<Icon name="card" />}
                title="名片夹"
                description="手机端名片夹稍后接入，当前可在桌面端管理名片，并在聊天里直接发送已生成名片。"
              />
            ) : mobileSelfSection === "tools" ? (
              renderMobileToolsContent()
            ) : mobileSelfSection === "games" ? (
              renderMobileGamesContent()
            ) : isFaollaMobileSettingsView(mobileSelfSection) ? (
              <FaollaMobileSettingsContent
                view={mobileSelfSection}
                notificationSummary={mobileSelfNotificationSummary}
                appUpdateState={faollaAndroidAppUpdate}
                onViewChange={(nextView) => setMobileSelfSection(nextView)}
                notificationContent={
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
                }
              />
            ) : (
              null
            )}
          </div>
        </div>
      );
    }
    return null;
  }

  const personalLogoutConfirmDialog = logoutConfirmOpen ? (
    <div className="fixed inset-0 z-[2147483600] flex items-center justify-center bg-slate-950/45 px-5 py-8 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
        <div className="text-base font-semibold text-slate-950">退出登录</div>
        <div className="mt-2 text-sm leading-6 text-slate-600">确认退出当前个人后台吗？</div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => setLogoutConfirmOpen(false)}
            disabled={loggingOut}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:bg-rose-300"
            onClick={() => {
              setLogoutConfirmOpen(false);
              void performLogout();
            }}
            disabled={loggingOut}
          >
            {loggingOut ? "退出中..." : "退出登录"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 text-sm text-slate-500">
        正在载入个人中心...
      </main>
    );
  }

  return (
    <>
      <style jsx global>{`
        @media (pointer: coarse) and (max-width: 1024px) {
          .faolla-personal-desktop-shell {
            display: none !important;
          }
          .faolla-personal-mobile-shell {
            display: flex !important;
          }
          .faolla-personal-mobile-bottom-nav {
            display: block !important;
          }
        }
      `}</style>
      <main className="faolla-personal-desktop-shell hidden min-h-screen bg-slate-50/70 pl-[320px] md:block">
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
                    onClick={() => openDesktopSection(item.key)}
                  />
                ))}
              </div>
            </div>

            <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">个人中心</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">个人用户后台包含会话、预约、订单、收藏、名片夹和 Faolla 菜单。</p>
            </div>
          </div>
        </aside>

        <section className="min-h-screen">
          <div className="px-6 py-8">
            {renderSectionContent(desktopSection)}
            <div
              className={`relative h-[calc(100vh-4rem)] min-h-[560px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${
                desktopSection === "faolla" ? "" : "hidden"
              }`}
            >
              <div className="pointer-events-none absolute left-4 top-4 z-10">
                <FaollaHomeButton className="pointer-events-auto h-11 w-11" onClick={navigatePersonalFaollaHome} />
              </div>
              <div className="pointer-events-none absolute right-4 top-4 z-20 flex items-center gap-2">
                {renderFaollaFavoriteButton("pointer-events-auto h-10 w-10")}
              </div>
              <iframe
                ref={personalDesktopFaollaFrameRef}
                title="Faolla"
                src={desktopFaollaTargetHref}
                onLoad={(event) => resetPersonalFaollaBackendFrame(event.currentTarget)}
                className="absolute inset-0 h-full w-full border-0 bg-transparent"
              />
            </div>
          </div>
        </section>
      </main>

      <main className="faolla-personal-mobile-shell fixed inset-x-0 top-0 bottom-0 z-[120] flex min-h-0 flex-col overflow-hidden overscroll-none bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)] touch-manipulation md:hidden">
        {renderMobileContent()}
        <div className={`support-preserve-light-surface relative min-h-0 flex-1 overflow-hidden bg-white ${mobileTab === "faolla" ? "" : "hidden"}`}>
          <div className="pointer-events-none absolute left-4 top-[calc(var(--faolla-mobile-safe-top)+0.75rem)] z-10">
            <FaollaHomeButton className="pointer-events-auto h-11 w-11" onClick={navigatePersonalFaollaHome} />
          </div>
          <div className="pointer-events-none absolute right-4 top-[calc(var(--faolla-mobile-safe-top)+0.75rem)] z-20 flex items-center gap-2">
            {renderFaollaFavoriteButton("pointer-events-auto h-10 w-10")}
          </div>
          {faollaFavoriteToast ? (
            <div className="pointer-events-none absolute left-1/2 top-[calc(var(--faolla-mobile-safe-top)+4.25rem)] z-30 -translate-x-1/2 px-4">
              <div
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold shadow-[0_14px_34px_rgba(15,23,42,0.20)] ring-1 ${
                  faollaFavoriteToast.tone === "error"
                    ? "bg-rose-600 text-white ring-rose-200/70"
                    : "bg-slate-950 text-white ring-white/40"
                }`}
              >
                {faollaFavoriteToast.text}
              </div>
            </div>
          ) : null}
          <iframe
            ref={personalMobileFaollaFrameRef}
            title="Faolla"
            src={mobileFaollaTargetHref}
            onLoad={(event) => resetPersonalFaollaBackendFrame(event.currentTarget)}
            scrolling="yes"
            style={MOBILE_FAOLLA_FRAME_STYLE}
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
        </div>
      </main>
      {mobileTab === "conversations" && mobileConversationView === "thread" ? null : (
        <MobileBottomNav activeTab={mobileTab} onChange={openMobileTab} />
      )}
      {renderSupportSelfCardPickerOverlay()}
      {renderConversationInfoOverlay()}
      {renderPersonalBookingDetailDialog()}
      {renderPersonalOrderDetailDialog()}
      {renderPersonalBookingEditDialog()}
      <AccountSwitcherDialog
        open={accountSwitcherOpen}
        entries={accountSwitchEntries}
        currentKey={personalAccountSwitchCurrentKey}
        busyKey={accountSwitchBusyKey}
        error={accountSwitchError}
        onClose={() => {
          if (accountSwitchBusyKey) return;
          setAccountSwitcherOpen(false);
          setAccountSwitchError("");
        }}
        onSwitch={(entry) => {
          void handleAccountSwitch(entry);
        }}
        onRemove={(key) => {
          setAccountSwitchEntries(removeAccountSwitchEntry(key));
        }}
        onAddAccount={() => {
          void addAccountFromSwitcher();
        }}
      />
      {personalLogoutConfirmDialog}
    </>
  );
}
