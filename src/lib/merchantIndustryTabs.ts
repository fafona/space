import { MERCHANT_INDUSTRY_OPTIONS, type MerchantIndustry } from "@/data/platformControlStore";

export type MerchantIndustryTabIndustry = Exclude<MerchantIndustry, ""> | "all";

export type MerchantIndustryTabInput = {
  id?: string;
  label?: string;
  industry?: MerchantIndustryTabIndustry;
};

export type MerchantIndustryTab = {
  id: string;
  label: string;
  industry: MerchantIndustryTabIndustry;
};

const DEFAULT_MERCHANT_INDUSTRY_TABS: MerchantIndustryTab[] = [
  { id: "tab-recommended", label: "推荐", industry: "all" },
  { id: "tab-catering", label: "餐饮", industry: "餐饮" },
  { id: "tab-entertainment", label: "娱乐", industry: "娱乐" },
  { id: "tab-retail", label: "零售", industry: "零售" },
  { id: "tab-service", label: "服务", industry: "服务" },
  { id: "tab-organization", label: "组织", industry: "组织" },
];

const DEFAULT_MERCHANT_INDUSTRY: Exclude<MerchantIndustry, ""> = "餐饮";

function toTrimmedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isMerchantIndustry(value: unknown): value is Exclude<MerchantIndustry, ""> {
  return MERCHANT_INDUSTRY_OPTIONS.includes(value as Exclude<MerchantIndustry, "">);
}

function uniqueId(base: string, used: Set<string>) {
  const normalizedBase = base.trim() || "tab";
  let candidate = normalizedBase;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${normalizedBase}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function normalizeRestIndustry(input: MerchantIndustryTabInput | null | undefined): MerchantIndustryTabIndustry {
  const rawIndustry = (input as { industry?: unknown } | null | undefined)?.industry;
  if (rawIndustry === "all") return "all";
  if (isMerchantIndustry(rawIndustry)) return rawIndustry;
  const label = toTrimmedText(input?.label);
  const fromLabel = MERCHANT_INDUSTRY_OPTIONS.find((item) => item === label) as
    | Exclude<MerchantIndustry, "">
    | undefined;
  return fromLabel ?? DEFAULT_MERCHANT_INDUSTRY;
}

export function createDefaultMerchantIndustryTabs(): MerchantIndustryTab[] {
  return DEFAULT_MERCHANT_INDUSTRY_TABS.map((item) => ({ ...item }));
}

export function normalizeMerchantIndustryTabs(
  source: Array<MerchantIndustryTabInput | null | undefined> | undefined,
): MerchantIndustryTab[] {
  if (!Array.isArray(source) || source.length === 0) {
    return createDefaultMerchantIndustryTabs();
  }

  const used = new Set<string>();
  const firstId = uniqueId(toTrimmedText(source[0]?.id) || "tab-recommended", used);
  const rest = source.slice(1).map((item, index) => {
    const industry = normalizeRestIndustry(item);
    const nextLabel = toTrimmedText(item?.label) || (industry === "all" ? "全部商户" : industry);
    return {
      id: uniqueId(toTrimmedText(item?.id) || `tab-${index + 2}`, used),
      label: nextLabel,
      industry,
    } satisfies MerchantIndustryTab;
  });

  return [
    {
      id: firstId,
      label: "推荐",
      industry: "all",
    },
    ...rest,
  ];
}

export function toMerchantIndustryTabInputs(tabs: MerchantIndustryTab[]): MerchantIndustryTabInput[] {
  return tabs.map((item) => ({
    id: item.id,
    label: item.label,
    industry: item.industry,
  }));
}
