import type { MerchantBookingRecord } from "@/lib/merchantBookings";
import type { MerchantMembershipRecord } from "@/lib/merchantMemberships";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

export const MERCHANT_CUSTOMER_SOURCES = ["manual", "import", "membership", "order", "booking"] as const;
export const MERCHANT_CUSTOMER_STATUSES = ["active", "archived"] as const;

export type MerchantCustomerSource = (typeof MERCHANT_CUSTOMER_SOURCES)[number];
export type MerchantCustomerStatus = (typeof MERCHANT_CUSTOMER_STATUSES)[number];

export type MerchantCustomerAddress = {
  country: string;
  province: string;
  city: string;
  postalCode: string;
  line1: string;
  line2: string;
};

export type MerchantCustomerTaxProfile = {
  name: string;
  number: string;
  country: string;
  province: string;
  city: string;
  address: string;
};

export type MerchantCustomerProfile = {
  id: string;
  siteId: string;
  referenceCode: string;
  memberNo: string;
  accountId: string;
  authUserId: string;
  guestHash: string;
  displayName: string;
  phone: string;
  email: string;
  birthday: string;
  gender: string;
  address: MerchantCustomerAddress;
  tax: MerchantCustomerTaxProfile;
  allergens: string[];
  tags: string[];
  notes: string;
  customFields: Record<string, string>;
  identityAliases: string[];
  sources: MerchantCustomerSource[];
  status: MerchantCustomerStatus;
  createdAt: string;
  updatedAt: string;
};

export type MerchantCustomerOrderTotal = {
  label: string;
  amount: number;
};

export type MerchantCustomerActivity = {
  orderCount: number;
  bookingCount: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  lastOrderAt: string | null;
  lastBookingAt: string | null;
  lastOrderNote: string;
  lastBookingNote: string;
  orderTotals: MerchantCustomerOrderTotal[];
};

export type MerchantCustomerDirectoryItem = MerchantCustomerProfile & {
  activity: MerchantCustomerActivity;
  incomplete: boolean;
};

export type MerchantCustomerDirectoryInput = {
  siteId: string;
  storedCustomers?: unknown;
  orders?: MerchantOrderRecord[];
  bookings?: MerchantBookingRecord[];
  memberships?: MerchantMembershipRecord[];
};

type CustomerCandidate = {
  profile: MerchantCustomerProfile;
  priority: number;
  activity: MerchantCustomerActivity;
};

const MAX_CUSTOM_FIELDS = 40;
const MAX_IDENTITY_ALIASES = 24;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTimestamp(value: unknown, fallback = "") {
  const text = trimText(value, 64);
  if (!text || !Number.isFinite(Date.parse(text))) return fallback;
  return new Date(text).toISOString();
}

function earlierTimestamp(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function laterTimestamp(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function normalizeStringList(value: unknown, maxItems: number, maxLength = 120) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，;；\n]/)
      : [];
  return Array.from(new Set(source.map((item) => trimText(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

function normalizeCustomFields(value: unknown) {
  const source = readRecord(value);
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, fieldValue]) => [trimText(key, 80), trimText(fieldValue, 500)] as const)
      .filter(([key, fieldValue]) => key && fieldValue)
      .slice(0, MAX_CUSTOM_FIELDS),
  );
}

export function normalizeMerchantCustomerEmail(value: unknown) {
  return trimText(value, 320).toLowerCase();
}

export function normalizeMerchantCustomerPhone(value: unknown) {
  const text = trimText(value, 80);
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  if (text.startsWith("00") && digits.length > 2) return digits.slice(2);
  return digits;
}

