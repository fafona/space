const RESEND_EMAILS_API_URL = "https://api.resend.com/emails";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type MerchantEnterpriseInvitationEmailConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
  publicOrigin: string;
};

export type MerchantEnterpriseInvitationEmailInput = {
  eventId: string;
  replayCount: number;
  siteId: string;
  employeeId: string;
  invitationVersion: number;
  invitationToken: string;
  recipientEmail: string;
  employeeDisplayName?: string;
  merchantDisplayName?: string;
  signal?: AbortSignal;
};

export type MerchantEnterpriseInvitationEmailResult = {
  provider: "resend";
  messageId: string;
};

export class MerchantEnterpriseInvitationEmailError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    options: { retryable: boolean; retryAfterSeconds?: number },
  ) {
    super(code);
    this.name = "MerchantEnterpriseInvitationEmailError";
    this.code = code;
    this.retryable = options.retryable;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  const email = trimText(value).toLowerCase();
  if (
    !email ||
    email.length > 320 ||
    /[\r\n\0]/.test(email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new MerchantEnterpriseInvitationEmailError(
      "invitation_email_address_invalid",
      { retryable: false },
    );
  }
  return email;
}

function normalizeMailbox(value: unknown, code: string) {
  const mailbox = trimText(value);
  if (!mailbox || mailbox.length > 512 || /[\r\n\0]/.test(mailbox)) {
    throw new MerchantEnterpriseInvitationEmailError(code, {
      retryable: false,
    });
  }
  const angleAddress = mailbox.match(/<([^<>]+)>$/)?.[1];
  normalizeEmail(angleAddress ?? mailbox);
  return mailbox;
}

function normalizePublicOrigin(value: unknown) {
  const raw = trimText(value);
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    throw new MerchantEnterpriseInvitationEmailError(
      "invitation_public_origin_invalid",
      { retryable: false },
    );
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
    throw new MerchantEnterpriseInvitationEmailError(
      "invitation_public_origin_invalid",
      { retryable: false },
    );
  }
  return url.origin;
}

