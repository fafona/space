export const MERCHANT_BOOKING_EMAIL_TIMEOUT_MS = 15_000;

export type MerchantBookingEmailTransportDependencies = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type EmailTransportResult =
  | { delivery: "sent"; messageId: string }
  | { delivery: "failed" | "unconfirmed"; error: string; retryAfterSeconds?: number };

// One attempt only. A timeout or lost response does not establish that the
// provider rejected the message; never report it as sent or blindly retry here.
export async function deliverMerchantBookingEmail(
  input: { apiKey: string; body: Record<string, unknown> },
  dependencies: MerchantBookingEmailTransportDependencies = {},
): Promise<EmailTransportResult> {
  const controller = new AbortController();
  const requestedTimeout = dependencies.timeoutMs ?? MERCHANT_BOOKING_EMAIL_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(1, Math.min(30_000, Math.trunc(requestedTimeout))) : MERCHANT_BOOKING_EMAIL_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const completed = await Promise.race([
      (async () => {
        const response = await (dependencies.fetcher ?? fetch)("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(input.body), signal: controller.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          return { response, text: "" };
        }
        return { response, text: await response.text() };
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("booking_email_timeout")); }, timeoutMs);
      }),
    ]);
    const { response, text } = completed;
    if (!response.ok) {
      if (response.status >= 500 || response.status === 408) {
        return { delivery: "unconfirmed", error: "邮件服务响应异常，发送结果待确认，请先核对发送记录再决定是否重发" };
      }
      // Do not echo provider response bodies, credentials, or customer data.
      if (response.status === 429) {
        const requested = Number(response.headers.get("retry-after"));
        return { delivery: "failed", error: "provider_rate_limited",
          retryAfterSeconds: Number.isFinite(requested) && requested > 0 ? Math.max(1, Math.min(3600, Math.ceil(requested))) : 60 };
      }
      return { delivery: "failed", error: `邮件服务拒绝请求（HTTP ${response.status}），请检查发件配置和收件地址` };
    }
    let messageId = "";
    try {
      const json: unknown = JSON.parse(text);
      if (json && typeof json === "object" && "id" in json && typeof json.id === "string") messageId = json.id.trim();
    } catch { /* A successful HTTP status alone is not a send receipt. */ }
    if (!messageId || messageId.length > 256 || /[\u0000-\u001f\u007f]/u.test(messageId)) {
      return { delivery: "unconfirmed", error: "邮件服务未返回有效发送凭据，发送结果待确认，请先核对发送记录" };
    }
    return { delivery: "sent", messageId };
  } catch {
    return { delivery: "unconfirmed", error: timedOut
      ? "邮件请求超时，发送结果待确认，请先核对发送记录再决定是否重发"
      : "邮件请求中断，发送结果待确认，请先核对发送记录再决定是否重发" };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
