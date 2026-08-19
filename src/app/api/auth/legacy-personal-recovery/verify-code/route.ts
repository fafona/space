import {
  isValidAuthVerificationCode,
  normalizeAuthVerificationCode,
} from "@/lib/authCredentialValidation";
import { resolveTrustedPublicOrigin } from "@/lib/requestOrigin";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import {
  LegacyPersonalRecoveryError,
  loadLegacyPersonalRecoveryCase,
  verifyLegacyPersonalRecoveryOtp,
} from "@/lib/legacyPersonalRecovery.server";
import {
  bodyTooLargeLegacyPersonalRecoveryResponse,
  clearLegacyPersonalRecoveryNonceCookie,
  hasAcceptableLegacyPersonalRecoveryBodySize,
  legacyPersonalRecoveryErrorResponse,
  legacyPersonalRecoveryJson,
  rateLimitedLegacyPersonalRecoveryResponse,
  readLegacyPersonalRecoveryNonceCookie,
  sameOriginLegacyPersonalRecoveryErrorResponse,
} from "@/lib/legacyPersonalRecoveryHttp.server";
import { consumeLegacyPersonalRecoveryRateLimit } from "@/lib/legacyPersonalRecoveryRateLimit.server";
import {
  createServerSupabaseAuthClient,
  createServerSupabaseServiceClient,
} from "@/lib/superAdminServer";
import {
  createLegacyPersonalRecoveryOtpDependencies,
  type LegacyPersonalRecoverySupabaseAuthClient,
  type LegacyPersonalRecoverySupabaseServiceClient,
} from "@/lib/legacyPersonalRecoverySupabase.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RequestBody = {
  email?: unknown;
  personalAccountId?: unknown;
  code?: unknown;
};

function isExactRequestBody(value: unknown): value is RequestBody {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") ===
        "code,email,personalAccountId",
  );
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return sameOriginLegacyPersonalRecoveryErrorResponse();
  }
  if (!hasAcceptableLegacyPersonalRecoveryBodySize(request)) {
    return bodyTooLargeLegacyPersonalRecoveryResponse();
  }

  try {
    const recoveryCase = loadLegacyPersonalRecoveryCase();
    const rateLimit = consumeLegacyPersonalRecoveryRateLimit(
      recoveryCase,
      "verify_otp",
      request,
    );
    if (!rateLimit.allowed) {
      return rateLimitedLegacyPersonalRecoveryResponse(
        rateLimit.retryAfterSeconds,
      );
    }
    const body = await request.json().catch(() => null);
    if (!isExactRequestBody(body)) {
      throw new LegacyPersonalRecoveryError(
        "legacy_personal_recovery_identity_mismatch",
        401,
      );
    }
    const code = normalizeAuthVerificationCode(body.code);
    if (!isValidAuthVerificationCode(code)) {
      throw new LegacyPersonalRecoveryError(
        "legacy_personal_recovery_otp_invalid_or_expired",
        401,
      );
    }
    const service = createServerSupabaseServiceClient();
    const auth = createServerSupabaseAuthClient();
    if (!service || !auth) {
      return legacyPersonalRecoveryErrorResponse(null);
    }
    const redirectTo = new URL(
      "/auth/legacy-personal-recovery",
      resolveTrustedPublicOrigin(new URL(request.url)),
    ).toString();
    await verifyLegacyPersonalRecoveryOtp(
      recoveryCase,
      {
        email: body.email,
        personalAccountId: body.personalAccountId,
        code,
        nonceCookie: readLegacyPersonalRecoveryNonceCookie(request),
      },
      createLegacyPersonalRecoveryOtpDependencies({
        service:
          service as unknown as LegacyPersonalRecoverySupabaseServiceClient,
        auth: auth as unknown as LegacyPersonalRecoverySupabaseAuthClient,
        redirectTo,
      }),
    );
    const response = legacyPersonalRecoveryJson({
      ok: true,
      verified: true,
      approvalPending: true,
    });
    clearLegacyPersonalRecoveryNonceCookie(response, request);
    return response;
  } catch (error) {
    return legacyPersonalRecoveryErrorResponse(error);
  }
}
