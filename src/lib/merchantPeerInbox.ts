import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import type { MerchantContactVisibility, SiteLocation } from "@/data/platformControlStore";

type StoredBlock = {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown> | null;
};

export type MerchantPeerMessage = {
  id: string;
  senderMerchantId: string;
  text: string;
  createdAt: string;
};

export type MerchantPeerThread = {
  threadKey: string;
  merchantAId: string;
  merchantAName: string;
  merchantAEmail: string;
  merchantBId: string;
  merchantBName: string;
  merchantBEmail: string;
  updatedAt: string;
  messages: MerchantPeerMessage[];
};

export type MerchantPeerContact = {
  ownerMerchantId: string;
  contactMerchantId: string;
  contactName: string;
  contactEmail: string;
  savedAt: string;
};

export type MerchantPeerInboxPayload = {
  contacts: MerchantPeerContact[];
  threads: MerchantPeerThread[];
};

export type MerchantPeerContactSummary = {
  merchantId: string;
  merchantName: string;
  merchantEmail: string;
  accountType?: "merchant" | "personal";
  avatarImageUrl?: string;
  chatAvatarImageUrl?: string;
  signature?: string;
  industry?: string;
  location?: Partial<SiteLocation> | null;
  contactName?: string;
  contactPhone?: string;
  contactCard?: string;
  contactAddress?: string;
  domain?: string;
  domainPrefix?: string;
  domainSuffix?: string;
  merchantCardImageUrl?: string;
  contactVisibility?: MerchantContactVisibility | null;
  chatBusinessCard?: MerchantBusinessCardAsset | null;
  savedAt: string;
  updatedAt: string;
  lastMessage: MerchantPeerMessage | null;
};

const MERCHANT_PEER_INBOX_BLOCK_ID = "merchant-peer-inbox";
export const MERCHANT_PEER_INBOX_SLUG = "__merchant_peer_inbox__";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeIsoString(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeMerchantId(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeMerchantName(value: unknown, merchantId: string) {
  return normalizeText(value) || merchantId;
}

function sortMerchantIds(left: string, right: string) {
  return [left, right].sort((a, b) => a.localeCompare(b, "en")) as [string, string];
}

export function buildMerchantPeerThreadKey(leftMerchantId: string, rightMerchantId: string) {
  const left = normalizeMerchantId(leftMerchantId);
  const right = normalizeMerchantId(rightMerchantId);
  if (!left || !right || left === right) return "";
  const [first, second] = sortMerchantIds(left, right);
  return `${first}::${second}`;
}

function createFallbackMessageId(index: number) {
  return `merchant-peer-message-${index + 1}`;
}

function normalizeMessage(value: unknown, index: number): MerchantPeerMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const senderMerchantId = normalizeMerchantId(record.senderMerchantId);
  const text = normalizeText(record.text);
  if (!senderMerchantId || !text) return null;
  const createdAt = normalizeIsoString(record.createdAt) || new Date(0).toISOString();
  return {
    id: normalizeText(record.id) || createFallbackMessageId(index),
    senderMerchantId,
    text,
    createdAt,
  };
}

function sortMessages(messages: MerchantPeerMessage[]) {
  return [...messages].sort((left, right) => {
    const leftTs = new Date(left.createdAt).getTime();
    const rightTs = new Date(right.createdAt).getTime();
    if (leftTs !== rightTs) return leftTs - rightTs;
    return left.id.localeCompare(right.id, "en");
  });
}

function buildThreadParticipantRecord(input: {
  leftMerchantId: unknown;
  leftMerchantName?: unknown;
  leftMerchantEmail?: unknown;
  rightMerchantId: unknown;
  rightMerchantName?: unknown;
  rightMerchantEmail?: unknown;
}) {
  const leftMerchantId = normalizeMerchantId(input.leftMerchantId);
  const rightMerchantId = normalizeMerchantId(input.rightMerchantId);
  if (!leftMerchantId || !rightMerchantId || leftMerchantId === rightMerchantId) return null;
  const [firstMerchantId, secondMerchantId] = sortMerchantIds(leftMerchantId, rightMerchantId);
  const leftIsFirst = firstMerchantId === leftMerchantId;
  const firstMerchantName = normalizeMerchantName(
    leftIsFirst ? input.leftMerchantName : input.rightMerchantName,
    firstMerchantId,
  );
  const firstMerchantEmail = normalizeEmail(leftIsFirst ? input.leftMerchantEmail : input.rightMerchantEmail);
  const secondMerchantName = normalizeMerchantName(
    leftIsFirst ? input.rightMerchantName : input.leftMerchantName,
    secondMerchantId,
  );
  const secondMerchantEmail = normalizeEmail(leftIsFirst ? input.rightMerchantEmail : input.leftMerchantEmail);
  return {
    threadKey: `${firstMerchantId}::${secondMerchantId}`,
    merchantAId: firstMerchantId,
    merchantAName: firstMerchantName,
    merchantAEmail: firstMerchantEmail,
    merchantBId: secondMerchantId,
    merchantBName: secondMerchantName,
    merchantBEmail: secondMerchantEmail,
  };
}

function normalizeThread(value: unknown): MerchantPeerThread | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const participants = buildThreadParticipantRecord({
    leftMerchantId: record.merchantAId,
    leftMerchantName: record.merchantAName,
    leftMerchantEmail: record.merchantAEmail,
    rightMerchantId: record.merchantBId,
    rightMerchantName: record.merchantBName,
    rightMerchantEmail: record.merchantBEmail,
  });
  if (!participants) return null;
  const messages = Array.isArray(record.messages)
    ? sortMessages(
        record.messages
          .map((item, index) => normalizeMessage(item, index))
          .filter((item): item is MerchantPeerMessage => !!item),
      )
    : [];
  const latestMessageAt = messages[messages.length - 1]?.createdAt ?? "";
  const updatedAt = normalizeIsoString(record.updatedAt) || latestMessageAt || new Date(0).toISOString();
  return {
    ...participants,
    updatedAt,
    messages,
  };
}

