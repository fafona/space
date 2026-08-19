"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MerchantEnterpriseManager from "@/components/admin/MerchantEnterpriseManager";
import { MerchantEnterpriseAuthGeneration } from "@/lib/merchantEnterpriseAuthGeneration";
import { merchantEnterpriseSupabase as supabase } from "@/lib/merchantEnterpriseSupabase";

type EnterpriseAuthSession = Awaited<
  ReturnType<typeof supabase.auth.getSession>
>["data"]["session"];

type InvitationCredential = {
  invitationVersion: number;
  invitationToken: string;
};

type StoredInvitationCredential = InvitationCredential & {
  attemptId: string;
  authUserId: string | null;
  createdAt: number;
  stage: "exchange_pending" | "accept_pending";
};

const INVITATION_HANDOFF_TTL_MS = 2 * 60 * 60 * 1000;
const INVITATION_STORAGE_PREFIX = "faolla:enterprise-invitation:v1";
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const INVITATION_ATTEMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class EnterpriseInvitationAcceptanceError extends Error {
  readonly terminal: boolean;

  constructor(message: string, terminal = false) {
    super(message);
    this.name = "EnterpriseInvitationAcceptanceError";
    this.terminal = terminal;
  }
}

function invitationStorageKey(siteId: string) {
  return `${INVITATION_STORAGE_PREFIX}:${siteId}`;
}

function parseInvitationCredential(params: URLSearchParams):
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "valid"; credential: InvitationCredential } {
  const hasVersion = params.has("iv");
  const hasToken = params.has("it");
  if (!hasVersion && !hasToken) return { status: "absent" };
  if (params.getAll("iv").length !== 1 || params.getAll("it").length !== 1) {
    return { status: "invalid" };
  }
  const invitationVersionText = params.get("iv")?.trim() ?? "";
  const invitationToken = params.get("it")?.trim() ?? "";
  if (
    !hasVersion ||
    !hasToken ||
    !/^[1-9][0-9]{0,15}$/.test(invitationVersionText) ||
    !INVITATION_TOKEN_PATTERN.test(invitationToken)
  ) {
    return { status: "invalid" };
  }
  const invitationVersion = Number(invitationVersionText);
  if (!Number.isSafeInteger(invitationVersion) || invitationVersion <= 0) {
    return { status: "invalid" };
  }
  return {
    status: "valid",
    credential: { invitationVersion, invitationToken },
  };
}

function parseInvitationExchangeError(params: URLSearchParams): string {
  if (!params.has("invitation_error") && !params.has("retry_after")) return "";
  if (
    params.getAll("invitation_error").length !== 1 ||
    params.getAll("retry_after").length > 1
  ) {
    return "邀请处理结果无效，请重新打开最新邮件。";
  }
  const code = params.get("invitation_error")?.trim() ?? "";
  const retryText = params.get("retry_after")?.trim() ?? "";
  if (code === "invalid" && !retryText) {
    return "邀请无效或已过期，请联系企业负责人重新发送。";
  }
  if (code === "unavailable" && !retryText) {
    return "邀请服务暂时不可用，请稍后重新打开最新邀请邮件。";
  }
  if (code === "rate_limited" && /^[1-9][0-9]{0,4}$/.test(retryText)) {
    const retryAfterSeconds = Number(retryText);
    if (retryAfterSeconds <= 86_400) {
      return `请求过于频繁，请在 ${retryAfterSeconds} 秒后重新打开最新邀请邮件。`;
    }
  }
  return "邀请处理结果无效，请重新打开最新邮件。";
}

function sameInvitationCredential(
  left: InvitationCredential,
  right: InvitationCredential,
) {
  return (
    left.invitationVersion === right.invitationVersion &&
    left.invitationToken === right.invitationToken
  );
}

