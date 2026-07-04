import type { MerchantBookingRecord, MerchantBookingStatus } from "@/lib/merchantBookings";
import { normalizeMerchantOrderRecords, type MerchantOrderRecord } from "@/lib/merchantOrders";
import type { PlatformSupportThread } from "@/lib/platformSupportInbox";

export const PERSONAL_GUEST_STORAGE_EVENT = "faolla:personal-guest-storage-changed";

const PERSONAL_CONSUMPTION_CHANGED_EVENT = "faolla:personal-consumption-changed";
const GUEST_IDENTITY_STORAGE_KEY = "faolla:personal-guest-identity:v1";
const GUEST_PROFILE_STORAGE_KEY = "faolla:personal-guest-profile:v1";
const GUEST_ORDERS_STORAGE_KEY = "faolla:personal-guest-orders:v1";
const GUEST_BOOKINGS_STORAGE_KEY = "faolla:personal-guest-bookings:v1";
const GUEST_SUPPORT_STORAGE_KEY = "faolla:personal-guest-support:v1";
const GUEST_FAVORITES_STORAGE_KEY = "faolla:personal-guest-favorites:v1";
const GUEST_MIGRATIONS_STORAGE_KEY = "faolla:personal-guest-migrations:v1";
const GUEST_ARCHIVES_STORAGE_KEY = "faolla:personal-guest-archives:v1";

export type PersonalGuestIdentity = {
  id: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonalGuestProfile = {
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

export type PersonalGuestSupportMessage = {
  id: string;
  sender: "merchant" | "super_admin";
  text: string;
  createdAt: string;
};

const EMPTY_GUEST_PROFILE: PersonalGuestProfile = {
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

function trimText(value: unknown, maxLength = 2000) {
  if (typeof value === "string") return value.trim().slice(0, maxLength);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readStorageJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorageJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Guest data is best-effort local state.
  }
}

function removeStorageItem(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Guest data is best-effort local state.
  }
}

function emitGuestStorageChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PERSONAL_GUEST_STORAGE_EVENT));
  window.dispatchEvent(new CustomEvent(PERSONAL_CONSUMPTION_CHANGED_EVENT));
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: PERSONAL_CONSUMPTION_CHANGED_EVENT }, "*");
  }
}

