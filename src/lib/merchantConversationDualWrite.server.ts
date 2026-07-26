import type { MerchantPeerInboxPayload } from "@/lib/merchantPeerInbox";
import type { MerchantSupportReadStatePayload } from "@/lib/merchantSupportReadState";
import type { PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";
import {
  buildMerchantConversationReadStateV1Mutation,
  buildMerchantPeerConversationV1Mutation,
  buildPlatformSupportConversationV1Mutation,
  countMerchantConversationV1MutationRecords,
  type MerchantConversationV1Mutation,
} from "@/lib/merchantConversationsV1";

export const MERCHANT_CONVERSATION_DUAL_WRITE_MODES = [
  "off",
  "shadow",
] as const;

export type MerchantConversationDualWriteMode =
  (typeof MERCHANT_CONVERSATION_DUAL_WRITE_MODES)[number];

export type MerchantConversationDualWriteConfig = {
  mode: MerchantConversationDualWriteMode;
  siteIds: string[];
  timeoutMs: number;
};

export type MerchantConversationShadowClient = {
  rpc?: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: unknown }>;
};

export type MerchantConversationDualWriteResult = {
  status: "disabled" | "skipped" | "written" | "failed" | "timeout";
  count: number;
  error?: string;
};

type MerchantConversationShadowSource =
  | "peer"
  | "support"
  | "read-state";

type MerchantConversationShadowLogger = (event: {
  event: "merchant_conversation_shadow_write_failed";
  source: MerchantConversationShadowSource;
  status: "failed" | "timeout";
  siteIds: string[];
  threadIds: string[];
  count: number;
  error: string;
}) => void;

const DEFAULT_TIMEOUT_MS = 2500;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 10000;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimeoutMs(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, parsed));
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const text = String(error ?? "").trim();
  return text || "unknown_error";
}

export function normalizeMerchantConversationDualWriteSiteIds(value: unknown) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(",")
        .map((siteId) => siteId.trim())
        .filter((siteId) => /^\d{8}$/.test(siteId)),
    ),
  );
}
export function resolveMerchantConversationDualWriteConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantConversationDualWriteConfig {
  const requestedMode = trimText(
    environment.MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE,
  ).toLowerCase();
  return {
    mode: requestedMode === "shadow" ? "shadow" : "off",
    siteIds: normalizeMerchantConversationDualWriteSiteIds(
      environment.MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS,
    ),
    timeoutMs: normalizeTimeoutMs(
      environment.MERCHANT_CONVERSATION_V1_DUAL_WRITE_TIMEOUT_MS,
    ),
  };
}

function mutationCount(mutation: MerchantConversationV1Mutation) {
  const counts = countMerchantConversationV1MutationRecords(mutation);
  return (
    counts.threads +
    counts.messages +
    counts.contacts +
    counts.readCursors +
    counts.archivedThreads
  );
}

function defaultShadowLogger(
  event: Parameters<MerchantConversationShadowLogger>[0],
) {
  console.error("[merchant-conversation-dual-write]", JSON.stringify(event));
}

async function mirrorConversationMutation(
  client: MerchantConversationShadowClient,
  source: MerchantConversationShadowSource,
  mutationBuilder: (
    config: MerchantConversationDualWriteConfig,
  ) => MerchantConversationV1Mutation,
  options?: {
    config?: MerchantConversationDualWriteConfig;
    logger?: MerchantConversationShadowLogger;
  },
): Promise<MerchantConversationDualWriteResult> {
  const config =
    options?.config ?? resolveMerchantConversationDualWriteConfig();
  if (config.mode === "off") return { status: "disabled", count: 0 };
  if (config.siteIds.length === 0) return { status: "skipped", count: 0 };

  const timeoutToken = Symbol("merchant_conversation_shadow_timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let mutation: MerchantConversationV1Mutation | null = null;

  try {
    mutation = mutationBuilder(config);
    const count = mutationCount(mutation);
    if (count === 0) return { status: "skipped", count: 0 };
    if (typeof client.rpc !== "function") throw new Error("rpc_unavailable");

    const query = Promise.resolve(
      client.rpc("faolla_upsert_merchant_conversations_v1", {
        p_mutations: mutation,
      }),
    );
    const result = await Promise.race([
      query,
      new Promise<typeof timeoutToken>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(timeoutToken), config.timeoutMs);
      }),
    ]);
    if (result === timeoutToken) {
      const error = `shadow_write_timeout:${config.timeoutMs}`;
      (options?.logger ?? defaultShadowLogger)({
        event: "merchant_conversation_shadow_write_failed",
        source,
        status: "timeout",
        siteIds: config.siteIds,
        threadIds: mutation.threads.map((item) => item.thread.id),
        count,
        error,
      });
      return { status: "timeout", count, error };
    }
    if (result.error) throw result.error;
    return { status: "written", count };
  } catch (error) {
    const message = toErrorMessage(error);
    const count = mutation ? mutationCount(mutation) : 0;
    (options?.logger ?? defaultShadowLogger)({
      event: "merchant_conversation_shadow_write_failed",
      source,
      status: "failed",
      siteIds: config.siteIds,
      threadIds: mutation?.threads.map((item) => item.thread.id) ?? [],
      count,
      error: message,
    });
    return { status: "failed", count, error: message };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export function mirrorMerchantPeerConversationSnapshot(
  client: MerchantConversationShadowClient,
  input: {
    current: MerchantPeerInboxPayload;
    previous?: MerchantPeerInboxPayload | null;
  },
  options?: {
    config?: MerchantConversationDualWriteConfig;
    logger?: MerchantConversationShadowLogger;
    buildMutation?: typeof buildMerchantPeerConversationV1Mutation;
  },
) {
  return mirrorConversationMutation(
    client,
    "peer",
    (config) =>
      (options?.buildMutation ?? buildMerchantPeerConversationV1Mutation)({
        current: input.current,
        previous: input.previous,
        accountIds: config.siteIds,
      }),
    options,
  );
}

export function mirrorPlatformSupportConversationSnapshot(
  client: MerchantConversationShadowClient,
  input: {
    current: PlatformSupportInboxPayload;
    previous?: PlatformSupportInboxPayload | null;
    replace?: boolean;
    operationAt?: string;
  },
  options?: {
    config?: MerchantConversationDualWriteConfig;
    logger?: MerchantConversationShadowLogger;
    buildMutation?: typeof buildPlatformSupportConversationV1Mutation;
  },
) {
  return mirrorConversationMutation(
    client,
    "support",
    (config) =>
      (options?.buildMutation ?? buildPlatformSupportConversationV1Mutation)({
        current: input.current,
        previous: input.previous,
        accountIds: config.siteIds,
        replace: input.replace,
        operationAt: input.operationAt,
      }),
    options,
  );
}

export function mirrorMerchantConversationReadState(
  client: MerchantConversationShadowClient,
  input: {
    current: MerchantSupportReadStatePayload;
    previous?: MerchantSupportReadStatePayload | null;
  },
  options?: {
    config?: MerchantConversationDualWriteConfig;
    logger?: MerchantConversationShadowLogger;
    buildMutation?: typeof buildMerchantConversationReadStateV1Mutation;
  },
) {
  return mirrorConversationMutation(
    client,
    "read-state",
    (config) =>
      (options?.buildMutation ??
        buildMerchantConversationReadStateV1Mutation)({
        current: input.current,
        previous: input.previous,
        accountIds: config.siteIds,
      }),
    options,
  );
}