function normalizeIdentityText(value: unknown) {
  return trimText(value, 320)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeTaxNumber(value: unknown) {
  return trimText(value, 120).normalize("NFKC").toUpperCase().replace(/[\s._-]+/g, "");
}

function createEmptyAddress(): MerchantCustomerAddress {
  return {
    country: "",
    province: "",
    city: "",
    postalCode: "",
    line1: "",
    line2: "",
  };
}

function createEmptyTaxProfile(): MerchantCustomerTaxProfile {
  return {
    name: "",
    number: "",
    country: "",
    province: "",
    city: "",
    address: "",
  };
}

export function createMerchantCustomerId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ? `customer-${randomId}` : `customer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyMerchantCustomerProfile(
  siteId: string,
  source: MerchantCustomerSource = "manual",
): MerchantCustomerProfile {
  const now = new Date().toISOString();
  return {
    id: createMerchantCustomerId(),
    siteId: trimText(siteId, 80),
    referenceCode: "",
    memberNo: "",
    accountId: "",
    authUserId: "",
    guestHash: "",
    displayName: "",
    phone: "",
    email: "",
    birthday: "",
    gender: "",
    address: createEmptyAddress(),
    tax: createEmptyTaxProfile(),
    allergens: [],
    tags: [],
    notes: "",
    customFields: {},
    identityAliases: [],
    sources: [source],
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeMerchantCustomerProfile(
  value: unknown,
  options: {
    siteId?: string;
    source?: MerchantCustomerSource;
    createId?: boolean;
    now?: string;
  } = {},
): MerchantCustomerProfile | null {
  const input = readRecord(value);
  const addressInput = readRecord(input.address);
  const taxInput = readRecord(input.tax);
  const siteId = trimText(input.siteId, 80) || trimText(options.siteId, 80);
  const id = trimText(input.id, 160) || (options.createId ? createMerchantCustomerId() : "");
  if (!siteId || !id) return null;
  const now = normalizeTimestamp(options.now) || new Date().toISOString();
  const createdAt = normalizeTimestamp(input.createdAt, now);
  const updatedAt = normalizeTimestamp(input.updatedAt, createdAt);
  const sources = normalizeStringList(input.sources, MERCHANT_CUSTOMER_SOURCES.length, 40).filter(
    (source): source is MerchantCustomerSource =>
      MERCHANT_CUSTOMER_SOURCES.includes(source as MerchantCustomerSource),
  );
  if (options.source && !sources.includes(options.source)) sources.push(options.source);
  return {
    id,
    siteId,
    referenceCode: trimText(input.referenceCode, 120),
    memberNo: trimText(input.memberNo, 120),
    accountId: trimText(input.accountId, 160),
    authUserId: trimText(input.authUserId, 160),
    guestHash: trimText(input.guestHash, 160),
    displayName: trimText(input.displayName, 160),
    phone: trimText(input.phone, 80),
    email: normalizeMerchantCustomerEmail(input.email),
    birthday: trimText(input.birthday, 32),
    gender: trimText(input.gender, 40),
    address: {
      country: trimText(addressInput.country, 120),
      province: trimText(addressInput.province, 120),
      city: trimText(addressInput.city, 120),
      postalCode: trimText(addressInput.postalCode, 40),
      line1: trimText(addressInput.line1, 300),
      line2: trimText(addressInput.line2, 300),
    },
    tax: {
      name: trimText(taxInput.name, 200),
      number: trimText(taxInput.number, 120),
      country: trimText(taxInput.country, 120),
      province: trimText(taxInput.province, 120),
      city: trimText(taxInput.city, 120),
      address: trimText(taxInput.address, 400),
    },
    allergens: normalizeStringList(input.allergens, 40),
    tags: normalizeStringList(input.tags, 30),
    notes: trimText(input.notes, 4000),
    customFields: normalizeCustomFields(input.customFields),
    identityAliases: normalizeStringList(input.identityAliases, MAX_IDENTITY_ALIASES, 400),
    sources,
    status: input.status === "archived" ? "archived" : "active",
    createdAt,
    updatedAt,
  };
}

export function isMerchantCustomerProfileMeaningful(profile: MerchantCustomerProfile) {
  return Boolean(
    profile.referenceCode ||
      profile.memberNo ||
      profile.accountId ||
      profile.authUserId ||
      profile.guestHash ||
      profile.displayName ||
      profile.phone ||
      profile.email ||
      profile.tax.number,
  );
}

export function getMerchantCustomerIdentityTokens(profile: MerchantCustomerProfile) {
  const tokens = [
    profile.accountId ? `account:${normalizeIdentityText(profile.accountId)}` : "",
    profile.authUserId ? `auth:${normalizeIdentityText(profile.authUserId)}` : "",
    profile.guestHash ? `guest:${normalizeIdentityText(profile.guestHash)}` : "",
    profile.email ? `email:${normalizeMerchantCustomerEmail(profile.email)}` : "",
    profile.phone ? `phone:${normalizeMerchantCustomerPhone(profile.phone)}` : "",
    profile.tax.number ? `tax:${normalizeTaxNumber(profile.tax.number)}` : "",
    profile.referenceCode ? `reference:${normalizeIdentityText(profile.referenceCode)}` : "",
    profile.memberNo ? `member:${normalizeIdentityText(profile.memberNo)}` : "",
    ...profile.identityAliases.map((item) => trimText(item, 400)),
  ].filter(Boolean);
  if (tokens.length === 0 && profile.displayName) {
    const addressHint = [
      normalizeIdentityText(profile.address.postalCode),
      normalizeIdentityText(profile.address.line1),
    ]
      .filter(Boolean)
      .join(":");
    if (addressHint) {
      tokens.push(`name:${normalizeIdentityText(profile.displayName)}:${addressHint}`);
    }
  }
  return Array.from(new Set(tokens)).slice(0, MAX_IDENTITY_ALIASES);
}

function emptyActivity(): MerchantCustomerActivity {
  return {
    orderCount: 0,
    bookingCount: 0,
    firstActivityAt: null,
    lastActivityAt: null,
    lastOrderAt: null,
    lastBookingAt: null,
    lastOrderNote: "",
    lastBookingNote: "",
    orderTotals: [],
  };
}

function mergeAddress(
  preferred: MerchantCustomerAddress,
  fallback: MerchantCustomerAddress,
): MerchantCustomerAddress {
  return {
    country: preferred.country || fallback.country,
    province: preferred.province || fallback.province,
    city: preferred.city || fallback.city,
    postalCode: preferred.postalCode || fallback.postalCode,
    line1: preferred.line1 || fallback.line1,
    line2: preferred.line2 || fallback.line2,
  };
}

function mergeTaxProfile(
  preferred: MerchantCustomerTaxProfile,
  fallback: MerchantCustomerTaxProfile,
): MerchantCustomerTaxProfile {
  return {
    name: preferred.name || fallback.name,
    number: preferred.number || fallback.number,
    country: preferred.country || fallback.country,
    province: preferred.province || fallback.province,
    city: preferred.city || fallback.city,
    address: preferred.address || fallback.address,
  };
}

function mergeProfiles(
  preferred: MerchantCustomerProfile,
  fallback: MerchantCustomerProfile,
  options: { replaceEmpty?: boolean } = {},
): MerchantCustomerProfile {
  const replace = options.replaceEmpty === true;
  const choose = (nextValue: string, previousValue: string) => (replace ? nextValue : nextValue || previousValue);
  return {
    ...fallback,
    ...preferred,
    id: fallback.id || preferred.id,
    siteId: fallback.siteId || preferred.siteId,
    referenceCode: choose(preferred.referenceCode, fallback.referenceCode),
    memberNo: choose(preferred.memberNo, fallback.memberNo),
    accountId: choose(preferred.accountId, fallback.accountId),
    authUserId: choose(preferred.authUserId, fallback.authUserId),
    guestHash: choose(preferred.guestHash, fallback.guestHash),
    displayName: choose(preferred.displayName, fallback.displayName),
    phone: choose(preferred.phone, fallback.phone),
    email: choose(preferred.email, fallback.email),
    birthday: choose(preferred.birthday, fallback.birthday),
    gender: choose(preferred.gender, fallback.gender),
    address: replace ? preferred.address : mergeAddress(preferred.address, fallback.address),
    tax: replace ? preferred.tax : mergeTaxProfile(preferred.tax, fallback.tax),
    allergens: replace
      ? preferred.allergens
      : Array.from(new Set([...preferred.allergens, ...fallback.allergens])),
    tags: replace
      ? preferred.tags
      : Array.from(new Set([...preferred.tags, ...fallback.tags])),
    notes: choose(preferred.notes, fallback.notes),
    customFields: replace
      ? preferred.customFields
      : { ...fallback.customFields, ...preferred.customFields },
    identityAliases: Array.from(
      new Set([
        ...fallback.identityAliases,
        ...preferred.identityAliases,
        ...getMerchantCustomerIdentityTokens(fallback),
        ...getMerchantCustomerIdentityTokens(preferred),
      ]),
    ).slice(0, MAX_IDENTITY_ALIASES),
    sources: Array.from(new Set([...preferred.sources, ...fallback.sources])),
    createdAt: earlierTimestamp(preferred.createdAt, fallback.createdAt) || preferred.createdAt,
    updatedAt: laterTimestamp(preferred.updatedAt, fallback.updatedAt) || preferred.updatedAt,
  };
}

export function upsertMerchantCustomerProfiles(
  existingValue: unknown,
  incomingValue: unknown,
  options: {
    siteId: string;
    source?: MerchantCustomerSource;
    replaceEmpty?: boolean;
    now?: string;
  },
) {
  const siteId = trimText(options.siteId, 80);
  const existingSource = Array.isArray(existingValue) ? existingValue : [];
  const incomingSource = Array.isArray(incomingValue) ? incomingValue : [incomingValue];
  const existing = existingSource
    .map((item) => normalizeMerchantCustomerProfile(item, { siteId }))
    .filter((item): item is MerchantCustomerProfile => Boolean(item && item.siteId === siteId));
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of incomingSource) {
    const incoming = normalizeMerchantCustomerProfile(raw, {
      siteId,
      source: options.source,
      createId: true,
      now: options.now,
    });
    if (!incoming || !isMerchantCustomerProfileMeaningful(incoming)) {
      skipped += 1;
      continue;
    }
    const incomingTokens = new Set(getMerchantCustomerIdentityTokens(incoming));
    const matches = existing
      .map((profile, index) => ({
        profile,
        index,
        matches:
          profile.id === incoming.id ||
          getMerchantCustomerIdentityTokens(profile).some((token) => incomingTokens.has(token)),
      }))
      .filter((entry) => entry.matches);
    if (matches.length === 0) {
      existing.push({
        ...incoming,
        identityAliases: Array.from(new Set([...incoming.identityAliases, ...incomingTokens])).slice(
          0,
          MAX_IDENTITY_ALIASES,
        ),
      });
      created += 1;
      continue;
    }
    const targetIndex = matches[0]!.index;
    const target = matches[0]!.profile;
    const next = mergeProfiles(
      {
        ...incoming,
        id: target.id,
        createdAt: target.createdAt,
        updatedAt: normalizeTimestamp(options.now) || new Date().toISOString(),
      },
      target,
      { replaceEmpty: options.replaceEmpty },
    );
    existing[targetIndex] = next;
    const duplicateIndexes = matches
      .slice(1)
      .map((entry) => entry.index)
      .sort((left, right) => right - left);
    for (const duplicateIndex of duplicateIndexes) {
      existing[targetIndex] = mergeProfiles(existing[targetIndex]!, existing[duplicateIndex]!);
      existing.splice(duplicateIndex, 1);
    }
    updated += 1;
  }

  return {
    customers: existing.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    created,
    updated,
    skipped,
  };
}

function candidateFromStored(profile: MerchantCustomerProfile): CustomerCandidate {
  return {
    profile,
    priority: 100,
    activity: emptyActivity(),
  };
}

function candidateFromMembership(siteId: string, membership: MerchantMembershipRecord): CustomerCandidate | null {
  const profile = normalizeMerchantCustomerProfile(
    {
      id: `membership-${membership.id}`,
      siteId,
      referenceCode: membership.id,
      memberNo: membership.memberNo,
      accountId: membership.accountId,
      authUserId: membership.userId,
      displayName: membership.name || membership.nickname || membership.memberNo,
      phone: membership.phone,
      email: membership.email,
      birthday: membership.birthday,
      gender: membership.gender,
      address: {
        country: membership.country,
        province: membership.province,
        city: membership.city,
        postalCode: "",
        line1: membership.address,
        line2: "",
      },
      tax: {
        name: membership.taxName,
        number: membership.taxNumber,
        country: membership.taxCountry,
        province: membership.taxProvince,
        city: membership.taxCity,
        address: membership.taxAddress,
      },
      allergens: membership.allergens,
      customFields: {
        membershipStatus: membership.status,
        pointBalance: String(membership.pointBalance),
        balanceAmount: String(membership.balanceAmount),
        growthValue: String(membership.growthValue),
      },
      sources: ["membership"],
      status: membership.status === "active" ? "active" : "archived",
      createdAt: membership.joinedAt,
      updatedAt: membership.updatedAt,
    },
    { siteId },
  );
  return profile ? { profile, priority: 80, activity: emptyActivity() } : null;
}

function candidateFromOrder(siteId: string, order: MerchantOrderRecord): CustomerCandidate | null {
  const profile = normalizeMerchantCustomerProfile(
    {
      id: `order-${order.id}`,
      siteId,
      accountId: order.customerAccountId,
      authUserId: order.customerUserId,
      guestHash: order.customerGuestHash,
      displayName: order.customer.name,
      phone: order.customer.phone,
      email: order.customer.email || order.customerLoginEmail,
      notes: order.customer.note,
      sources: ["order"],
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
    { siteId },
  );
  if (!profile || !isMerchantCustomerProfileMeaningful(profile)) return null;
  return {
    profile,
    priority: 50,
    activity: {
      ...emptyActivity(),
      orderCount: 1,
      firstActivityAt: order.createdAt,
      lastActivityAt: order.createdAt,
      lastOrderAt: order.createdAt,
      lastOrderNote: trimText(order.customer.note, 1000),
      orderTotals: [{ label: trimText(order.pricePrefix, 20) || "EUR", amount: order.totalAmount }],
    },
  };
}

function candidateFromBooking(siteId: string, booking: MerchantBookingRecord): CustomerCandidate | null {
  const profile = normalizeMerchantCustomerProfile(
    {
      id: `booking-${booking.id}`,
      siteId,
      accountId: booking.customerAccountId,
      authUserId: booking.customerUserId,
      guestHash: booking.customerGuestHash,
      displayName: booking.customerName,
      phone: booking.phone,
      email: booking.email || booking.customerLoginEmail,
      notes: booking.note,
      customFields: {
        lastBookingStore: booking.store,
        lastBookingItem: booking.item,
        lastBookingTitle: booking.title,
      },
      sources: ["booking"],
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    },
    { siteId },
  );
  if (!profile || !isMerchantCustomerProfileMeaningful(profile)) return null;
  return {
    profile,
    priority: 50,
    activity: {
      ...emptyActivity(),
      bookingCount: 1,
      firstActivityAt: booking.createdAt,
      lastActivityAt: booking.createdAt,
      lastBookingAt: booking.createdAt,
      lastBookingNote: trimText(booking.note, 1000),
    },
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function mergeActivities(activities: MerchantCustomerActivity[]) {
  const totalMap = new Map<string, number>();
  const orderedByActivity = [...activities].sort(
    (left, right) => Date.parse(right.lastActivityAt ?? "") - Date.parse(left.lastActivityAt ?? ""),
  );
  for (const activity of activities) {
    for (const total of activity.orderTotals) {
      totalMap.set(total.label, Number(((totalMap.get(total.label) ?? 0) + total.amount).toFixed(2)));
    }
  }
  return {
    orderCount: activities.reduce((total, item) => total + item.orderCount, 0),
    bookingCount: activities.reduce((total, item) => total + item.bookingCount, 0),
    firstActivityAt: activities.reduce<string | null>(
      (current, item) => earlierTimestamp(current, item.firstActivityAt),
      null,
    ),
    lastActivityAt: activities.reduce<string | null>(
      (current, item) => laterTimestamp(current, item.lastActivityAt),
      null,
    ),
    lastOrderAt: activities.reduce<string | null>(
      (current, item) => laterTimestamp(current, item.lastOrderAt),
      null,
    ),
    lastBookingAt: activities.reduce<string | null>(
      (current, item) => laterTimestamp(current, item.lastBookingAt),
      null,
    ),
    lastOrderNote: orderedByActivity.find((item) => item.lastOrderNote)?.lastOrderNote ?? "",
    lastBookingNote: orderedByActivity.find((item) => item.lastBookingNote)?.lastBookingNote ?? "",
    orderTotals: Array.from(totalMap.entries()).map(([label, amount]) => ({ label, amount })),
  } satisfies MerchantCustomerActivity;
}

export function buildMerchantCustomerDirectory(input: MerchantCustomerDirectoryInput) {
  const siteId = trimText(input.siteId, 80);
  if (!siteId) return [] as MerchantCustomerDirectoryItem[];
  const storedSource = Array.isArray(input.storedCustomers)
    ? input.storedCustomers
    : Array.isArray(readRecord(input.storedCustomers).customers)
      ? (readRecord(input.storedCustomers).customers as unknown[])
      : [];
  const candidates: CustomerCandidate[] = [
    ...storedSource
      .map((item) => normalizeMerchantCustomerProfile(item, { siteId }))
      .filter((item): item is MerchantCustomerProfile => Boolean(item && item.siteId === siteId))
      .map(candidateFromStored),
    ...(input.memberships ?? [])
      .filter((item) => item.siteId === siteId)
      .map((item) => candidateFromMembership(siteId, item))
      .filter((item): item is CustomerCandidate => Boolean(item)),
    ...(input.orders ?? [])
      .filter((item) => item.siteId === siteId)
      .map((item) => candidateFromOrder(siteId, item))
      .filter((item): item is CustomerCandidate => Boolean(item)),
    ...(input.bookings ?? [])
      .filter((item) => item.siteId === siteId)
      .map((item) => candidateFromBooking(siteId, item))
      .filter((item): item is CustomerCandidate => Boolean(item)),
  ];
  if (candidates.length === 0) return [];

  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]!);
    return parent[index]!;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const tokenOwner = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    getMerchantCustomerIdentityTokens(candidate.profile).forEach((token) => {
      const owner = tokenOwner.get(token);
      if (owner === undefined) tokenOwner.set(token, index);
      else union(index, owner);
    });
  });

  const groups = new Map<number, CustomerCandidate[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), candidate]);
  });

  return Array.from(groups.values())
    .map((group) => {
      const ordered = [...group].sort((left, right) => {
        const priorityDelta = right.priority - left.priority;
        if (priorityDelta !== 0) return priorityDelta;
        return Date.parse(right.profile.updatedAt) - Date.parse(left.profile.updatedAt);
      });
      const stored = ordered.find((candidate) => candidate.priority === 100);
      const allTokens = Array.from(
        new Set(ordered.flatMap((candidate) => getMerchantCustomerIdentityTokens(candidate.profile))),
      );
      let profile = ordered[ordered.length - 1]!.profile;
      for (let index = ordered.length - 2; index >= 0; index -= 1) {
        profile = mergeProfiles(ordered[index]!.profile, profile);
      }
      const id =
        stored?.profile.id ||
        `customer-derived-${stableHash(`${siteId}:${allTokens.sort().join("|") || profile.displayName}`)}`;
      const activity = mergeActivities(group.map((candidate) => candidate.activity));
      const merged: MerchantCustomerDirectoryItem = {
        ...profile,
        id,
        identityAliases: allTokens.slice(0, MAX_IDENTITY_ALIASES),
        activity,
        incomplete: !profile.phone && !profile.email && !profile.tax.number && !profile.address.line1,
      };
      return merged;
    })
    .sort((left, right) => {
      const activityDelta = Date.parse(right.activity.lastActivityAt ?? "") - Date.parse(left.activity.lastActivityAt ?? "");
      if (Number.isFinite(activityDelta) && activityDelta !== 0) return activityDelta;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
}

export function filterMerchantCustomerDirectory(
  customers: MerchantCustomerDirectoryItem[],
  input: {
    query?: string;
    source?: MerchantCustomerSource | "all";
    status?: MerchantCustomerStatus | "all";
  } = {},
) {
  const query = normalizeIdentityText(input.query);
  return customers.filter((customer) => {
    if (input.source && input.source !== "all" && !customer.sources.includes(input.source)) return false;
    if (input.status && input.status !== "all" && customer.status !== input.status) return false;
    if (!query) return true;
    const haystack = [
      customer.referenceCode,
      customer.memberNo,
      customer.displayName,
      customer.phone,
      customer.email,
      customer.address.country,
      customer.address.province,
      customer.address.city,
      customer.address.postalCode,
      customer.address.line1,
      customer.address.line2,
      customer.tax.name,
      customer.tax.number,
      customer.tax.address,
      customer.notes,
      customer.tags.join(" "),
      Object.entries(customer.customFields)
        .map(([key, value]) => `${key} ${value}`)
        .join(" "),
    ]
      .map(normalizeIdentityText)
      .join(" ");
    return haystack.includes(query);
  });
}
