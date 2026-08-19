import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";
import {
  LegacyPersonalRecoveryError,
  approveLegacyPersonalRecovery,
  getLegacyPersonalRecoveryStatus,
  loadLegacyPersonalRecoveryCase,
} from "@/lib/legacyPersonalRecovery.server";
import {
  bodyTooLargeLegacyPersonalRecoveryResponse,
  hasAcceptableLegacyPersonalRecoveryBodySize,
  legacyPersonalRecoveryErrorResponse,
  legacyPersonalRecoveryJson,
  rateLimitedLegacyPersonalRecoveryResponse,
  sameOriginLegacyPersonalRecoveryErrorResponse,
} from "@/lib/legacyPersonalRecoveryHttp.server";
import { consumeLegacyPersonalRecoveryRateLimit } from "@/lib/legacyPersonalRecoveryRateLimit.server";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  createLegacyPersonalRecoveryApprovalDependencies,
  type LegacyPersonalRecoverySupabaseServiceClient,
} from "@/lib/legacyPersonalRecoverySupabase.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorizedResponse() {
  return legacyPersonalRecoveryJson(
    { ok: false, error: "unauthorized" },
    { status: 401 },
  );
}

function loadDependencies(request?: Request) {
  const service = createServerSupabaseServiceClient();
  if (!service) {
    throw new LegacyPersonalRecoveryError(
      "legacy_personal_recovery_upstream_unavailable",
      503,
    );
  }
  return createLegacyPersonalRecoveryApprovalDependencies(
    service as unknown as LegacyPersonalRecoverySupabaseServiceClient,
    () => Boolean(request && isSuperAdminRequestAuthorized(request)),
  );
}

export async function GET(request: Request) {
  if (!isSuperAdminRequestAuthorized(request)) return unauthorizedResponse();
  try {
    const recoveryCase = loadLegacyPersonalRecoveryCase();
    const status = await getLegacyPersonalRecoveryStatus(
      recoveryCase,
      loadDependencies(),
    );
    return legacyPersonalRecoveryJson(status);
  } catch (error) {
    return legacyPersonalRecoveryErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return sameOriginLegacyPersonalRecoveryErrorResponse();
  }
  if (!isSuperAdminRequestAuthorized(request)) return unauthorizedResponse();
  if (!hasAcceptableLegacyPersonalRecoveryBodySize(request)) {
    return bodyTooLargeLegacyPersonalRecoveryResponse();
  }
  try {
    const recoveryCase = loadLegacyPersonalRecoveryCase();
    const rateLimit = consumeLegacyPersonalRecoveryRateLimit(
      recoveryCase,
      "approve",
      request,
    );
    if (!rateLimit.allowed) {
      return rateLimitedLegacyPersonalRecoveryResponse(
        rateLimit.retryAfterSeconds,
      );
    }
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      body.confirm !== true
    ) {
      return legacyPersonalRecoveryJson(
        { ok: false, error: "legacy_personal_recovery_confirmation_required" },
        { status: 400 },
      );
    }
    const result = await approveLegacyPersonalRecovery(
      recoveryCase,
      loadDependencies(request),
    );
    return legacyPersonalRecoveryJson(result);
  } catch (error) {
    return legacyPersonalRecoveryErrorResponse(error);
  }
}
