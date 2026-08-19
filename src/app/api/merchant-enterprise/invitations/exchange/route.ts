import { createHash } from "node:crypto";

import { createClient, type User } from "@supabase/supabase-js";
import { normalizeAuthEmail } from "@/lib/authCredentialValidation";
import { hashMerchantEnterpriseInvitationToken } from "@/lib/merchantEnterpriseInvitationSecret.server";
import type { MerchantOutboxRpcClient } from "@/lib/merchantOutboxEnqueue.server";
import { hasImmutableMerchantStaffPrincipal } from "@/lib/merchantStaffPrincipal.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STAFF_EMAIL_HASH_METADATA_KEY = "merchant_staff_email_hash";
const FORM_KEYS = [
  "attemptId",
  "invitationToken",
  "invitationVersion",
  "siteId",
] as const;

type ExchangeLinkType = "invite" | "magiclink";

type ExchangeAuthAdmin = {
  getUserById(userId: string): PromiseLike<{
    data: { user: User | null };
    error: unknown;
  }>;
  generateLink(input: {
    type: ExchangeLinkType;
    email: string;
    options: { redirectTo: string };
  }): PromiseLike<{
    data: {
      user: User | null;
      properties:
        | {
            action_link?: unknown;
            hashed_token?: unknown;
            redirect_to?: unknown;
            verification_type?: unknown;
          }
        | null;
    };
    error: unknown;
  }>;
};

export type MerchantEnterpriseInvitationExchangeConfig = {
  publicOrigin: string;
  publicSupabaseOrigin: string;
  issuanceLeaseSeconds: number;
};

export type MerchantEnterpriseInvitationExchangeDependencies = {
  rpcClient: MerchantOutboxRpcClient;
  authAdmin: ExchangeAuthAdmin;
  config: MerchantEnterpriseInvitationExchangeConfig;
};

type ExchangeClaim = {
  siteId: string;
  employeeId: string;
  authUserId: string;
  invitationVersion: number;
  issuanceId: string;
  tokenHash: string;
  email: string;
  emailHash: string;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedEmailHash(email: string) {
  return createHash("sha256").update(email, "utf8").digest("hex");
}

function normalizeOrigin(value: unknown, code: string) {
  let url: URL;
  try {
    url = new URL(trimText(value));
  } catch {
    throw new Error(code);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    url.hostname.toLowerCase(),
  );
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(code);
  }
  return url.origin;
}

function readBoundedInteger(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = trimText(environment[name]);
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name.toLowerCase()}_invalid`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name.toLowerCase()}_invalid`);
  }
  return value;
}

export function resolveMerchantEnterpriseInvitationExchangeConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantEnterpriseInvitationExchangeConfig {
  const authLinkTtlSeconds = readBoundedInteger(
    environment,
    "MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS",
    3600,
    60,
    86_100,
  );
  const issuanceLeaseSeconds = readBoundedInteger(
    environment,
    "MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS",
    3900,
    60,
    86_400,
  );
  if (issuanceLeaseSeconds < authLinkTtlSeconds + 300) {
    throw new Error("invitation_issuance_lease_too_short");
  }
  return {
    publicOrigin: normalizeOrigin(
      environment.MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN,
      "invitation_public_origin_invalid",
    ),
    publicSupabaseOrigin: normalizeOrigin(
      environment.NEXT_PUBLIC_SUPABASE_URL,
      "invitation_supabase_origin_invalid",
    ),
    issuanceLeaseSeconds,
  };
}

function responseHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function errorResponse(code: string, status: number, retryAfterSeconds?: number) {
  const headers = responseHeaders({ "Content-Type": "application/json; charset=utf-8" });
  if (retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(retryAfterSeconds));
  }
  return new Response(JSON.stringify({ error: code }), { status, headers });
}

function invitationErrorRedirect(
  siteId: string,
  code: "invalid" | "rate_limited" | "unavailable",
  retryAfterSeconds = 0,
) {
  const safeSiteId = /^\d{8}$/.test(siteId) ? siteId : "";
  const retryAfter = Math.min(86_400, Math.max(0, Math.floor(retryAfterSeconds)));
  const query = new URLSearchParams({
    invitation_error: code,
    retry_after: String(retryAfter),
  });
  const headers = responseHeaders({
    Location: `${safeSiteId ? `/enterprise/${safeSiteId}` : "/enterprise"}?${query}`,
  });
  if (code === "rate_limited") {
    headers.set("Retry-After", String(Math.max(1, retryAfter)));
  }
  return new Response(null, { status: 303, headers });
}

