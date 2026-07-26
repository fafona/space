import { isDeepStrictEqual } from "node:util";

import type { MerchantPeerInboxPayload } from "@/lib/merchantPeerInbox";
import type { MerchantSupportReadStatePayload } from "@/lib/merchantSupportReadState";
import type { PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";
import {
  buildMerchantConversationReadStateV1Mutation,
  buildMerchantPeerConversationV1Mutation,
  buildPlatformSupportConversationV1Mutation,
  mergeMerchantConversationV1Mutations,
  type MerchantConversationContactV1Payload,
  type MerchantConversationMessageV1Payload,
  type MerchantConversationParticipantV1Payload,
  type MerchantConversationReadCursorV1Payload,
  type MerchantConversationThreadV1Payload,
} from "@/lib/merchantConversationsV1";

export type MerchantConversationThreadV1Row = {
  id: string;
  conversation_kind: string;
  state: string;
  site_id: string | null;
  source_snapshot: unknown;
  source_updated_at: string;
  created_at: string;
  updated_at: string;
};

export type MerchantConversationParticipantV1Row = {
  thread_id: string;
  account_id: string;
  participant_role: string;
  display_name: string;
  email: string;
  source_snapshot: unknown;
  joined_at: string;
  source_updated_at: string;
};

export type MerchantConversationMessageV1Row = {
  thread_id: string;
  id: string;
  sender_account_id: string;
  sender_role: string;
  body: string;
  source_snapshot: unknown;
  created_at: string;
  source_updated_at: string;
};

export type MerchantConversationContactV1Row = {
  owner_merchant_id: string;
  contact_account_id: string;
  customer_id: string | null;
  contact_name: string;
  contact_email: string;
  source_snapshot: unknown;
  saved_at: string;
  source_updated_at: string;
};

export type MerchantConversationReadCursorV1Row = {
  thread_id: string;
  account_id: string;
  last_read_at: string;
  source_snapshot: unknown;
  source_updated_at: string;
};

export type MerchantConversationReconciliationMismatch = {
  entity: "thread" | "participant" | "message" | "contact" | "read_cursor";
  recordId: string;
  fields: string[];
};

export type MerchantConversationReconciliationReport = {
  accountId: string;
  expectedThreadCount: number;
  v1ThreadCount: number;
  missingThreads: string[];
  unexpectedActiveThreads: string[];
  allowedArchivedThreads: string[];
  duplicateThreadIds: string[];
  missingParticipants: string[];
  unexpectedParticipants: string[];
  duplicateParticipantIds: string[];
  missingMessages: string[];
  unexpectedMessages: string[];
  allowedHistoricalMessages: string[];
  duplicateMessageIds: string[];
  missingContacts: string[];
  unexpectedContacts: string[];
  contactsWithoutCustomer: string[];
  duplicateContactIds: string[];
  missingReadCursors: string[];
  unexpectedReadCursors: string[];
  duplicateReadCursorIds: string[];
  mismatches: MerchantConversationReconciliationMismatch[];
  isMatch: boolean;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimestamp(value: unknown) {
  const text = trimText(value);
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : text;
}

function sameTimestamp(left: unknown, right: unknown) {
  return normalizeTimestamp(left) === normalizeTimestamp(right);
}

function sameJson(left: unknown, right: unknown) {
  return isDeepStrictEqual(left ?? {}, right ?? {});
}

function indexRows<T>(
  rows: T[],
  identity: (row: T) => string,
) {
  const map = new Map<string, T>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const id = identity(row);
    if (!id) continue;
    if (map.has(id)) duplicates.add(id);
    else map.set(id, row);
  }
  return { map, duplicates: [...duplicates].sort() };
}

function compareThread(
  expected: MerchantConversationThreadV1Payload,
  row: MerchantConversationThreadV1Row,
) {
  const fields: string[] = [];
  if (trimText(row.conversation_kind) !== expected.conversation_kind) {
    fields.push("conversationKind");
  }
  if (trimText(row.state) !== expected.state) fields.push("state");
  if ((trimText(row.site_id) || null) !== expected.site_id) fields.push("siteId");
  if (!sameJson(row.source_snapshot, expected.source_snapshot)) {
    fields.push("sourceSnapshot");
  }
  if (!sameTimestamp(row.source_updated_at, expected.source_updated_at)) {
    fields.push("sourceUpdatedAt");
  }
  if (!sameTimestamp(row.created_at, expected.created_at)) {
    fields.push("createdAt");
  }
  if (!sameTimestamp(row.updated_at, expected.updated_at)) {
    fields.push("updatedAt");
  }
  return fields;
}

function compareParticipant(
  expected: MerchantConversationParticipantV1Payload,
  row: MerchantConversationParticipantV1Row,
) {
  const fields: string[] = [];
  if (trimText(row.participant_role) !== expected.participant_role) {
    fields.push("participantRole");
  }
  if (trimText(row.display_name) !== expected.display_name) {
    fields.push("displayName");
  }
  if (trimText(row.email) !== expected.email) fields.push("email");
  if (!sameJson(row.source_snapshot, expected.source_snapshot)) {
    fields.push("sourceSnapshot");
  }
  if (!sameTimestamp(row.joined_at, expected.joined_at)) {
    fields.push("joinedAt");
  }
  if (!sameTimestamp(row.source_updated_at, expected.source_updated_at)) {
    fields.push("sourceUpdatedAt");
  }
  return fields;
}

function compareMessage(
  expected: MerchantConversationMessageV1Payload,
  row: MerchantConversationMessageV1Row,
) {
  const fields: string[] = [];
  if (trimText(row.sender_account_id) !== expected.sender_account_id) {
    fields.push("senderAccountId");
  }
  if (trimText(row.sender_role) !== expected.sender_role) {
    fields.push("senderRole");
  }
  if (row.body !== expected.body) fields.push("body");
  if (!sameJson(row.source_snapshot, expected.source_snapshot)) {
    fields.push("sourceSnapshot");
  }
  if (!sameTimestamp(row.created_at, expected.created_at)) {
    fields.push("createdAt");
  }
  if (!sameTimestamp(row.source_updated_at, expected.source_updated_at)) {
    fields.push("sourceUpdatedAt");
  }
  return fields;
}

function compareContact(
  expected: MerchantConversationContactV1Payload,
  row: MerchantConversationContactV1Row,
) {
  const fields: string[] = [];
  if (trimText(row.contact_name) !== expected.contact_name) {
    fields.push("contactName");
  }
  if (trimText(row.contact_email) !== expected.contact_email) {
    fields.push("contactEmail");
  }
  if (!sameJson(row.source_snapshot, expected.source_snapshot)) {
    fields.push("sourceSnapshot");
  }
  if (!sameTimestamp(row.saved_at, expected.saved_at)) fields.push("savedAt");
  if (!sameTimestamp(row.source_updated_at, expected.source_updated_at)) {
    fields.push("sourceUpdatedAt");
  }
  return fields;
}

function compareReadCursor(
  expected: MerchantConversationReadCursorV1Payload,
  row: MerchantConversationReadCursorV1Row,
) {
  const fields: string[] = [];
  if (!sameTimestamp(row.last_read_at, expected.last_read_at)) {
    fields.push("lastReadAt");
  }
  if (!sameJson(row.source_snapshot, expected.source_snapshot)) {
    fields.push("sourceSnapshot");
  }
  if (!sameTimestamp(row.source_updated_at, expected.source_updated_at)) {
    fields.push("sourceUpdatedAt");
  }
  return fields;
}

export function reconcileMerchantConversationStorage(input: {
  accountId: string;
  peerInbox: MerchantPeerInboxPayload;
  supportInbox: PlatformSupportInboxPayload;
  readState: MerchantSupportReadStatePayload;
  v1Threads: MerchantConversationThreadV1Row[];
  v1Participants: MerchantConversationParticipantV1Row[];
  v1Messages: MerchantConversationMessageV1Row[];
  v1Contacts: MerchantConversationContactV1Row[];
  v1ReadCursors: MerchantConversationReadCursorV1Row[];
}): MerchantConversationReconciliationReport {
  const accountId = trimText(input.accountId);
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
  const expectedThreads = new Map<string, MerchantConversationThreadV1Payload>(
    expected.threads.map((item) => [item.thread.id, item.thread]),
  );
  const expectedParticipants = new Map<
    string,
    MerchantConversationParticipantV1Payload
  >(
    expected.threads.flatMap((item) =>
      item.participants.map(
        (participant) =>
          [`${participant.thread_id}:${participant.account_id}`, participant] as const,
      ),
    ),
  );
  const expectedMessages = new Map<string, MerchantConversationMessageV1Payload>(
    expected.threads.flatMap((item) =>
      item.messages.map(
        (message) => [`${message.thread_id}:${message.id}`, message] as const,
      ),
    ),
  );
  const expectedContacts = new Map<string, MerchantConversationContactV1Payload>(
    expected.contacts.map(
      (contact) =>
        [
          `${contact.owner_merchant_id}:${contact.contact_account_id}`,
          contact,
        ] as const,
    ),
  );
  const expectedReadCursors = new Map<
    string,
    MerchantConversationReadCursorV1Payload
  >(
    expected.read_cursors.map(
      (cursor) =>
        [`${cursor.thread_id}:${cursor.account_id}`, cursor] as const,
    ),
  );

  const threadRows = indexRows(input.v1Threads, (row) => trimText(row.id));
  const participantRows = indexRows(
    input.v1Participants,
    (row) => `${trimText(row.thread_id)}:${trimText(row.account_id)}`,
  );
  const messageRows = indexRows(
    input.v1Messages,
    (row) => `${trimText(row.thread_id)}:${trimText(row.id)}`,
  );
  const contactRows = indexRows(
    input.v1Contacts,
    (row) =>
      `${trimText(row.owner_merchant_id)}:${trimText(row.contact_account_id)}`,
  );
  const readCursorRows = indexRows(
    input.v1ReadCursors,
    (row) => `${trimText(row.thread_id)}:${trimText(row.account_id)}`,
  );

  const missingThreads: string[] = [];
  const unexpectedActiveThreads: string[] = [];
  const allowedArchivedThreads: string[] = [];
  const missingParticipants: string[] = [];
  const unexpectedParticipants: string[] = [];
  const missingMessages: string[] = [];
  const unexpectedMessages: string[] = [];
  const allowedHistoricalMessages: string[] = [];
  const missingContacts: string[] = [];
  const unexpectedContacts: string[] = [];
  const contactsWithoutCustomer: string[] = [];
  const missingReadCursors: string[] = [];
  const unexpectedReadCursors: string[] = [];
  const mismatches: MerchantConversationReconciliationMismatch[] = [];

  for (const [id, expectedThread] of expectedThreads) {
    const row = threadRows.map.get(id);
    if (!row) {
      missingThreads.push(id);
      continue;
    }
    const fields = compareThread(expectedThread, row);
    if (fields.length > 0) {
      mismatches.push({ entity: "thread", recordId: id, fields });
    }
  }
  for (const [id, row] of threadRows.map) {
    if (expectedThreads.has(id)) continue;
    if (trimText(row.state) === "archived") allowedArchivedThreads.push(id);
    else unexpectedActiveThreads.push(id);
  }

  for (const [id, expectedParticipant] of expectedParticipants) {
    const row = participantRows.map.get(id);
    if (!row) {
      missingParticipants.push(id);
      continue;
    }
    const fields = compareParticipant(expectedParticipant, row);
    if (fields.length > 0) {
      mismatches.push({ entity: "participant", recordId: id, fields });
    }
  }
  for (const [id, row] of participantRows.map) {
    if (expectedParticipants.has(id)) continue;
    const thread = threadRows.map.get(trimText(row.thread_id));
    if (trimText(thread?.state) !== "archived") {
      unexpectedParticipants.push(id);
    }
  }

  for (const [id, expectedMessage] of expectedMessages) {
    const row = messageRows.map.get(id);
    if (!row) {
      missingMessages.push(id);
      continue;
    }
    const fields = compareMessage(expectedMessage, row);
    if (fields.length > 0) {
      mismatches.push({ entity: "message", recordId: id, fields });
    }
  }
  for (const [id, row] of messageRows.map) {
    if (expectedMessages.has(id)) continue;
    const thread = threadRows.map.get(trimText(row.thread_id));
    if (trimText(thread?.conversation_kind) === "support") {
      allowedHistoricalMessages.push(id);
    } else {
      unexpectedMessages.push(id);
    }
  }

  for (const [id, expectedContact] of expectedContacts) {
    const row = contactRows.map.get(id);
    if (!row) {
      missingContacts.push(id);
      continue;
    }
    if (!trimText(row.customer_id)) contactsWithoutCustomer.push(id);
    const fields = compareContact(expectedContact, row);
    if (fields.length > 0) {
      mismatches.push({ entity: "contact", recordId: id, fields });
    }
  }
  for (const [id] of contactRows.map) {
    if (!expectedContacts.has(id)) unexpectedContacts.push(id);
  }

  for (const [id, expectedCursor] of expectedReadCursors) {
    const row = readCursorRows.map.get(id);
    if (!row) {
      missingReadCursors.push(id);
      continue;
    }
    const fields = compareReadCursor(expectedCursor, row);
    if (fields.length > 0) {
      mismatches.push({ entity: "read_cursor", recordId: id, fields });
    }
  }
  for (const [id] of readCursorRows.map) {
    if (!expectedReadCursors.has(id)) unexpectedReadCursors.push(id);
  }

  const sorted = [
    missingThreads,
    unexpectedActiveThreads,
    allowedArchivedThreads,
    missingParticipants,
    unexpectedParticipants,
    missingMessages,
    unexpectedMessages,
    allowedHistoricalMessages,
    missingContacts,
    unexpectedContacts,
    contactsWithoutCustomer,
    missingReadCursors,
    unexpectedReadCursors,
  ];
  sorted.forEach((values) => values.sort());
  mismatches.sort((left, right) => {
    const entity = left.entity.localeCompare(right.entity, "en");
    return entity || left.recordId.localeCompare(right.recordId, "en");
  });

  const isMatch =
    missingThreads.length === 0 &&
    unexpectedActiveThreads.length === 0 &&
    threadRows.duplicates.length === 0 &&
    missingParticipants.length === 0 &&
    unexpectedParticipants.length === 0 &&
    participantRows.duplicates.length === 0 &&
    missingMessages.length === 0 &&
    unexpectedMessages.length === 0 &&
    messageRows.duplicates.length === 0 &&
    missingContacts.length === 0 &&
    unexpectedContacts.length === 0 &&
    contactsWithoutCustomer.length === 0 &&
    contactRows.duplicates.length === 0 &&
    missingReadCursors.length === 0 &&
    unexpectedReadCursors.length === 0 &&
    readCursorRows.duplicates.length === 0 &&
    mismatches.length === 0;

  return {
    accountId,
    expectedThreadCount: expectedThreads.size,
    v1ThreadCount: threadRows.map.size,
    missingThreads,
    unexpectedActiveThreads,
    allowedArchivedThreads,
    duplicateThreadIds: threadRows.duplicates,
    missingParticipants,
    unexpectedParticipants,
    duplicateParticipantIds: participantRows.duplicates,
    missingMessages,
    unexpectedMessages,
    allowedHistoricalMessages,
    duplicateMessageIds: messageRows.duplicates,
    missingContacts,
    unexpectedContacts,
    contactsWithoutCustomer,
    duplicateContactIds: contactRows.duplicates,
    missingReadCursors,
    unexpectedReadCursors,
    duplicateReadCursorIds: readCursorRows.duplicates,
    mismatches,
    isMatch,
  };
}
