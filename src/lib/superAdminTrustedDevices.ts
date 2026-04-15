export const SUPER_ADMIN_TRUSTED_DEVICES_PAGE_SLUG = "super-admin-trusted-devices";
export const DEFAULT_SUPER_ADMIN_MAX_DEVICES = 3;
const SUPER_ADMIN_TRUSTED_DEVICES_VERSION = 3;

export type SuperAdminTrustedDeviceLoginStatus = "success";

export type SuperAdminTrustedDeviceDetails = {
  platform: string;
  os: string;
  browser: string;
  browserVersion: string;
  model: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  language: string;
  languages: string[];
  timezone: string;
  screen: string;
  viewport: string;
  userAgent: string;
  brands: string[];
  deviceMemory: string;
  hardwareConcurrency: string;
};

export type SuperAdminTrustedDeviceRecord = {
  deviceId: string;
  deviceLabel: string;
  addedAt: string;
  lastVerifiedAt: string;
  firstLoginIp: string;
  lastLoginIp: string;
  lastLoginStatus: SuperAdminTrustedDeviceLoginStatus;
  details: SuperAdminTrustedDeviceDetails | null;
};

type QueryErrorLike = { message?: string } | null;

type TrustedDevicesPageRow = {
  id?: string | null;
  blocks?: unknown;
};

type TrustedDevicesPageSelectBuilder = {
  eq: (column: string, value: unknown) => TrustedDevicesPageSelectBuilder;
  is: (column: string, value: null) => TrustedDevicesPageSelectBuilder;
  limit: (value: number) => TrustedDevicesPageSelectBuilder;
  maybeSingle: () => PromiseLike<{
    data: TrustedDevicesPageRow | null;
    error: QueryErrorLike;
  }>;
};

type TrustedDevicesPageMutationBuilder = {
  eq: (column: string, value: unknown) => PromiseLike<{
    error: QueryErrorLike;
  }>;
};

type TrustedDevicesStoreClient = {
  from: (table: string) => {
    select: (columns: string) => TrustedDevicesPageSelectBuilder;
    update: (values: { blocks: unknown }) => TrustedDevicesPageMutationBuilder;
    insert: (values: { merchant_id: null; slug: string; blocks: unknown }) => PromiseLike<{
      error: QueryErrorLike;
    }>;
  };
};

type TrustedDevicesPagePayload = {
  version: number;
  maxDevices: number;
  devices: SuperAdminTrustedDeviceRecord[];
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoDate(value: unknown, fallback: string) {
  const normalized = normalizeText(value);
  if (!normalized) return fallback;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizeLoginStatus(value: unknown): SuperAdminTrustedDeviceLoginStatus {
  return normalizeText(value) === "success" ? "success" : "success";
}

function normalizeTextArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeDeviceType(value: unknown): SuperAdminTrustedDeviceDetails["deviceType"] {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "desktop" || normalized === "mobile" || normalized === "tablet") return normalized;
  return "unknown";
}

export function normalizeSuperAdminTrustedDeviceDetails(value: unknown): SuperAdminTrustedDeviceDetails | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<SuperAdminTrustedDeviceDetails>;
  const details: SuperAdminTrustedDeviceDetails = {
    platform: normalizeText(source.platform),
    os: normalizeText(source.os),
    browser: normalizeText(source.browser),
    browserVersion: normalizeText(source.browserVersion),
    model: normalizeText(source.model),
    deviceType: normalizeDeviceType(source.deviceType),
    language: normalizeText(source.language),
    languages: normalizeTextArray(source.languages),
    timezone: normalizeText(source.timezone),
    screen: normalizeText(source.screen),
    viewport: normalizeText(source.viewport),
    userAgent: normalizeText(source.userAgent),
    brands: normalizeTextArray(source.brands),
    deviceMemory: normalizeText(source.deviceMemory),
    hardwareConcurrency: normalizeText(source.hardwareConcurrency),
  };

  const hasMeaningfulValue = Object.entries(details).some(([key, current]) => {
    if (key === "deviceType") return current !== "unknown";
    if (Array.isArray(current)) return current.length > 0;
    return Boolean(current);
  });
  return hasMeaningfulValue ? details : null;
}

