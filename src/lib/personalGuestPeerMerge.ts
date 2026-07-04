import {
  createMerchantPeerMessage,
  normalizeMerchantPeerInboxPayload,
  upsertMerchantPeerContact,
  upsertMerchantPeerMessage,
  type MerchantPeerInboxPayload,
} from "@/lib/merchantPeerInbox";

type GuestPeerContactInput = {
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  savedAt: string;
};

type GuestPeerMessageInput = {
  id: string;
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  text: string;
  createdAt: string;
};

export type PersonalGuestPeerMergeResult = {
  payload: MerchantPeerInboxPayload;
  contactCount: number;
  messageCount: number;
  skippedContactCount: number;
  skippedThreadCount: number;
  skippedMessageCount: number;
};

function trimText(value: unknown, maxLength = 2000) {
  if (typeof value === "string") return value.trim().slice(0, maxLength);
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, maxLength);
  return "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeMerchantId(value: unknown) {
  const normalized = trimText(value, 32);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeEmail(value: unknown) {
  return trimText(value, 320).toLowerCase();
}

function normalizeIsoString(value: unknown) {
  const normalized = trimText(value, 80);
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeGuestPeerContacts(value: unknown, guestAccountId: string, targetAccountId: string) {
  const contacts: GuestPeerContactInput[] = [];
  let skippedContactCount = 0;
  const seen = new Set<string>();
  if (!Array.isArray(value)) return { contacts, skippedContactCount };

  for (const item of value) {
    const record = readRecord(item);
    const recipientId = normalizeMerchantId(record?.merchantId || record?.contactMerchantId);
    if (!recipientId || recipientId === guestAccountId || recipientId === targetAccountId) {
      skippedContactCount += 1;
      continue;
    }
    if (seen.has(recipientId)) continue;
    seen.add(recipientId);
    contacts.push({
      recipientId,
      recipientName: trimText(record?.merchantName || record?.contactName, 160) || recipientId,
      recipientEmail: normalizeEmail(record?.merchantEmail || record?.contactEmail),
      savedAt: normalizeIsoString(record?.savedAt || record?.updatedAt),
    });
    if (contacts.length >= 200) break;
  }

  return { contacts, skippedContactCount };
}

function readThreadRecipient(record: Record<string, unknown>, guestAccountId: string, targetAccountId: string) {
  const merchantAId = normalizeMerchantId(record.merchantAId);
  const merchantBId = normalizeMerchantId(record.merchantBId);
  if (!merchantAId || !merchantBId) return null;

  if (merchantAId === guestAccountId && merchantBId !== targetAccountId) {
    return {
      recipientId: merchantBId,
      recipientName: trimText(record.merchantBName, 160) || merchantBId,
      recipientEmail: normalizeEmail(record.merchantBEmail),
    };
  }
  if (merchantBId === guestAccountId && merchantAId !== targetAccountId) {
    return {
      recipientId: merchantAId,
      recipientName: trimText(record.merchantAName, 160) || merchantAId,
      recipientEmail: normalizeEmail(record.merchantAEmail),
    };
  }
  return null;
}

function normalizeGuestPeerMessages(value: unknown, guestAccountId: string, targetAccountId: string) {
  const messages: GuestPeerMessageInput[] = [];
  let skippedThreadCount = 0;
  let skippedMessageCount = 0;
  const seen = new Set<string>();
  if (!Array.isArray(value)) {
    return { messages, skippedThreadCount, skippedMessageCount };
  }

  for (const item of value) {
    const record = readRecord(item);
    if (!record) {
      skippedThreadCount += 1;
      continue;
    }
    const recipient = readThreadRecipient(record, guestAccountId, targetAccountId);
    if (!recipient) {
      skippedThreadCount += 1;
      continue;
    }
    const sourceMessages = Array.isArray(record.messages) ? record.messages : [];
    for (const messageItem of sourceMessages) {
      const messageRecord = readRecord(messageItem);
      const senderMerchantId = normalizeMerchantId(messageRecord?.senderMerchantId);
      const text = trimText(messageRecord?.text, 5000);
      if (senderMerchantId !== guestAccountId || !text) {
        skippedMessageCount += 1;
        continue;
      }
      const id =
        trimText(messageRecord?.id, 180) ||
        `${trimText(record.threadKey, 180) || recipient.recipientId}:${messages.length + 1}`;
      const dedupeKey = `${recipient.recipientId}:${id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      messages.push({
        id,
        recipientId: recipient.recipientId,
        recipientName: recipient.recipientName,
        recipientEmail: recipient.recipientEmail,
        text,
        createdAt: normalizeIsoString(messageRecord?.createdAt) || new Date().toISOString(),
      });
      if (messages.length >= 500) break;
    }
    if (messages.length >= 500) break;
  }

  return { messages, skippedThreadCount, skippedMessageCount };
}

export function mergePersonalGuestPeerDataIntoMerchantPeerInbox(
  payload: MerchantPeerInboxPayload,
  input: {
    guestAccountId?: unknown;
    targetAccountId?: unknown;
    targetName?: unknown;
    targetEmail?: unknown;
    guestHash?: unknown;
    peerContacts?: unknown;
    peerThreads?: unknown;
  },
): PersonalGuestPeerMergeResult {
  const guestAccountId = normalizeMerchantId(input.guestAccountId);
  const targetAccountId = normalizeMerchantId(input.targetAccountId);
  const normalizedPayload = normalizeMerchantPeerInboxPayload(payload);
  if (!guestAccountId || !targetAccountId || guestAccountId === targetAccountId) {
    const contactCount = Array.isArray(input.peerContacts) ? input.peerContacts.length : 0;
    const threadCount = Array.isArray(input.peerThreads) ? input.peerThreads.length : 0;
    return {
      payload: normalizedPayload,
      contactCount: 0,
      messageCount: 0,
      skippedContactCount: contactCount,
      skippedThreadCount: threadCount,
      skippedMessageCount: 0,
    };
  }

  const { contacts, skippedContactCount } = normalizeGuestPeerContacts(
    input.peerContacts,
    guestAccountId,
    targetAccountId,
  );
  const { messages, skippedThreadCount, skippedMessageCount } = normalizeGuestPeerMessages(
    input.peerThreads,
    guestAccountId,
    targetAccountId,
  );
  const targetName = trimText(input.targetName, 160) || targetAccountId;
  const targetEmail = normalizeEmail(input.targetEmail);
  const guestHash = trimText(input.guestHash, 160);
  const messageIdPrefix = guestHash ? `guest-peer:${guestHash.slice(0, 24)}:` : "guest-peer:";

  let nextPayload = normalizedPayload;
  const migratedContacts = new Set<string>();
  for (const contact of contacts) {
    nextPayload = upsertMerchantPeerContact(nextPayload, {
      ownerMerchantId: targetAccountId,
      contactMerchantId: contact.recipientId,
      contactName: contact.recipientName,
      contactEmail: contact.recipientEmail,
      savedAt: contact.savedAt,
    });
    migratedContacts.add(contact.recipientId);
  }

  for (const message of messages) {
    if (!migratedContacts.has(message.recipientId)) {
      nextPayload = upsertMerchantPeerContact(nextPayload, {
        ownerMerchantId: targetAccountId,
        contactMerchantId: message.recipientId,
        contactName: message.recipientName,
        contactEmail: message.recipientEmail,
        savedAt: message.createdAt,
      });
      migratedContacts.add(message.recipientId);
    }
    nextPayload = upsertMerchantPeerMessage(nextPayload, {
      senderMerchantId: targetAccountId,
      senderMerchantName: targetName,
      senderMerchantEmail: targetEmail,
      recipientMerchantId: message.recipientId,
      recipientMerchantName: message.recipientName,
      recipientMerchantEmail: message.recipientEmail,
      message: createMerchantPeerMessage({
        id: `${messageIdPrefix}${message.id}`,
        senderMerchantId: targetAccountId,
        text: message.text,
        createdAt: message.createdAt,
      }),
    });
  }

  return {
    payload: nextPayload,
    contactCount: migratedContacts.size,
    messageCount: messages.length,
    skippedContactCount,
    skippedThreadCount,
    skippedMessageCount,
  };
}
