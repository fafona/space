import {
  buildMerchantPeerThreadKey,
  normalizeMerchantPeerInboxPayload,
  type MerchantPeerInboxPayload,
} from "@/lib/merchantPeerInbox";
import {
  normalizeMerchantSupportReadStatePayload,
  type MerchantSupportReadStatePayload,
} from "@/lib/merchantSupportReadState";
import {
  normalizePlatformSupportInboxPayload,
  type PlatformSupportInboxPayload,
} from "@/lib/platformSupportInbox";
import {
  buildMerchantConversationReadStateV1Mutation,
  buildMerchantPeerConversationV1Mutation,
  buildPlatformSupportConversationV1Mutation,
  countMerchantConversationV1MutationRecords,
  mergeMerchantConversationV1Mutations,
  sortMerchantConversationV1Mutation,
  type MerchantConversationV1Mutation,
} from "@/lib/merchantConversationsV1";

export const MERCHANT_CONVERSATION_BACKFILL_DEFAULT_BATCH_SIZE = 10;
export const MERCHANT_CONVERSATION_BACKFILL_MAX_BATCH_SIZE = 50;

export type MerchantConversationBackfillBlocker = {
  code:
    | "invalid_account_id"
    | "invalid_peer_identity"
    | "invalid_peer_thread_key"
    | "duplicate_thread_id"
    | "missing_message_id"
    | "duplicate_message_id"
    | "invalid_message_sender"
    | "missing_message_body"
    | "invalid_message_at"
    | "invalid_thread_updated_at"
    | "invalid_contact_identity"
    | "duplicate_contact"
    | "invalid_contact_saved_at"
    | "support_account_mismatch"
    | "support_site_mismatch"
    | "invalid_read_state_account"
    | "duplicate_read_state_account"
    | "invalid_read_cursor_at"
    | "read_cursor_thread_not_found"
    | "read_cursor_message_not_found";
  recordId: string;
};

export type MerchantConversationBackfillPlan = {
  accountId: string;
  batchSize: number;
  threadCount: number;
  participantCount: number;
  messageCount: number;
  contactCount: number;
  readCursorCount: number;
  batches: MerchantConversationV1Mutation[];
  expected: MerchantConversationV1Mutation;
  blockers: MerchantConversationBackfillBlocker[];
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isAccountId(value: unknown) {
  return /^\d{8}$/.test(trimText(value));
}

function normalizeIso(value: unknown) {
  const text = trimText(value);
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function normalizeMerchantConversationBackfillBatchSize(
  value: unknown,
) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return MERCHANT_CONVERSATION_BACKFILL_DEFAULT_BATCH_SIZE;
  }
  return Math.min(
    MERCHANT_CONVERSATION_BACKFILL_MAX_BATCH_SIZE,
    Math.max(1, parsed),
  );
}

function pushBlocker(
  blockers: MerchantConversationBackfillBlocker[],
  recordId: string,
  code: MerchantConversationBackfillBlocker["code"],
) {
  if (
    blockers.some(
      (blocker) => blocker.recordId === recordId && blocker.code === code,
    )
  ) {
    return;
  }
  blockers.push({ recordId, code });
}

