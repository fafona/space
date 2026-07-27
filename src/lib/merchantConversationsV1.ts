import {
  buildMerchantPeerThreadKey,
  normalizeMerchantPeerInboxPayload,
  type MerchantPeerContact,
  type MerchantPeerInboxPayload,
  type MerchantPeerMessage,
  type MerchantPeerThread,
} from "@/lib/merchantPeerInbox";
import {
  normalizeMerchantSupportReadStatePayload,
  type MerchantSupportReadStateEntry,
  type MerchantSupportReadStatePayload,
} from "@/lib/merchantSupportReadState";
import {
  normalizePlatformSupportInboxPayload,
  type PlatformSupportInboxPayload,
  type PlatformSupportMessage,
  type PlatformSupportThread,
} from "@/lib/platformSupportInbox";

export const MERCHANT_CONVERSATION_PLATFORM_ACCOUNT_ID = "faolla-support";

export type MerchantConversationThreadV1Payload = {
  id: string;
  conversation_kind: "peer" | "support";
  state: "active";
  site_id: string | null;
  source_snapshot: Record<string, unknown>;
  source_updated_at: string;
  created_at: string;
  updated_at: string;
};

export type MerchantConversationParticipantV1Payload = {
  thread_id: string;
  account_id: string;
  participant_role: "account" | "platform";
  display_name: string;
  email: string;
  source_snapshot: Record<string, unknown>;
  joined_at: string;
  source_updated_at: string;
};

export type MerchantConversationMessageV1Payload = {
  thread_id: string;
  id: string;
  sender_account_id: string;
  sender_role: "account" | "platform";
  body: string;
  source_snapshot: Record<string, unknown>;
  created_at: string;
  source_updated_at: string;
};

export type MerchantConversationThreadV1Mutation = {
  thread: MerchantConversationThreadV1Payload;
  participants: MerchantConversationParticipantV1Payload[];
  messages: MerchantConversationMessageV1Payload[];
};

export type MerchantConversationContactV1Payload = {
  owner_merchant_id: string;
  contact_account_id: string;
  contact_name: string;
  contact_email: string;
  customer: Record<string, unknown>;
  source_snapshot: Record<string, unknown>;
  saved_at: string;
  source_updated_at: string;
};

export type MerchantConversationReadCursorV1Payload = {
  thread_id: string;
  account_id: string;
  last_read_at: string;
  source_snapshot: Record<string, unknown>;
  source_updated_at: string;
};

export type MerchantConversationArchivedThreadV1Payload = {
  id: string;
  archived_at: string;
};

export type MerchantConversationV1Mutation = {
  threads: MerchantConversationThreadV1Mutation[];
  contacts: MerchantConversationContactV1Payload[];
  read_cursors: MerchantConversationReadCursorV1Payload[];
  archived_threads: MerchantConversationArchivedThreadV1Payload[];
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAccountIds(value: unknown) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((accountId) => trimText(accountId))
        .filter((accountId) => /^\d{8}$/.test(accountId)),
    ),
  ).sort((left, right) => left.localeCompare(right, "en"));
}

function normalizeIsoString(value: unknown, fallback = "") {
  const text = trimText(value);
  const timestamp = Date.parse(text);
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  return fallback;
}

function compareIso(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime)) return -1;
  if (!Number.isFinite(rightTime)) return 1;
  return leftTime - rightTime;
}

function earliestMessageAt(
  messages: Array<{ createdAt: string }>,
  fallback: string,
) {
  return messages.reduce((earliest, message) => {
    const createdAt = normalizeIsoString(message.createdAt);
    if (!createdAt) return earliest;
    if (!earliest || compareIso(createdAt, earliest) < 0) return createdAt;
    return earliest;
  }, normalizeIsoString(fallback));
}

function samePeerMessage(
  left: MerchantPeerMessage | undefined,
  right: MerchantPeerMessage,
) {
  return (
    !!left &&
    left.id === right.id &&
    left.senderMerchantId === right.senderMerchantId &&
    left.text === right.text &&
    normalizeIsoString(left.createdAt) === normalizeIsoString(right.createdAt)
  );
}

