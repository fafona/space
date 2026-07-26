import { loadEnvConfig } from "@next/env";

import {
  MERCHANT_PEER_INBOX_SLUG,
  normalizeMerchantPeerInboxPayload,
  readMerchantPeerInboxFromBlocks,
  type MerchantPeerInboxPayload,
} from "../src/lib/merchantPeerInbox";
import {
  MERCHANT_SUPPORT_READ_STATE_SLUG,
  normalizeMerchantSupportReadStatePayload,
  readMerchantSupportReadStateFromBlocks,
  type MerchantSupportReadStatePayload,
} from "../src/lib/merchantSupportReadState";
import {
  PLATFORM_SUPPORT_INBOX_SLUG,
  normalizePlatformSupportInboxPayload,
  readPlatformSupportInboxFromBlocks,
  type PlatformSupportInboxPayload,
} from "../src/lib/platformSupportInbox";
import type {
  MerchantConversationContactV1Row,
  MerchantConversationMessageV1Row,
  MerchantConversationParticipantV1Row,
  MerchantConversationReadCursorV1Row,
  MerchantConversationThreadV1Row,
} from "../src/lib/merchantConversationReconciliation";

export type ConversationRestRuntime = {
  baseUrl: string;
  headers: Record<string, string>;
};

export type LegacyConversationSnapshots = {
  peerInbox: MerchantPeerInboxPayload;
  supportInbox: PlatformSupportInboxPayload;
  readState: MerchantSupportReadStatePayload;
};

export type ConversationV1Snapshot = {
  threads: MerchantConversationThreadV1Row[];
  participants: MerchantConversationParticipantV1Row[];
  messages: MerchantConversationMessageV1Row[];
  contacts: MerchantConversationContactV1Row[];
  readCursors: MerchantConversationReadCursorV1Row[];
};

const REQUIRED_MIGRATIONS = [
  202607250001,
  202607250002,
  202607250003,
  202607250004,
  202607250005,
  202607250006,
];
const MAX_REST_ROWS = 100000;

export function trimConversationCliText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function createConversationRestRuntime(): ConversationRestRuntime {
  loadEnvConfig(process.cwd());
  const baseUrl = trimConversationCliText(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/+$/, "");
  const serviceRoleKey = trimConversationCliText(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("supabase_service_env_missing");
  }
  return {
    baseUrl,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  };
}

export async function requestConversationJson(
  runtime: ConversationRestRuntime,
  path: string,
  init?: RequestInit,
  timeoutMs = 15000,
) {
  const response = await fetch(`${runtime.baseUrl}${path}`, {
    ...init,
    headers: {
      ...runtime.headers,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const code =
      body && typeof body === "object"
        ? trimConversationCliText((body as { code?: unknown }).code)
        : "";
    throw new Error(`${path}:${response.status}:${code || "request_failed"}`);
  }
  return body;
}

async function fetchConversationRows<T>(
  runtime: ConversationRestRuntime,
  path: string,
  params: URLSearchParams,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_REST_ROWS; offset += pageSize) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", String(pageSize));
    pageParams.set("offset", String(offset));
    const page = await requestConversationJson(
      runtime,
      `${path}?${pageParams.toString()}`,
    );
    if (!Array.isArray(page)) throw new Error(`${path}:invalid_response`);
    rows.push(...(page as T[]));
    if (page.length < pageSize) return rows;
    if (offset + pageSize >= MAX_REST_ROWS) {
      throw new Error(`${path}:row_limit_exceeded:${MAX_REST_ROWS}`);
    }
  }
  return rows;
}

async function loadGlobalPageBlocks(
  runtime: ConversationRestRuntime,
  slug: string,
) {
  return fetchConversationRows<{ blocks?: unknown }>(
    runtime,
    "/rest/v1/pages",
    new URLSearchParams({
      select: "id,blocks,updated_at",
      slug: `eq.${slug}`,
      order: "updated_at.asc",
    }),
  );
}

export async function loadLegacyConversationSnapshots(
  runtime: ConversationRestRuntime,
): Promise<LegacyConversationSnapshots> {
  const [peerRows, supportRows, readRows] = await Promise.all([
    loadGlobalPageBlocks(runtime, MERCHANT_PEER_INBOX_SLUG),
    loadGlobalPageBlocks(runtime, PLATFORM_SUPPORT_INBOX_SLUG),
    loadGlobalPageBlocks(runtime, MERCHANT_SUPPORT_READ_STATE_SLUG),
  ]);
  const peerPayloads = peerRows.map((row) =>
    readMerchantPeerInboxFromBlocks(row.blocks),
  );
  const supportPayloads = supportRows.map((row) =>
    readPlatformSupportInboxFromBlocks(row.blocks),
  );
  const readPayloads = readRows.map((row) =>
    readMerchantSupportReadStateFromBlocks(row.blocks),
  );
  return {
    peerInbox: normalizeMerchantPeerInboxPayload({
      contacts: peerPayloads.flatMap((payload) => payload.contacts),
      threads: peerPayloads.flatMap((payload) => payload.threads),
    }),
    supportInbox: normalizePlatformSupportInboxPayload({
      threads: supportPayloads.flatMap((payload) => payload.threads),
    }),
    readState: normalizeMerchantSupportReadStatePayload({
      accounts: readPayloads.flatMap((payload) => payload.accounts),
    }),
  };
}

