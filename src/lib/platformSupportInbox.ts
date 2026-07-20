type SupportMessageSender = "merchant" | "super_admin";

export type PlatformSupportMessage = {
  id: string;
  sender: SupportMessageSender;
  text: string;
  createdAt: string;
};

export type PlatformSupportThread = {
  merchantId: string;
  siteId: string;
  merchantName: string;
  merchantEmail: string;
  updatedAt: string;
  messages: PlatformSupportMessage[];
};

export type PlatformSupportInboxPayload = {
  threads: PlatformSupportThread[];
};

type StoredBlock = {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown> | null;
};

const PLATFORM_SUPPORT_INBOX_BLOCK_ID = "platform-support-inbox";
export const PLATFORM_SUPPORT_INBOX_SLUG = "__platform_support_inbox__";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoString(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeSender(value: unknown): SupportMessageSender {
  return value === "super_admin" ? "super_admin" : "merchant";
}

function createFallbackMessageId(index: number) {
  return `support-message-${index + 1}`;
}

function normalizeMessage(value: unknown, index: number): PlatformSupportMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = normalizeText(record.text);
  if (!text) return null;
  const createdAt = normalizeIsoString(record.createdAt) || new Date(0).toISOString();
  return {
    id: normalizeText(record.id) || createFallbackMessageId(index),
    sender: normalizeSender(record.sender),
    text,
    createdAt,
  };
}

function sortMessages(messages: PlatformSupportMessage[]) {
  return [...messages].sort((left, right) => {
    const leftTs = new Date(left.createdAt).getTime();
    const rightTs = new Date(right.createdAt).getTime();
    if (leftTs !== rightTs) return leftTs - rightTs;
    return left.id.localeCompare(right.id, "en");
  });
}

function selectLatestIsoTimestamp(left: string, right: string) {
  const leftTimestamp = new Date(left).getTime();
  const rightTimestamp = new Date(right).getTime();
  if (!Number.isFinite(leftTimestamp)) return right;
  if (!Number.isFinite(rightTimestamp)) return left;
  return rightTimestamp > leftTimestamp ? right : left;
}

function isSameOrLaterIsoTimestamp(candidate: string, current: string) {
  const candidateTimestamp = new Date(candidate).getTime();
  const currentTimestamp = new Date(current).getTime();
  if (!Number.isFinite(candidateTimestamp)) return false;
  if (!Number.isFinite(currentTimestamp)) return true;
  return candidateTimestamp >= currentTimestamp;
}

function normalizeThread(value: unknown): PlatformSupportThread | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const merchantId = normalizeText(record.merchantId);
  if (!merchantId) return null;
  const messageMap = new Map<string, PlatformSupportMessage>();
  if (Array.isArray(record.messages)) {
    record.messages
      .map((item, index) => normalizeMessage(item, index))
      .filter((item): item is PlatformSupportMessage => !!item)
      .forEach((message) => {
        if (!messageMap.has(message.id)) messageMap.set(message.id, message);
      });
  }
  const messages = sortMessages([...messageMap.values()]);
  const latestMessageAt = messages[messages.length - 1]?.createdAt ?? "";
  const updatedAt =
    selectLatestIsoTimestamp(normalizeIsoString(record.updatedAt), latestMessageAt) || new Date(0).toISOString();
  return {
    merchantId,
    siteId: normalizeText(record.siteId) || merchantId,
    merchantName: normalizeText(record.merchantName),
    merchantEmail: normalizeText(record.merchantEmail).toLowerCase(),
    updatedAt,
    messages,
  };
}

export function sortSupportThreads(threads: PlatformSupportThread[]) {
  return [...threads].sort((left, right) => {
    const leftTs = new Date(left.updatedAt).getTime();
    const rightTs = new Date(right.updatedAt).getTime();
    if (leftTs !== rightTs) return rightTs - leftTs;
    return left.merchantId.localeCompare(right.merchantId, "en");
  });
}