function normalizeContact(value: unknown): MerchantPeerContact | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const ownerMerchantId = normalizeMerchantId(record.ownerMerchantId);
  const contactMerchantId = normalizeMerchantId(record.contactMerchantId);
  if (!ownerMerchantId || !contactMerchantId || ownerMerchantId === contactMerchantId) return null;
  return {
    ownerMerchantId,
    contactMerchantId,
    contactName: normalizeMerchantName(record.contactName, contactMerchantId),
    contactEmail: normalizeEmail(record.contactEmail),
    savedAt: normalizeIsoString(record.savedAt) || new Date(0).toISOString(),
  };
}

function sortThreads(threads: MerchantPeerThread[]) {
  return [...threads].sort((left, right) => {
    const leftTs = new Date(left.updatedAt).getTime();
    const rightTs = new Date(right.updatedAt).getTime();
    if (leftTs !== rightTs) return rightTs - leftTs;
    return left.threadKey.localeCompare(right.threadKey, "en");
  });
}

function sortContacts(contacts: MerchantPeerContact[]) {
  return [...contacts].sort((left, right) => {
    const leftTs = new Date(left.savedAt).getTime();
    const rightTs = new Date(right.savedAt).getTime();
    if (leftTs !== rightTs) return rightTs - leftTs;
    if (left.ownerMerchantId !== right.ownerMerchantId) {
      return left.ownerMerchantId.localeCompare(right.ownerMerchantId, "en");
    }
    return left.contactMerchantId.localeCompare(right.contactMerchantId, "en");
  });
}

export function normalizeMerchantPeerInboxPayload(value: unknown): MerchantPeerInboxPayload {
  const contacts = Array.isArray((value as { contacts?: unknown } | null | undefined)?.contacts)
    ? (value as { contacts: unknown[] }).contacts
        .map((item) => normalizeContact(item))
        .filter((item): item is MerchantPeerContact => !!item)
    : [];
  const threads = Array.isArray((value as { threads?: unknown } | null | undefined)?.threads)
    ? (value as { threads: unknown[] }).threads
        .map((item) => normalizeThread(item))
        .filter((item): item is MerchantPeerThread => !!item)
    : [];
  return {
    contacts: sortContacts(contacts),
    threads: sortThreads(threads),
  };
}

export function buildMerchantPeerInboxBlocks(payload: MerchantPeerInboxPayload) {
  return [
    {
      id: MERCHANT_PEER_INBOX_BLOCK_ID,
      type: "common",
      content: "merchant peer inbox",
      props: {
        isMerchantPeerInbox: true,
        payload: normalizeMerchantPeerInboxPayload(payload),
      },
    },
  ];
}

