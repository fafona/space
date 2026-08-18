const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseUtcDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

export type MerchantEnterpriseAuditUtcRangeResult =
  | {
      ok: true;
      createdFrom?: string;
      createdToExclusive?: string;
    }
  | {
      ok: false;
      error: string;
    };

export function buildMerchantEnterpriseAuditUtcRange(input: {
  startDate: string;
  endDate: string;
}): MerchantEnterpriseAuditUtcRangeResult {
  const startDate = input.startDate.trim();
  const endDate = input.endDate.trim();
  const startMs = startDate ? parseUtcDate(startDate) : null;
  const endMs = endDate ? parseUtcDate(endDate) : null;

  if ((startDate && startMs === null) || (endDate && endMs === null)) {
    return { ok: false, error: "请输入有效的 UTC 日期，格式为 YYYY-MM-DD。" };
  }
  if (startMs !== null && endMs !== null && startMs > endMs) {
    return { ok: false, error: "结束日期不能早于开始日期。" };
  }

  const createdToExclusive =
    endMs === null ? null : new Date(endMs + DAY_MS).toISOString();
  if (endDate && !/^\d{4}-/.test(createdToExclusive ?? "")) {
    return { ok: false, error: "结束日期超出支持范围。" };
  }

  return {
    ok: true,
    ...(startMs === null ? {} : { createdFrom: new Date(startMs).toISOString() }),
    ...(createdToExclusive === null ? {} : { createdToExclusive }),
  };
}

export function appendMerchantEnterpriseAuditActorFilter(
  params: URLSearchParams,
  actorFilter: string,
) {
  if (actorFilter === "owner" || actorFilter === "system") {
    params.set("actorType", actorFilter);
    return;
  }
  if (actorFilter.startsWith("employee:")) {
    const actorId = actorFilter.slice("employee:".length);
    if (actorId) {
      params.set("actorType", "employee");
      params.set("actorId", actorId);
    }
  }
}
