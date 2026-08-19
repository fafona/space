import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import {
  buildPersonalAccountPermissionConfig,
  readPersonalAccountServiceConfigFromMetadata,
  type PersonalAccountServiceConfig,
} from "@/lib/personalAccountServiceConfig";
import { readMerchantAuthCookie, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import {
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { loadActiveOrdinaryAccountAuthorization } from "@/lib/ordinaryAccountPrincipal.server";
import { normalizeCanonicalPersonalAccountId } from "@/lib/personalAccountId";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  verifyFrontendAuthProof,
  type FrontendAuthProofPayload,
} from "@/lib/frontendAuthProof.server";

export type PersonalAccountSession = {
  adminSupabase: PlatformIdentitySupabaseClient;
  user: MerchantAuthUserSummary;
  accountId: string;
  userId: string;
  email: string;
  serviceConfig: PersonalAccountServiceConfig;
  servicePaused: boolean;
  permissionConfig: ReturnType<typeof buildPersonalAccountPermissionConfig>;
};

export class FrontendPersonalSessionProofError extends Error {
  readonly code = "frontend_personal_session_proof_rejected";
  readonly status = 401;

  constructor() {
    super("frontend_personal_session_proof_rejected");
    this.name = "FrontendPersonalSessionProofError";
  }
}

export function isFrontendPersonalSessionProofError(
  error: unknown,
): error is FrontendPersonalSessionProofError {
  return error instanceof FrontendPersonalSessionProofError;
}

type AdminGetUserByIdResult = {
  data?: { user?: MerchantAuthUserSummary | null } | null;
  error?: unknown;
};

type PersonalAccountServiceSupabaseClient = PlatformIdentitySupabaseClient & {
  auth: PlatformIdentitySupabaseClient["auth"] & {
    admin: PlatformIdentitySupabaseClient["auth"]["admin"] & {
      getUserById?: (userId: string) => Promise<AdminGetUserByIdResult>;
    };
  };
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function loadFreshAuthUser(
  adminSupabase: PlatformIdentitySupabaseClient,
  userId: string,
): Promise<MerchantAuthUserSummary | null> {
  const admin = (adminSupabase as PersonalAccountServiceSupabaseClient).auth.admin;
  const getUserById = admin.getUserById;
  if (typeof getUserById === "function") {
    try {
      const { data, error } = await admin.getUserById!(userId);
      if (!error && data?.user) return data.user;
    } catch {
      // Fall through to paged lookup below.
    }
  }

  try {
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return null;
      const users = data?.users ?? [];
      const matched = users.find((user) => trimText(user.id, 128) === userId);
      if (matched) return matched;
      if (users.length < 200) break;
    }
  } catch {
    return null;
  }
  return null;
}

export async function resolvePersonalAccountSessionFromRequest(request: Request): Promise<PersonalAccountSession | null> {
  const authSupabase = createServerSupabaseAuthClient();
  const adminSupabase = createServerSupabaseServiceClient() as unknown as PlatformIdentitySupabaseClient | null;
  if (!authSupabase || !adminSupabase) return null;

  const candidates = [...readMerchantRequestAccessTokens(request), readMerchantAuthCookie(request)]
    .map((value) => trimText(value))
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);

  let user: MerchantAuthUserSummary | null = null;
  for (const accessToken of candidates) {
    const { data, error } = await authSupabase.auth.getUser(accessToken).catch(() => ({ data: null, error: true }));
    if (!error && data?.user) {
      user = data.user as MerchantAuthUserSummary;
      break;
    }
  }

  const userId = trimText(user?.id, 128);
  if (!user || !userId) return null;
  user = (await loadFreshAuthUser(adminSupabase, userId)) ?? user;

  const authorization = await loadActiveOrdinaryAccountAuthorization(
    adminSupabase,
    user,
  ).catch(() => null);
  if (!authorization || authorization.accountType !== "personal") return null;
  const accountId = authorization.personalAccountId;
  const serviceConfig = readPersonalAccountServiceConfigFromMetadata(user);

  return {
    adminSupabase,
    user,
    accountId,
    userId,
    email: trimText(user.email, 320).toLowerCase(),
    serviceConfig,
    servicePaused: serviceConfig.servicePaused,
    permissionConfig: buildPersonalAccountPermissionConfig(serviceConfig),
  };
}

export async function resolvePersonalAccountSessionFromFrontendAuthProofPayload(
  payload: FrontendAuthProofPayload | null | undefined,
): Promise<PersonalAccountSession | null> {
  if (!payload || payload.accountType !== "personal") return null;
  const adminSupabase = createServerSupabaseServiceClient() as unknown as PlatformIdentitySupabaseClient | null;
  if (!adminSupabase) return null;

  const userId = trimText(payload.userId, 128);
  if (!userId) return null;
  const user = await loadFreshAuthUser(adminSupabase, userId);
  if (!user || trimText(user.id, 128) !== userId) return null;

  const authorization = await loadActiveOrdinaryAccountAuthorization(
    adminSupabase,
    user,
  ).catch(() => null);
  if (!authorization || authorization.accountType !== "personal") return null;
  const accountId = authorization.personalAccountId;
  const proofAccountId = normalizeCanonicalPersonalAccountId(
    payload.accountId,
  );
  if (!proofAccountId || proofAccountId !== accountId) return null;

  const serviceConfig = readPersonalAccountServiceConfigFromMetadata(user);
  return {
    adminSupabase,
    user,
    accountId,
    userId,
    email: trimText(user.email, 320).toLowerCase(),
    serviceConfig,
    servicePaused: serviceConfig.servicePaused,
    permissionConfig: buildPersonalAccountPermissionConfig(serviceConfig),
  };
}


/**
 * The signed proof transports a candidate Auth UUID only. It never establishes
 * a principal by itself: the current 035 resolver result must still be active,
 * personal, and exactly match both the proof userId and accountId.
 */
export async function resolvePersonalAccountSessionFromRequestOrFrontendAuthProof(
  request: Request,
  frontendAuthProof: unknown,
  requestSessionResolver: (
    request: Request,
  ) => Promise<PersonalAccountSession | null> = resolvePersonalAccountSessionFromRequest,
): Promise<PersonalAccountSession | null> {
  let proofSession: PersonalAccountSession | null = null;
  if (frontendAuthProof !== undefined) {
    const payload = verifyFrontendAuthProof(frontendAuthProof);
    if (!payload) throw new FrontendPersonalSessionProofError();
    proofSession =
      await resolvePersonalAccountSessionFromFrontendAuthProofPayload(payload);
    if (!proofSession) throw new FrontendPersonalSessionProofError();
  }

  const directSession = await requestSessionResolver(request);
  if (directSession) {
    if (
      proofSession &&
      (proofSession.userId !== directSession.userId ||
        proofSession.accountId !== directSession.accountId)
    ) {
      throw new FrontendPersonalSessionProofError();
    }
    return directSession;
  }
  return proofSession;
}