export function normalizePlatformSupportInboxPayload(value: unknown): PlatformSupportInboxPayload {
  const normalizedThreads = Array.isArray((value as { threads?: unknown } | null | undefined)?.threads)
    ? (value as { threads: unknown[] }).threads
        .map((item) => normalizeThread(item))
        .filter((item): item is PlatformSupportThread => !!item)
    : [];
  const threadMap = new Map<string, PlatformSupportThread>();
  normalizedThreads.forEach((thread) => {
    const current = threadMap.get(thread.merchantId);
    if (!current) {
      threadMap.set(thread.merchantId, thread);
      return;
    }
    const messageMap = new Map(current.messages.map((message) => [message.id, message]));
    thread.messages.forEach((message) => {
      if (!messageMap.has(message.id)) messageMap.set(message.id, message);
    });
    const messages = sortMessages([...messageMap.values()]);
    const candidateIsCurrent = isSameOrLaterIsoTimestamp(thread.updatedAt, current.updatedAt);
    const preferred = candidateIsCurrent ? thread : current;
    const fallback = candidateIsCurrent ? current : thread;
    threadMap.set(thread.merchantId, {
      ...current,
      siteId: preferred.siteId || fallback.siteId,
      merchantName: preferred.merchantName || fallback.merchantName,
      merchantEmail: preferred.merchantEmail || fallback.merchantEmail,
      updatedAt:
        messages[messages.length - 1]?.createdAt || selectLatestIsoTimestamp(current.updatedAt, thread.updatedAt),
      messages,
    });
  });
  return {
    threads: sortSupportThreads([...threadMap.values()]),
  };
}

export function mergePlatformSupportInboxPayloads(
  current: PlatformSupportInboxPayload,
  incoming: PlatformSupportInboxPayload,
) {
  return normalizePlatformSupportInboxPayload({
    threads: [...current.threads, ...incoming.threads],
  });
}

export function buildPlatformSupportInboxBlocks(payload: PlatformSupportInboxPayload) {
  return [
    {
      id: PLATFORM_SUPPORT_INBOX_BLOCK_ID,
      type: "common",
      content: "platform support inbox",
      props: {
        isPlatformSupportInbox: true,
        payload: normalizePlatformSupportInboxPayload(payload),
      },
    },
  ];
}

export function readPlatformSupportInboxFromBlocks(blocks: unknown): PlatformSupportInboxPayload {
  if (!Array.isArray(blocks)) {
    return { threads: [] };
  }
  const matched = (blocks as StoredBlock[]).find((block) => {
    const props = block?.props;
    return !!props && props.isPlatformSupportInbox === true;
  });
  const payload = matched?.props?.payload;
  return normalizePlatformSupportInboxPayload(payload);
}

export function createPlatformSupportMessage(input: {
  sender: SupportMessageSender;
  text: string;
  createdAt?: string;
  id?: string;
}) {
  const createdAt = normalizeIsoString(input.createdAt) || new Date().toISOString();
  const id = normalizeText(input.id) || `${input.sender}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    sender: normalizeSender(input.sender),
    text: normalizeText(input.text),
    createdAt,
  } satisfies PlatformSupportMessage;
}

export function upsertPlatformSupportThread(
  payload: PlatformSupportInboxPayload,
  input: {
    merchantId: string;
    siteId?: string | null;
    merchantName?: string | null;
    merchantEmail?: string | null;
    message?: PlatformSupportMessage | null;
  },
) {
  const merchantId = normalizeText(input.merchantId);
  if (!merchantId) return normalizePlatformSupportInboxPayload(payload);
  const siteId = normalizeText(input.siteId) || merchantId;
  const merchantName = normalizeText(input.merchantName);
  const merchantEmail = normalizeText(input.merchantEmail).toLowerCase();
  const nextThreads = normalizePlatformSupportInboxPayload(payload).threads.map((thread) => ({ ...thread, messages: [...thread.messages] }));
  const existingIndex = nextThreads.findIndex((thread) => thread.merchantId === merchantId);
  const nextMessage = input.message && input.message.text ? input.message : null;

  if (existingIndex >= 0) {
    const current = nextThreads[existingIndex];
    const hasMessage = nextMessage ? current.messages.some((message) => message.id === nextMessage.id) : false;
    const mergedMessages = nextMessage && !hasMessage ? sortMessages([...current.messages, nextMessage]) : current.messages;
    const latestMessageAt = mergedMessages[mergedMessages.length - 1]?.createdAt ?? current.updatedAt;
    nextThreads[existingIndex] = {
      ...current,
      siteId: siteId || current.siteId,
      merchantName: merchantName || current.merchantName,
      merchantEmail: merchantEmail || current.merchantEmail,
      updatedAt: latestMessageAt,
      messages: mergedMessages,
    };
    return {
      threads: sortSupportThreads(nextThreads),
    } satisfies PlatformSupportInboxPayload;
  }

  nextThreads.push({
    merchantId,
    siteId,
    merchantName,
    merchantEmail,
    updatedAt: nextMessage?.createdAt ?? new Date().toISOString(),
    messages: nextMessage ? [nextMessage] : [],
  });
  return {
    threads: sortSupportThreads(nextThreads),
  } satisfies PlatformSupportInboxPayload;
}