function sameSupportMessage(
  left: PlatformSupportMessage | undefined,
  right: PlatformSupportMessage,
) {
  return (
    !!left &&
    left.id === right.id &&
    left.sender === right.sender &&
    left.text === right.text &&
    normalizeIsoString(left.createdAt) === normalizeIsoString(right.createdAt)
  );
}

function samePeerThreadMetadata(
  left: MerchantPeerThread | undefined,
  right: MerchantPeerThread,
) {
  return (
    !!left &&
    left.threadKey === right.threadKey &&
    left.merchantAId === right.merchantAId &&
    left.merchantAName === right.merchantAName &&
    left.merchantAEmail === right.merchantAEmail &&
    left.merchantBId === right.merchantBId &&
    left.merchantBName === right.merchantBName &&
    left.merchantBEmail === right.merchantBEmail &&
    normalizeIsoString(left.updatedAt) === normalizeIsoString(right.updatedAt)
  );
}

function sameSupportThreadMetadata(
  left: PlatformSupportThread | undefined,
  right: PlatformSupportThread,
) {
  return (
    !!left &&
    left.merchantId === right.merchantId &&
    left.siteId === right.siteId &&
    left.merchantName === right.merchantName &&
    left.merchantEmail === right.merchantEmail &&
    normalizeIsoString(left.updatedAt) === normalizeIsoString(right.updatedAt)
  );
}

function samePeerContact(
  left: MerchantPeerContact | undefined,
  right: MerchantPeerContact,
) {
  return (
    !!left &&
    left.ownerMerchantId === right.ownerMerchantId &&
    left.contactMerchantId === right.contactMerchantId &&
    left.contactName === right.contactName &&
    left.contactEmail === right.contactEmail &&
    normalizeIsoString(left.savedAt) === normalizeIsoString(right.savedAt)
  );
}

export function buildMerchantPeerConversationThreadId(
  leftAccountId: string,
  rightAccountId: string,
) {
  const legacyKey = buildMerchantPeerThreadKey(leftAccountId, rightAccountId);
  return legacyKey ? `peer:${legacyKey}` : "";
}

export function buildPlatformSupportConversationThreadId(accountId: string) {
  const normalized = trimText(accountId);
  return /^\d{8}$/.test(normalized) ? `support:${normalized}` : "";
}

function mapPeerMessage(
  threadId: string,
  message: MerchantPeerMessage,
): MerchantConversationMessageV1Payload {
  const createdAt = normalizeIsoString(message.createdAt);
  return {
    thread_id: threadId,
    id: message.id,
    sender_account_id: message.senderMerchantId,
    sender_role: "account",
    body: message.text,
    source_snapshot: {
      source: "merchant-peer-inbox",
      legacy_message_id: message.id,
    },
    created_at: createdAt,
    source_updated_at: createdAt,
  };
}

function mapPeerThread(
  thread: MerchantPeerThread,
  previous: MerchantPeerThread | undefined,
): MerchantConversationThreadV1Mutation | null {
  const threadId = buildMerchantPeerConversationThreadId(
    thread.merchantAId,
    thread.merchantBId,
  );
  if (!threadId) return null;
  const previousMessages = new Map(
    (previous?.messages ?? []).map((message) => [message.id, message]),
  );
  const changedMessages = thread.messages
    .filter(
      (message) =>
        !samePeerMessage(previousMessages.get(message.id), message),
    )
    .map((message) => mapPeerMessage(threadId, message));
  if (previous && samePeerThreadMetadata(previous, thread) && changedMessages.length === 0) {
    return null;
  }
  const updatedAt = normalizeIsoString(thread.updatedAt);
  const joinedAt = earliestMessageAt(thread.messages, updatedAt);
  return {
    thread: {
      id: threadId,
      conversation_kind: "peer",
      state: "active",
      site_id: null,
      source_snapshot: {
        source: "merchant-peer-inbox",
        legacy_thread_key: thread.threadKey,
      },
      source_updated_at: updatedAt,
      created_at: joinedAt,
      updated_at: updatedAt,
    },
    participants: [
      {
        thread_id: threadId,
        account_id: thread.merchantAId,
        participant_role: "account",
        display_name: thread.merchantAName,
        email: thread.merchantAEmail,
        source_snapshot: {
          source: "merchant-peer-inbox",
          legacy_side: "a",
        },
        joined_at: joinedAt,
        source_updated_at: updatedAt,
      },
      {
        thread_id: threadId,
        account_id: thread.merchantBId,
        participant_role: "account",
        display_name: thread.merchantBName,
        email: thread.merchantBEmail,
        source_snapshot: {
          source: "merchant-peer-inbox",
          legacy_side: "b",
        },
        joined_at: joinedAt,
        source_updated_at: updatedAt,
      },
    ],
    messages: changedMessages,
  };
}