function validatePeerInbox(
  accountId: string,
  payload: MerchantPeerInboxPayload,
  blockers: MerchantConversationBackfillBlocker[],
) {
  const threadIds = new Set<string>();
  for (const thread of Array.isArray(payload?.threads) ? payload.threads : []) {
    const leftId = trimText(thread?.merchantAId);
    const rightId = trimText(thread?.merchantBId);
    const relevant = leftId === accountId || rightId === accountId;
    if (!relevant) continue;
    const recordId =
      trimText(thread?.threadKey) || `${leftId || "?"}::${rightId || "?"}`;
    if (!isAccountId(leftId) || !isAccountId(rightId) || leftId === rightId) {
      pushBlocker(blockers, recordId, "invalid_peer_identity");
    }
    const expectedKey = buildMerchantPeerThreadKey(leftId, rightId);
    if (!expectedKey || trimText(thread?.threadKey) !== expectedKey) {
      pushBlocker(blockers, recordId, "invalid_peer_thread_key");
    }
    const threadId = `peer:${expectedKey || recordId}`;
    if (threadIds.has(threadId)) {
      pushBlocker(blockers, threadId, "duplicate_thread_id");
    }
    threadIds.add(threadId);
    if (!normalizeIso(thread?.updatedAt)) {
      pushBlocker(blockers, threadId, "invalid_thread_updated_at");
    }

    const messageIds = new Set<string>();
    for (const message of Array.isArray(thread?.messages)
      ? thread.messages
      : []) {
      const messageId = trimText(message?.id);
      const messageRecordId = `${threadId}:${messageId || "missing"}`;
      if (!messageId) {
        pushBlocker(blockers, messageRecordId, "missing_message_id");
      } else if (messageIds.has(messageId)) {
        pushBlocker(blockers, messageRecordId, "duplicate_message_id");
      }
      if (messageId) messageIds.add(messageId);
      if (
        trimText(message?.senderMerchantId) !== leftId &&
        trimText(message?.senderMerchantId) !== rightId
      ) {
        pushBlocker(blockers, messageRecordId, "invalid_message_sender");
      }
      if (!trimText(message?.text)) {
        pushBlocker(blockers, messageRecordId, "missing_message_body");
      }
      if (!normalizeIso(message?.createdAt)) {
        pushBlocker(blockers, messageRecordId, "invalid_message_at");
      }
    }
  }

  const contactIds = new Set<string>();
  for (const contact of Array.isArray(payload?.contacts)
    ? payload.contacts
    : []) {
    if (trimText(contact?.ownerMerchantId) !== accountId) continue;
    const contactAccountId = trimText(contact?.contactMerchantId);
    const recordId = `${accountId}:${contactAccountId || "missing"}`;
    if (
      !isAccountId(contactAccountId) ||
      contactAccountId === accountId
    ) {
      pushBlocker(blockers, recordId, "invalid_contact_identity");
    }
    if (contactIds.has(recordId)) {
      pushBlocker(blockers, recordId, "duplicate_contact");
    }
    contactIds.add(recordId);
    if (!normalizeIso(contact?.savedAt)) {
      pushBlocker(blockers, recordId, "invalid_contact_saved_at");
    }
  }
}

function validateSupportInbox(
  accountId: string,
  payload: PlatformSupportInboxPayload,
  blockers: MerchantConversationBackfillBlocker[],
) {
  const threadIds = new Set<string>();
  for (const thread of Array.isArray(payload?.threads) ? payload.threads : []) {
    const merchantId = trimText(thread?.merchantId);
    const siteId = trimText(thread?.siteId);
    if (merchantId !== accountId && siteId !== accountId) continue;
    const recordId = `support:${merchantId || "missing"}`;
    if (merchantId !== accountId || !isAccountId(merchantId)) {
      pushBlocker(blockers, recordId, "support_account_mismatch");
    }
    if (siteId !== accountId || !isAccountId(siteId)) {
      pushBlocker(blockers, recordId, "support_site_mismatch");
    }
    if (threadIds.has(recordId)) {
      pushBlocker(blockers, recordId, "duplicate_thread_id");
    }
    threadIds.add(recordId);
    if (!normalizeIso(thread?.updatedAt)) {
      pushBlocker(blockers, recordId, "invalid_thread_updated_at");
    }
    const messageIds = new Set<string>();
    for (const message of Array.isArray(thread?.messages)
      ? thread.messages
      : []) {
      const messageId = trimText(message?.id);
      const messageRecordId = `${recordId}:${messageId || "missing"}`;
      if (!messageId) {
        pushBlocker(blockers, messageRecordId, "missing_message_id");
      } else if (messageIds.has(messageId)) {
        pushBlocker(blockers, messageRecordId, "duplicate_message_id");
      }
      if (messageId) messageIds.add(messageId);
      if (
        message?.sender !== "merchant" &&
        message?.sender !== "super_admin"
      ) {
        pushBlocker(blockers, messageRecordId, "invalid_message_sender");
      }
      if (!trimText(message?.text)) {
        pushBlocker(blockers, messageRecordId, "missing_message_body");
      }
      if (!normalizeIso(message?.createdAt)) {
        pushBlocker(blockers, messageRecordId, "invalid_message_at");
      }
    }
  }
}

