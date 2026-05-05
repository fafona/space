export type MerchantSupportReadStateEntry = {
  accountId: string;
  officialLastReadAt: string;
  peerLastRead: Record<string, string>;
  updatedAt: string;
};

export type MerchantSupportReadStatePayload = {
  accounts: MerchantSupportReadStateEntry[];
};

type StoredBlock = {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown> | null;
};

const MERCHANT_SUPPORT_READ_STATE_BLOCK_ID = "merchant-support-read-state";
export const MERCHANT_SUPPORT_READ_STATE_SLUG = "__merchant_support_read_state__";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAccountId(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeIsoString(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function getLatestSupportReadTimestamp(left: unknown, right: unknown) {
  const leftNormalized = normalizeIsoString(left);
  const rightNormalized = normalizeIsoString(right);
  if (!leftNormalized) return rightNormalized;
  if (!rightNormalized) return leftNormalized;
  return new Date(rightNormalized).getTime() > new Date(leftNormalized).getTime() ? rightNormalized : leftNormalized;
}

function normalizePeerLastRead(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([accountId, timestamp]) => [normalizeAccountId(accountId), normalizeIsoString(timestamp)] as const)
      .filter(([accountId, timestamp]) => accountId && timestamp),
  );
}

function normalizeEntry(value: unknown): MerchantSupportReadStateEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const accountId = normalizeAccountId(record.accountId);
  if (!accountId) return null;
  const peerLastRead = normalizePeerLastRead(record.peerLastRead);
  const officialLastReadAt = normalizeIsoString(record.officialLastReadAt);
  const updatedAt =
    normalizeIsoString(record.updatedAt) ||
    [officialLastReadAt, ...Object.values(peerLastRead)].reduce(getLatestSupportReadTimestamp, "") ||
    new Date(0).toISOString();
  return {
    accountId,
    officialLastReadAt,
    peerLastRead,
    updatedAt,
  };
}

function sortReadStateEntries(entries: MerchantSupportReadStateEntry[]) {
  return [...entries].sort((left, right) => {
    const leftTs = new Date(left.updatedAt).getTime();
    const rightTs = new Date(right.updatedAt).getTime();
    if (leftTs !== rightTs) return rightTs - leftTs;
    return left.accountId.localeCompare(right.accountId, "en");
  });
}

export function normalizeMerchantSupportReadStatePayload(value: unknown): MerchantSupportReadStatePayload {
  const entries = Array.isArray((value as { accounts?: unknown } | null | undefined)?.accounts)
    ? (value as { accounts: unknown[] }).accounts
        .map((item) => normalizeEntry(item))
        .filter((item): item is MerchantSupportReadStateEntry => !!item)
    : [];
  const mergedByAccount = new Map<string, MerchantSupportReadStateEntry>();
  entries.forEach((entry) => {
    const current = mergedByAccount.get(entry.accountId);
    if (!current) {
      mergedByAccount.set(entry.accountId, entry);
      return;
    }
    mergedByAccount.set(entry.accountId, {
      accountId: entry.accountId,
      officialLastReadAt: getLatestSupportReadTimestamp(current.officialLastReadAt, entry.officialLastReadAt),
      peerLastRead: mergeSupportPeerLastRead(current.peerLastRead, entry.peerLastRead),
      updatedAt: getLatestSupportReadTimestamp(current.updatedAt, entry.updatedAt) || current.updatedAt,
    });
  });
  return {
    accounts: sortReadStateEntries([...mergedByAccount.values()]),
  };
}

export function buildMerchantSupportReadStateBlocks(payload: MerchantSupportReadStatePayload) {
  return [
    {
      id: MERCHANT_SUPPORT_READ_STATE_BLOCK_ID,
      type: "common",
      content: "merchant support read state",
      props: {
        isMerchantSupportReadState: true,
        payload: normalizeMerchantSupportReadStatePayload(payload),
      },
    },
  ];
}

export function readMerchantSupportReadStateFromBlocks(blocks: unknown): MerchantSupportReadStatePayload {
  if (!Array.isArray(blocks)) {
    return { accounts: [] };
  }
  const matched = (blocks as StoredBlock[]).find((block) => {
    const props = block?.props;
    return !!props && props.isMerchantSupportReadState === true;
  });
  return normalizeMerchantSupportReadStatePayload(matched?.props?.payload);
}

export function getMerchantSupportReadState(payload: MerchantSupportReadStatePayload, accountId: unknown) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId) {
    return {
      officialLastReadAt: "",
      peerLastRead: {} as Record<string, string>,
    };
  }
  const entry = normalizeMerchantSupportReadStatePayload(payload).accounts.find(
    (item) => item.accountId === normalizedAccountId,
  );
  return {
    officialLastReadAt: entry?.officialLastReadAt ?? "",
    peerLastRead: entry ? { ...entry.peerLastRead } : ({} as Record<string, string>),
  };
}

export function mergeSupportPeerLastRead(
  current: Record<string, string>,
  next: Record<string, string>,
) {
  const merged = { ...normalizePeerLastRead(current) };
  Object.entries(normalizePeerLastRead(next)).forEach(([accountId, timestamp]) => {
    merged[accountId] = getLatestSupportReadTimestamp(merged[accountId], timestamp);
  });
  return merged;
}

export function mergeMerchantSupportReadState(
  payload: MerchantSupportReadStatePayload,
  accountId: unknown,
  readState: {
    officialLastReadAt?: unknown;
    peerLastRead?: Record<string, unknown> | null;
  },
) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId) return normalizeMerchantSupportReadStatePayload(payload);
  const normalizedPayload = normalizeMerchantSupportReadStatePayload(payload);
  const existing = getMerchantSupportReadState(normalizedPayload, normalizedAccountId);
  const officialLastReadAt = getLatestSupportReadTimestamp(existing.officialLastReadAt, readState.officialLastReadAt);
  const peerLastRead = mergeSupportPeerLastRead(existing.peerLastRead, normalizePeerLastRead(readState.peerLastRead));
  const updatedAt =
    [officialLastReadAt, ...Object.values(peerLastRead)].reduce(getLatestSupportReadTimestamp, "") || new Date().toISOString();

  const accounts = normalizedPayload.accounts.filter((entry) => entry.accountId !== normalizedAccountId);
  accounts.push({
    accountId: normalizedAccountId,
    officialLastReadAt,
    peerLastRead,
    updatedAt,
  });
  return {
    accounts: sortReadStateEntries(accounts),
  };
}