function mapPeerContact(
  contact: MerchantPeerContact,
): MerchantConversationContactV1Payload {
  const savedAt = normalizeIsoString(contact.savedAt);
  return {
    owner_merchant_id: contact.ownerMerchantId,
    contact_account_id: contact.contactMerchantId,
    contact_name: contact.contactName,
    contact_email: contact.contactEmail,
    customer: {
      merchant_id: contact.ownerMerchantId,
      account_id: contact.contactMerchantId,
      email: contact.contactEmail || null,
      phone: null,
      display_name: contact.contactName,
      profile: {
        source: "conversation-contact",
      },
      created_at: savedAt,
      updated_at: savedAt,
    },
    source_snapshot: {
      source: "merchant-peer-inbox",
    },
    saved_at: savedAt,
    source_updated_at: savedAt,
  };
}

export function buildMerchantPeerConversationV1Mutation(input: {
  current: MerchantPeerInboxPayload;
  previous?: MerchantPeerInboxPayload | null;
  accountIds: string[];
}): MerchantConversationV1Mutation {
  const accountIds = new Set(normalizeAccountIds(input.accountIds));
  const current = normalizeMerchantPeerInboxPayload(input.current);
  const previous = input.previous
    ? normalizeMerchantPeerInboxPayload(input.previous)
    : null;
  const previousThreads = new Map(
    (previous?.threads ?? []).map((thread) => [thread.threadKey, thread]),
  );
  const previousContacts = new Map(
    (previous?.contacts ?? []).map((contact) => [
      `${contact.ownerMerchantId}:${contact.contactMerchantId}`,
      contact,
    ]),
  );

  const threads = current.threads
    .filter(
      (thread) =>
        accountIds.has(thread.merchantAId) ||
        accountIds.has(thread.merchantBId),
    )
    .map((thread) =>
      mapPeerThread(thread, previousThreads.get(thread.threadKey)),
    )
    .filter(
      (thread): thread is MerchantConversationThreadV1Mutation => !!thread,
    );

  const contacts = current.contacts
    .filter((contact) => accountIds.has(contact.ownerMerchantId))
    .filter(
      (contact) =>
        !samePeerContact(
          previousContacts.get(
            `${contact.ownerMerchantId}:${contact.contactMerchantId}`,
          ),
          contact,
        ),
    )
    .map(mapPeerContact);

  return sortMerchantConversationV1Mutation({
    threads,
    contacts,
    read_cursors: [],
    archived_threads: [],
  });
}

function mapSupportMessage(
  threadId: string,
  merchantId: string,
  message: PlatformSupportMessage,
): MerchantConversationMessageV1Payload {
  const createdAt = normalizeIsoString(message.createdAt);
  const isPlatform = message.sender === "super_admin";
  return {
    thread_id: threadId,
    id: message.id,
    sender_account_id: isPlatform
      ? MERCHANT_CONVERSATION_PLATFORM_ACCOUNT_ID
      : merchantId,
    sender_role: isPlatform ? "platform" : "account",
    body: message.text,
    source_snapshot: {
      source: "platform-support-inbox",
      legacy_message_id: message.id,
      legacy_sender: message.sender,
    },
    created_at: createdAt,
    source_updated_at: createdAt,
  };
}

