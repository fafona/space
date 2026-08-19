import { isAuthRateLimitError } from "@/lib/authCredentialValidation";
import {
  LEGACY_PERSONAL_RECOVERY_RPC_NAMES,
  LegacyPersonalRecoveryError,
  type LegacyPersonalRecoveryApprovalDependencies,
  type LegacyPersonalRecoveryAuthUser,
  type LegacyPersonalRecoveryOtpDependencies,
} from "@/lib/legacyPersonalRecovery.server";

type SupabaseAuthClient = {
  auth: {
    signInWithOtp: (input: {
      email: string;
      options: { shouldCreateUser: false; emailRedirectTo: string };
    }) => Promise<{ error: unknown }>;
    verifyOtp: (input: {
      email: string;
      token: string;
      type: "email";
    }) => Promise<{ data: { user?: unknown } | null; error: unknown }>;
  };
};

type SupabaseServiceClient = {
  auth: {
    admin: {
      getUserById: (
        authUserId: string,
      ) => Promise<{ data: { user?: unknown } | null; error: unknown }>;
      listUsers: (input: {
        page: number;
        perPage: number;
      }) => Promise<{
        data:
          | {
              users?: unknown[];
              nextPage?: unknown;
              lastPage?: unknown;
              total?: unknown;
            }
          | null;
        error: unknown;
      }>;
      updateUserById: (
        authUserId: string,
        attributes: { app_metadata: Record<string, unknown> },
      ) => Promise<{ data: { user?: unknown } | null; error: unknown }>;
    };
  };
  rpc: (
    functionName: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

const AUTH_LIST_PAGE_SIZE = 200;
const AUTH_LIST_MAX_PAGES = 100;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function upstreamError(): never {
  throw new LegacyPersonalRecoveryError(
    "legacy_personal_recovery_upstream_unavailable",
    503,
  );
}

function normalizeAuthUser(value: unknown): LegacyPersonalRecoveryAuthUser {
  const source = record(value);
  const id = typeof source?.id === "string" ? source.id.trim() : "";
  if (!id) upstreamError();
  return {
    id,
    email: typeof source?.email === "string" ? source.email : null,
    appMetadata: record(source?.app_metadata),
    userMetadata: record(source?.user_metadata),
  };
}

async function getAuthUser(
  service: SupabaseServiceClient,
  authUserId: string,
) {
  const result = await service.auth.admin.getUserById(authUserId);
  if (result.error || !result.data?.user) upstreamError();
  return normalizeAuthUser(result.data.user);
}

async function updateAuthAppMetadata(
  service: SupabaseServiceClient,
  authUserId: string,
  appMetadata: Record<string, unknown>,
) {
  const result = await service.auth.admin.updateUserById(authUserId, {
    app_metadata: appMetadata,
  });
  if (result.error || !result.data?.user) upstreamError();
  const updated = normalizeAuthUser(result.data.user);
  if (updated.id.trim().toLowerCase() !== authUserId.trim().toLowerCase()) {
    upstreamError();
  }
}

async function listAuthUsers(service: SupabaseServiceClient) {
  const users: LegacyPersonalRecoveryAuthUser[] = [];
  const seenIds = new Set<string>();
  let expectedTotal: number | null = null;
  let page = 1;

  // auth-js 2.93.3 truncates two-digit Link page numbers to their first
  // digit. Total comes from X-Total-Count and is not affected, so derive the
  // traversal from total while accepting only the SDK's exact known
  // representation (or the correct value) for nextPage/lastPage.
  const paginationValueMatches = (value: unknown, expected: number | null) => {
    if (expected === null) return value === null;
    if (!Number.isSafeInteger(value)) return false;
    return (
      value === expected ||
      (expected >= 10 && value === Number(String(expected).slice(0, 1)))
    );
  };

  for (let iteration = 0; iteration < AUTH_LIST_MAX_PAGES; iteration += 1) {
    const result = await service.auth.admin.listUsers({
      page,
      perPage: AUTH_LIST_PAGE_SIZE,
    });
    if (result.error || !Array.isArray(result.data?.users)) upstreamError();
    const total = result.data.total;
    if (!Number.isSafeInteger(total) || (total as number) < 0) {
      upstreamError();
    }
    const normalizedTotal = total as number;
    if (expectedTotal === null) {
      expectedTotal = normalizedTotal;
    } else if (normalizedTotal !== expectedTotal) {
      upstreamError();
    }
    const computedLastPage =
      normalizedTotal === 0
        ? 0
        : Math.ceil(normalizedTotal / AUTH_LIST_PAGE_SIZE);
    if (computedLastPage > AUTH_LIST_MAX_PAGES) upstreamError();
    const expectedRowCount = Math.max(
      0,
      Math.min(
        AUTH_LIST_PAGE_SIZE,
        normalizedTotal - (page - 1) * AUTH_LIST_PAGE_SIZE,
      ),
    );
    const expectedNextPage =
      page < computedLastPage ? page + 1 : null;
    if (
      result.data.users.length !== expectedRowCount ||
      !paginationValueMatches(result.data.lastPage, computedLastPage) ||
      !paginationValueMatches(result.data.nextPage, expectedNextPage)
    ) {
      upstreamError();
    }
    const pageUsers = result.data.users.map(normalizeAuthUser);
    for (const user of pageUsers) {
      const id = user.id.trim().toLowerCase();
      if (seenIds.has(id)) upstreamError();
      seenIds.add(id);
    }
    users.push(...pageUsers);
    if (users.length > normalizedTotal) upstreamError();
    if (expectedNextPage === null) {
      if (users.length !== normalizedTotal) upstreamError();
      return users;
    }
    page = expectedNextPage;
  }
  upstreamError();
}

async function rpc(
  service: SupabaseServiceClient,
  functionName: string,
  args: Record<string, unknown>,
) {
  let result: { data: unknown; error: unknown };
  try {
    result = await service.rpc(functionName, args);
  } catch {
    upstreamError();
  }
  if (!result || result.error) upstreamError();
  return result.data;
}

async function inspectDirectory(
  service: SupabaseServiceClient,
  authUserId: string,
  personalAccountId: string,
) {
  return rpc(service, LEGACY_PERSONAL_RECOVERY_RPC_NAMES.observer, {
    p_auth_user_id: authUserId,
    p_personal_account_id: personalAccountId,
  });
}

export function createLegacyPersonalRecoveryOtpDependencies(input: {
  service: SupabaseServiceClient;
  auth: SupabaseAuthClient;
  redirectTo: string;
}): LegacyPersonalRecoveryOtpDependencies {
  return {
    getAuthUser: (authUserId) => getAuthUser(input.service, authUserId),
    async sendOtp(email) {
      const result = await input.auth.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: input.redirectTo,
        },
      });
      if (result.error) {
        if (isAuthRateLimitError(result.error)) {
          throw new LegacyPersonalRecoveryError(
            "legacy_personal_recovery_rate_limited",
            429,
          );
        }
        upstreamError();
      }
    },
    async verifyOtp(email, code) {
      const result = await input.auth.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (result.error || !result.data?.user) {
        if (isAuthRateLimitError(result.error)) {
          throw new LegacyPersonalRecoveryError(
            "legacy_personal_recovery_rate_limited",
            429,
          );
        }
        return null;
      }
      return normalizeAuthUser(result.data.user);
    },
    updateAuthAppMetadata: (authUserId, appMetadata) =>
      updateAuthAppMetadata(input.service, authUserId, appMetadata),
  };
}