export function normalizeSuperAdminMaxDevices(value: unknown) {
  const numeric =
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) return DEFAULT_SUPER_ADMIN_MAX_DEVICES;
  return Math.max(1, Math.min(20, numeric));
}

function sortTrustedDevices(devices: SuperAdminTrustedDeviceRecord[]) {
  return [...devices].sort((left, right) => {
    const verifiedDiff = new Date(right.lastVerifiedAt).getTime() - new Date(left.lastVerifiedAt).getTime();
    if (verifiedDiff !== 0) return verifiedDiff;
    const addedDiff = new Date(right.addedAt).getTime() - new Date(left.addedAt).getTime();
    if (addedDiff !== 0) return addedDiff;
    return left.deviceLabel.localeCompare(right.deviceLabel, "zh-CN");
  });
}

function normalizeTrustedDeviceRecord(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<SuperAdminTrustedDeviceRecord> & { details?: unknown };
  const deviceId = normalizeText(source.deviceId);
  if (!deviceId) return null;
  const nowIso = new Date().toISOString();
  const addedAt = normalizeIsoDate(source.addedAt, nowIso);
  const lastVerifiedAt = normalizeIsoDate(source.lastVerifiedAt, addedAt);
  const firstLoginIp = normalizeText(source.firstLoginIp);
  const lastLoginIp = normalizeText(source.lastLoginIp) || firstLoginIp;
  return {
    deviceId,
    deviceLabel: normalizeText(source.deviceLabel) || "当前设备",
    addedAt,
    lastVerifiedAt,
    firstLoginIp,
    lastLoginIp,
    lastLoginStatus: normalizeLoginStatus(source.lastLoginStatus),
    details: normalizeSuperAdminTrustedDeviceDetails(source.details),
  } satisfies SuperAdminTrustedDeviceRecord;
}

export function normalizeSuperAdminTrustedDevices(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { devices?: unknown }).devices)
      ? (value as { devices: unknown[] }).devices
      : [];
  const deduped = new Map<string, SuperAdminTrustedDeviceRecord>();
  source.forEach((item) => {
    const normalized = normalizeTrustedDeviceRecord(item);
    if (!normalized) return;
    const previous = deduped.get(normalized.deviceId);
    if (!previous) {
      deduped.set(normalized.deviceId, normalized);
      return;
    }
    deduped.set(
      normalized.deviceId,
      new Date(normalized.lastVerifiedAt).getTime() >= new Date(previous.lastVerifiedAt).getTime() ? normalized : previous,
    );
  });
  return sortTrustedDevices(Array.from(deduped.values()));
}

function buildPayload(maxDevices: number, devices: SuperAdminTrustedDeviceRecord[]): TrustedDevicesPagePayload {
  return {
    version: SUPER_ADMIN_TRUSTED_DEVICES_VERSION,
    maxDevices: normalizeSuperAdminMaxDevices(maxDevices),
    devices: sortTrustedDevices(devices),
  };
}

export function canRegisterAnotherSuperAdminDevice(
  devices: SuperAdminTrustedDeviceRecord[],
  maxDevices: number,
  deviceId: string,
) {
  const normalizedDeviceId = normalizeText(deviceId);
  if (!normalizedDeviceId) return false;
  if (devices.some((item) => item.deviceId === normalizedDeviceId)) return true;
  return devices.length < normalizeSuperAdminMaxDevices(maxDevices);
}