function mapSupportThread(
  thread: PlatformSupportThread,
  previous: PlatformSupportThread | undefined,
): MerchantConversationThreadV1Mutation | null {
  const threadId = buildPlatformSupportConversationThreadId(thread.merchantId);
  if (!threadId) return null;
  const previousMessages = new Map(
    (previous?.messages ?? []).map((message) => [message.id, message]),
  );
  const changedMessages = thread.messages
    .filter(
      (message) =>
        !sameSupportMessage(previousMessages.get(message.id), message),
    )
    .map((message) => mapSupportMessage(threadId, thread.merchantId, message));
  if (
    previous &&
    sameSupportThreadMetadata(previous, thread) &&
    changedMessages.length === 0
  ) {
    return null;
  }
  const updatedAt = normalizeIsoString(thread.updatedAt);
  const joinedAt = earliestMessageAt(thread.messages, updatedAt);
  return {
    thread: {
      id: threadId,
      conversation_kind: "support",
      state: "active",
      site_id: thread.siteId || thread.merchantId,
      source_snapshot: {
        source: "platform-support-inbox",
        legacy_merchant_id: thread.merchantId,
      },
      source_updated_at: updatedAt,
      created_at: joinedAt,
      updated_at: updatedAt,
    },
    participants: [
      {
        thread_id: threadId,
        account_id: thread.merchantId,
        participant_role: "account",
        display_name: thread.merchantName,
        email: thread.merchantEmail,
        source_snapshot: {
          source: "platform-support-inbox",
          legacy_role: "merchant",
        },
        joined_at: joinedAt,
        source_updated_at: updatedAt,
      },
      {
        thread_id: threadId,
        account_id: MERCHANT_CONVERSATION_PLATFORM_ACCOUNT_ID,
        participant_role: "platform",
        display_name: "Faolla",
        email: "",
        source_snapshot: {
          source: "platform-support-inbox",
          legacy_role: "super_admin",
        },
        joined_at: joinedAt,
        source_updated_at: updatedAt,
      },
    ],
    messages: changedMessages,
  };
}

export function buildPlatformSupportConversationV1Mutation(input: {
  current: PlatformSupportInboxPayload;
  previous?: PlatformSupportInboxPayload | null;
  accountIds: string[];
  replace?: boolean;
  operationAt?: string;
}): MerchantConversationV1Mutation {
  const accountIds = new Set(normalizeAccountIds(input.accountIds));
  const current = normalizePlatformSupportInboxPayload(input.current);
  const previous = input.previous
    ? normalizePlatformSupportInboxPayload(input.previous)
    : null;
  const currentThreads = new Map(
    current.threads.map((thread) => [thread.merchantId, thread]),
  );
  const previousThreads = new Map(
    (previous?.threads ?? []).map((thread) => [thread.merchantId, thread]),
  );
  const threads = current.threads
    .filter((thread) => accountIds.has(thread.merchantId))
    .map((thread) =>
      mapSupportThread(thread, previousThreads.get(thread.merchantId)),
    )
    .filter(
      (thread): thread is MerchantConversationThreadV1Mutation => !!thread,
    );
  const archivedAt = normalizeIsoString(input.operationAt);
  const archivedThreads =
    input.replace && previous
      ? previous.threads
          .filter(
            (thread) =>
              accountIds.has(thread.merchantId) &&
              !currentThreads.has(thread.merchantId),
          )
          .map((thread) => ({
            id: buildPlatformSupportConversationThreadId(thread.merchantId),
            archived_at:
              archivedAt || normalizeIsoString(thread.updatedAt),
          }))
          .filter((thread) => !!thread.id)
      : [];

  return sortMerchantConversationV1Mutation({
    threads,
    contacts: [],
    read_cursors: [],
    archived_threads: archivedThreads,
  });
}

function mapOfficialReadCursor(
  entry: MerchantSupportReadStateEntry,
): MerchantConversationReadCursorV1Payload | null {
  const lastReadAt = normalizeIsoString(entry.officialLastReadAt);
  const threadId = buildPlatformSupportConversationThreadId(entry.accountId);
  if (!lastReadAt || !threadId) return null;
  return {
    thread_id: threadId,
    account_id: entry.accountId,
    last_read_at: lastReadAt,
    source_snapshot: {
      source: "merchant-support-read-state",
      cursor_kind: "official",
    },
    source_updated_at: normalizeIsoString(entry.updatedAt, lastReadAt),
  };
}