class ExchangeFormError extends Error {
  readonly siteId: string;

  constructor(siteId = "") {
    super("invalid_invitation_exchange_form");
    this.siteId = /^\d{8}$/.test(siteId) ? siteId : "";
  }
}

function parseExchangeForm(request: Request) {
  const contentType = trimText(request.headers.get("content-type"))
    .split(";", 1)[0]
    ?.toLowerCase();
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    contentType !== "application/x-www-form-urlencoded" ||
    (Number.isFinite(contentLength) && contentLength > 4096)
  ) {
    throw new ExchangeFormError();
  }
  return request.text().then((body) => {
    if (body.length > 4096) throw new ExchangeFormError();
    const form = new URLSearchParams(body);
    const candidateSiteId = trimText(form.get("siteId"));
    const keys = Array.from(form.keys()).sort();
    if (
      keys.length !== FORM_KEYS.length ||
      keys.some((key, index) => key !== FORM_KEYS[index]) ||
      FORM_KEYS.some((key) => form.getAll(key).length !== 1)
    ) {
      throw new ExchangeFormError(candidateSiteId);
    }
    const siteId = trimText(form.get("siteId"));
    const versionText = trimText(form.get("invitationVersion"));
    const invitationToken = trimText(form.get("invitationToken"));
    const attemptId = trimText(form.get("attemptId")).toLowerCase();
    const invitationVersion = Number(versionText);
    if (
      !/^\d{8}$/.test(siteId) ||
      !/^[1-9][0-9]{0,17}$/.test(versionText) ||
      !Number.isSafeInteger(invitationVersion) ||
      !TOKEN_PATTERN.test(invitationToken) ||
      !UUID_V4_PATTERN.test(attemptId)
    ) {
      throw new ExchangeFormError(candidateSiteId);
    }
    return { siteId, invitationVersion, invitationToken, attemptId };
  });
}

async function callRpc(
  client: MerchantOutboxRpcClient,
  functionName: string,
  input: Record<string, unknown>,
) {
  const result = await Promise.resolve(client.rpc(functionName, { p_input: input }));
  if (result.error) throw result.error;
  return result.data;
}

function normalizeClaim(
  value: unknown,
  expected: {
    siteId: string;
    invitationVersion: number;
    tokenHash: string;
    attemptId: string;
  },
):
  | { allowed: false; reason: string; retryAfterSeconds: number }
  | { allowed: true; claim: ExchangeClaim } {
  const row = recordValue(value);
  if (row?.allowed === false) {
    const reason = trimText(row.reason);
    const retryAfterSeconds = Number(row.retry_after_seconds);
    if (
      !["invalid_or_expired", "identity_mismatch", "issuance_cooldown", "rate_limited"].includes(
        reason,
      ) ||
      !Number.isSafeInteger(retryAfterSeconds) ||
      retryAfterSeconds < 0 ||
      retryAfterSeconds > 86_400
    ) {
      throw new Error("invitation_exchange_response_invalid");
    }
    return { allowed: false, reason, retryAfterSeconds };
  }
  const siteId = trimText(row?.merchant_id);
  const employeeId = trimText(row?.employee_id).toLowerCase();
  const authUserId = trimText(row?.auth_user_id).toLowerCase();
  const issuanceId = trimText(row?.issuance_id).toLowerCase();
  const leaseUntil = trimText(row?.lease_until);
  const invitationVersion = Number(row?.invitation_version);
  const email = normalizeAuthEmail(row?.email);
  const emailHash = trimText(row?.email_hash).toLowerCase();
  if (
    row?.allowed !== true ||
    siteId !== expected.siteId ||
    invitationVersion !== expected.invitationVersion ||
    !UUID_PATTERN.test(employeeId) ||
    !UUID_PATTERN.test(authUserId) ||
    !UUID_V4_PATTERN.test(issuanceId) ||
    issuanceId !== expected.attemptId ||
    !Number.isFinite(Date.parse(leaseUntil)) ||
    !email ||
    emailHash !== normalizedEmailHash(email)
  ) {
    throw new Error("invitation_exchange_response_invalid");
  }
  return {
    allowed: true,
    claim: {
      siteId,
      employeeId,
      authUserId,
      invitationVersion,
      issuanceId,
      tokenHash: expected.tokenHash,
      email,
      emailHash,
    },
  };
}