export function resolveMerchantEnterpriseInvitationEmailConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantEnterpriseInvitationEmailConfig {
  const apiKey = trimText(environment.RESEND_API_KEY);
  if (!apiKey || apiKey.length > 512 || /[\r\n\0]/.test(apiKey)) {
    throw new MerchantEnterpriseInvitationEmailError(
      "invitation_email_provider_unconfigured",
      { retryable: false },
    );
  }
  const from = normalizeMailbox(
    environment.MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM,
    "invitation_email_sender_invalid",
  );
  const replyToText = trimText(
    environment.MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO,
  );
  const publicOrigin = normalizePublicOrigin(
    environment.MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN,
  );
  return {
    apiKey,
    from,
    ...(replyToText
      ? {
          replyTo: normalizeMailbox(
            replyToText,
            "invitation_email_reply_to_invalid",
          ),
        }
      : {}),
    publicOrigin,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeDisplayName(value: unknown, fallback: string) {
  const name = trimText(value)
    .replace(/[\r\n\0<>]/g, "")
    .slice(0, 120);
  return name || fallback;
}

function normalizeInvitationIdentity(input: MerchantEnterpriseInvitationEmailInput) {
  const eventId = trimText(input.eventId).toLowerCase();
  const siteId = trimText(input.siteId);
  const employeeId = trimText(input.employeeId).toLowerCase();
  const invitationVersion = Number(input.invitationVersion);
  const invitationToken = trimText(input.invitationToken);
  const replayCount = Number(input.replayCount);
  if (
    !UUID_PATTERN.test(eventId) ||
    !Number.isSafeInteger(replayCount) ||
    replayCount < 0 ||
    !/^\d{8}$/.test(siteId) ||
    !UUID_PATTERN.test(employeeId) ||
    !Number.isSafeInteger(invitationVersion) ||
    invitationVersion <= 0 ||
    !INVITATION_TOKEN_PATTERN.test(invitationToken)
  ) {
    throw new MerchantEnterpriseInvitationEmailError(
      "invitation_email_payload_invalid",
      { retryable: false },
    );
  }
  return {
    eventId,
    replayCount,
    siteId,
    employeeId,
    invitationVersion,
    invitationToken,
  };
}

export function buildMerchantEnterpriseInvitationEntryUrl(
  input: Pick<
    MerchantEnterpriseInvitationEmailInput,
    "siteId" | "employeeId" | "invitationVersion" | "invitationToken"
  >,
  publicOrigin: string,
) {
  const normalized = normalizeInvitationIdentity({
    eventId: "123e4567-e89b-42d3-a456-426614174000",
    replayCount: 0,
    recipientEmail: "placeholder@example.com",
    ...input,
  });
  const url = new URL("/enterprise/invite", normalizePublicOrigin(publicOrigin));
  url.pathname = `/enterprise/${encodeURIComponent(normalized.siteId)}`;
  url.hash = new URLSearchParams({
    iv: String(normalized.invitationVersion),
    it: normalized.invitationToken,
  }).toString();
  return url.toString();
}

function readRetryAfterSeconds(response: Response) {
  const raw = trimText(response.headers.get("retry-after"));
  if (!raw) return undefined;
  if (/^[0-9]+$/.test(raw)) {
    return Math.min(86_400, Math.max(5, Number(raw)));
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(
    86_400,
    Math.max(5, Math.ceil((timestamp - Date.now()) / 1_000)),
  );
}

function readResendErrorName(bodyText: string) {
  if (!bodyText || bodyText.length > 16_384) return "";
  try {
    const parsed = JSON.parse(bodyText) as {
      name?: unknown;
      error?: { name?: unknown } | unknown;
    };
    const nested =
      parsed.error && typeof parsed.error === "object"
        ? (parsed.error as { name?: unknown }).name
        : undefined;
    return trimText(parsed.name ?? nested).toLowerCase();
  } catch {
    return "";
  }
}

function resendFailure(response: Response, bodyText: string) {
  const errorName = readResendErrorName(bodyText);
  if (response.status === 409 && errorName === "invalid_idempotent_request") {
    return new MerchantEnterpriseInvitationEmailError(
      "invitation_email_idempotency_conflict",
      { retryable: false },
    );
  }
  const retryable =
    response.status === 408 ||
    response.status === 409 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500;
  return new MerchantEnterpriseInvitationEmailError(
    retryable
      ? "invitation_email_provider_temporarily_unavailable"
      : "invitation_email_provider_rejected",
    {
      retryable,
      ...(retryable
        ? { retryAfterSeconds: readRetryAfterSeconds(response) }
        : {}),
    },
  );
}

export async function sendMerchantEnterpriseInvitationEmail(
  input: MerchantEnterpriseInvitationEmailInput,
  options: {
    config?: MerchantEnterpriseInvitationEmailConfig;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<MerchantEnterpriseInvitationEmailResult> {
  const identity = normalizeInvitationIdentity(input);
  const recipientEmail = normalizeEmail(input.recipientEmail);
  const config = options.config ?? resolveMerchantEnterpriseInvitationEmailConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const merchantName = normalizeDisplayName(
    input.merchantDisplayName,
    "FAOLLA 企业",
  );
  const employeeName = normalizeDisplayName(input.employeeDisplayName, "您好");
  const invitationUrl = buildMerchantEnterpriseInvitationEntryUrl(
    identity,
    config.publicOrigin,
  );
  const subject = `${merchantName} 邀请您加入企业工作台`;
  const text = [
    `${employeeName}：`,
    "",
    `${merchantName} 邀请您加入 FAOLLA 企业工作台。`,
    "请使用以下链接完成身份验证并接受邀请：",
    invitationUrl,
    "",
    "如果您不认识该企业，请忽略此邮件。请勿转发邀请链接。",
  ].join("\n");
  const html = [
    '<div style="font-family:Arial,Microsoft YaHei,sans-serif;line-height:1.7;color:#0f172a;">',
    `<p>${escapeHtml(employeeName)}：</p>`,
    `<p>${escapeHtml(merchantName)} 邀请您加入 FAOLLA 企业工作台。</p>`,
    `<p><a href="${escapeHtml(invitationUrl)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#0f172a;color:#fff;text-decoration:none;font-weight:600;">接受企业邀请</a></p>`,
    `<p style="font-size:13px;color:#64748b;word-break:break-all;">如果按钮无法打开，请复制此链接：<br>${escapeHtml(invitationUrl)}</p>`,
    '<p style="font-size:13px;color:#64748b;">如果您不认识该企业，请忽略此邮件。请勿转发邀请链接。</p>',
    "</div>",
  ].join("");

  let response: Response;
  try {
    response = await fetchImpl(RESEND_EMAILS_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `enterprise-invite/${identity.eventId}/${identity.replayCount}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [recipientEmail],
        subject,
        text,
        html,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
      signal: input.signal,
    });
  } catch (error) {
    throw new MerchantEnterpriseInvitationEmailError(
      error instanceof DOMException && error.name === "AbortError"
        ? "invitation_email_aborted"
        : "invitation_email_provider_temporarily_unavailable",
      { retryable: true },
    );
  }
  const responseText = await response.text().catch(() => "");
  if (!response.ok) throw resendFailure(response, responseText);

  let messageId = "";
  try {
    const parsed = JSON.parse(responseText) as { id?: unknown };
    messageId = trimText(parsed.id);
  } catch {
    messageId = "";
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(messageId)) {
    throw new MerchantEnterpriseInvitationEmailError(
      "invitation_email_provider_response_invalid",
      { retryable: true },
    );
  }
  return { provider: "resend", messageId };
}
