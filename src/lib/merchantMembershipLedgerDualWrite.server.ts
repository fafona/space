import type { MerchantMembershipRecord } from "@/lib/merchantMemberships";
import {
  buildMerchantMembershipLedgerMutations,
  normalizeMembershipLedgerCurrency,
} from "@/lib/merchantMembershipLedger";

export const MERCHANT_MEMBERSHIP_LEDGER_DUAL_WRITE_MODES = ["off", "shadow"] as const;

export type MerchantMembershipLedgerDualWriteMode =
  (typeof MERCHANT_MEMBERSHIP_LEDGER_DUAL_WRITE_MODES)[number];

export type MerchantMembershipLedgerDualWriteConfig = {
  mode: MerchantMembershipLedgerDualWriteMode;
  siteIds: string[];
  timeoutMs: number;
  currency: string;
};

export type MerchantMembershipLedgerShadowClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: unknown }>;
};

export type MerchantMembershipLedgerDualWriteResult = {
  status: "disabled" | "skipped" | "written" | "failed" | "timeout";
  customerCount: number;
  entryCount: number;
  error?: string;
};

type MerchantMembershipLedgerShadowLogger = (event: {
  event: "merchant_membership_ledger_shadow_write_failed";
  status: "failed" | "timeout";
  siteIds: string[];
  membershipIds: string[];
  transactionIds: string[];
  customerCount: number;
  entryCount: number;
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

function normalizeSiteIds(value: unknown) {
  if (typeof value !== "string") return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((siteId) => siteId.trim())
        .filter((siteId) => /^\d{8}$/.test(siteId)),
    ),
  );
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return String(error ?? "").trim() || "unknown_error";
}

export function resolveMerchantMembershipLedgerDualWriteConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantMembershipLedgerDualWriteConfig {
  return {
    mode:
      trimText(environment.MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_MODE).toLowerCase() === "shadow"
        ? "shadow"
        : "off",
    siteIds: normalizeSiteIds(environment.MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_SITE_IDS),
    timeoutMs: normalizeTimeoutMs(environment.MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_TIMEOUT_MS),
    currency: normalizeMembershipLedgerCurrency(
      environment.MERCHANT_MEMBERSHIP_V1_STORED_VALUE_CURRENCY,
    ),
  };
}

function defaultShadowLogger(event: Parameters<MerchantMembershipLedgerShadowLogger>[0]) {
  console.error("[merchant-membership-ledger-dual-write]", JSON.stringify(event));
}

export async function mirrorMerchantMembershipLedgerChanges(
  client: MerchantMembershipLedgerShadowClient,
  input: {
    siteId: string;
    previousMemberships?: readonly MerchantMembershipRecord[] | null;
    nextMemberships: readonly MerchantMembershipRecord[];
  },
  options?: {
    config?: MerchantMembershipLedgerDualWriteConfig;
    logger?: MerchantMembershipLedgerShadowLogger;
  },
): Promise<MerchantMembershipLedgerDualWriteResult> {
  const config = options?.config ?? resolveMerchantMembershipLedgerDualWriteConfig();
  if (config.mode === "off") {
    return { status: "disabled", customerCount: 0, entryCount: 0 };
  }

  const siteId = trimText(input.siteId);
  if (!siteId || !config.siteIds.includes(siteId)) {
    return { status: "skipped", customerCount: 0, entryCount: 0 };
  }

  const mutations = buildMerchantMembershipLedgerMutations({
    previousMemberships: input.previousMemberships,
    nextMemberships: input.nextMemberships.filter(
      (membership) => membership.siteId === siteId,
    ),
    currency: config.currency,
  });
  if (mutations.length === 0) {
    return { status: "skipped", customerCount: 0, entryCount: 0 };
  }

  const customerCount = mutations.length;
  const entryCount = mutations.reduce((sum, mutation) => sum + mutation.entries.length, 0);
  const membershipIds = mutations.map(
    (mutation) => mutation.customer.legacy_membership_id,
  );
  const transactionIds = Array.from(
    new Set(
      mutations.flatMap((mutation) =>
        mutation.entries.map((entry) => entry.reference_id),
      ),
    ),
  );
  const timeoutToken = Symbol("merchant_membership_ledger_shadow_timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const query = Promise.resolve(
      client.rpc("faolla_upsert_merchant_membership_ledger_v1", {
        p_mutations: mutations,
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
        event: "merchant_membership_ledger_shadow_write_failed",
        status: "timeout",
        siteIds: [siteId],
        membershipIds,
        transactionIds,
        customerCount,
        entryCount,
        error,
      });
      return { status: "timeout", customerCount, entryCount, error };
    }

    if (result.error) throw result.error;
    return { status: "written", customerCount, entryCount };
  } catch (error) {
    const message = toErrorMessage(error);
    (options?.logger ?? defaultShadowLogger)({
      event: "merchant_membership_ledger_shadow_write_failed",
      status: "failed",
      siteIds: [siteId],
      membershipIds,
      transactionIds,
      customerCount,
      entryCount,
      error: message,
    });
    return { status: "failed", customerCount, entryCount, error: message };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
