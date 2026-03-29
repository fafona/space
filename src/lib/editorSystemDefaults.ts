import type { Block } from "@/data/homeBlocks";
import type { PagePlanConfig } from "@/lib/pagePlans";
import { ensureDomTranslations, normalizeDomLocale, reverseTranslateDomText, translateDomText } from "@/lib/domTranslations";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";

const SYSTEM_DEFAULT_PAGE_NAME_COUNT = 24;

const SYSTEM_DEFAULT_ALIASES: Record<string, string> = {
  "臊展示平台注册商户的前台入口": "展示平台注册商户的前台入口",
  "攌城市定位与内容搜": "城市定位与内容搜索",
};

const SYSTEM_DEFAULT_TEXTS = (() => {
  const values = new Set<string>([
    "按钮",
    "新的画廊区块",
    "新的图表区块",
    "图表说明文本",
    "页面导航",
    "新的音乐区块",
    "新的视觉横幅",
    "在这里编写副标题说明文案",
    "新的文本区块",
    "在这里输入文本内容。",
    "新的列表区块",
    "列表1",
    "列表2",
    "搜索",
    "城市定位与内容搜索",
    "国家",
    "省份",
    "选择城市",
    "请输入商户名称关键词",
    "请输入关键词",
    "定位",
    "商户列表",
    "展示平台注册商户的前台入口",
    "暂无商户",
    "上一页",
    "下一页",
    "推荐",
    "推荐（全部）",
    "全部商户",
    "餐饮",
    "娱乐",
    "零售",
    "服务",
    "组织",
    "产品展示",
    "支持产品图片、编号、名称、介绍和价格展示。",
    "搜索产品名称/编号/介绍",
    "示例产品",
    "在这里填写产品卖点、规格或简短介绍。",
    "在线预约",
    "客户可选择店铺、项目、日期时间并填写预约信息。",
    "预约店铺",
    "项目或类型",
    "主店",
    "咨询预约",
    "到店服务",
    "提交预约",
    "修改预约",
    "取消预约",
    "预约提交成功",
    "我们已收到您的预约，可在此继续修改或取消。",
    "请输入称谓或姓名",
    "可填写备注或需求",
    "先生",
    "女士",
    "联系方式",
    "相册展示",
    "数据图表",
    "支持图表与文字混排展示。",
    "一月",
    "二月",
    "三月",
    "四月",
    "方案一",
    "方案二",
    "方案三",
    "扫码进入网站",
  ]);

  for (let index = 1; index <= SYSTEM_DEFAULT_PAGE_NAME_COUNT; index += 1) {
    values.add(`页面${index}`);
  }

  return [...values];
})();

const SYSTEM_DEFAULT_TEXT_SET = new Set(SYSTEM_DEFAULT_TEXTS);
const PAGE_NAME_PATTERN =
  /^(?:page|pagina|página|seite|strona|страница|сторінка|頁面|页面|ページ|페이지)\s*([0-9]{1,2})$/iu;
const PLAN_NAME_PATTERN =
  /^(?:edit\s*)?(?:plan|variant|variante|вариант|方案)\s*([123一二三])$/iu;
const PLAN_NAME_BY_INDEX = ["方案一", "方案二", "方案三"] as const;

function resolveCanonicalDefaultPageName(value: string) {
  const match = value.match(PAGE_NAME_PATTERN);
  if (!match) return null;
  const rawIndex = Number(match[1]);
  if (!Number.isFinite(rawIndex) || rawIndex < 1 || rawIndex > SYSTEM_DEFAULT_PAGE_NAME_COUNT) return null;
  return `页面${rawIndex}`;
}

function resolveCanonicalDefaultPlanName(value: string) {
  const match = value.match(PLAN_NAME_PATTERN);
  if (!match) return null;
  const raw = (match[1] ?? "").trim();
  const index =
    raw === "一" ? 1 :
    raw === "二" ? 2 :
    raw === "三" ? 3 :
    Number(raw);
  if (!Number.isFinite(index) || index < 1 || index > PLAN_NAME_BY_INDEX.length) return null;
  return PLAN_NAME_BY_INDEX[index - 1];
}

function toCanonicalSystemDefaultText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const canonicalPageName = resolveCanonicalDefaultPageName(trimmed);
  if (canonicalPageName) return canonicalPageName;

  const canonicalPlanName = resolveCanonicalDefaultPlanName(trimmed);
  if (canonicalPlanName) return canonicalPlanName;

  const aliased = SYSTEM_DEFAULT_ALIASES[trimmed];
  if (aliased) return aliased;
  if (SYSTEM_DEFAULT_TEXT_SET.has(trimmed)) return trimmed;

  for (const option of LANGUAGE_OPTIONS) {
    const recovered = reverseTranslateDomText(trimmed, option.code)?.trim();
    if (!recovered) continue;
    const recoveredAlias = SYSTEM_DEFAULT_ALIASES[recovered];
    if (recoveredAlias) return recoveredAlias;
    if (SYSTEM_DEFAULT_TEXT_SET.has(recovered)) return recovered;
  }

  return null;
}

function localizeSystemDefaultValue<T>(value: T, locale: string): T {
  if (typeof value === "string") {
    const canonical = toCanonicalSystemDefaultText(value);
    if (!canonical) return value;
    const translated = translateDomText(canonical, normalizeDomLocale(locale));
    return (translated === canonical && normalizeDomLocale(locale) !== "zh-CN" ? value : translated) as T;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const localized = localizeSystemDefaultValue(item, locale);
      if (localized !== item) changed = true;
      return localized;
    });
    return (changed ? next : value) as T;
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    let changed = false;
    const nextEntries = Object.entries(source).map(([key, nestedValue]) => {
      const localized = localizeSystemDefaultValue(nestedValue, locale);
      if (localized !== nestedValue) changed = true;
      return [key, localized] as const;
    });
    return (changed ? Object.fromEntries(nextEntries) : value) as T;
  }

  return value;
}