function assertExactStaffUser(user: User | null | undefined, claim: ExchangeClaim) {
  if (
    !user ||
    trimText(user.id).toLowerCase() !== claim.authUserId ||
    normalizeAuthEmail(user.email) !== claim.email ||
    !hasImmutableMerchantStaffPrincipal(user) ||
    trimText(user.app_metadata?.[STAFF_EMAIL_HASH_METADATA_KEY]).toLowerCase() !==
      claim.emailHash
  ) {
    throw new Error("invitation_exchange_identity_mismatch");
  }
  return user;
}

function isConfirmedUser(user: User) {
  return Boolean(trimText(user.email_confirmed_at) || trimText(user.confirmed_at));
}

function canFallbackToMagicLink(error: unknown) {
  const row = recordValue(error);
  const text = `${trimText(row?.code)} ${trimText(row?.message)}`.toLowerCase();
  return (
    text.includes("email_exists") ||
    text.includes("user_already_exists") ||
    text.includes("already been registered") ||
    text.includes("already registered")
  );
}

function validateGeneratedActionLink(
  value: unknown,
  input: {
    type: ExchangeLinkType;
    redirectTo: string;
    publicSupabaseOrigin: string;
  },
) {
  const properties = recordValue(value);
  const actionLink = trimText(properties?.action_link);
  const hashedToken = trimText(properties?.hashed_token);
  const redirectTo = trimText(properties?.redirect_to);
  const verificationType = trimText(properties?.verification_type);
  let url: URL;
  try {
    url = new URL(actionLink);
  } catch {
    throw new Error("invitation_action_link_invalid");
  }
  const queryEntries = Array.from(url.searchParams.entries());
  const queryKeys = queryEntries.map(([key]) => key).sort();
  if (
    url.origin !== input.publicSupabaseOrigin ||
    url.pathname !== "/auth/v1/verify" ||
    url.username ||
    url.password ||
    url.hash ||
    queryKeys.length !== 3 ||
    queryKeys[0] !== "redirect_to" ||
    queryKeys[1] !== "token" ||
    queryKeys[2] !== "type" ||
    url.searchParams.getAll("token").length !== 1 ||
    url.searchParams.getAll("type").length !== 1 ||
    url.searchParams.getAll("redirect_to").length !== 1 ||
    !hashedToken ||
    url.searchParams.get("token") !== hashedToken ||
    url.searchParams.get("type") !== input.type ||
    url.searchParams.get("redirect_to") !== input.redirectTo ||
    redirectTo !== input.redirectTo ||
    verificationType !== input.type
  ) {
    throw new Error("invitation_action_link_invalid");
  }
  return url.toString();
}

function claimRpcInput(claim: ExchangeClaim) {
  return {
    merchant_id: claim.siteId,
    employee_id: claim.employeeId,
    auth_user_id: claim.authUserId,
    invitation_version: claim.invitationVersion,
    issuance_id: claim.issuanceId,
    token_hash: claim.tokenHash,
  };
}

async function releaseClaim(
  dependencies: MerchantEnterpriseInvitationExchangeDependencies,
  claim: ExchangeClaim,
) {
  await callRpc(
    dependencies.rpcClient,
    "faolla_release_merchant_employee_invitation_exchange_v1",
    {
      merchant_id: claim.siteId,
      employee_id: claim.employeeId,
      auth_user_id: claim.authUserId,
      invitation_version: claim.invitationVersion,
      issuance_id: claim.issuanceId,
    },
  ).catch(() => null);
}

