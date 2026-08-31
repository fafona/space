"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MerchantEmployeeWorkspace from "@/components/enterprise/MerchantEmployeeWorkspace";
import { MerchantEnterpriseAuthGeneration } from "@/lib/merchantEnterpriseAuthGeneration";
import {
  MERCHANT_ENTERPRISE_ONBOARDING_QUERY_KEY,
} from "@/lib/merchantEnterpriseInvitationOnboarding";
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
  initialPasswordOperationId: string | null;
  stage: "exchange_pending" | "password_pending" | "accept_pending";
};

type InitialPasswordSetupState = "required" | "accepting" | "retry_acceptance" | null;

type InitialPasswordOperation = InvitationCredential & {
  operationId: string;
  password: string;
};

type PasswordResetRequestPayload = {
  ok?: unknown;
  error?: unknown;
};

const INVITATION_HANDOFF_TTL_MS = 2 * 60 * 60 * 1000;
const INVITATION_STORAGE_PREFIX = "faolla:enterprise-invitation:v1";
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const INVITATION_ATTEMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function passwordResetRequestError(payload: PasswordResetRequestPayload | null) {
  if (payload?.error === "reset_password_invalid_email") {
    return "请输入有效的员工邮箱。";
  }
  if (payload?.error === "auth_rate_limited") {
    return "发送请求过于频繁，请稍后再试。";
  }
  return "暂时无法发送密码设置邮件，请稍后重试。";
}

class EnterpriseInvitationAcceptanceError extends Error {
  readonly terminal: boolean;

  constructor(message: string, terminal = false) {
    super(message);
    this.name = "EnterpriseInvitationAcceptanceError";
    this.terminal = terminal;
  }
}

class EnterpriseInitialPasswordSetupError extends Error {
  readonly existingPasswordRequired: boolean;
  readonly terminal: boolean;

  constructor(
    message: string,
    existingPasswordRequired = false,
    terminal = false,
  ) {
    super(message);
    this.name = "EnterpriseInitialPasswordSetupError";
    this.existingPasswordRequired = existingPasswordRequired;
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
    initialPasswordOperationId: null,
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
  requiresInitialPassword = false,
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
    initialPasswordOperationId: requiresInitialPassword
      ? credential.initialPasswordOperationId ?? createInvitationAttemptId()
      : null,
    stage: requiresInitialPassword ? "password_pending" : "accept_pending",
  };
  persistStoredInvitationCredential(siteId, next);
  return next;
}