function normalizeIsoString(value: unknown, fallback = new Date().toISOString()) {
  const normalized = trimText(value, 80);
  if (!normalized) return fallback;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function createGuestAccountId() {
  const numeric = Math.floor(10000000 + Math.random() * 90000000);
  return String(numeric);
}

function createGuestIdentity(): PersonalGuestIdentity {
  const now = new Date().toISOString();
  const accountId = createGuestAccountId();
  return {
    id: `guest-${accountId}-${Math.random().toString(36).slice(2, 10)}`,
    accountId,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeGuestIdentity(value: unknown): PersonalGuestIdentity | null {
  const record = readRecord(value);
  if (!record) return null;
  const accountId = trimText(record.accountId, 16);
  if (!/^\d{8}$/.test(accountId)) return null;
  const now = new Date().toISOString();
  return {
    id: trimText(record.id, 80) || `guest-${accountId}`,
    accountId,
    createdAt: normalizeIsoString(record.createdAt, now),
    updatedAt: normalizeIsoString(record.updatedAt, now),
  };
}

export function readPersonalGuestIdentity(): PersonalGuestIdentity | null {
  return normalizeGuestIdentity(readStorageJson(GUEST_IDENTITY_STORAGE_KEY));
}

export function ensurePersonalGuestIdentity(): PersonalGuestIdentity {
  const existing = readPersonalGuestIdentity();
  if (existing) return existing;
  const next = createGuestIdentity();
  writeStorageJson(GUEST_IDENTITY_STORAGE_KEY, next);
  return next;
}

export function readPersonalGuestMergeToken(identity = ensurePersonalGuestIdentity()) {
  return trimText(identity?.id, 180);
}

export function normalizePersonalGuestProfile(value: unknown): PersonalGuestProfile {
  const record = readRecord(value) ?? {};
  return {
    displayName: trimText(record.displayName || record.display_name || record.name, 80),
    avatarUrl: trimText(record.avatarUrl || record.avatar_url, 1200),
    signature: trimText(record.signature || record.bio, 160),
    phone: trimText(record.phone || record.contact_phone || record.contactPhone, 64),
    email: trimText(record.email || record.contact_email || record.contactEmail, 160).toLowerCase(),
    contactCard: trimText(record.contactCard || record.contact_card, 1200),
    birthday: trimText(record.birthday, 32),
    gender: trimText(record.gender, 32),
    country: trimText(record.country, 80),
    province: trimText(record.province || record.state, 80),
    city: trimText(record.city, 80),
    address: trimText(record.address || record.contactAddress, 240),
  };
}

export function readPersonalGuestProfile(): PersonalGuestProfile {
  return normalizePersonalGuestProfile(readStorageJson(GUEST_PROFILE_STORAGE_KEY));
}

export function savePersonalGuestProfile(profile: Partial<PersonalGuestProfile>) {
  const next = normalizePersonalGuestProfile({ ...EMPTY_GUEST_PROFILE, ...profile });
  writeStorageJson(GUEST_PROFILE_STORAGE_KEY, next);
  emitGuestStorageChanged();
  return next;
}

export function buildPersonalGuestSessionPayload(identity = ensurePersonalGuestIdentity(), profile = readPersonalGuestProfile()) {
  const displayName = profile.displayName || "\u6e38\u5ba2";
  return {
    authenticated: false,
    accountType: "personal",
    accountId: identity.accountId,
    guest: true,
    user: {
      email: profile.email || null,
      user_metadata: {
        guest: true,
        personal_profile: {
          ...profile,
          displayName,
          bio: profile.signature,
        },
        display_name: displayName,
        displayName,
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
      app_metadata: {
        guest: true,
      },
    },
  };
}

export function readPersonalGuestOrders(): MerchantOrderRecord[] {
  return normalizeMerchantOrderRecords(readStorageJson(GUEST_ORDERS_STORAGE_KEY));
}

export function upsertPersonalGuestOrder(order: unknown) {
  const normalized = normalizeMerchantOrderRecords([order])[0];
  if (!normalized) return;
  const current = readPersonalGuestOrders();
  const next = [normalized, ...current.filter((item) => item.id !== normalized.id)].slice(0, 200);
  writeStorageJson(GUEST_ORDERS_STORAGE_KEY, next);
  emitGuestStorageChanged();
}

function normalizeBookingStatus(value: unknown): MerchantBookingStatus {
  return value === "confirmed" ||
    value === "completed" ||
    value === "no_show" ||
    value === "cancelled" ||
    value === "active"
    ? value
    : "active";
}

function normalizeGuestBookingRecord(value: unknown): MerchantBookingRecord | null {
  const record = readRecord(value);
  if (!record) return null;
  const id = trimText(record.id, 160);
  const siteId = trimText(record.siteId, 32);
  if (!id || !siteId) return null;
  const now = new Date().toISOString();
  return {
    id,
    siteId,
    siteName: trimText(record.siteName, 160),
    bookingBlockId: trimText(record.bookingBlockId, 120) || undefined,
    bookingViewport: record.bookingViewport === "mobile" || record.bookingViewport === "desktop" ? record.bookingViewport : undefined,
    store: trimText(record.store, 160),
    item: trimText(record.item, 160),
    appointmentAt: trimText(record.appointmentAt, 80),
    title: trimText(record.title, 80),
    customerName: trimText(record.customerName, 160),
    email: trimText(record.email, 160).toLowerCase(),
    phone: trimText(record.phone, 80),
    note: trimText(record.note, 2000),
    customerAccountId: trimText(record.customerAccountId, 80),
    customerUserId: trimText(record.customerUserId, 160),
    customerLoginEmail: trimText(record.customerLoginEmail, 160).toLowerCase(),
    customerGuestHash: trimText(record.customerGuestHash, 160),
    status: normalizeBookingStatus(record.status),
    createdAt: normalizeIsoString(record.createdAt, now),
    updatedAt: normalizeIsoString(record.updatedAt, now),
    merchantTouchedAt: trimText(record.merchantTouchedAt, 80),
    customerReminderProcessedMinutes: Array.isArray(record.customerReminderProcessedMinutes)
      ? record.customerReminderProcessedMinutes.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
      : undefined,
    merchantReminderProcessedMinutes: Array.isArray(record.merchantReminderProcessedMinutes)
      ? record.merchantReminderProcessedMinutes.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
      : undefined,
    noShowMarkedAt: trimText(record.noShowMarkedAt, 80),
    customerEmailLogs: Array.isArray(record.customerEmailLogs) ? [] : undefined,
    timeline: Array.isArray(record.timeline) ? [] : undefined,
  };
}

export function readPersonalGuestBookings(): MerchantBookingRecord[] {
  const source = readStorageJson(GUEST_BOOKINGS_STORAGE_KEY);
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => normalizeGuestBookingRecord(item))
    .filter((item): item is MerchantBookingRecord => Boolean(item))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function upsertPersonalGuestBooking(booking: unknown) {
  const normalized = normalizeGuestBookingRecord(booking);
  if (!normalized) return;
  const current = readPersonalGuestBookings();
  const next = [normalized, ...current.filter((item) => item.id !== normalized.id)].slice(0, 200);
  writeStorageJson(GUEST_BOOKINGS_STORAGE_KEY, next);
  emitGuestStorageChanged();
}

function normalizeGuestSupportMessage(value: unknown): PersonalGuestSupportMessage | null {
  const record = readRecord(value);
  if (!record) return null;
  const text = trimText(record.text, 5000);
  if (!text) return null;
  return {
    id: trimText(record.id, 120) || `guest-support-${Date.now().toString(36)}`,
    sender: record.sender === "super_admin" ? "super_admin" : "merchant",
    text,
    createdAt: normalizeIsoString(record.createdAt),
  };
}

export function readPersonalGuestSupportMessages(): PersonalGuestSupportMessage[] {
  const source = readStorageJson(GUEST_SUPPORT_STORAGE_KEY);
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => normalizeGuestSupportMessage(item))
    .filter((item): item is PersonalGuestSupportMessage => Boolean(item))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-200);
}

export function readPersonalGuestSupportThread(
  identity = ensurePersonalGuestIdentity(),
  profile = readPersonalGuestProfile(),
): PlatformSupportThread {
  const messages = readPersonalGuestSupportMessages();
  return {
    merchantId: identity.accountId,
    siteId: identity.accountId,
    merchantName: profile.displayName || "\u6e38\u5ba2",
    merchantEmail: profile.email,
    updatedAt: messages[messages.length - 1]?.createdAt ?? identity.updatedAt,
    messages,
  };
}

export function appendPersonalGuestSupportMessage(
  text: string,
  identity = ensurePersonalGuestIdentity(),
  profile = readPersonalGuestProfile(),
) {
  const normalizedText = trimText(text, 5000);
  if (!normalizedText) return readPersonalGuestSupportThread(identity, profile);
  const messages = readPersonalGuestSupportMessages();
  const nextMessage: PersonalGuestSupportMessage = {
    id: `guest-support-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sender: "merchant",
    text: normalizedText,
    createdAt: new Date().toISOString(),
  };
  writeStorageJson(GUEST_SUPPORT_STORAGE_KEY, [...messages, nextMessage].slice(-200));
  emitGuestStorageChanged();
  return readPersonalGuestSupportThread(identity, profile);
}

export function readPersonalGuestFavoriteSites<T = unknown>(): T[] {
  const source = readStorageJson(GUEST_FAVORITES_STORAGE_KEY);
  return Array.isArray(source) ? (source as T[]) : [];
}

export function savePersonalGuestFavoriteSites<T>(sites: T[]) {
  const next = Array.isArray(sites) ? sites.slice(0, 200) : [];
  writeStorageJson(GUEST_FAVORITES_STORAGE_KEY, next);
  emitGuestStorageChanged();
  return next;
}

function readMigrationMap(): Record<string, string> {
  const source = readStorageJson(GUEST_MIGRATIONS_STORAGE_KEY);
  return source && typeof source === "object" && !Array.isArray(source) ? (source as Record<string, string>) : {};
}

export function buildPersonalGuestMigrationFingerprint(input: {
  identity?: PersonalGuestIdentity | null;
  profile?: PersonalGuestProfile | null;
  favoriteSites?: unknown[];
  orders?: MerchantOrderRecord[];
  bookings?: MerchantBookingRecord[];
  supportMessages?: PersonalGuestSupportMessage[];
}) {
  const identityId = trimText(input.identity?.id, 180);
  const profile = normalizePersonalGuestProfile(input.profile ?? null);
  const profilePart = Object.values(profile).join("\u001f");
  const favoritePart = (Array.isArray(input.favoriteSites) ? input.favoriteSites : [])
    .map((item) => JSON.stringify(item))
    .join("\u001e");
  const orderPart = (input.orders ?? []).map((item) => `${item.siteId}:${item.id}:${item.updatedAt}`).join("\u001e");
  const bookingPart = (input.bookings ?? []).map((item) => `${item.siteId}:${item.id}:${item.updatedAt}`).join("\u001e");
  const supportPart = (input.supportMessages ?? []).map((item) => `${item.id}:${item.createdAt}`).join("\u001e");
  return [identityId, profilePart, favoritePart, orderPart, bookingPart, supportPart].join("\u001d").slice(0, 12000);
}

export function hasPersonalGuestMigrationCompleted(accountId: string, fingerprint: string) {
  const normalizedAccountId = trimText(accountId, 32);
  if (!normalizedAccountId || !fingerprint) return false;
  return readMigrationMap()[normalizedAccountId] === fingerprint;
}

export function markPersonalGuestMigrationCompleted(accountId: string, fingerprint: string) {
  const normalizedAccountId = trimText(accountId, 32);
  if (!normalizedAccountId || !fingerprint) return;
  const next = {
    ...readMigrationMap(),
    [normalizedAccountId]: fingerprint,
  };
  writeStorageJson(GUEST_MIGRATIONS_STORAGE_KEY, next);
}

function readGuestArchives(): unknown[] {
  const source = readStorageJson(GUEST_ARCHIVES_STORAGE_KEY);
  return Array.isArray(source) ? source : [];
}

export function archiveAndClearPersonalGuestData(input: {
  accountId: string;
  fingerprint: string;
  clearProfile?: boolean;
  clearFavorites?: boolean;
  clearOrders?: boolean;
  clearBookings?: boolean;
  clearSupport?: boolean;
}) {
  const normalizedAccountId = trimText(input.accountId, 32);
  const fingerprint = trimText(input.fingerprint, 12000);
  if (!normalizedAccountId || !fingerprint) return;

  const archiveEntry = {
    accountId: normalizedAccountId,
    fingerprint,
    archivedAt: new Date().toISOString(),
    identity: readPersonalGuestIdentity(),
    profile: readPersonalGuestProfile(),
    favoriteSites: readPersonalGuestFavoriteSites(),
    orders: readPersonalGuestOrders(),
    bookings: readPersonalGuestBookings(),
    supportMessages: readPersonalGuestSupportMessages(),
    cleared: {
      profile: input.clearProfile === true,
      favorites: input.clearFavorites === true,
      orders: input.clearOrders === true,
      bookings: input.clearBookings === true,
      support: input.clearSupport === true,
    },
  };
  writeStorageJson(GUEST_ARCHIVES_STORAGE_KEY, [archiveEntry, ...readGuestArchives()].slice(0, 20));

  if (input.clearProfile === true) removeStorageItem(GUEST_PROFILE_STORAGE_KEY);
  if (input.clearFavorites === true) removeStorageItem(GUEST_FAVORITES_STORAGE_KEY);
  if (input.clearOrders === true) removeStorageItem(GUEST_ORDERS_STORAGE_KEY);
  if (input.clearBookings === true) removeStorageItem(GUEST_BOOKINGS_STORAGE_KEY);
  if (input.clearSupport === true) removeStorageItem(GUEST_SUPPORT_STORAGE_KEY);
  emitGuestStorageChanged();
}
