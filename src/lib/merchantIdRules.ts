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
    .replace(/[–—－~〜]/g, "-")
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

function intersectMerchantIdInterval(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const intervalStart = Math.max(MERCHANT_ID_MIN, Math.round(start));
  const intervalEnd = Math.min(MERCHANT_ID_MAX, Math.round(end));
  if (intervalStart > intervalEnd) return null;
  return {
    intervalStart,
    intervalEnd,
  };
}

function isMerchantIdPatternExpression(value: string) {
  return value.length === 8 && /^[\d*]{8}$/.test(value) && value.includes("*");
}

function buildPatternCoverageInterval(expression: string) {
  if (!isMerchantIdPatternExpression(expression)) return null;
  const minValue = Number(expression.replace(/\*/g, "0"));
  const maxValue = Number(expression.replace(/\*/g, "9"));
  return intersectMerchantIdInterval(minValue, maxValue);
}

function matchesMerchantIdPattern(candidate: string, expression: string) {
  if (!MERCHANT_ID_REGEX.test(candidate) || !isMerchantIdPatternExpression(expression)) return false;
  for (let index = 0; index < expression.length; index += 1) {
    const ruleChar = expression[index];
    if (ruleChar === "*") continue;
    if (candidate[index] !== ruleChar) return false;
  }
  return true;
}

function countTrailingWildcards(expression: string) {
  let count = 0;
  for (let index = expression.length - 1; index >= 0; index -= 1) {
    if (expression[index] !== "*") break;
    count += 1;
  }
  return count;
}

function getPatternBlockEnd(candidate: number, expression: string) {
  const normalizedCandidate = String(Math.round(candidate)).padStart(8, "0");
  const trailingWildcards = countTrailingWildcards(expression);
  if (trailingWildcards <= 0) return candidate;
  const prefix = normalizedCandidate.slice(0, expression.length - trailingWildcards);
  return Number(prefix + "9".repeat(trailingWildcards));
}

export function parseMerchantIdRuleInput(value: string): MerchantIdRuleParseResult {
  const normalized = normalizeRuleInput(value);
  if (!normalized) {
    return { ok: false, message: "Please enter a blocked ID, range, or wildcard rule" };
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
      return { ok: false, message: "Range rules must be valid 8-digit IDs and the start cannot exceed the end" };
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

  if (isMerchantIdPatternExpression(normalized)) {
    const interval = buildPatternCoverageInterval(normalized);
    if (!interval) {
      return { ok: false, message: "The wildcard rule must match at least one valid 8-digit merchant ID" };
    }
    return {
      ok: true,
      rule: {
        type: "pattern",
        expression: normalized,
        intervalStart: interval.intervalStart,
        intervalEnd: interval.intervalEnd,
      },
    };
  }

  return {
    ok: false,
    message:
      "Only 8-digit IDs, 8-digit ranges (for example 10000010-10000020), or 8-character wildcard rules (for example 100000**, 10**0010, ****1111) are supported",
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

  const parsed = parseMerchantIdRuleInput(expression);
  const interval =
    parsed.ok && parsed.rule.type === type
      ? {
          intervalStart: parsed.rule.intervalStart,
          intervalEnd: parsed.rule.intervalEnd,
        }
      : clampMerchantIdInterval(intervalStart, intervalEnd);
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

function matchesMerchantIdRuleNumber(candidate: number, rule: MerchantIdRule) {
  if (!Number.isFinite(candidate)) return false;
  if (rule.type === "pattern") {
    return matchesMerchantIdPattern(String(Math.round(candidate)).padStart(8, "0"), rule.expression);
  }
  return candidate >= rule.intervalStart && candidate <= rule.intervalEnd;
}

function findBlockingRuleByNumber(candidate: number, rules: MerchantIdRule[]) {
  let blocking: { rule: MerchantIdRule; blockEnd: number } | null = null;
  for (const rule of rules) {
    if (!matchesMerchantIdRuleNumber(candidate, rule)) continue;
    const blockEnd = rule.type === "pattern" ? getPatternBlockEnd(candidate, rule.expression) : rule.intervalEnd;
    if (!blocking || blockEnd > blocking.blockEnd) {
      blocking = { rule, blockEnd };
    }
  }
  return blocking;
}

export function findBlockingMerchantIdRule(merchantId: string, rules: MerchantIdRule[]) {
  if (!MERCHANT_ID_REGEX.test(merchantId.trim())) return null;
  return findBlockingRuleByNumber(Number(merchantId), rules)?.rule ?? null;
}

export function findNextAllowedMerchantIdNumber(start: number, rules: MerchantIdRule[]) {
  let candidate = Math.max(MERCHANT_ID_MIN, Math.round(start));
  while (candidate <= MERCHANT_ID_MAX) {
    const blocking = findBlockingRuleByNumber(candidate, rules);
    if (!blocking) return candidate;
    candidate = Math.max(candidate + 1, blocking.blockEnd + 1);
  }
  return null;
}
