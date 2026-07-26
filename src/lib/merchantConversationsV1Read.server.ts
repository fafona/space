import type { MerchantPeerInboxPayload } from "@/lib/merchantPeerInbox";
import {
  reconcileMerchantConversationStorage,
  type MerchantConversationContactV1Row,
  type MerchantConversationMessageV1Row,
  type MerchantConversationParticipantV1Row,
  type MerchantConversationReadCursorV1Row,
  type MerchantConversationReconciliationReport,
  type MerchantConversationThreadV1Row,
} from "@/lib/merchantConversationReconciliation";
import type { MerchantSupportReadStatePayload } from "@/lib/merchantSupportReadState";
import type { PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";

export const MERCHANT_CONVERSATION_V1_READ_MODES = ["off", "verify"] as const;

export type MerchantConversationV1ReadMode =
  (typeof MERCHANT_CONVERSATION_V1_READ_MODES)[number];

export type MerchantConversationV1ReadConfig = {
  mode: MerchantConversationV1ReadMode;
  siteIds: string[];
  timeoutMs: number;
  minIntervalMs: number;
};

export type MerchantConversationLegacySnapshot = {
  peerInbox: MerchantPeerInboxPayload;
  supportInbox: PlatformSupportInboxPayload;
  readState: MerchantSupportReadStatePayload;
};

export type MerchantConversationV1VerificationData = {
  threads: MerchantConversationThreadV1Row[];
  participants: MerchantConversationParticipantV1Row[];
  messages: MerchantConversationMessageV1Row[];
  contacts: MerchantConversationContactV1Row[];
  readCursors: MerchantConversationReadCursorV1Row[];
};

type MerchantConversationV1QueryResult = {
  data?: unknown;
  error?: unknown;
};

type MerchantConversationV1Query =
  PromiseLike<MerchantConversationV1QueryResult> & {
    select: (columns: string) => MerchantConversationV1Query;
    eq: (column: string, value: unknown) => MerchantConversationV1Query;
    in: (column: string, values: unknown[]) => MerchantConversationV1Query;
    order: (
      column: string,
      options: { ascending: boolean },
    ) => MerchantConversationV1Query;
    range: (from: number, to: number) => MerchantConversationV1Query;
  };

export type MerchantConversationV1ReadClient = {
  from: (table: string) => MerchantConversationV1Query;
};

export type MerchantConversationV1ReadEvent = {
  event: "merchant_conversation_v1_read";
  siteId: string;
  mode: "verify";
  observedAt: string;
  durationMs: number;
  outcome: "match" | "fallback";
  reason:
    | "parity"
    | "v1_timeout"
    | "v1_query_failed"
    | "v1_missing"
    | "v1_reconciliation_failed"
    | "v1_mismatch";
  legacyPeerThreadCount: number;
  legacySupportThreadCount: number;
  v1ThreadCount: number;
  v1ParticipantCount: number;
  v1MessageCount: number;
  v1ContactCount: number;
  v1ReadCursorCount: number;
  missingThreadCount: number;
  unexpectedActiveThreadCount: number;
  duplicateThreadCount: number;
  missingParticipantCount: number;
  unexpectedParticipantCount: number;
  duplicateParticipantCount: number;
  missingMessageCount: number;
  unexpectedMessageCount: number;
  duplicateMessageCount: number;
  missingContactCount: number;
  unexpectedContactCount: number;
  contactWithoutCustomerCount: number;
  duplicateContactCount: number;
  missingReadCursorCount: number;
  unexpectedReadCursorCount: number;
  duplicateReadCursorCount: number;
  mismatchCount: number;
  mismatchFieldCount: number;
  allowedArchivedThreadCount: number;
  allowedHistoricalMessageCount: number;
};

type MerchantConversationV1ReadLogger = (
  event: MerchantConversationV1ReadEvent,
) => void;

type ParticipantSeedRow = {
  thread_id: string;
  account_id: string;
};

const THREAD_SELECT_COLUMNS = [
  "id",
  "conversation_kind",
  "state",
  "site_id",
  "source_snapshot",
  "source_updated_at",
  "created_at",
  "updated_at",
].join(",");
const PARTICIPANT_SELECT_COLUMNS = [
  "thread_id",
  "account_id",
  "participant_role",
  "display_name",
  "email",
  "source_snapshot",
  "joined_at",
  "source_updated_at",
].join(",");
const MESSAGE_SELECT_COLUMNS = [
  "thread_id",
  "id",
  "sender_account_id",
  "sender_role",
  "body",
  "source_snapshot",
  "created_at",
  "source_updated_at",
].join(",");
const CONTACT_SELECT_COLUMNS = [
  "owner_merchant_id",
  "contact_account_id",
  "customer_id",
  "contact_name",
  "contact_email",
  "source_snapshot",
  "saved_at",
  "source_updated_at",
].join(",");
const READ_CURSOR_SELECT_COLUMNS = [
  "thread_id",
  "account_id",
  "last_read_at",
  "source_snapshot",
  "source_updated_at",
].join(",");
const DEFAULT_READ_TIMEOUT_MS = 2500;
const MIN_READ_TIMEOUT_MS = 250;
const MAX_READ_TIMEOUT_MS = 10000;
const DEFAULT_MIN_INTERVAL_MS = 60000;
const MIN_INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = 3600000;
const READ_PAGE_SIZE = 1000;
const MAX_ROWS_PER_ENTITY = 100000;
const THREAD_SCOPE_CHUNK_SIZE = 100;
const defaultVerificationGate = new Map<string, number>();

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(trimText(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function throwReadError(scope: string): never {
  throw new Error(`merchant_conversations_v1_${scope}_failed`);
}

async function readQuery(
  query: MerchantConversationV1Query,
  scope: string,
): Promise<MerchantConversationV1QueryResult> {
  const result = await query;
  if (result.error) throwReadError(scope);
  if (
    result.data !== null &&
    result.data !== undefined &&
    !Array.isArray(result.data)
  ) {
    throwReadError(scope);
  }
  return result;
}

async function loadScopedRows<T>(
  client: MerchantConversationV1ReadClient,
  input: {
    table: string;
    columns: string;
    scope: (
      query: MerchantConversationV1Query,
    ) => MerchantConversationV1Query;
    orderBy: string;
    tieBreaker: string;
    maxRows?: number;
  },
): Promise<T[]> {
  const rows: T[] = [];
  const maxRows = input.maxRows ?? MAX_ROWS_PER_ENTITY;
  for (let offset = 0; offset < maxRows; offset += READ_PAGE_SIZE) {
    const pageSize = Math.min(READ_PAGE_SIZE, maxRows - offset);
    const query = input
      .scope(client.from(input.table).select(input.columns))
      .order(input.orderBy, { ascending: true })
      .order(input.tieBreaker, { ascending: true })
      .range(offset, offset + pageSize - 1);
    const result = await readQuery(query, `${input.table}_query`);
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throwReadError(`${input.table}_row_limit`);
}

function chunkValues(values: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function loadThreadScopedRows<T>(
  client: MerchantConversationV1ReadClient,
  input: {
    table: string;
    columns: string;
    threadIds: string[];
    scopeColumn?: "id" | "thread_id";
    orderBy: string;
    tieBreaker: string;
  },
) {
  const rows: T[] = [];
  for (const threadIds of chunkValues(
    input.threadIds,
    THREAD_SCOPE_CHUNK_SIZE,
  )) {
    const remaining = MAX_ROWS_PER_ENTITY - rows.length;
    if (remaining <= 0) throwReadError(`${input.table}_row_limit`);
    const page = await loadScopedRows<T>(client, {
      table: input.table,
      columns: input.columns,
      scope: (query) =>
        query.in(input.scopeColumn ?? "thread_id", threadIds),
      orderBy: input.orderBy,
      tieBreaker: input.tieBreaker,
      maxRows: remaining,
    });
    rows.push(...page);
  }
  return rows;
}

function assertRecordFields(
  row: unknown,
  requiredFields: string[],
): asserts row is Record<string, unknown> {
  if (
    !isPlainRecord(row) ||
    requiredFields.some((field) => !trimText(row[field]))
  ) {
    throwReadError("identity");
  }
}

export function validateMerchantConversationV1VerificationData(
  siteId: string,
  data: MerchantConversationV1VerificationData,
) {
  const normalizedSiteId = trimText(siteId);
  if (!/^\d{8}$/.test(normalizedSiteId)) throwReadError("identity");
  if (
    !Array.isArray(data?.threads) ||
    !Array.isArray(data?.participants) ||
    !Array.isArray(data?.messages) ||
    !Array.isArray(data?.contacts) ||
    !Array.isArray(data?.readCursors)
  ) {
    throwReadError("response");
  }

  const threadIds = new Set<string>();
  for (const row of data.threads) {
    assertRecordFields(row, [
      "id",
      "conversation_kind",
      "state",
      "source_updated_at",
      "created_at",
      "updated_at",
    ]);
    threadIds.add(trimText(row.id));
  }
  for (const row of data.participants) {
    assertRecordFields(row, [
      "thread_id",
      "account_id",
      "participant_role",
      "joined_at",
      "source_updated_at",
    ]);
    if (!threadIds.has(trimText(row.thread_id))) throwReadError("identity");
  }
  for (const row of data.messages) {
    assertRecordFields(row, [
      "thread_id",
      "id",
      "sender_account_id",
      "sender_role",
      "body",
      "created_at",
      "source_updated_at",
    ]);
    if (!threadIds.has(trimText(row.thread_id))) throwReadError("identity");
  }
  for (const row of data.contacts) {
    assertRecordFields(row, [
      "owner_merchant_id",
      "contact_account_id",
      "saved_at",
      "source_updated_at",
    ]);
    if (trimText(row.owner_merchant_id) !== normalizedSiteId) {
      throwReadError("identity");
    }
  }
  for (const row of data.readCursors) {
    assertRecordFields(row, [
      "thread_id",
      "account_id",
      "last_read_at",
      "source_updated_at",
    ]);
    if (
      trimText(row.account_id) !== normalizedSiteId ||
      !threadIds.has(trimText(row.thread_id))
    ) {
      throwReadError("identity");
    }
  }

  const participantThreadIds = new Set(
    data.participants
      .filter((row) => trimText(row.account_id) === normalizedSiteId)
      .map((row) => trimText(row.thread_id)),
  );
  if (
    threadIds.size !== participantThreadIds.size ||
    [...threadIds].some((threadId) => !participantThreadIds.has(threadId))
  ) {
    throwReadError("identity");
  }
  return data;
}

export async function loadMerchantConversationsV1VerificationData(
  client: MerchantConversationV1ReadClient,
  siteId: string,
): Promise<MerchantConversationV1VerificationData> {
  const normalizedSiteId = trimText(siteId);
  if (!/^\d{8}$/.test(normalizedSiteId)) throwReadError("identity");

  const [participantSeed, contacts, readCursors] = await Promise.all([
    loadScopedRows<ParticipantSeedRow>(client, {
      table: "merchant_conversation_participants",
      columns: "thread_id,account_id",
      scope: (query) => query.eq("account_id", normalizedSiteId),
      orderBy: "thread_id",
      tieBreaker: "account_id",
    }),
    loadScopedRows<MerchantConversationContactV1Row>(client, {
      table: "merchant_conversation_contacts",
      columns: CONTACT_SELECT_COLUMNS,
      scope: (query) => query.eq("owner_merchant_id", normalizedSiteId),
      orderBy: "saved_at",
      tieBreaker: "contact_account_id",
    }),
    loadScopedRows<MerchantConversationReadCursorV1Row>(client, {
      table: "merchant_conversation_read_cursors",
      columns: READ_CURSOR_SELECT_COLUMNS,
      scope: (query) => query.eq("account_id", normalizedSiteId),
      orderBy: "thread_id",
      tieBreaker: "account_id",
    }),
  ]);
  for (const row of participantSeed) {
    assertRecordFields(row, ["thread_id", "account_id"]);
    if (trimText(row.account_id) !== normalizedSiteId) {
      throwReadError("identity");
    }
  }
  const threadIds = [
    ...new Set(participantSeed.map((row) => trimText(row.thread_id))),
  ]
    .filter(Boolean)
    .sort();
  if (threadIds.length === 0) {
    return validateMerchantConversationV1VerificationData(normalizedSiteId, {
      threads: [],
      participants: [],
      messages: [],
      contacts,
      readCursors,
    });
  }

  const [threads, participants, messages] = await Promise.all([
    loadThreadScopedRows<MerchantConversationThreadV1Row>(client, {
      table: "merchant_conversation_threads",
      columns: THREAD_SELECT_COLUMNS,
      threadIds,
      scopeColumn: "id",
      orderBy: "id",
      tieBreaker: "updated_at",
    }),
    loadThreadScopedRows<MerchantConversationParticipantV1Row>(client, {
      table: "merchant_conversation_participants",
      columns: PARTICIPANT_SELECT_COLUMNS,
      threadIds,
      orderBy: "thread_id",
      tieBreaker: "account_id",
    }),
    loadThreadScopedRows<MerchantConversationMessageV1Row>(client, {
      table: "merchant_conversation_messages",
      columns: MESSAGE_SELECT_COLUMNS,
      threadIds,
      orderBy: "created_at",
      tieBreaker: "id",
    }),
  ]);
  return validateMerchantConversationV1VerificationData(normalizedSiteId, {
    threads,
    participants,
    messages,
    contacts,
    readCursors,
  });
}

export function resolveMerchantConversationV1ReadConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantConversationV1ReadConfig {
  const mode =
    trimText(environment.MERCHANT_CONVERSATION_V1_READ_MODE).toLowerCase() ===
    "verify"
      ? "verify"
      : "off";
  const siteIds = [
    ...new Set(
      trimText(environment.MERCHANT_CONVERSATION_V1_READ_SITE_IDS)
        .split(",")
        .map((siteId) => siteId.trim())
        .filter((siteId) => /^\d{8}$/.test(siteId)),
    ),
  ];
  return {
    mode,
    siteIds,
    timeoutMs: normalizeNumber(
      environment.MERCHANT_CONVERSATION_V1_READ_TIMEOUT_MS,
      DEFAULT_READ_TIMEOUT_MS,
      MIN_READ_TIMEOUT_MS,
      MAX_READ_TIMEOUT_MS,
    ),
    minIntervalMs: normalizeNumber(
      environment.MERCHANT_CONVERSATION_V1_READ_MIN_INTERVAL_MS,
      DEFAULT_MIN_INTERVAL_MS,
      MIN_INTERVAL_MS,
      MAX_INTERVAL_MS,
    ),
  };
}

export function isMerchantConversationV1ReadEnabled(
  siteId: string,
  config: MerchantConversationV1ReadConfig,
) {
  return (
    config.mode === "verify" &&
    config.siteIds.includes(trimText(siteId))
  );
}

export function reserveMerchantConversationV1ReadWindow(
  siteId: string,
  config: MerchantConversationV1ReadConfig,
  options?: {
    now?: number;
    gate?: Map<string, number>;
  },
) {
  const normalizedSiteId = trimText(siteId);
  if (!isMerchantConversationV1ReadEnabled(normalizedSiteId, config)) {
    return false;
  }
  const now = options?.now ?? Date.now();
  const gate = options?.gate ?? defaultVerificationGate;
  if ((gate.get(normalizedSiteId) ?? 0) > now) return false;
  gate.set(normalizedSiteId, now + config.minIntervalMs);
  if (gate.size > 1000) {
    for (const [entrySiteId, nextAt] of gate) {
      if (nextAt <= now) gate.delete(entrySiteId);
    }
  }
  return true;
}

function defaultReadLogger(event: MerchantConversationV1ReadEvent) {
  const output = JSON.stringify(event);
  if (event.outcome === "fallback") {
    console.warn("[merchant-conversation-v1-read]", output);
  } else {
    console.info("[merchant-conversation-v1-read]", output);
  }
}

async function observeV1Read(
  loadV1: () => Promise<MerchantConversationV1VerificationData | null>,
  timeoutMs: number,
): Promise<
  | { status: "loaded"; value: MerchantConversationV1VerificationData | null }
  | { status: "timeout" }
  | { status: "failed" }
> {
  const timeoutToken = Symbol("merchant_conversation_v1_read_timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      loadV1(),
      new Promise<typeof timeoutToken>((resolve) => {
        timeoutHandle = setTimeout(
          () => resolve(timeoutToken),
          Math.max(1, timeoutMs),
        );
      }),
    ]);
    return result === timeoutToken
      ? { status: "timeout" }
      : { status: "loaded", value: result };
  } catch {
    return { status: "failed" };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function emptyMetrics() {
  return {
    v1ThreadCount: 0,
    v1ParticipantCount: 0,
    v1MessageCount: 0,
    v1ContactCount: 0,
    v1ReadCursorCount: 0,
    missingThreadCount: 0,
    unexpectedActiveThreadCount: 0,
    duplicateThreadCount: 0,
    missingParticipantCount: 0,
    unexpectedParticipantCount: 0,
    duplicateParticipantCount: 0,
    missingMessageCount: 0,
    unexpectedMessageCount: 0,
    duplicateMessageCount: 0,
    missingContactCount: 0,
    unexpectedContactCount: 0,
    contactWithoutCustomerCount: 0,
    duplicateContactCount: 0,
    missingReadCursorCount: 0,
    unexpectedReadCursorCount: 0,
    duplicateReadCursorCount: 0,
    mismatchCount: 0,
    mismatchFieldCount: 0,
    allowedArchivedThreadCount: 0,
    allowedHistoricalMessageCount: 0,
  };
}

function reportMetrics(
  report: MerchantConversationReconciliationReport,
  data: MerchantConversationV1VerificationData,
) {
  return {
    v1ThreadCount: data.threads.length,
    v1ParticipantCount: data.participants.length,
    v1MessageCount: data.messages.length,
    v1ContactCount: data.contacts.length,
    v1ReadCursorCount: data.readCursors.length,
    missingThreadCount: report.missingThreads.length,
    unexpectedActiveThreadCount: report.unexpectedActiveThreads.length,
    duplicateThreadCount: report.duplicateThreadIds.length,
    missingParticipantCount: report.missingParticipants.length,
    unexpectedParticipantCount: report.unexpectedParticipants.length,
    duplicateParticipantCount: report.duplicateParticipantIds.length,
    missingMessageCount: report.missingMessages.length,
    unexpectedMessageCount: report.unexpectedMessages.length,
    duplicateMessageCount: report.duplicateMessageIds.length,
    missingContactCount: report.missingContacts.length,
    unexpectedContactCount: report.unexpectedContacts.length,
    contactWithoutCustomerCount: report.contactsWithoutCustomer.length,
    duplicateContactCount: report.duplicateContactIds.length,
    missingReadCursorCount: report.missingReadCursors.length,
    unexpectedReadCursorCount: report.unexpectedReadCursors.length,
    duplicateReadCursorCount: report.duplicateReadCursorIds.length,
    mismatchCount: report.mismatches.length,
    mismatchFieldCount: report.mismatches.reduce(
      (total, mismatch) => total + mismatch.fields.length,
      0,
    ),
    allowedArchivedThreadCount: report.allowedArchivedThreads.length,
    allowedHistoricalMessageCount: report.allowedHistoricalMessages.length,
  };
}

export async function readMerchantConversationsWithV1Verification<
  T extends MerchantConversationLegacySnapshot,
>(input: {
  siteId: string;
  legacy: T;
  loadV1: () => Promise<MerchantConversationV1VerificationData | null>;
  config?: MerchantConversationV1ReadConfig;
  logger?: MerchantConversationV1ReadLogger;
}): Promise<T> {
  const config = input.config ?? resolveMerchantConversationV1ReadConfig();
  if (!isMerchantConversationV1ReadEnabled(input.siteId, config)) {
    return input.legacy;
  }

  const verificationStartedAt = Date.now();
  const observedV1 = await observeV1Read(input.loadV1, config.timeoutMs);
  const logger = input.logger ?? defaultReadLogger;
  const log = (
    outcome: MerchantConversationV1ReadEvent["outcome"],
    reason: MerchantConversationV1ReadEvent["reason"],
    metrics = emptyMetrics(),
  ) => {
    try {
      const completedAt = Date.now();
      logger({
        event: "merchant_conversation_v1_read",
        siteId: trimText(input.siteId),
        mode: "verify",
        observedAt: new Date(completedAt).toISOString(),
        durationMs: Math.max(0, completedAt - verificationStartedAt),
        outcome,
        reason,
        legacyPeerThreadCount: input.legacy.peerInbox.threads.filter(
          (thread) =>
            thread.merchantAId === input.siteId ||
            thread.merchantBId === input.siteId,
        ).length,
        legacySupportThreadCount: input.legacy.supportInbox.threads.filter(
          (thread) =>
            thread.merchantId === input.siteId ||
            thread.siteId === input.siteId,
        ).length,
        ...metrics,
      });
    } catch {
      // Conversation verification must never affect the legacy read.
    }
  };

  if (observedV1.status === "timeout") {
    log("fallback", "v1_timeout");
    return input.legacy;
  }
  if (observedV1.status === "failed") {
    log("fallback", "v1_query_failed");
    return input.legacy;
  }
  if (!observedV1.value) {
    log("fallback", "v1_missing");
    return input.legacy;
  }

  let report: MerchantConversationReconciliationReport;
  let data: MerchantConversationV1VerificationData;
  try {
    data = validateMerchantConversationV1VerificationData(
      input.siteId,
      observedV1.value,
    );
    report = reconcileMerchantConversationStorage({
      accountId: input.siteId,
      peerInbox: input.legacy.peerInbox,
      supportInbox: input.legacy.supportInbox,
      readState: input.legacy.readState,
      v1Threads: data.threads,
      v1Participants: data.participants,
      v1Messages: data.messages,
      v1Contacts: data.contacts,
      v1ReadCursors: data.readCursors,
    });
  } catch {
    log("fallback", "v1_reconciliation_failed");
    return input.legacy;
  }

  const metrics = reportMetrics(report, data);
  if (!report.isMatch) {
    log("fallback", "v1_mismatch", metrics);
    return input.legacy;
  }
  log("match", "parity", metrics);
  return input.legacy;
}