function buildInFilter(values: string[]) {
  return `in.(${values.map((value) => `"${value.replaceAll('"', '\\"')}"`).join(",")})`;
}

export async function loadConversationV1(
  runtime: ConversationRestRuntime,
  accountId: string,
): Promise<ConversationV1Snapshot> {
  const participantSeed = await fetchConversationRows<MerchantConversationParticipantV1Row>(
    runtime,
    "/rest/v1/merchant_conversation_participants",
    new URLSearchParams({
      select:
        "thread_id,account_id,participant_role,display_name,email,source_snapshot,joined_at,source_updated_at",
      account_id: `eq.${accountId}`,
      order: "thread_id.asc",
    }),
  );
  const threadIds = Array.from(
    new Set(participantSeed.map((row) => trimConversationCliText(row.thread_id))),
  )
    .filter(Boolean)
    .sort();
  const contactsPromise = fetchConversationRows<MerchantConversationContactV1Row>(
    runtime,
    "/rest/v1/merchant_conversation_contacts",
    new URLSearchParams({
      select:
        "owner_merchant_id,contact_account_id,customer_id,contact_name,contact_email,source_snapshot,saved_at,source_updated_at",
      owner_merchant_id: `eq.${accountId}`,
      order: "saved_at.asc",
    }),
  );
  const readCursorsPromise =
    fetchConversationRows<MerchantConversationReadCursorV1Row>(
      runtime,
      "/rest/v1/merchant_conversation_read_cursors",
      new URLSearchParams({
        select:
          "thread_id,account_id,last_read_at,source_snapshot,source_updated_at",
        account_id: `eq.${accountId}`,
        order: "thread_id.asc",
      }),
    );
  if (threadIds.length === 0) {
    const [contacts, readCursors] = await Promise.all([
      contactsPromise,
      readCursorsPromise,
    ]);
    return {
      threads: [],
      participants: [],
      messages: [],
      contacts,
      readCursors,
    };
  }
  const threadFilter = buildInFilter(threadIds);
  const [threads, participants, messages, contacts, readCursors] =
    await Promise.all([
      fetchConversationRows<MerchantConversationThreadV1Row>(
        runtime,
        "/rest/v1/merchant_conversation_threads",
        new URLSearchParams({
          select:
            "id,conversation_kind,state,site_id,source_snapshot,source_updated_at,created_at,updated_at",
          id: threadFilter,
          order: "id.asc",
        }),
      ),
      fetchConversationRows<MerchantConversationParticipantV1Row>(
        runtime,
        "/rest/v1/merchant_conversation_participants",
        new URLSearchParams({
          select:
            "thread_id,account_id,participant_role,display_name,email,source_snapshot,joined_at,source_updated_at",
          thread_id: threadFilter,
          order: "thread_id.asc,account_id.asc",
        }),
      ),
      fetchConversationRows<MerchantConversationMessageV1Row>(
        runtime,
        "/rest/v1/merchant_conversation_messages",
        new URLSearchParams({
          select:
            "thread_id,id,sender_account_id,sender_role,body,source_snapshot,created_at,source_updated_at",
          thread_id: threadFilter,
          order: "thread_id.asc,created_at.asc,id.asc",
        }),
      ),
      contactsPromise,
      readCursorsPromise,
    ]);
  return { threads, participants, messages, contacts, readCursors };
}

export async function assertConversationWriteReady(
  runtime: ConversationRestRuntime,
) {
  const rows = await requestConversationJson(
    runtime,
    "/rest/v1/faolla_schema_migrations?select=version&order=version.asc&limit=100",
  );
  if (!Array.isArray(rows)) throw new Error("migration_registry_invalid");
  const versions = new Set(
    rows
      .map((row) => Number((row as { version?: unknown }).version))
      .filter(Number.isFinite),
  );
  const missing = REQUIRED_MIGRATIONS.filter((version) => !versions.has(version));
  if (missing.length > 0) {
    throw new Error(`required_migrations_missing:${missing.join(",")}`);
  }
  const result = await requestConversationJson(
    runtime,
    "/rest/v1/rpc/faolla_upsert_merchant_conversations_v1",
    {
      method: "POST",
      body: JSON.stringify({
        p_mutations: {
          threads: [],
          contacts: [],
          read_cursors: [],
          archived_threads: [],
        },
      }),
    },
  );
  if (Number(result) !== 0) {
    throw new Error("conversation_v1_rpc_readiness_failed");
  }
}