export function createLegacyPersonalRecoveryApprovalDependencies(
  service: SupabaseServiceClient,
  reauthorizeOperator: () => boolean = () => false,
): LegacyPersonalRecoveryApprovalDependencies {
  return {
    reauthorizeOperator,
    getAuthUser: (authUserId) => getAuthUser(service, authUserId),
    listAuthUsers: () => listAuthUsers(service),
    resolveAuthorization: (authUserId) =>
      rpc(service, LEGACY_PERSONAL_RECOVERY_RPC_NAMES.resolve, {
        p_auth_user_id: authUserId,
      }),
    loadReadiness: () =>
      rpc(service, LEGACY_PERSONAL_RECOVERY_RPC_NAMES.readiness, {}),
    inspectDirectory: (authUserId, personalAccountId) =>
      inspectDirectory(service, authUserId, personalAccountId),
    createAuthorization: (authUserId, accountType, personalAccountId) =>
      rpc(service, LEGACY_PERSONAL_RECOVERY_RPC_NAMES.create, {
        p_auth_user_id: authUserId,
        p_account_type: accountType,
        p_account_id: personalAccountId,
      }),
    updateAuthAppMetadata: (authUserId, appMetadata) =>
      updateAuthAppMetadata(service, authUserId, appMetadata),
  };
}

export type LegacyPersonalRecoverySupabaseAuthClient = SupabaseAuthClient;
export type LegacyPersonalRecoverySupabaseServiceClient = SupabaseServiceClient;