function mapPeerReadCursors(
  entry: MerchantSupportReadStateEntry,
): MerchantConversationReadCursorV1Payload[] {
  const cursors: MerchantConversationReadCursorV1Payload[] = [];
  for (const [peerAccountId, value] of Object.entries(entry.peerLastRead)) {
    const lastReadAt = normalizeIsoString(value);
    const threadId = buildMerchantPeerConversationThreadId(
      entry.accountId,
      peerAccountId,
    );
    if (!lastReadAt || !threadId) continue;
    cursors.push({
      thread_id: threadId,
      account_id: entry.accountId,
      last_read_at: lastReadAt,
      source_snapshot: {
        source: "merchant-support-read-state",
        cursor_kind: "peer",
        peer_account_id: peerAccountId,
      },
      source_updated_at: normalizeIsoString(entry.updatedAt, lastReadAt),
    });
  }
  return cursors;
}

function readCursorIdentity(cursor: MerchantConversationReadCursorV1Payload) {
  return `${cursor.thread_id}:${cursor.account_id}`;
}

export function buildMerchantConversationReadStateV1Mutation(input: {
  current: MerchantSupportReadStatePayload;
  previous?: MerchantSupportReadStatePayload | null;
  accountIds: string[];
}): MerchantConversationV1Mutation {
  const accountIds = new Set(normalizeAccountIds(input.accountIds));
  const current = normalizeMerchantSupportReadStatePayload(input.current);
  const previous = input.previous
    ? normalizeMerchantSupportReadStatePayload(input.previous)
    : null;
  const previousCursors = new Map<string, MerchantConversationReadCursorV1Payload>();
  for (const entry of previous?.accounts ?? []) {
    const official = mapOfficialReadCursor(entry);
    if (official) previousCursors.set(readCursorIdentity(official), official);
    for (const cursor of mapPeerReadCursors(entry)) {
      previousCursors.set(readCursorIdentity(cursor), cursor);
    }
  }

  const readCursors: MerchantConversationReadCursorV1Payload[] = [];
  for (const entry of current.accounts) {
    if (!accountIds.has(entry.accountId)) continue;
    const cursors = [
      mapOfficialReadCursor(entry),
      ...mapPeerReadCursors(entry),
    ].filter(
      (cursor): cursor is MerchantConversationReadCursorV1Payload => !!cursor,
    );
    for (const cursor of cursors) {
      const previousCursor = previousCursors.get(readCursorIdentity(cursor));
      if (
        previousCursor &&
        previousCursor.last_read_at === cursor.last_read_at &&
        previousCursor.source_updated_at === cursor.source_updated_at
      ) {
        continue;
      }
      readCursors.push(cursor);
    }
  }

  return sortMerchantConversationV1Mutation({
    threads: [],
    contacts: [],
    read_cursors: readCursors,
    archived_threads: [],
  });
}

function mergeThreadMutation(
  left: MerchantConversationThreadV1Mutation,
  right: MerchantConversationThreadV1Mutation,
) {
  const rightIsLatest =
    compareIso(left.thread.source_updated_at, right.thread.source_updated_at) <=
    0;
  const latest = rightIsLatest ? right : left;
  const participants = new Map<string, MerchantConversationParticipantV1Payload>();
  for (const participant of [...left.participants, ...right.participants]) {
    const current = participants.get(participant.account_id);
    if (
      !current ||
      compareIso(current.source_updated_at, participant.source_updated_at) <= 0
    ) {
      participants.set(participant.account_id, participant);
    }
  }
  const messages = new Map<string, MerchantConversationMessageV1Payload>();
  for (const message of [...left.messages, ...right.messages]) {
    const current = messages.get(message.id);
    if (
      !current ||
      compareIso(current.source_updated_at, message.source_updated_at) <= 0
    ) {
      messages.set(message.id, message);
    }
  }
  return {
    thread: latest.thread,
    participants: [...participants.values()],
    messages: [...messages.values()],
  } satisfies MerchantConversationThreadV1Mutation;
}