export function createMerchantEnterpriseInvitationExchangeHandler(
  dependencies: MerchantEnterpriseInvitationExchangeDependencies,
) {
  return async function handleInvitationExchange(request: Request) {
    if (!isTrustedSameOriginMutationRequest(request)) {
      return errorResponse("forbidden_origin", 403);
    }
    let form: Awaited<ReturnType<typeof parseExchangeForm>>;
    try {
      form = await parseExchangeForm(request);
    } catch (error) {
      return invitationErrorRedirect(
        error instanceof ExchangeFormError ? error.siteId : "",
        "invalid",
      );
    }
    const tokenHash = hashMerchantEnterpriseInvitationToken(form.invitationToken);
    let begin: ReturnType<typeof normalizeClaim>;
    try {
      begin = normalizeClaim(
        await callRpc(
          dependencies.rpcClient,
          "faolla_begin_merchant_employee_invitation_exchange_v1",
          {
            merchant_id: form.siteId,
            invitation_version: form.invitationVersion,
            token_hash: tokenHash,
            attempt_id: form.attemptId,
            issuance_lease_seconds: dependencies.config.issuanceLeaseSeconds,
          },
        ),
        {
          siteId: form.siteId,
          invitationVersion: form.invitationVersion,
          tokenHash,
          attemptId: form.attemptId,
        },
      );
    } catch {
      return invitationErrorRedirect(form.siteId, "unavailable");
    }
    if (!begin.allowed) {
      if (["issuance_cooldown", "rate_limited"].includes(begin.reason)) {
        return invitationErrorRedirect(
          form.siteId,
          "rate_limited",
          Math.max(1, begin.retryAfterSeconds),
        );
      }
      return invitationErrorRedirect(form.siteId, "invalid");
    }

    const claim = begin.claim;
    const redirectTo = new URL(
      `/enterprise/${encodeURIComponent(claim.siteId)}`,
      dependencies.config.publicOrigin,
    ).toString();
    let generationStarted = false;
    try {
      const initial = await Promise.resolve(
        dependencies.authAdmin.getUserById(claim.authUserId),
      );
      if (initial.error) throw initial.error;
      let user = assertExactStaffUser(initial.data.user, claim);
      let type: ExchangeLinkType = isConfirmedUser(user) ? "magiclink" : "invite";
      generationStarted = true;
      let generated = await Promise.resolve(
        dependencies.authAdmin.generateLink({
          type,
          email: claim.email,
          options: { redirectTo },
        }),
      );
      if (generated.error && type === "invite" && canFallbackToMagicLink(generated.error)) {
        const refreshed = await Promise.resolve(
          dependencies.authAdmin.getUserById(claim.authUserId),
        );
        if (refreshed.error) throw refreshed.error;
        user = assertExactStaffUser(refreshed.data.user, claim);
        if (!isConfirmedUser(user)) throw generated.error;
        type = "magiclink";
        generated = await Promise.resolve(
          dependencies.authAdmin.generateLink({
            type,
            email: claim.email,
            options: { redirectTo },
          }),
        );
      }
      if (generated.error) throw generated.error;
      assertExactStaffUser(generated.data.user, claim);
      const actionLink = validateGeneratedActionLink(generated.data.properties, {
        type,
        redirectTo,
        publicSupabaseOrigin: dependencies.config.publicSupabaseOrigin,
      });
      const marked = recordValue(
        await callRpc(
          dependencies.rpcClient,
          "faolla_mark_merchant_employee_invitation_exchange_issued_v1",
          claimRpcInput(claim),
        ),
      );
      if (
        marked?.issued !== true ||
        trimText(marked.issuance_id).toLowerCase() !== claim.issuanceId
      ) {
        throw new Error("invitation_exchange_mark_invalid");
      }
      const rechecked = recordValue(
        await callRpc(
          dependencies.rpcClient,
          "faolla_recheck_merchant_employee_invitation_exchange_v1",
          claimRpcInput(claim),
        ),
      );
      if (
        rechecked?.valid !== true ||
        trimText(rechecked.issuance_id).toLowerCase() !== claim.issuanceId
      ) {
        throw new Error("invitation_exchange_recheck_invalid");
      }
      return new Response(null, {
        status: 303,
        headers: responseHeaders({ Location: actionLink }),
      });
    } catch {
      if (!generationStarted) await releaseClaim(dependencies, claim);
      return invitationErrorRedirect(form.siteId, "unavailable");
    }
  };
}

function createExchangeDependencies() {
  const config = resolveMerchantEnterpriseInvitationExchangeConfig();
  const serviceRoleKey =
    trimText(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    trimText(process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY);
  if (!serviceRoleKey) throw new Error("supabase_service_env_missing");
  const client = createClient(config.publicSupabaseOrigin, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return {
    rpcClient: client as unknown as MerchantOutboxRpcClient,
    authAdmin: client.auth.admin as unknown as ExchangeAuthAdmin,
    config,
  };
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return errorResponse("forbidden_origin", 403);
  }
  let dependencies: MerchantEnterpriseInvitationExchangeDependencies;
  try {
    dependencies = createExchangeDependencies();
  } catch {
    return invitationErrorRedirect("", "unavailable");
  }
  return createMerchantEnterpriseInvitationExchangeHandler(dependencies)(request);
}