export function upsertSuperAdminTrustedDevice(
  devices: SuperAdminTrustedDeviceRecord[],
  input: {
    deviceId: string;
    deviceLabel: string;
    verifiedAt?: string | null;
    loginIp?: string | null;
    loginStatus?: SuperAdminTrustedDeviceLoginStatus | null;
    details?: SuperAdminTrustedDeviceDetails | null;
  },
) {
  const deviceId = normalizeText(input.deviceId);
  if (!deviceId) return sortTrustedDevices(devices);
  const verifiedAt = normalizeIsoDate(input.verifiedAt, new Date().toISOString());
  const loginIp = normalizeText(input.loginIp);
  const existing = devices.find((item) => item.deviceId === deviceId);
  const nextRecord: SuperAdminTrustedDeviceRecord = {
    deviceId,
    deviceLabel: normalizeText(input.deviceLabel) || existing?.deviceLabel || "当前设备",
    addedAt: existing?.addedAt || verifiedAt,
    lastVerifiedAt: verifiedAt,
    firstLoginIp: existing?.firstLoginIp || loginIp,
    lastLoginIp: loginIp || existing?.lastLoginIp || "",
    lastLoginStatus: input.loginStatus ?? existing?.lastLoginStatus ?? "success",
    details: normalizeSuperAdminTrustedDeviceDetails(input.details) ?? existing?.details ?? null,
  };
  return sortTrustedDevices([nextRecord, ...devices.filter((item) => item.deviceId !== deviceId)]);
}

export function removeSuperAdminTrustedDevice(devices: SuperAdminTrustedDeviceRecord[], deviceId: string) {
  const normalizedDeviceId = normalizeText(deviceId);
  return sortTrustedDevices(devices.filter((item) => item.deviceId !== normalizedDeviceId));
}

export function pickLeastRecentlyVerifiedSuperAdminTrustedDevice(devices: SuperAdminTrustedDeviceRecord[]) {
  const sortedDevices = sortTrustedDevices(devices);
  return sortedDevices.at(-1) ?? null;
}

function readDevicesFromBlocks(blocks: unknown) {
  if (Array.isArray(blocks)) {
    return {
      maxDevices: DEFAULT_SUPER_ADMIN_MAX_DEVICES,
      devices: normalizeSuperAdminTrustedDevices(blocks),
    };
  }
  if (!blocks || typeof blocks !== "object") {
    return {
      maxDevices: DEFAULT_SUPER_ADMIN_MAX_DEVICES,
      devices: [] as SuperAdminTrustedDeviceRecord[],
    };
  }
  const payload = blocks as { devices?: unknown; maxDevices?: unknown };
  return {
    maxDevices: normalizeSuperAdminMaxDevices(payload.maxDevices),
    devices: normalizeSuperAdminTrustedDevices(payload),
  };
}

export async function loadSuperAdminTrustedDevicesFromStore(supabase: unknown): Promise<{
  rowId: string;
  maxDevices: number;
  devices: SuperAdminTrustedDeviceRecord[];
}> {
  const client = supabase as TrustedDevicesStoreClient;
  const { data, error } = await client
    .from("pages")
    .select("id,blocks")
    .is("merchant_id", null)
    .eq("slug", SUPER_ADMIN_TRUSTED_DEVICES_PAGE_SLUG)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "super_admin_trusted_devices_load_failed");
  }

  const payload = readDevicesFromBlocks(data?.blocks);
  return {
    rowId: normalizeText(data?.id),
    maxDevices: payload.maxDevices,
    devices: payload.devices,
  };
}

export async function saveSuperAdminTrustedDevicesToStore(
  supabase: unknown,
  rowId: string,
  maxDevices: number,
  devices: SuperAdminTrustedDeviceRecord[],
) {
  const client = supabase as TrustedDevicesStoreClient;
  const payload = buildPayload(maxDevices, devices);

  if (normalizeText(rowId)) {
    const { error } = await client.from("pages").update({ blocks: payload }).eq("id", rowId);
    if (error) {
      throw new Error(error.message || "super_admin_trusted_devices_save_failed");
    }
    return;
  }

  const { error } = await client.from("pages").insert({
    merchant_id: null,
    slug: SUPER_ADMIN_TRUSTED_DEVICES_PAGE_SLUG,
    blocks: payload,
  });
  if (error) {
    throw new Error(error.message || "super_admin_trusted_devices_save_failed");
  }
}