function validateReadState(
  accountId: string,
  peerInbox: MerchantPeerInboxPayload,
  supportInbox: PlatformSupportInboxPayload,
  readState: MerchantSupportReadStatePayload,
  blockers: MerchantConversationBackfillBlocker[],
) {
  const normalizedPeer = normalizeMerchantPeerInboxPayload(peerInbox);
  const normalizedSupport = normalizePlatformSupportInboxPayload(supportInbox);
  const officialIncomingTimes = new Set(
    normalizedSupport.threads
      .filter((thread) => thread.merchantId === accountId)
      .flatMap((thread) =>
        thread.messages
          .filter((message) => message.sender === "super_admin")
          .map((message) => normalizeIso(message.createdAt)),
      )
      .filter(Boolean),
  );
  const peerIncomingTimes = new Map<string, Set<string>>();
  for (const thread of normalizedPeer.threads) {
    if (
      thread.merchantAId !== accountId &&
      thread.merchantBId !== accountId
    ) {
      continue;
    }
    const peerId =
      thread.merchantAId === accountId
        ? thread.merchantBId
        : thread.merchantAId;
    peerIncomingTimes.set(
      peerId,
      new Set(
        thread.messages
          .filter((message) => message.senderMerchantId === peerId)
          .map((message) => normalizeIso(message.createdAt))
          .filter(Boolean),
      ),
    );
  }

  const rawAccountIds = new Set<string>();
  for (const entry of Array.isArray(readState?.accounts)
    ? readState.accounts
    : []) {
    if (trimText(entry?.accountId) !== accountId) continue;
    const recordId = `read:${accountId}`;
    if (!isAccountId(entry?.accountId)) {
      pushBlocker(blockers, recordId, "invalid_read_state_account");
    }
    if (rawAccountIds.has(accountId)) {
      pushBlocker(blockers, recordId, "duplicate_read_state_account");
    }
    rawAccountIds.add(accountId);
  }

  const normalizedReadState =
    normalizeMerchantSupportReadStatePayload(readState);
  const entry = normalizedReadState.accounts.find(
    (candidate) => candidate.accountId === accountId,
  );
  if (!entry) return;
  if (entry.officialLastReadAt) {
    const lastReadAt = normalizeIso(entry.officialLastReadAt);
    const recordId = `support:${accountId}:${accountId}`;
    if (!lastReadAt) {
      pushBlocker(blockers, recordId, "invalid_read_cursor_at");
    } else if (
      !normalizedSupport.threads.some(
        (thread) => thread.merchantId === accountId,
      )
    ) {
      pushBlocker(blockers, recordId, "read_cursor_thread_not_found");
    } else if (!officialIncomingTimes.has(lastReadAt)) {
      pushBlocker(blockers, recordId, "read_cursor_message_not_found");
    }
  }
  for (const [peerId, value] of Object.entries(entry.peerLastRead)) {
    const recordId = `peer:${accountId}:${peerId}`;
    const lastReadAt = normalizeIso(value);
    if (!isAccountId(peerId)) {
      pushBlocker(blockers, recordId, "invalid_read_state_account");
    }
    if (!lastReadAt) {
      pushBlocker(blockers, recordId, "invalid_read_cursor_at");
    } else if (!peerIncomingTimes.has(peerId)) {
      pushBlocker(blockers, recordId, "read_cursor_thread_not_found");
    } else if (!peerIncomingTimes.get(peerId)?.has(lastReadAt)) {
      pushBlocker(blockers, recordId, "read_cursor_message_not_found");
    }
  }
}

