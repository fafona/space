export const MERCHANT_ID_MIN = 10_000_000;
export const MERCHANT_ID_MAX = 99_999_999;
export const MERCHANT_ID_REGEX = /^\d{8}$/;

export type MerchantIdRuleType = "exact" | "range" | "pattern";

export type MerchantIdRule = {
  id: string;
  type: MerchantIdRuleType;
  expression: string;
  note: string;
  intervalStart: number;
  intervalEnd: number;
  createdAt: string;
};

type MerchantIdRuleDraft = Omit<MerchantIdRule, "id" | "createdAt" | "note">;

type MerchantIdRuleParseResult =
  | { ok: true; rule: MerchantIdRuleDraft }
  | { ok: false; message: string };

function normalizeRuleInput(value: string) {
  return value
    .trim()
    .replace(/[－—–~～]/g, "-")
    .replace(/\s+/g, "");
}

function clampMerchantIdInterval(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < MERCHANT_ID_MIN || end > MERCHANT_ID_MAX || start > end) return null;
  return {
    intervalStart: Math.round(start),
    intervalEnd: Math.round(end),
  };
}

export function parseMerchantIdRuleInput(value: string): MerchantIdRuleParseResult {
  const normalized = normalizeRuleInput(value);
  if (!normalized) {
    return { ok: false, message: "请输入要禁用的 ID、号段或通配规则" };
  }

  if (MERCHANT_ID_REGEX.test(normalized)) {
    const exactValue = Number(normalized);
    return {
      ok: true,
      rule: {
        type: "exact",
        expression: normalized,
        intervalStart: exactValue,
        intervalEnd: exactValue,
      },
    };
  }

  const rangeMatch = normalized.match(/^(\d{8})-(\d{8})$/);
  if (rangeMatch) {
    const interval = clampMerchantIdInterval(Number(rangeMatch[1]), Number(rangeMatch[2]));
    if (!interval) {
      return { ok: false, message: "号段范围必须是 8 位数字，且起始值不能大于结束值" };
    }
    return {
      ok: true,
      rule: {
        type: "range",
        expression: `${rangeMatch[1]}-${rangeMatch[2]}`,
        intervalStart: interval.intervalStart,
        intervalEnd: interval.intervalEnd,
      },
    };
  }

  const patternMatch = normalized.match(/^(\d{1,7})(\*{1,7})$/);
  if (patternMatch && normalized.length === 8) {
    const prefix = patternMatch[1];
    const wildcardLength = patternMatch[2].length;
    const base = Number(prefix) * 10 ** wildcardLength;
    const interval = clampMerchantIdInterval(base, base + 10 ** wildcardLength - 1);
    if (!interval) {
      return { ok: false, message: "通配规则必须落在 8 位商户 ID 范围内" };
    }
    return {
      ok: true,
      rule: {
        type: "pattern",
        expression: `${prefix}${"*".repeat(wildcardLength)}`,
        intervalStart: interval.intervalStart,
        intervalEnd: interval.intervalEnd,
      },
    };
  }

  return {
    ok: false,
    message: "仅支持 8 位单个 ID、8 位号段（如 10000010-10000020）或前缀通配（如 100000**）",
  };
}

function normalizeNote(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCreatedAt(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed || "";
}

export function normalizeMerchantIdRule(input: unknown): MerchantIdRule | null {
  if (!input || typeof input !== "object") return null;
  const record = input as {
    id?: unknown;
    type?: unknown;
    expression?: unknown;
    note?: unknown;
    intervalStart?: unknown;
    intervalEnd?: unknown;
    createdAt?: unknown;
  };
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const type = record.type;
  const expression = typeof record.expression === "string" ? record.expression.trim() : "";
  const intervalStart = typeof record.intervalStart === "number" ? record.intervalStart : Number(record.intervalStart);
  const intervalEnd = typeof record.intervalEnd === "number" ? record.intervalEnd : Number(record.intervalEnd);
  const createdAt = normalizeCreatedAt(record.createdAt);

  if (!id || !expression || !createdAt) return null;
  if (type !== "exact" && type !== "range" && type !== "pattern") return null;

  const interval = clampMerchantIdInterval(intervalStart, intervalEnd);
  if (!interval) return null;

  return {
    id,
    type,
    expression,
    note: normalizeNote(record.note),
    intervalStart: interval.intervalStart,
    intervalEnd: interval.intervalEnd,
    createdAt,
  };
}

export function normalizeMerchantIdRules(input: unknown): MerchantIdRule[] {
  if (!Array.isArray(input)) return [];
  const rules = input
    .map((item) => normalizeMerchantIdRule(item))
    .filter((item): item is MerchantIdRule => !!item);
  return sortMerchantIdRules(rules);
}

export function sortMerchantIdRules(rules: MerchantIdRule[]) {
  return [...rules].sort((left, right) => {
    if (left.intervalStart !== right.intervalStart) {
      return left.intervalStart - right.intervalStart;
    }
    if (left.intervalEnd !== right.intervalEnd) {
      return left.intervalEnd - right.intervalEnd;
    }
    return left.expression.localeCompare(right.expression, "zh-CN");
  });
}

function findBlockingRuleByNumber(candidate: number, rules: MerchantIdRule[]) {
  let blocking: MerchantIdRule | null = null;
  for (const rule of rules) {
    if (candidate < rule.intervalStart || candidate > rule.intervalEnd) continue;
    if (!blocking || rule.intervalEnd > blocking.intervalEnd) {
      blocking = rule;
    }
  }
  return blocking;
}

export function findBlockingMerchantIdRule(merchantId: string, rules: MerchantIdRule[]) {
  if (!MERCHANT_ID_REGEX.test(merchantId.trim())) return null;
  return findBlockingRuleByNumber(Number(merchantId), rules);
}

export function findNextAllowedMerchantIdNumber(start: number, rules: MerchantIdRule[]) {
  let candidate = Math.max(MERCHANT_ID_MIN, Math.round(start));
  while (candidate <= MERCHANT_ID_MAX) {
    const blocking = findBlockingRuleByNumber(candidate, rules);
    if (!blocking) return candidate;
    candidate = blocking.intervalEnd + 1;
  }
  return null;
}