function createInvitationAttemptId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new EnterpriseInvitationAcceptanceError(
      "当前浏览器无法安全处理邀请，请升级浏览器后重新打开邮件。",
      true,
    );
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function clearStoredInvitationCredential(siteId: string) {
  try {
    window.sessionStorage.removeItem(invitationStorageKey(siteId));
  } catch {
    // The in-memory credential is cleared separately; storage may be disabled.
  }
}

function storeInvitationCredential(
  siteId: string,
  credential: InvitationCredential,
): StoredInvitationCredential {
  const stored: StoredInvitationCredential = {
    ...credential,
    attemptId: createInvitationAttemptId(),
    authUserId: null,
    createdAt: Date.now(),
    stage: "exchange_pending",
  };
  persistStoredInvitationCredential(siteId, stored);
  return stored;
}

function persistStoredInvitationCredential(
  siteId: string,
  credential: StoredInvitationCredential,
) {
  try {
    window.sessionStorage.setItem(
      invitationStorageKey(siteId),
      JSON.stringify(credential),
    );
  } catch {
    throw new EnterpriseInvitationAcceptanceError(
      "浏览器未能暂存邀请，请允许会话存储后重新打开邮件。",
      true,
    );
  }
}

function markInvitationAcceptPending(
  siteId: string,
  credential: StoredInvitationCredential,
  authUserId: string,
) {
  if (!AUTH_USER_ID_PATTERN.test(authUserId)) {
    throw new EnterpriseInvitationAcceptanceError(
      "员工登录身份无效，请重新打开最新邀请邮件。",
      true,
    );
  }
  const next: StoredInvitationCredential = {
    ...credential,
    authUserId,
    stage: "accept_pending",
  };
  persistStoredInvitationCredential(siteId, next);
  return next;
}

function readStoredInvitationCredential(siteId: string): {
  credential: StoredInvitationCredential | null;
  expired: boolean;
} {
  let raw = "";
  try {
    raw = window.sessionStorage.getItem(invitationStorageKey(siteId)) ?? "";
  } catch {
    return { credential: null, expired: false };
  }
  if (!raw) return { credential: null, expired: false };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const exactKeys = Object.keys(value).sort().join(",");
    const invitationVersion = Number(value.invitationVersion);
    const invitationToken =
      typeof value.invitationToken === "string" ? value.invitationToken : "";
    const attemptId = typeof value.attemptId === "string" ? value.attemptId : "";
    const authUserId = typeof value.authUserId === "string" ? value.authUserId : null;
    const createdAt = Number(value.createdAt);
    const stage = value.stage;
    const now = Date.now();
    if (
      exactKeys !==
        "attemptId,authUserId,createdAt,invitationToken,invitationVersion,stage" ||
      !Number.isSafeInteger(invitationVersion) ||
      invitationVersion <= 0 ||
      !INVITATION_TOKEN_PATTERN.test(invitationToken) ||
      !INVITATION_ATTEMPT_ID_PATTERN.test(attemptId) ||
      (stage !== "exchange_pending" && stage !== "accept_pending") ||
      (stage === "exchange_pending" && authUserId !== null) ||
      (stage === "accept_pending" &&
        (authUserId === null || !AUTH_USER_ID_PATTERN.test(authUserId))) ||
      !Number.isSafeInteger(createdAt) ||
      createdAt <= 0 ||
      createdAt > now + 60_000 ||
      now - createdAt >= INVITATION_HANDOFF_TTL_MS
    ) {
      clearStoredInvitationCredential(siteId);
      return { credential: null, expired: true };
    }
    return {
      credential: {
        invitationVersion,
        invitationToken,
        attemptId,
        authUserId,
        createdAt,
        stage,
      },
      expired: false,
    };
  } catch {
    clearStoredInvitationCredential(siteId);
    return { credential: null, expired: true };
  }
}

