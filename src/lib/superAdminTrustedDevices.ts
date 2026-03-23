export const SUPER_ADMIN_TRUSTED_DEVICES_PAGE_SLUG = "super-admin-trusted-devices";

export type SuperAdminTrustedDeviceRecord = {
  deviceId: string;
  deviceLabel: string;
  addedAt: string;
  lastVerifiedAt: string;
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
  version: 1;
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
  const source = value as Partial<SuperAdminTrustedDeviceRecord>;
  const deviceId = normalizeText(source.deviceId);
  if (!deviceId) return null;
  const nowIso = new Date().toISOString();
  const addedAt = normalizeIsoDate(source.addedAt, nowIso);
  return {
    deviceId,
    deviceLabel: normalizeText(source.deviceLabel) || "当前设备",
    addedAt,
    lastVerifiedAt: normalizeIsoDate(source.lastVerifiedAt, addedAt),
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

function buildPayload(devices: SuperAdminTrustedDeviceRecord[]): TrustedDevicesPagePayload {
  return {
    version: 1,
    devices: sortTrustedDevices(devices),
  };
}

export function upsertSuperAdminTrustedDevice(
  devices: SuperAdminTrustedDeviceRecord[],
  input: { deviceId: string; deviceLabel: string; verifiedAt?: string | null },
) {
  const deviceId = normalizeText(input.deviceId);
  if (!deviceId) return sortTrustedDevices(devices);
  const verifiedAt = normalizeIsoDate(input.verifiedAt, new Date().toISOString());
  const existing = devices.find((item) => item.deviceId === deviceId);
  const nextRecord: SuperAdminTrustedDeviceRecord = {
    deviceId,
    deviceLabel: normalizeText(input.deviceLabel) || existing?.deviceLabel || "当前设备",
    addedAt: existing?.addedAt || verifiedAt,
    lastVerifiedAt: verifiedAt,
  };
  return sortTrustedDevices([
    nextRecord,
    ...devices.filter((item) => item.deviceId !== deviceId),
  ]);
}

export function removeSuperAdminTrustedDevice(
  devices: SuperAdminTrustedDeviceRecord[],
  deviceId: string,
) {
  const normalizedDeviceId = normalizeText(deviceId);
  return sortTrustedDevices(devices.filter((item) => item.deviceId !== normalizedDeviceId));
}

function readDevicesFromBlocks(blocks: unknown) {
  if (Array.isArray(blocks)) return normalizeSuperAdminTrustedDevices(blocks);
  if (!blocks || typeof blocks !== "object") return [];
  return normalizeSuperAdminTrustedDevices(blocks);
}

export async function loadSuperAdminTrustedDevicesFromStore(supabase: unknown): Promise<{
  rowId: string;
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

  return {
    rowId: normalizeText(data?.id),
    devices: readDevicesFromBlocks(data?.blocks),
  };
}

export async function saveSuperAdminTrustedDevicesToStore(
  supabase: unknown,
  rowId: string,
  devices: SuperAdminTrustedDeviceRecord[],
) {
  const client = supabase as TrustedDevicesStoreClient;
  const payload = buildPayload(devices);

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
