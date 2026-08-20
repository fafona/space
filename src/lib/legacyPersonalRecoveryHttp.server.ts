import { NextResponse } from "next/server";
import {
  LEGACY_PERSONAL_RECOVERY_NONCE_COOKIE,
  LEGACY_PERSONAL_RECOVERY_NONCE_COOKIE_V1,
  LegacyPersonalRecoveryError,
} from "@/lib/legacyPersonalRecovery.server";
import { resolveCanonicalPortalHostname } from "@/lib/canonicalPortalRequest";
import { appendLegacyCookieExpiration } from "@/lib/legacyCookieCleanup";
import { parseCookieValues } from "@/lib/merchantAuthSession";

const JSON_BODY_LIMIT_BYTES = 4_096;
const NONCE_COOKIE_MAX_AGE_SECONDS = 15 * 60;

function expireLegacyPersonalRecoveryNonceCookie(response: NextResponse) {
  const rootHostname = resolveCanonicalPortalHostname().replace(/^www\./, "");
  appendLegacyCookieExpiration(response, LEGACY_PERSONAL_RECOVERY_NONCE_COOKIE_V1, {
    httpOnly: true,
  });
  if (rootHostname) {
    appendLegacyCookieExpiration(response, LEGACY_PERSONAL_RECOVERY_NONCE_COOKIE_V1, {
      domain: rootHostname,
      httpOnly: true,
    });
  }
}

export function legacyPersonalRecoveryJson(
  body: unknown,
  init?: ResponseInit,
) {
  const response = NextResponse.json(body, init);
  response.headers.set(
    "cache-control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  );
  response.headers.set("pragma", "no-cache");
  response.headers.set("expires", "0");
  return response;
}

export function legacyPersonalRecoveryErrorResponse(error: unknown) {
  const recoveryError =
    error instanceof LegacyPersonalRecoveryError
      ? error
      : new LegacyPersonalRecoveryError(
          "legacy_personal_recovery_upstream_unavailable",
          503,
        );
  const response = legacyPersonalRecoveryJson(
    { ok: false, error: recoveryError.code },
    { status: recoveryError.status },
  );
  if (recoveryError.status === 429) {
    response.headers.set("retry-after", "60");
  }
  return response;
}

export function hasAcceptableLegacyPersonalRecoveryBodySize(request: Request) {
  const raw = (request.headers.get("content-length") ?? "").trim();
  if (!raw) return true;
  const length = Number(raw);
  return Number.isSafeInteger(length) && length >= 0 && length <= JSON_BODY_LIMIT_BYTES;
}

export function bodyTooLargeLegacyPersonalRecoveryResponse() {
  return legacyPersonalRecoveryJson(
    { ok: false, error: "legacy_personal_recovery_request_too_large" },
    { status: 413 },
  );
}

export function sameOriginLegacyPersonalRecoveryErrorResponse() {
  return legacyPersonalRecoveryJson(
    { ok: false, error: "forbidden_origin" },
    { status: 403 },
  );
}

export function rateLimitedLegacyPersonalRecoveryResponse(
  retryAfterSeconds: number,
) {
  const response = legacyPersonalRecoveryJson(
    { ok: false, error: "legacy_personal_recovery_rate_limited" },
    { status: 429 },
  );
  response.headers.set("retry-after", String(retryAfterSeconds));
  return response;
}

export function readLegacyPersonalRecoveryNonceCookie(request: Request) {
  const values = parseCookieValues(
    request.headers.get("cookie") ?? "",
    LEGACY_PERSONAL_RECOVERY_NONCE_COOKIE,
  ).filter((value) => value.length > 0);
  return values.length === 1 ? values[0] : "";
}

export function setLegacyPersonalRecoveryNonceCookie(
  response: NextResponse,
  request: Request,
  value: string,
) {
  void request;
  response.cookies.set(LEGACY_PERSONAL_RECOVERY_NONCE_COOKIE, value, {
    path: "/",
    maxAge: NONCE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "strict",
    secure: true,
    httpOnly: true,
  });
  expireLegacyPersonalRecoveryNonceCookie(response);
}

export function clearLegacyPersonalRecoveryNonceCookie(
  response: NextResponse,
  request: Request,
) {
  void request;
  response.cookies.set(LEGACY_PERSONAL_RECOVERY_NONCE_COOKIE, "", {
    path: "/",
    maxAge: 0,
    sameSite: "strict",
    secure: true,
    httpOnly: true,
  });
  expireLegacyPersonalRecoveryNonceCookie(response);
}