export function readMerchantPeerInboxFromBlocks(blocks: unknown): MerchantPeerInboxPayload {
  if (!Array.isArray(blocks)) {
    return { contacts: [], threads: [] };
  }
  const matched = (blocks as StoredBlock[]).find((block) => {
    const props = block?.props;
    return !!props && props.isMerchantPeerInbox === true;
  });
  return normalizeMerchantPeerInboxPayload(matched?.props?.payload);
}

export function createMerchantPeerMessage(input: {
  senderMerchantId: string;
  text: string;
  createdAt?: string;
  id?: string;
}) {
  const senderMerchantId = normalizeMerchantId(input.senderMerchantId);
  const text = normalizeText(input.text);
  const createdAt = normalizeIsoString(input.createdAt) || new Date().toISOString();
  return {
    id: normalizeText(input.id) || `merchant-peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    senderMerchantId,
    text,
    createdAt,
  } satisfies MerchantPeerMessage;
}

export function upsertMerchantPeerContact(
  payload: MerchantPeerInboxPayload,
  input: {
    ownerMerchantId: string;
    contactMerchantId: string;
    contactName?: string | null;
    contactEmail?: string | null;
    savedAt?: string | null;
  },
) {
  const ownerMerchantId = normalizeMerchantId(input.ownerMerchantId);
  const contactMerchantId = normalizeMerchantId(input.contactMerchantId);
  if (!ownerMerchantId || !contactMerchantId || ownerMerchantId === contactMerchantId) {
    return normalizeMerchantPeerInboxPayload(payload);
  }
  const contactName = normalizeMerchantName(input.contactName, contactMerchantId);
  const contactEmail = normalizeEmail(input.contactEmail);
  const savedAt = normalizeIsoString(input.savedAt) || new Date().toISOString();
  const nextPayload = normalizeMerchantPeerInboxPayload(payload);
  const contacts = nextPayload.contacts.map((contact) => ({ ...contact }));
  const existingIndex = contacts.findIndex(
    (contact) => contact.ownerMerchantId === ownerMerchantId && contact.contactMerchantId === contactMerchantId,
  );
  if (existingIndex >= 0) {
    contacts[existingIndex] = {
      ...contacts[existingIndex],
      contactName: contactName || contacts[existingIndex].contactName,
      contactEmail: contactEmail || contacts[existingIndex].contactEmail,
      savedAt,
    };
    return {
      contacts: sortContacts(contacts),
      threads: nextPayload.threads,
    } satisfies MerchantPeerInboxPayload;
  }
  contacts.push({
    ownerMerchantId,
    contactMerchantId,
    contactName,
    contactEmail,
    savedAt,
  });
  return {
    contacts: sortContacts(contacts),
    threads: nextPayload.threads,
  } satisfies MerchantPeerInboxPayload;
}

export function upsertMerchantPeerMessage(
  payload: MerchantPeerInboxPayload,
  input: {
    senderMerchantId: string;
    senderMerchantName?: string | null;
    senderMerchantEmail?: string | null;
    recipientMerchantId: string;
    recipientMerchantName?: string | null;
    recipientMerchantEmail?: string | null;
    message: MerchantPeerMessage | null;
  },
) {
  const participants = buildThreadParticipantRecord({
    leftMerchantId: input.senderMerchantId,
    leftMerchantName: input.senderMerchantName,
    leftMerchantEmail: input.senderMerchantEmail,
    rightMerchantId: input.recipientMerchantId,
    rightMerchantName: input.recipientMerchantName,
    rightMerchantEmail: input.recipientMerchantEmail,
  });
  const nextMessage = input.message && input.message.text ? input.message : null;
  if (!participants) return normalizeMerchantPeerInboxPayload(payload);

  let nextPayload = upsertMerchantPeerContact(payload, {
    ownerMerchantId: input.senderMerchantId,
    contactMerchantId: input.recipientMerchantId,
    contactName: input.recipientMerchantName,
    contactEmail: input.recipientMerchantEmail,
    savedAt: nextMessage?.createdAt,
  });
  nextPayload = upsertMerchantPeerContact(nextPayload, {
    ownerMerchantId: input.recipientMerchantId,
    contactMerchantId: input.senderMerchantId,
    contactName: input.senderMerchantName,
    contactEmail: input.senderMerchantEmail,
    savedAt: nextMessage?.createdAt,
  });

  const threads = nextPayload.threads.map((thread) => ({ ...thread, messages: [...thread.messages] }));
  const existingIndex = threads.findIndex((thread) => thread.threadKey === participants.threadKey);
  if (existingIndex >= 0) {
    const current = threads[existingIndex];
    const mergedMessages = nextMessage ? sortMessages([...current.messages, nextMessage]) : current.messages;
    const latestMessageAt = mergedMessages[mergedMessages.length - 1]?.createdAt ?? current.updatedAt;
    threads[existingIndex] = {
      ...current,
      merchantAName: participants.merchantAName || current.merchantAName,
      merchantAEmail: participants.merchantAEmail || current.merchantAEmail,
      merchantBName: participants.merchantBName || current.merchantBName,
      merchantBEmail: participants.merchantBEmail || current.merchantBEmail,
      updatedAt: latestMessageAt,
      messages: mergedMessages,
    };
    return {
      contacts: nextPayload.contacts,
      threads: sortThreads(threads),
    } satisfies MerchantPeerInboxPayload;
  }

  threads.push({
    ...participants,
    updatedAt: nextMessage?.createdAt ?? new Date().toISOString(),
    messages: nextMessage ? [nextMessage] : [],
  });
  return {
    contacts: nextPayload.contacts,
    threads: sortThreads(threads),
  } satisfies MerchantPeerInboxPayload;
}

export function listMerchantPeerThreadsForMerchant(payload: MerchantPeerInboxPayload, merchantId: string) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) return [];
  return normalizeMerchantPeerInboxPayload(payload).threads.filter(
    (thread) => thread.merchantAId === normalizedMerchantId || thread.merchantBId === normalizedMerchantId,
  );
}

export function findMerchantPeerThreadForMerchants(
  payload: MerchantPeerInboxPayload,
  leftMerchantId: string,
  rightMerchantId: string,
) {
  const threadKey = buildMerchantPeerThreadKey(leftMerchantId, rightMerchantId);
  if (!threadKey) return null;
  return normalizeMerchantPeerInboxPayload(payload).threads.find((thread) => thread.threadKey === threadKey) ?? null;
}

export function listMerchantPeerContactsForMerchant(payload: MerchantPeerInboxPayload, ownerMerchantId: string) {
  const normalizedOwnerMerchantId = normalizeMerchantId(ownerMerchantId);
  if (!normalizedOwnerMerchantId) return [];
  const normalizedPayload = normalizeMerchantPeerInboxPayload(payload);
  const contactMap = new Map<string, MerchantPeerContactSummary>();

  normalizedPayload.contacts
    .filter((contact) => contact.ownerMerchantId === normalizedOwnerMerchantId)
    .forEach((contact) => {
      contactMap.set(contact.contactMerchantId, {
        merchantId: contact.contactMerchantId,
        merchantName: contact.contactName || contact.contactMerchantId,
        merchantEmail: contact.contactEmail,
        savedAt: contact.savedAt,
        updatedAt: "",
        lastMessage: null,
      });
    });

  normalizedPayload.threads.forEach((thread) => {
    let contactMerchantId = "";
    let contactMerchantName = "";
    let contactMerchantEmail = "";
    if (thread.merchantAId === normalizedOwnerMerchantId) {
      contactMerchantId = thread.merchantBId;
      contactMerchantName = thread.merchantBName;
      contactMerchantEmail = thread.merchantBEmail;
    } else if (thread.merchantBId === normalizedOwnerMerchantId) {
      contactMerchantId = thread.merchantAId;
      contactMerchantName = thread.merchantAName;
      contactMerchantEmail = thread.merchantAEmail;
    }
    if (!contactMerchantId) return;
    const latestMessage = thread.messages[thread.messages.length - 1] ?? null;
    const current = contactMap.get(contactMerchantId);
    contactMap.set(contactMerchantId, {
      merchantId: contactMerchantId,
      merchantName: current?.merchantName || contactMerchantName || contactMerchantId,
      merchantEmail: current?.merchantEmail || contactMerchantEmail,
      savedAt: current?.savedAt || thread.updatedAt,
      updatedAt: thread.updatedAt,
      lastMessage: latestMessage,
    });
  });

  return [...contactMap.values()].sort((left, right) => {
    const leftTs = new Date(left.updatedAt || left.savedAt).getTime();
    const rightTs = new Date(right.updatedAt || right.savedAt).getTime();
    if (leftTs !== rightTs) return rightTs - leftTs;
    return left.merchantId.localeCompare(right.merchantId, "en");
  });
}