function buildBatches(
  mutation: MerchantConversationV1Mutation,
  batchSize: number,
) {
  const batches: MerchantConversationV1Mutation[] = [];
  for (let index = 0; index < mutation.threads.length; index += batchSize) {
    batches.push({
      threads: mutation.threads.slice(index, index + batchSize),
      contacts: [],
      read_cursors: [],
      archived_threads: [],
    });
  }
  if (batches.length === 0) {
    if (
      mutation.contacts.length > 0 ||
      mutation.read_cursors.length > 0 ||
      mutation.archived_threads.length > 0
    ) {
      batches.push({
        threads: [],
        contacts: mutation.contacts,
        read_cursors: mutation.read_cursors,
        archived_threads: mutation.archived_threads,
      });
    }
    return batches;
  }
  batches[0] = {
    ...batches[0],
    contacts: mutation.contacts,
  };
  const lastIndex = batches.length - 1;
  batches[lastIndex] = {
    ...batches[lastIndex],
    read_cursors: mutation.read_cursors,
    archived_threads: mutation.archived_threads,
  };
  return batches.map(sortMerchantConversationV1Mutation);
}

export function buildMerchantConversationBackfillPlan(input: {
  accountId: string;
  peerInbox: MerchantPeerInboxPayload;
  supportInbox: PlatformSupportInboxPayload;
  readState: MerchantSupportReadStatePayload;
  batchSize?: unknown;
}): MerchantConversationBackfillPlan {
  const accountId = trimText(input.accountId);
  const batchSize = normalizeMerchantConversationBackfillBatchSize(
    input.batchSize,
  );
  const blockers: MerchantConversationBackfillBlocker[] = [];
  if (!isAccountId(accountId)) {
    pushBlocker(blockers, accountId || "missing", "invalid_account_id");
  }

  validatePeerInbox(accountId, input.peerInbox, blockers);
  validateSupportInbox(accountId, input.supportInbox, blockers);
  validateReadState(
    accountId,
    input.peerInbox,
    input.supportInbox,
    input.readState,
    blockers,
  );

  const expected = mergeMerchantConversationV1Mutations(
    buildMerchantPeerConversationV1Mutation({
      current: input.peerInbox,
      accountIds: [accountId],
    }),
    buildPlatformSupportConversationV1Mutation({
      current: input.supportInbox,
      accountIds: [accountId],
    }),
    buildMerchantConversationReadStateV1Mutation({
      current: input.readState,
      accountIds: [accountId],
    }),
  );
  const threadIds = new Set(expected.threads.map((item) => item.thread.id));
  const participantIds = new Map(
    expected.threads.map((item) => [
      item.thread.id,
      new Set(item.participants.map((participant) => participant.account_id)),
    ]),
  );
  for (const cursor of expected.read_cursors) {
    if (!threadIds.has(cursor.thread_id)) {
      pushBlocker(
        blockers,
        `${cursor.thread_id}:${cursor.account_id}`,
        "read_cursor_thread_not_found",
      );
    } else if (!participantIds.get(cursor.thread_id)?.has(cursor.account_id)) {
      pushBlocker(
        blockers,
        `${cursor.thread_id}:${cursor.account_id}`,
        "invalid_read_state_account",
      );
    }
  }

  blockers.sort((left, right) => {
    const record = left.recordId.localeCompare(right.recordId, "en");
    return record || left.code.localeCompare(right.code, "en");
  });
  const counts = countMerchantConversationV1MutationRecords(expected);
  return {
    accountId,
    batchSize,
    threadCount: counts.threads,
    participantCount: counts.participants,
    messageCount: counts.messages,
    contactCount: counts.contacts,
    readCursorCount: counts.readCursors,
    batches: buildBatches(expected, batchSize),
    expected,
    blockers,
  };
}