function markInvitationPasswordCompleted(
  siteId: string,
  credential: StoredInvitationCredential,
) {
  if (
    credential.stage !== "password_pending" ||
    !credential.authUserId ||
    !AUTH_USER_ID_PATTERN.test(credential.authUserId)
  ) {
    throw new EnterpriseInvitationAcceptanceError(
      "初始密码设置会话无效，请重新打开最新邀请邮件。",
      true,
    );
  }
  const next: StoredInvitationCredential = {
    ...credential,
    initialPasswordOperationId: null,
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
    const initialPasswordOperationId =
      typeof value.initialPasswordOperationId === "string"
        ? value.initialPasswordOperationId
        : null;
    const stage = value.stage;
    const now = Date.now();
    if (
      exactKeys !==
        "attemptId,authUserId,createdAt,initialPasswordOperationId,invitationToken,invitationVersion,stage" ||
      !Number.isSafeInteger(invitationVersion) ||
      invitationVersion <= 0 ||
      !INVITATION_TOKEN_PATTERN.test(invitationToken) ||
      !INVITATION_ATTEMPT_ID_PATTERN.test(attemptId) ||
      (stage !== "exchange_pending" &&
        stage !== "password_pending" &&
        stage !== "accept_pending") ||
      (stage === "exchange_pending" && authUserId !== null) ||
      ((stage === "password_pending" || stage === "accept_pending") &&
        (authUserId === null || !AUTH_USER_ID_PATTERN.test(authUserId))) ||
      (stage === "password_pending"
        ? !initialPasswordOperationId ||
          !INVITATION_ATTEMPT_ID_PATTERN.test(initialPasswordOperationId)
        : initialPasswordOperationId !== null) ||
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
        initialPasswordOperationId,
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
  if (payload?.error === "employee_password_authentication_required") {
    throw new EnterpriseInvitationAcceptanceError(
      "请先设置员工登录密码，并使用邮箱和密码重新登录。",
    );
  }
  throw new EnterpriseInvitationAcceptanceError("员工邀请确认失败，请稍后重试。");
}

async function initializeEnterpriseStaffPassword(
  siteId: string,
  accessToken: string,
  invitation: InvitationCredential,
  operationId: string,
  newPassword: string,
) {
  const response = await fetch(
    "/api/merchant-enterprise/invitations/initial-password",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-merchant-access-token": accessToken,
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        siteId,
        invitationVersion: invitation.invitationVersion,
        invitationToken: invitation.invitationToken,
        operationId,
        newPassword,
      }),
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (response.ok && payload?.ok) return;
  if (
    payload?.error === "employee_password_already_initialized" ||
    payload?.error === "employee_password_state_unknown"
  ) {
    throw new EnterpriseInitialPasswordSetupError(
      "该员工账号已有密码或属于历史账号，请使用现有密码登录；忘记密码时可发送重置邮件。",
      true,
      true,
    );
  }
  if (payload?.error === "employee_invitation_expired") {
    throw new EnterpriseInvitationAcceptanceError(
      "这封邀请已过期，请联系企业负责人重新发送。",
      true,
    );
  }
  if (payload?.error === "employee_invitation_invalid_or_expired") {
    throw new EnterpriseInvitationAcceptanceError(
      "邀请无效、已过期或已被撤销，请联系企业负责人重新发送。",
      true,
    );
  }
  if (payload?.error === "employee_invitation_revoked") {
    throw new EnterpriseInvitationAcceptanceError(
      "这封邀请已被撤销，请联系企业负责人。",
      true,
    );
  }
  if (
    payload?.error === "employee_invitation_superseded" ||
    payload?.error === "invalid_employee_invitation_credentials"
  ) {
    throw new EnterpriseInvitationAcceptanceError(
      "这不是最新的邀请，请重新打开最近收到的邮件。",
      true,
    );
  }
  if (payload?.error === "employee_invitation_identity_mismatch") {
    throw new EnterpriseInvitationAcceptanceError(
      "员工登录身份与邀请不一致，请重新打开最新邀请邮件。",
      true,
    );
  }
  if (payload?.error === "invalid_employee_password") {
    throw new EnterpriseInitialPasswordSetupError(
      "密码需为 8 至 128 个字符，请重新输入。",
      false,
      true,
    );
  }
  const retryableOperationFailure =
    response.status >= 500 ||
    response.status === 429 ||
    payload?.error === "employee_initial_password_setup_in_progress";
  throw new EnterpriseInitialPasswordSetupError(
    "密码暂时未能设置，请稍后重试。",
    false,
    response.status >= 400 && !retryableOperationFailure,
  );
}

export default function EnterprisePortalClient({ siteId }: { siteId: string }) {
  const [authContext, setAuthContext] = useState<PortalAuthContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [invitedAccountEmail, setInvitedAccountEmail] = useState("");
  const [initialPasswordSetupState, setInitialPasswordSetupState] =
    useState<InitialPasswordSetupState>(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
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
  const passwordSetupTransitionRef = useRef(false);
  const initialPasswordOperationRef = useRef<InitialPasswordOperation | null>(
    null,
  );
  const authGenerationRef = useRef(new MerchantEnterpriseAuthGeneration());
  const accessToken = authContext?.siteId === siteId ? authContext.token : "";
  const portalContextMismatch = Boolean(authContext && authContext.siteId !== siteId);

  const clearInvitationCredential = useCallback(
    (expected?: InvitationCredential | null) => {
      if (expected && invitationCredentialRef.current !== expected) return;
      invitationCredentialRef.current = null;
      storedInvitationCredentialRef.current = null;
      invitationVersionRef.current = 0;
      initialPasswordOperationRef.current = null;
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
          const hasOnboardingMarker = url.searchParams.has(
            MERCHANT_ENTERPRISE_ONBOARDING_QUERY_KEY,
          );
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
              hasAuthHash ||
              hasOnboardingMarker,
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
            url.searchParams.delete(MERCHANT_ENTERPRISE_ONBOARDING_QUERY_KEY);
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
                true,
              );
              storedInvitationCredentialRef.current = callbackInvitation;
            }
            if (
              (callbackInvitation?.stage === "password_pending" ||
                callbackInvitation?.stage === "accept_pending") &&
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
            authCallbackInProgress,
          );
          storedInvitationCredentialRef.current = storedInvitation;
        }
        if (
          (storedInvitation?.stage === "password_pending" ||
            storedInvitation?.stage === "accept_pending") &&
          session?.user?.id !== storedInvitation.authUserId
        ) {
          throw new EnterpriseInvitationAcceptanceError(
            "请使用该邀请已验证的员工账号登录后重试。",
          );
        }
        scrubResolvedCallbackUrl?.();
        if (cancelled || !authGeneration.bindSessionToken(generation, token)) return;
        if (token && storedInvitation?.stage === "password_pending") {
          setInvitedAccountEmail(session?.user?.email?.trim().toLowerCase() ?? "");
          setInitialPasswordSetupState("required");
          setAuthContext({ siteId, token, generation });
          return;
        }
        if (token) await ensureMembershipAccepted(token);
        if (!authGeneration.isCurrent(generation, token, cancelled)) return;
        setInitialPasswordSetupState(null);
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
      if (passwordSetupTransitionRef.current) return;
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
        setInitialPasswordSetupState(null);
        setChecking(false);
        return;
      }
      const storedInvitation = storedInvitationCredentialRef.current;
      if (
        (storedInvitation?.stage === "password_pending" ||
          storedInvitation?.stage === "accept_pending") &&
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
      if (storedInvitation?.stage === "password_pending") {
        setInvitedAccountEmail(session?.user?.email?.trim().toLowerCase() ?? "");
        setInitialPasswordSetupState("required");
        setAuthContext({ siteId, token, generation });
        setChecking(false);
        return;
      }
      setChecking(true);
      void ensureMembershipAccepted(token)
        .then(() => {
          if (!authGeneration.isCurrent(generation, token, cancelled)) return;
          setInitialPasswordSetupState(null);
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

  function beginPasswordAuthenticatedPortalSession(token: string) {
    const authGeneration = authGenerationRef.current;
    const generation = authGeneration.begin();
    if (!authGeneration.bindSessionToken(generation, token)) {
      throw new EnterpriseInvitationAcceptanceError("登录会话已更新，请重试。");
    }
    return { authGeneration, generation };
  }

  function bindPasswordAuthenticatedPortalSession(token: string) {
    const { generation } = beginPasswordAuthenticatedPortalSession(token);
    setAuthContext({ siteId, token, generation });
  }

  function initialPasswordOperationFor(
    invitation: StoredInvitationCredential,
    submittedPassword: string,
  ) {
    if (
      !invitation.initialPasswordOperationId ||
      !INVITATION_ATTEMPT_ID_PATTERN.test(
        invitation.initialPasswordOperationId,
      )
    ) {
      throw new EnterpriseInitialPasswordSetupError(
        "密码设置会话已失效，请重新打开最新邀请邮件。",
        false,
        true,
      );
    }
    const current = initialPasswordOperationRef.current;
    if (
      current?.invitationVersion === invitation.invitationVersion &&
      current.invitationToken === invitation.invitationToken &&
      current.password === submittedPassword
    ) {
      return current;
    }
    const operation: InitialPasswordOperation = {
      ...invitation,
      operationId: invitation.initialPasswordOperationId,
      password: submittedPassword,
    };
    initialPasswordOperationRef.current = operation;
    return operation;
  }

  function clearInitialPasswordOperation(expectedOperationId?: string) {
    if (
      expectedOperationId &&
      initialPasswordOperationRef.current?.operationId !== expectedOperationId
    ) {
      return;
    }
    initialPasswordOperationRef.current = null;
  }

  async function acceptPendingInvitationWithPasswordSession(token: string) {
    let storedInvitation = storedInvitationCredentialRef.current;
    if (!storedInvitation) {
      throw new EnterpriseInvitationAcceptanceError(
        "邀请处理会话已过期，请重新打开最新邮件。",
        true,
      );
    }
    if (storedInvitation.stage === "password_pending") {
      storedInvitation = markInvitationPasswordCompleted(siteId, storedInvitation);
      storedInvitationCredentialRef.current = storedInvitation;
    }
    if (storedInvitation.stage !== "accept_pending") {
      throw new EnterpriseInvitationAcceptanceError(
        "邀请处理状态无效，请重新打开最新邮件。",
        true,
      );
    }
    const { authGeneration, generation } =
      beginPasswordAuthenticatedPortalSession(token);
    setInitialPasswordSetupState("accepting");
    setChecking(false);
    setAuthContext({ siteId, token, generation });
    try {
      await ensureMembershipAccepted(token);
      if (!authGeneration.isCurrent(generation, token)) return;
      setInitialPasswordSetupState(null);
      setMessage("邀请已接受，已进入企业工作台。");
    } finally {
      if (authGeneration.isCurrent(generation, token)) setChecking(false);
    }
  }

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
      setInvitedAccountEmail(result.data.session?.user?.email?.trim().toLowerCase() ?? "");
      if (
        storedInvitationCredentialRef.current?.stage === "password_pending" ||
        storedInvitationCredentialRef.current?.stage === "accept_pending"
      ) {
        await acceptPendingInvitationWithPasswordSession(token);
      }
      setPassword("");
    } catch (error) {
      if (
        error instanceof EnterpriseInvitationAcceptanceError &&
        error.terminal
      ) {
        initialPasswordOperationRef.current = null;
        setPassword("");
        setAuthContext(null);
        setInitialPasswordSetupState(null);
        setChecking(false);
      } else if (
        storedInvitationCredentialRef.current?.stage === "accept_pending"
      ) {
        setInitialPasswordSetupState("retry_acceptance");
      }
      setMessage(error instanceof Error ? error.message : "登录失败，请检查邮箱和密码。");
    } finally {
      setBusy(false);
    }
  }

  async function completeInitialPasswordSetup() {
    if (busy) return;
    if (newPassword.length < 8) {
      setMessage("新密码至少需要 8 个字符。");
      return;
    }
    if (newPassword.length > 128) {
      setMessage("新密码不能超过 128 个字符。");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setMessage("两次输入的密码不一致。");
      return;
    }
    const submittedPassword = newPassword;
    const storedInvitation = storedInvitationCredentialRef.current;
    if (storedInvitation?.stage !== "password_pending") {
      setMessage("邀请处理会话已过期，请重新打开最新邮件。");
      return;
    }

    setBusy(true);
    setMessage("");
    passwordSetupTransitionRef.current = true;
    let passwordSessionToken = "";
    let accountEmail = invitedAccountEmail;
    try {
      const current = await supabase.auth.getSession();
      if (current.error) throw current.error;
      const currentSession = current.data.session;
      accountEmail =
        currentSession?.user?.email?.trim().toLowerCase() || invitedAccountEmail;
      if (
        !currentSession ||
        !accountEmail ||
        currentSession.user.id !== storedInvitation.authUserId
      ) {
        throw new EnterpriseInvitationAcceptanceError(
          "员工登录身份与邀请不一致，请重新打开最新邀请邮件。",
          true,
        );
      }

      const initialPasswordOperation = initialPasswordOperationFor(
        storedInvitation,
        submittedPassword,
      );
      await initializeEnterpriseStaffPassword(
        siteId,
        currentSession.access_token,
        storedInvitation,
        initialPasswordOperation.operationId,
        submittedPassword,
      );
      clearInitialPasswordOperation(initialPasswordOperation.operationId);
      setNewPassword("");
      setConfirmNewPassword("");
      const passwordCompletedInvitation = markInvitationPasswordCompleted(
        siteId,
        storedInvitation,
      );
      storedInvitationCredentialRef.current = passwordCompletedInvitation;

      const signedOut = await supabase.auth.signOut({ scope: "local" });
      if (signedOut.error) throw signedOut.error;
      const signedIn = await supabase.auth.signInWithPassword({
        email: accountEmail,
        password: submittedPassword,
      });
      if (signedIn.error) throw signedIn.error;
      passwordSessionToken = signedIn.data.session?.access_token ?? "";
      if (!passwordSessionToken) {
        throw new EnterpriseInvitationAcceptanceError(
          "密码已保存，但未能建立新的登录会话，请使用新密码重新登录。",
        );
      }

      await acceptPendingInvitationWithPasswordSession(passwordSessionToken);
    } catch (error) {
      if (
        error instanceof EnterpriseInitialPasswordSetupError &&
        error.terminal
      ) {
        clearInitialPasswordOperation();
      }
      if (
        error instanceof EnterpriseInitialPasswordSetupError &&
        error.existingPasswordRequired
      ) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => null);
        setNewPassword("");
        setConfirmNewPassword("");
        setEmail(accountEmail);
        setPassword("");
        setAuthContext(null);
        setInitialPasswordSetupState(null);
        setChecking(false);
        setMessage(error.message);
        return;
      }
      if (
        error instanceof EnterpriseInvitationAcceptanceError &&
        error.terminal
      ) {
        clearInvitationCredential();
        setNewPassword("");
        setConfirmNewPassword("");
        setAuthContext(null);
        setInitialPasswordSetupState(null);
        setChecking(false);
        setMessage(error.message);
        return;
      }
      const pendingStage = storedInvitationCredentialRef.current?.stage;
      if (pendingStage === "accept_pending" && passwordSessionToken) {
        bindPasswordAuthenticatedPortalSession(passwordSessionToken);
        setInitialPasswordSetupState("retry_acceptance");
      } else if (passwordSessionToken) {
        bindPasswordAuthenticatedPortalSession(passwordSessionToken);
        setInitialPasswordSetupState("required");
      } else {
        const recovered = await supabase.auth.getSession().catch(() => null);
        const recoveredSession = recovered?.data?.session ?? null;
        const recoveredToken = recoveredSession?.access_token ?? "";
        if (
          recoveredToken &&
          storedInvitationCredentialRef.current?.stage === "password_pending"
        ) {
          setInvitedAccountEmail(
            recoveredSession?.user?.email?.trim().toLowerCase() ?? invitedAccountEmail,
          );
          bindPasswordAuthenticatedPortalSession(recoveredToken);
          setInitialPasswordSetupState("required");
        } else {
          setAuthContext(null);
          setInitialPasswordSetupState(null);
        }
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "密码设置未完成，请重新打开邀请邮件后重试。",
      );
    } finally {
      passwordSetupTransitionRef.current = false;
      setBusy(false);
    }
  }

  async function retryInvitationAcceptance() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.getSession();
      if (result.error) throw result.error;
      const token = result.data.session?.access_token ?? "";
      if (!token) throw new Error("登录会话已失效，请使用员工邮箱和密码重新登录。");
      await acceptPendingInvitationWithPasswordSession(token);
    } catch (error) {
      if (
        error instanceof EnterpriseInvitationAcceptanceError &&
        error.terminal
      ) {
        clearInitialPasswordOperation();
        setAuthContext(null);
        setInitialPasswordSetupState(null);
        setChecking(false);
      } else {
        setInitialPasswordSetupState("retry_acceptance");
      }
      setMessage(error instanceof Error ? error.message : "邀请确认失败，请稍后重试。");
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
      setAccountPanelOpen(false);
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
      const response = await fetch("/api/auth/reset-password/request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          email: normalizedEmail,
          returnTo: `/enterprise/${siteId}`,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | PasswordResetRequestPayload
        | null;
      if (!response.ok || payload?.ok !== true) {
        setMessage(passwordResetRequestError(payload));
        return;
      }
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
    clearInitialPasswordOperation();
    setNewPassword("");
    setConfirmNewPassword("");
    setInvitedAccountEmail("");
    setInitialPasswordSetupState(null);
    setAccountPanelOpen(false);
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

  if (accessToken && initialPasswordSetupState) {
    const invitationAcceptancePending =
      initialPasswordSetupState === "accepting" ||
      initialPasswordSetupState === "retry_acceptance";
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#164e63,#0f172a_55%)] px-4 py-10">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-6 shadow-2xl sm:p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">
            Faolla Enterprise
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-950">
            {invitationAcceptancePending ? "正在开通员工账号" : "设置员工登录密码"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {invitationAcceptancePending
              ? "密码已经设置。完成邀请确认后，才会进入企业工作台。"
              : "邀请身份已经验证。请先设置登录密码，完成前不会进入企业工作台。"}
          </p>
          {invitedAccountEmail ? (
            <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              员工邮箱：<span className="font-semibold">{invitedAccountEmail}</span>
            </div>
          ) : null}

          {initialPasswordSetupState === "required" ? (
            <form
              className="mt-5 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void completeInitialPasswordSetup();
              }}
            >
              <label className="block text-sm font-medium text-slate-700">
                新密码
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                  placeholder="至少 8 个字符"
                  value={newPassword}
                  onChange={(event) => {
                    const nextPassword = event.target.value;
                    if (
                      initialPasswordOperationRef.current?.password !==
                      nextPassword
                    ) {
                      clearInitialPasswordOperation();
                    }
                    setNewPassword(nextPassword);
                  }}
                  disabled={busy}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                确认新密码
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                  placeholder="再次输入新密码"
                  value={confirmNewPassword}
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-45"
                disabled={busy || newPassword.length < 8 || newPassword !== confirmNewPassword}
              >
                {busy ? "正在安全设置..." : "设置密码并进入工作台"}
              </button>
            </form>
          ) : initialPasswordSetupState === "retry_acceptance" ? (
            <button
              type="button"
              className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-45"
              disabled={busy}
              onClick={() => void retryInvitationAcceptance()}
            >
              {busy ? "正在确认邀请..." : "重试确认邀请"}
            </button>
          ) : (
            <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              正在确认员工权限，请稍候...
            </div>
          )}

          {message ? (
            <div role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {message}
            </div>
          ) : null}
          <button
            type="button"
            className="mt-3 w-full rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
            disabled={busy}
            onClick={() => void signOut()}
          >
            退出并稍后处理
          </button>
        </section>
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
      <MerchantEmployeeWorkspace
        key={`${siteId}:${authContext?.generation ?? 0}`}
        siteId={siteId}
        accessToken={accessToken}
        onSignOut={() => void signOut()}
        signOutDisabled={busy}
        accountActions={
          <div className="space-y-2">
            <button
              type="button"
              className="w-full rounded-lg border border-blue-300/30 bg-white/5 px-3 py-2 text-left text-xs font-semibold text-[#dbeafe] transition hover:bg-[#17233f] hover:text-white"
              aria-expanded={accountPanelOpen}
              aria-controls="enterprise-portal-account-security"
              onClick={() => {
                clearInitialPasswordOperation();
                setNewPassword("");
                setConfirmNewPassword("");
                setAccountPanelOpen((current) => !current);
                setMessage("");
              }}
            >
              账户与安全
            </button>
            {accountPanelOpen ? (
              <div
                id="enterprise-portal-account-security"
                className="space-y-2 rounded-xl border border-white/10 bg-[#0f1b31] p-3"
              >
                <label
                  htmlFor="enterprise-portal-new-password"
                  className="block text-xs font-semibold text-slate-200"
                >
                  设置或修改登录密码
                </label>
                <input
                  id="enterprise-portal-new-password"
                  type="password"
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950 outline-none focus:border-blue-400"
                  placeholder="至少 8 个字符"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
                    disabled={busy || newPassword.length < 8}
                    onClick={() => void setLoginPassword()}
                  >
                    {busy ? "保存中..." : "保存密码"}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200"
                    onClick={() => {
                      setNewPassword("");
                      setAccountPanelOpen(false);
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className="w-full rounded-lg border border-blue-300/30 bg-white/5 px-3 py-2 text-left text-xs font-semibold text-[#dbeafe] transition hover:bg-[#17233f] hover:text-white"
              onClick={() => {
                setNewPassword("");
                setAccountPanelOpen(false);
                window.location.assign("/enterprise");
              }}
            >
              切换企业
            </button>
            {message ? (
              <div
                role="alert"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs leading-5 text-slate-200"
              >
                {message}
              </div>
            ) : null}
          </div>
        }
      />
    </main>
  );
}
