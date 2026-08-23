import {
  createServerSupabaseAuthClient,
  createServerSupabaseServiceClient,
} from "@/lib/superAdminServer";
import {
  readMerchantAuthCookie,
  readMerchantAuthMerchantIdCookie,
  readMerchantRequestAccessTokens,
} from "@/lib/merchantAuthSession";
import { resolveOrdinaryAccountPlatformIdentity } from "@/lib/ordinaryAccountPrincipal.server";

type AuthUserSummary = {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type MerchantSessionHintInput = {
  hintedMerchantId?: string | null;
  hintedMerchantEmail?: string | null;
  hintedMerchantName?: string | null;
};

export type ResolvedMerchantSession = {
  merchantId: string;
  merchantEmail: string;
  merchantName: string;
};

export type ResolvedMerchantPrincipal = ResolvedMerchantSession & {
  merchantIds: string[];
};

const MERCHANT_SESSION_LOOKUP_TIMEOUT_MS = 4_500;
const merchantSessionInflight = new Map<
  string,
  Promise<ResolvedMerchantPrincipal | null>
>();

async function withTimeout<T>(
  task: PromiseLike<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(
          () => resolve(fallback),
          Math.max(500, timeoutMs),
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) return normalized;
  }
  return "";
}

function readMerchantSessionHints(
  request: Request,
  hintInput?: MerchantSessionHintInput,
) {
  const requestUrl = new URL(request.url);
  const hintedSiteId =
    trimText(hintInput?.hintedMerchantId) ||
    trimText(request.headers.get("x-merchant-site-id")) ||
    trimText(requestUrl.searchParams.get("siteId")) ||
    readMerchantAuthMerchantIdCookie(request);
  // Email hints remain accepted for call-site compatibility but are never
  // copied into the authenticated principal because 035 binds account ids,
  // not mutable email aliases.
  void hintInput?.hintedMerchantEmail;
  const hintedName =
    trimText(hintInput?.hintedMerchantName) ||
    trimText(request.headers.get("x-merchant-name")) ||
    trimText(requestUrl.searchParams.get("merchantName"));

  return {
    hintedMerchantId: hintedSiteId.slice(0, 64),
    hintedName,
  };
}

function buildInflightKey(accessTokens: string[], hintedMerchantId: string) {
  return `${accessTokens.join("|")}::${hintedMerchantId || "default"}`;
}

export async function resolveMerchantPrincipalFromRequest(
  request: Request,
  hintInput?: MerchantSessionHintInput,
): Promise<ResolvedMerchantPrincipal | null> {
  const { hintedMerchantId, hintedName } =
    readMerchantSessionHints(request, hintInput);
  const accessTokens = [
    ...readMerchantRequestAccessTokens(request),
    readMerchantAuthCookie(request),
  ]
    .map(trimText)
    .filter(
      (value, index, values) => Boolean(value) && values.indexOf(value) === index,
    );
  if (accessTokens.length === 0) return null;

  const inflightKey = buildInflightKey(accessTokens, hintedMerchantId);
  const existingTask = merchantSessionInflight.get(inflightKey);
  if (existingTask) return existingTask;

  const task = (async () => {
    const authSupabase = createServerSupabaseAuthClient();
    const adminSupabase = createServerSupabaseServiceClient();
    if (!authSupabase || !adminSupabase) return null;

    let user: AuthUserSummary | null = null;
    for (const accessToken of accessTokens) {
      const result = await withTimeout(
        authSupabase.auth
          .getUser(accessToken)
          .catch(() => ({ data: null, error: true })),
        MERCHANT_SESSION_LOOKUP_TIMEOUT_MS,
        { data: null, error: true },
      );
      if (!result.error && result.data?.user) {
        user = result.data.user as AuthUserSummary;
        break;
      }
    }
    if (!user) return null;

    const identity = await withTimeout(
      resolveOrdinaryAccountPlatformIdentity(adminSupabase, user, {
        preferredMerchantId: hintedMerchantId,
        strictPreferredMerchantId: Boolean(hintedMerchantId),
      }).catch(() => null),
      MERCHANT_SESSION_LOOKUP_TIMEOUT_MS,
      null,
    );
    if (!identity || identity.accountType !== "merchant") return null;

    return {
      merchantId: identity.merchantId,
      merchantIds: [...identity.merchantIds],
      merchantEmail: normalizeEmail(user.email),
      merchantName: hintedName,
    };
  })();

  merchantSessionInflight.set(inflightKey, task);
  try {
    return await task;
  } finally {
    if (merchantSessionInflight.get(inflightKey) === task) {
      merchantSessionInflight.delete(inflightKey);
    }
  }
}

export async function resolveMerchantSessionFromRequest(
  request: Request,
  hintInput?: MerchantSessionHintInput,
): Promise<ResolvedMerchantSession | null> {
  const principal = await resolveMerchantPrincipalFromRequest(
    request,
    hintInput,
  );
  if (!principal) return null;
  return {
    merchantId: principal.merchantId,
    merchantEmail: principal.merchantEmail,
    merchantName: principal.merchantName,
  };
}
