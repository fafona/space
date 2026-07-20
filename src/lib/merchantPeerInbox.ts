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

function selectParticipantName(current: string, candidate: string, merchantId: string) {
  if (candidate && candidate !== merchantId) return candidate;
  if (current) return current;
  return candidate || merchantId;
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
  const messageMap = new Map<string, MerchantPeerMessage>();
  if (Array.isArray(record.messages)) {
    record.messages
      .map((item, index) => normalizeMessage(item, index))
      .filter(
        (item): item is MerchantPeerMessage =>
          !!item &&
          (item.senderMerchantId === participants.merchantAId || item.senderMerchantId === participants.merchantBId),
      )
      .forEach((message) => {
        if (!messageMap.has(message.id)) messageMap.set(message.id, message);
      });
  }
  const messages = sortMessages([...messageMap.values()]);
  const latestMessageAt = messages[messages.length - 1]?.createdAt ?? "";
  const updatedAt =
    selectLatestIsoTimestamp(normalizeIsoString(record.updatedAt), latestMessageAt) || new Date(0).toISOString();
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
  const normalizedContacts = Array.isArray((value as { contacts?: unknown } | null | undefined)?.contacts)
    ? (value as { contacts: unknown[] }).contacts
        .map((item) => normalizeContact(item))
        .filter((item): item is MerchantPeerContact => !!item)
    : [];
  const contactMap = new Map<string, MerchantPeerContact>();
  normalizedContacts.forEach((contact) => {
    const key = `${contact.ownerMerchantId}::${contact.contactMerchantId}`;
    const current = contactMap.get(key);
    if (!current) {
      contactMap.set(key, contact);
      return;
    }
    const candidateIsCurrent = isSameOrLaterIsoTimestamp(contact.savedAt, current.savedAt);
    const preferred = candidateIsCurrent ? contact : current;
    const fallback = candidateIsCurrent ? current : contact;
    contactMap.set(key, {
      ...current,
      contactName: selectParticipantName(fallback.contactName, preferred.contactName, contact.contactMerchantId),
      contactEmail: preferred.contactEmail || fallback.contactEmail,
      savedAt: selectLatestIsoTimestamp(current.savedAt, contact.savedAt),
    });
  });

  const normalizedThreads = Array.isArray((value as { threads?: unknown } | null | undefined)?.threads)
    ? (value as { threads: unknown[] }).threads
        .map((item) => normalizeThread(item))
        .filter((item): item is MerchantPeerThread => !!item)
    : [];
  const threadMap = new Map<string, MerchantPeerThread>();
  normalizedThreads.forEach((thread) => {
    const current = threadMap.get(thread.threadKey);
    if (!current) {
      threadMap.set(thread.threadKey, thread);
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
    threadMap.set(thread.threadKey, {
      ...current,
      merchantAName: selectParticipantName(fallback.merchantAName, preferred.merchantAName, thread.merchantAId),
      merchantAEmail: preferred.merchantAEmail || fallback.merchantAEmail,
      merchantBName: selectParticipantName(fallback.merchantBName, preferred.merchantBName, thread.merchantBId),
      merchantBEmail: preferred.merchantBEmail || fallback.merchantBEmail,
      updatedAt:
        messages[messages.length - 1]?.createdAt || selectLatestIsoTimestamp(current.updatedAt, thread.updatedAt),
      messages,
    });
  });
  return {
    contacts: sortContacts([...contactMap.values()]),
    threads: sortThreads([...threadMap.values()]),
  };
}

export function mergeMerchantPeerInboxPayloads(
  current: MerchantPeerInboxPayload,
  incoming: MerchantPeerInboxPayload,
) {
  return normalizeMerchantPeerInboxPayload({
    contacts: [...current.contacts, ...incoming.contacts],
    threads: [...current.threads, ...incoming.threads],
  });
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
  const providedContactName = normalizeText(input.contactName);
  const contactName = providedContactName || contactMerchantId;
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
      contactName: providedContactName || contacts[existingIndex].contactName,
      contactEmail: contactEmail || contacts[existingIndex].contactEmail,
      savedAt: selectLatestIsoTimestamp(contacts[existingIndex].savedAt, savedAt),
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
    const hasMessage = nextMessage ? current.messages.some((message) => message.id === nextMessage.id) : false;
    const mergedMessages = nextMessage && !hasMessage ? sortMessages([...current.messages, nextMessage]) : current.messages;
    const latestMessageAt = mergedMessages[mergedMessages.length - 1]?.createdAt ?? current.updatedAt;
    const senderMerchantId = normalizeMerchantId(input.senderMerchantId);
    const senderMerchantName = normalizeText(input.senderMerchantName);
    const recipientMerchantName = normalizeText(input.recipientMerchantName);
    const participantAName = participants.merchantAId === senderMerchantId ? senderMerchantName : recipientMerchantName;
    const participantBName = participants.merchantBId === senderMerchantId ? senderMerchantName : recipientMerchantName;
    threads[existingIndex] = {
      ...current,
      merchantAName: participantAName || current.merchantAName,
      merchantAEmail: participants.merchantAEmail || current.merchantAEmail,
      merchantBName: participantBName || current.merchantBName,
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