function submitInvitationExchange(siteId: string, credential: StoredInvitationCredential) {
  const action = new URL(
    "/api/merchant-enterprise/invitations/exchange",
    window.location.origin,
  );
  if (action.origin !== window.location.origin) {
    throw new EnterpriseInvitationAcceptanceError("邀请处理地址无效。", true);
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action.toString();
  form.target = "_top";
  form.enctype = "application/x-www-form-urlencoded";
  form.style.display = "none";
  for (const [name, value] of [
    ["siteId", siteId],
    ["invitationVersion", String(credential.invitationVersion)],
    ["invitationToken", credential.invitationToken],
    ["attemptId", credential.attemptId],
  ]) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  try {
    form.submit();
  } finally {
    form.remove();
  }
}

type PortalAuthContext = {
  siteId: string;
  token: string;
  generation: number;
};

function invitationAcceptanceKey(
  accessToken: string,
  siteId: string,
  invitationVersion: number,
) {
  return JSON.stringify([accessToken, siteId, invitationVersion]);
}

async function acceptEnterpriseMembership(
  siteId: string,
  accessToken: string,
  invitation: InvitationCredential | null,
) {
  const response = await fetch("/api/merchant-enterprise/employees/accept", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-merchant-access-token": accessToken,
    },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({
      siteId,
      ...(invitation
        ? {
            invitationVersion: invitation.invitationVersion,
            invitationToken: invitation.invitationToken,
          }
        : {}),
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (response.ok && payload?.ok) return;
  if (payload?.error === "enterprise_management_disabled") {
    throw new EnterpriseInvitationAcceptanceError("当前企业尚未开通企业管理。");
  }
  if (payload?.error === "merchant_employee_not_invited") {
    throw new EnterpriseInvitationAcceptanceError(
      "该账号没有收到此企业的员工邀请。",
      true,
    );
  }
  if (payload?.error === "merchant_access_denied") {
    throw new EnterpriseInvitationAcceptanceError(
      "邀请对应的角色已停用，请联系企业负责人。",
      true,
    );
  }
  if (payload?.error === "employee_account_disabled") {
    throw new EnterpriseInvitationAcceptanceError(
      "员工账号已停用，请联系企业负责人。",
      true,
    );
  }
  if (payload?.error === "employee_invitation_expired") {
    throw new EnterpriseInvitationAcceptanceError(
      "这封邀请已过期，请联系企业负责人重新发送。",
      true,
    );
  }
  if (payload?.error === "employee_invitation_revoked") {
    throw new EnterpriseInvitationAcceptanceError(
      "这封邀请已被撤销，请联系企业负责人。",
      true,
    );
  }
  if (payload?.error === "employee_invitation_superseded") {
    throw new EnterpriseInvitationAcceptanceError(
      "这不是最新的邀请邮件，请打开最近收到的那一封。",
      true,
    );
  }
  if (payload?.error === "employee_invitation_credentials_required") {
    throw new EnterpriseInvitationAcceptanceError(
      "请从最新的邀请邮件进入企业工作台。",
      true,
    );
  }
  if (payload?.error === "invalid_employee_invitation_credentials") {
    throw new EnterpriseInvitationAcceptanceError(
      "邀请凭证无效，请重新打开最新邀请邮件。",
      true,
    );
  }
  throw new EnterpriseInvitationAcceptanceError("员工邀请确认失败，请稍后重试。");
}

export default function EnterprisePortalClient({ siteId }: { siteId: string }) {
  const [authContext, setAuthContext] = useState<PortalAuthContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const invitationCredentialRef = useRef<InvitationCredential | null>(null);
  const storedInvitationCredentialRef =
    useRef<StoredInvitationCredential | null>(null);
  const invitationVersionRef = useRef(0);
  const acceptedAcceptanceKeysRef = useRef(new Set<string>());
  const acceptanceInFlightRef = useRef(new Map<string, Promise<void>>());
  const invitationExchangeSubmittedRef = useRef(false);
  const authCallbackInProgressRef = useRef(false);
  const authGenerationRef = useRef(new MerchantEnterpriseAuthGeneration());
  const accessToken = authContext?.siteId === siteId ? authContext.token : "";
  const portalContextMismatch = Boolean(authContext && authContext.siteId !== siteId);

  const clearInvitationCredential = useCallback(
    (expected?: InvitationCredential | null) => {
      if (expected && invitationCredentialRef.current !== expected) return;
      invitationCredentialRef.current = null;
      storedInvitationCredentialRef.current = null;
      invitationVersionRef.current = 0;
      clearStoredInvitationCredential(siteId);
    },
    [siteId],
  );

  const ensureMembershipAccepted = useCallback(
    async (token: string) => {
      const invitation = invitationCredentialRef.current;
      const invitationVersion = invitation?.invitationVersion ?? invitationVersionRef.current;
      const acceptanceKey = invitationAcceptanceKey(token, siteId, invitationVersion);
      if (!token || acceptedAcceptanceKeysRef.current.has(acceptanceKey)) return;
      const inFlight = acceptanceInFlightRef.current.get(acceptanceKey);
      if (inFlight) return inFlight;
      const acceptance = acceptEnterpriseMembership(siteId, token, invitation)
        .then(() => {
          acceptedAcceptanceKeysRef.current.add(acceptanceKey);
          if (invitation) {
            clearInvitationCredential(invitation);
          }
        })
        .catch((error) => {
          if (
            invitation &&
            error instanceof EnterpriseInvitationAcceptanceError &&
            error.terminal
          ) {
            clearInvitationCredential(invitation);
          }
          throw error;
        })
        .finally(() => {
          if (acceptanceInFlightRef.current.get(acceptanceKey) === acceptance) {
            acceptanceInFlightRef.current.delete(acceptanceKey);
          }
        });
      acceptanceInFlightRef.current.set(acceptanceKey, acceptance);
      return acceptance;
    },
    [clearInvitationCredential, siteId],
  );

  useEffect(() => {
    let cancelled = false;
    const authGeneration = authGenerationRef.current;
    const initializationGeneration = authGeneration.begin();
    authGeneration.bindSessionToken(initializationGeneration, "");

    async function resolveSession(generation: number) {
      let token = "";
      let exchangeSubmitted = false;
      let authCallbackInProgress = false;
      let scrubResolvedCallbackUrl: (() => void) | null = null;
      let callbackSession: EnterpriseAuthSession = null;
      try {
        if (typeof window !== "undefined") {
          if (!/^\d{8}$/.test(siteId)) {
            throw new EnterpriseInvitationAcceptanceError("企业入口无效。", true);
          }
          const url = new URL(window.location.href);
          const code = url.searchParams.get("code")?.trim() ?? "";
          const exchangeError = parseInvitationExchangeError(url.searchParams);
          const queryInvitation = parseInvitationCredential(url.searchParams);
          const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
          const fragmentInvitation = parseInvitationCredential(hash);
          const hashAccessToken = hash.get("access_token")?.trim() ?? "";
          const hashRefreshToken = hash.get("refresh_token")?.trim() ?? "";
          authCallbackInProgress = Boolean(
            code || hashAccessToken || hashRefreshToken,
          );
          if (authCallbackInProgress) {
            authCallbackInProgressRef.current = true;
          }
          const hasInvitationInQuery = queryInvitation.status !== "absent";
          const hasInvitationInFragment = fragmentInvitation.status !== "absent";
          const hasAuthHash = Boolean(hashAccessToken || hashRefreshToken);
          const shouldScrubUrl = Boolean(
            code ||
              exchangeError ||
              hasInvitationInQuery ||
              hasInvitationInFragment ||
              hasAuthHash,
          );
          let incomingCredential: InvitationCredential | null = null;
          let invitationError = "";
          if (exchangeError) {
            invitationError = exchangeError;
          } else if (
            queryInvitation.status === "invalid" ||
            fragmentInvitation.status === "invalid"
          ) {
            invitationError = "邀请凭证格式无效，请重新打开最新邮件。";
          } else if (
            queryInvitation.status === "valid" &&
            fragmentInvitation.status === "valid" &&
            !sameInvitationCredential(
              queryInvitation.credential,
              fragmentInvitation.credential,
            )
          ) {
            invitationError = "页面包含两组不同的邀请凭证，请重新打开最新邮件。";
          } else if (fragmentInvitation.status === "valid") {
            incomingCredential = fragmentInvitation.credential;
          } else if (queryInvitation.status === "valid") {
            incomingCredential = queryInvitation.credential;
          }

          let storedInvitation: StoredInvitationCredential | null = null;
          let storageError: unknown = null;
          if (incomingCredential && !invitationError) {
            try {
              storedInvitation = storeInvitationCredential(siteId, incomingCredential);
            } catch (error) {
              storageError = error;
            }
          }

          let callbackUrlScrubbed = false;
          scrubResolvedCallbackUrl = () => {
            if (!shouldScrubUrl || callbackUrlScrubbed) return;
            callbackUrlScrubbed = true;
            url.searchParams.delete("code");
            url.searchParams.delete("iv");
            url.searchParams.delete("it");
            url.searchParams.delete("invitation_error");
            url.searchParams.delete("retry_after");
            if (hasInvitationInFragment || hasAuthHash) url.hash = "";
            window.history.replaceState(
              window.history.state,
              "",
              `${url.pathname}${url.search}${url.hash}`,
            );
          };
          if (
            shouldScrubUrl &&
            (!authCallbackInProgress || invitationError || storageError)
          ) {
            scrubResolvedCallbackUrl();
          }

          if (invitationError) {
            clearInvitationCredential();
            throw new EnterpriseInvitationAcceptanceError(invitationError, true);
          }
          if (storageError) throw storageError;

          if (!storedInvitation) {
            const stored = readStoredInvitationCredential(siteId);
            storedInvitation = stored.credential;
            if (stored.expired) {
              throw new EnterpriseInvitationAcceptanceError(
                "邀请处理会话已过期，请重新打开最新邮件。",
                true,
              );
            }
          }
          if (storedInvitation) {
            storedInvitationCredentialRef.current = storedInvitation;
            invitationCredentialRef.current = {
              invitationVersion: storedInvitation.invitationVersion,
              invitationToken: storedInvitation.invitationToken,
            };
            invitationVersionRef.current = storedInvitation.invitationVersion;
          }

          if (
            storedInvitation &&
            storedInvitation.stage === "exchange_pending" &&
            !code &&
            !hashAccessToken &&
            !hashRefreshToken
          ) {
            if (!invitationExchangeSubmittedRef.current) {
              invitationExchangeSubmittedRef.current = true;
              try {
                submitInvitationExchange(siteId, storedInvitation);
                exchangeSubmitted = true;
              } catch (error) {
                invitationExchangeSubmittedRef.current = false;
                throw error;
              }
            }
            return;
          }
          if (code) {
            const exchanged = await supabase.auth.exchangeCodeForSession(code);
            if (exchanged.error) throw exchanged.error;
            callbackSession = exchanged.data.session;
          } else if (hashAccessToken && hashRefreshToken) {
            const established = await supabase.auth.setSession({
              access_token: hashAccessToken,
              refresh_token: hashRefreshToken,
            });
            if (established.error) throw established.error;
            callbackSession = established.data.session;
          } else if (hashAccessToken || hashRefreshToken) {
            throw new EnterpriseInvitationAcceptanceError(
              "登录回跳凭证不完整，请重新打开邀请邮件。",
              true,
            );
          }

          if (authCallbackInProgress) {
            if (!callbackSession) {
              throw new EnterpriseInvitationAcceptanceError(
                "登录回跳未能建立有效会话，请重试。",
              );
            }
            if (!authGeneration.isGenerationCurrent(generation, cancelled)) return;
            let callbackInvitation = storedInvitationCredentialRef.current;
            if (callbackInvitation?.stage === "exchange_pending") {
              callbackInvitation = markInvitationAcceptPending(
                siteId,
                callbackInvitation,
                callbackSession.user.id,
              );
              storedInvitationCredentialRef.current = callbackInvitation;
            }
            if (
              callbackInvitation?.stage === "accept_pending" &&
              callbackSession.user.id !== callbackInvitation.authUserId
            ) {
              throw new EnterpriseInvitationAcceptanceError(
                "请使用该邀请已验证的员工账号登录后重试。",
              );
            }
            scrubResolvedCallbackUrl?.();
          }
        }
        let session = callbackSession;
        if (!session) {
          const result = await supabase.auth.getSession();
          if (result.error) throw result.error;
          session = result.data.session;
        }
        token = session?.access_token ?? "";
        let storedInvitation = storedInvitationCredentialRef.current;
        if (
          storedInvitation?.stage === "exchange_pending" &&
          authCallbackInProgress
        ) {
          const authUserId = session?.user?.id ?? "";
          storedInvitation = markInvitationAcceptPending(
            siteId,
            storedInvitation,
            authUserId,
          );
          storedInvitationCredentialRef.current = storedInvitation;
        }
        if (
          storedInvitation?.stage === "accept_pending" &&
          session?.user?.id !== storedInvitation.authUserId
        ) {
          throw new EnterpriseInvitationAcceptanceError(
            "请使用该邀请已验证的员工账号登录后重试。",
          );
        }
        scrubResolvedCallbackUrl?.();
        if (cancelled || !authGeneration.bindSessionToken(generation, token)) return;
        if (token) await ensureMembershipAccepted(token);
        if (!authGeneration.isCurrent(generation, token, cancelled)) return;
        setAuthContext(token ? { siteId, token, generation } : null);
      } catch (error) {
        if (
          error instanceof EnterpriseInvitationAcceptanceError &&
          error.terminal
        ) {
          clearInvitationCredential();
        }
        if (authGeneration.isCurrent(generation, token, cancelled)) {
          setAuthContext(null);
          setMessage(error instanceof Error ? error.message : "邀请链接无效或已过期。");
        }
      } finally {
        if (authCallbackInProgress) {
          authCallbackInProgressRef.current = false;
        }
        if (
          !exchangeSubmitted &&
          authGeneration.isGenerationCurrent(generation, cancelled)
        ) {
          setChecking(false);
        }
      }
    }
    void resolveSession(initializationGeneration);
    const listener = supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase can emit INITIAL_SESSION for the previous account while a
      // code/hash callback is still establishing the invited account. Let the
      // callback resolver own that transition so stale credentials can never
      // consume or clear the new invitation.
      if (authCallbackInProgressRef.current) return;
      const generation = authGeneration.begin();
      if (invitationExchangeSubmittedRef.current) {
        authGeneration.bindSessionToken(generation, "");
        return;
      }
      const token = session?.access_token ?? "";
      if (!authGeneration.bindSessionToken(generation, token) || cancelled) return;
      setAuthContext(null);
      if (!token) {
        acceptedAcceptanceKeysRef.current.clear();
        setChecking(false);
        return;
      }
      const storedInvitation = storedInvitationCredentialRef.current;
      if (
        storedInvitation?.stage === "accept_pending" &&
        session?.user?.id !== storedInvitation.authUserId
      ) {
        setMessage("请使用该邀请已验证的员工账号登录后重试。");
        setChecking(false);
        return;
      }
      if (storedInvitation?.stage === "exchange_pending") {
        setMessage("请完成邀请邮件中的身份验证后再进入企业工作台。");
        setChecking(false);
        return;
      }
      setChecking(true);
      void ensureMembershipAccepted(token)
        .then(() => {
          if (!authGeneration.isCurrent(generation, token, cancelled)) return;
          setAuthContext({ siteId, token, generation });
        })
        .catch((error) => {
          if (!authGeneration.isCurrent(generation, token, cancelled)) return;
          setAuthContext(null);
          setMessage(error instanceof Error ? error.message : "员工邀请确认失败。");
        })
        .finally(() => {
          if (authGeneration.isCurrent(generation, token, cancelled)) setChecking(false);
        });
    });
    return () => {
      cancelled = true;
      const invalidationGeneration = authGeneration.begin();
      authGeneration.bindSessionToken(invalidationGeneration, "");
      listener.data.subscription.unsubscribe();
    };
  }, [clearInvitationCredential, ensureMembershipAccepted, siteId]);

  async function signIn() {
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (result.error) throw result.error;
      const token = result.data.session?.access_token ?? "";
      if (!token) throw new Error("登录未返回有效会话。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败，请检查邮箱和密码。");
    } finally {
      setBusy(false);
    }
  }

  async function setLoginPassword() {
    if (newPassword.length < 8) {
      setMessage("新密码至少需要 8 个字符。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.updateUser({ password: newPassword });
      if (result.error) throw result.error;
      setNewPassword("");
      setMessage("登录密码已设置。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "密码设置失败。");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage("请先填写员工邮箱。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const redirectTo =
        typeof window === "undefined"
          ? undefined
          : `${window.location.origin}/enterprise/${encodeURIComponent(siteId)}`;
      const result = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        ...(redirectTo ? { redirectTo } : {}),
      });
      if (result.error) throw result.error;
      setMessage("如果该邮箱已开通员工账号，密码设置邮件会发送到邮箱。");
    } catch {
      setMessage("暂时无法发送密码设置邮件，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const authGeneration = authGenerationRef.current;
    const generation = authGeneration.begin();
    authGeneration.bindSessionToken(generation, "");
    acceptedAcceptanceKeysRef.current.clear();
    setAuthContext(null);
    setChecking(false);
    const result = await supabase.auth.signOut();
    if (result.error) setMessage("退出失败，请稍后重试。");
  }

  if (checking || portalContextMismatch) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white">
        <div className="text-sm text-slate-300">正在验证企业账号...</div>
      </main>
    );
  }

  if (!/^\d{8}$/.test(siteId)) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">企业入口无效。</div>
      </main>
    );
  }

  if (!accessToken) {
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#164e63,#0f172a_55%)] px-4 py-10">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-6 shadow-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">Faolla Enterprise</div>
          <h1 className="mt-3 text-2xl font-bold text-slate-950">员工登录</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">使用企业负责人邀请的员工邮箱登录。</p>
          <div className="mt-6 space-y-3">
            <label htmlFor="enterprise-portal-email" className="sr-only">
              员工邮箱
            </label>
            <input
              id="enterprise-portal-email"
              type="email"
              autoComplete="email"
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              placeholder="员工邮箱"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <label htmlFor="enterprise-portal-password" className="sr-only">
              密码
            </label>
            <input
              id="enterprise-portal-password"
              type="password"
              autoComplete="current-password"
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              placeholder="密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void signIn();
              }}
            />
            {message ? <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</div> : null}
            <button
              type="button"
              className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-45"
              disabled={busy || !email.trim() || !password}
              onClick={() => void signIn()}
            >
              {busy ? "登录中..." : "登录企业工作台"}
            </button>
            <button
              type="button"
              className="w-full rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
              disabled={busy || !email.trim()}
              onClick={() => void requestPasswordReset()}
            >
              忘记密码 / 设置密码
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3f6fb]">
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <label htmlFor="enterprise-portal-new-password" className="sr-only">
          设置或修改登录密码
        </label>
        <input
          id="enterprise-portal-new-password"
          type="password"
          autoComplete="new-password"
          className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-xs"
          placeholder="设置或修改登录密码"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-45"
          disabled={busy || !newPassword}
          onClick={() => void setLoginPassword()}
        >
          设置密码
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
          onClick={() => void signOut()}
        >
          退出
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
          onClick={() => window.location.assign("/enterprise")}
        >
          切换企业
        </button>
        {message ? <span role="alert" className="text-xs text-slate-600">{message}</span> : null}
      </div>
      <MerchantEnterpriseManager
        key={`${siteId}:${authContext?.generation ?? 0}`}
        siteId={siteId}
        accessToken={accessToken}
        standalone
      />
    </main>
  );
}