export function mergeMerchantConversationV1Mutations(
  ...mutations: MerchantConversationV1Mutation[]
) {
  const threads = new Map<string, MerchantConversationThreadV1Mutation>();
  const contacts = new Map<string, MerchantConversationContactV1Payload>();
  const readCursors = new Map<
    string,
    MerchantConversationReadCursorV1Payload
  >();
  const archivedThreads = new Map<
    string,
    MerchantConversationArchivedThreadV1Payload
  >();

  for (const mutation of mutations) {
    for (const thread of mutation.threads) {
      const current = threads.get(thread.thread.id);
      threads.set(
        thread.thread.id,
        current ? mergeThreadMutation(current, thread) : thread,
      );
    }
    for (const contact of mutation.contacts) {
      const identity = `${contact.owner_merchant_id}:${contact.contact_account_id}`;
      const current = contacts.get(identity);
      if (
        !current ||
        compareIso(current.source_updated_at, contact.source_updated_at) <= 0
      ) {
        contacts.set(identity, contact);
      }
    }
    for (const cursor of mutation.read_cursors) {
      const identity = readCursorIdentity(cursor);
      const current = readCursors.get(identity);
      if (
        !current ||
        compareIso(current.last_read_at, cursor.last_read_at) <= 0
      ) {
        readCursors.set(identity, cursor);
      }
    }
    for (const archived of mutation.archived_threads) {
      const current = archivedThreads.get(archived.id);
      if (!current || compareIso(current.archived_at, archived.archived_at) <= 0) {
        archivedThreads.set(archived.id, archived);
      }
    }
  }

  for (const [threadId, archived] of archivedThreads) {
    const active = threads.get(threadId);
    if (
      active &&
      compareIso(active.thread.source_updated_at, archived.archived_at) >= 0
    ) {
      archivedThreads.delete(threadId);
    }
  }

  return sortMerchantConversationV1Mutation({
    threads: [...threads.values()],
    contacts: [...contacts.values()],
    read_cursors: [...readCursors.values()],
    archived_threads: [...archivedThreads.values()],
  });
}

export function sortMerchantConversationV1Mutation(
  mutation: MerchantConversationV1Mutation,
): MerchantConversationV1Mutation {
  return {
    threads: [...mutation.threads]
      .map((thread) => ({
        ...thread,
        participants: [...thread.participants].sort((left, right) =>
          left.account_id.localeCompare(right.account_id, "en"),
        ),
        messages: [...thread.messages].sort((left, right) => {
          const timestamp = compareIso(left.created_at, right.created_at);
          return timestamp || left.id.localeCompare(right.id, "en");
        }),
      }))
      .sort((left, right) =>
        left.thread.id.localeCompare(right.thread.id, "en"),
      ),
    contacts: [...mutation.contacts].sort((left, right) => {
      const owner = left.owner_merchant_id.localeCompare(
        right.owner_merchant_id,
        "en",
      );
      return (
        owner ||
        left.contact_account_id.localeCompare(
          right.contact_account_id,
          "en",
        )
      );
    }),
    read_cursors: [...mutation.read_cursors].sort((left, right) => {
      const thread = left.thread_id.localeCompare(right.thread_id, "en");
      return thread || left.account_id.localeCompare(right.account_id, "en");
    }),
    archived_threads: [...mutation.archived_threads].sort((left, right) =>
      left.id.localeCompare(right.id, "en"),
    ),
  };
}

export function countMerchantConversationV1MutationRecords(
  mutation: MerchantConversationV1Mutation,
) {
  return {
    threads: mutation.threads.length,
    participants: mutation.threads.reduce(
      (total, thread) => total + thread.participants.length,
      0,
    ),
    messages: mutation.threads.reduce(
      (total, thread) => total + thread.messages.length,
      0,
    ),
    contacts: mutation.contacts.length,
    readCursors: mutation.read_cursors.length,
    archivedThreads: mutation.archived_threads.length,
  };
}