function canonicalizeSystemDefaultValue<T>(value: T): T {
  if (typeof value === "string") {
    const canonical = toCanonicalSystemDefaultText(value);
    return (canonical ?? value) as T;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const canonicalized = canonicalizeSystemDefaultValue(item);
      if (canonicalized !== item) changed = true;
      return canonicalized;
    });
    return (changed ? next : value) as T;
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    let changed = false;
    const nextEntries = Object.entries(source).map(([key, nestedValue]) => {
      const canonicalized = canonicalizeSystemDefaultValue(nestedValue);
      if (canonicalized !== nestedValue) changed = true;
      return [key, canonicalized] as const;
    });
    return (changed ? Object.fromEntries(nextEntries) : value) as T;
  }

  return value;
}

const EDITOR_DEFAULT_PAGE_NAME_PATTERN =
  /^(?:page|pagina|página|seite|strona|\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430|\u0441\u0442\u043e\u0440\u0456\u043d\u043a\u0430|\u9801\u9762|\u9875\u9762|\u30da\u30fc\u30b8|\ud398\uc774\uc9c0)\s*([0-9]{1,2})$/iu;
const EDITOR_DEFAULT_PLAN_NAME_PATTERN =
  /^(?:(?:edit|\u7f16\u8f91)\s*)?(?:plan|variant|variante|\u0432\u0430\u0440\u0438\u0430\u043d\u0442|\u65b9\u6848)\s*([123\u4e00\u4e8c\u4e09])$/iu;
const CANONICAL_PLAN_NAMES = ["\u65b9\u6848\u4e00", "\u65b9\u6848\u4e8c", "\u65b9\u6848\u4e09"] as const;
const CANONICAL_PAGE_PREFIX = "\u9875\u9762";

function canonicalizeEditorPageOrPlanName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return value;

  const pageMatch = normalized.match(EDITOR_DEFAULT_PAGE_NAME_PATTERN);
  if (pageMatch) {
    const index = Number(pageMatch[1]);
    if (Number.isFinite(index) && index >= 1 && index <= SYSTEM_DEFAULT_PAGE_NAME_COUNT) {
      return `${CANONICAL_PAGE_PREFIX}${index}`;
    }
  }

  const planMatch = normalized.match(EDITOR_DEFAULT_PLAN_NAME_PATTERN);
  if (planMatch) {
    const raw = (planMatch[1] ?? "").trim();
    const index =
      raw === "\u4e00" ? 1 :
      raw === "\u4e8c" ? 2 :
      raw === "\u4e09" ? 3 :
      Number(raw);
    if (Number.isFinite(index) && index >= 1 && index <= CANONICAL_PLAN_NAMES.length) {
      return CANONICAL_PLAN_NAMES[index - 1];
    }
  }

  return value;
}

function deepCanonicalizeEditorDefaults<T>(value: T): T {
  if (typeof value === "string") {
    const pageOrPlanName = canonicalizeEditorPageOrPlanName(value);
    const canonical = toCanonicalSystemDefaultText(pageOrPlanName);
    return (canonical ?? pageOrPlanName) as T;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const canonicalized = deepCanonicalizeEditorDefaults(item);
      if (canonicalized !== item) changed = true;
      return canonicalized;
    });
    return (changed ? next : value) as T;
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    let changed = false;
    const nextEntries = Object.entries(source).map(([key, nestedValue]) => {
      const canonicalized = deepCanonicalizeEditorDefaults(nestedValue);
      if (canonicalized !== nestedValue) changed = true;
      return [key, canonicalized] as const;
    });
    return (changed ? Object.fromEntries(nextEntries) : value) as T;
  }

  return value;
}

export async function prepareEditorSystemDefaultTranslations(locale: string) {
  const normalizedLocale = normalizeDomLocale(locale);
  if (normalizedLocale === "zh-CN") return;
  await ensureDomTranslations(SYSTEM_DEFAULT_TEXTS, normalizedLocale);
}

export function localizeSystemDefaultText(value: string, locale: string) {
  const canonical = canonicalizeEditorPageOrPlanName(value);
  return localizeSystemDefaultValue(canonical, locale);
}

export function resolveLocalizedSystemDefaultText(
  value: string | null | undefined,
  fallbackCanonical: string,
  locale: string,
) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized) return localizeSystemDefaultText(normalized, locale);
  return localizeSystemDefaultText(fallbackCanonical, locale);
}

export function localizeEditorBlocksSystemDefaults(blocks: Block[], locale: string) {
  return localizeSystemDefaultValue(blocks, locale) as Block[];
}

export function localizePagePlanConfigSystemDefaults(config: PagePlanConfig, locale: string) {
  return localizeSystemDefaultValue(config, locale) as PagePlanConfig;
}

export function canonicalizeSystemDefaultText(value: string) {
  return deepCanonicalizeEditorDefaults(value);
}

export function canonicalizeEditorBlocksSystemDefaults(blocks: Block[]) {
  return deepCanonicalizeEditorDefaults(blocks) as Block[];
}

export function canonicalizePagePlanConfigSystemDefaults(config: PagePlanConfig) {
  return deepCanonicalizeEditorDefaults(config) as PagePlanConfig;
}
