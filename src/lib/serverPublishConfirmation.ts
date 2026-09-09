export type ServerPublishError = { code?: string; message: string };

export type ServerPublishAttemptResult = {
  handled: boolean;
  error: ServerPublishError | null;
};

/** A successful HTTP status alone is not confirmation of this publish request. */
export function isServerPublishConfirmed(
  response: { ok: boolean },
  value: unknown,
  expected: { requestId: string; updatedAt: string; mode: "platform" | "merchant" },
): boolean {
  if (!response.ok || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const expectedTime = Date.parse(expected.updatedAt);
  if (
    !expected.requestId ||
    result.ok !== true ||
    result.requestId !== expected.requestId ||
    result.mode !== expected.mode ||
    typeof result.updatedAt !== "string" ||
    !Number.isFinite(expectedTime) ||
    Date.parse(result.updatedAt) !== expectedTime ||
    typeof result.merchantCount !== "number" ||
    !Number.isSafeInteger(result.merchantCount) ||
    result.merchantCount < 0
  ) return false;
  return expected.mode === "platform" ? result.merchantCount === 0 : result.merchantCount > 0;
}

/** Unhandled transport/response failures must never fall through to local success. */
export function readServerPublishCompletionError(
  result: ServerPublishAttemptResult,
): ServerPublishError | null {
  if (result.error) return result.error;
  if (result.handled === true) return null;
  return {
    code: "publish_result_unconfirmed",
    message: "发布结果未确认，当前编辑已保留；请先核对线上内容，再决定是否重试。",
  };
}
