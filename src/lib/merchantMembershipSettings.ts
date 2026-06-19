export type MerchantMemberSettingsView =
  | "list"
  | "rechargePlans"
  | "redemptionCategories"
  | "redemptionItems"
  | "levels"
  | "pointsRules";

export const MERCHANT_MEMBER_HOLIDAY_OPTIONS = [
  "元旦",
  "春节",
  "元宵节",
  "情人节",
  "妇女节",
  "清明节",
  "复活节",
  "劳动节",
  "儿童节",
  "端午节",
  "母亲节",
  "父亲节",
  "七夕",
  "中元节",
  "中秋节",
  "国庆节",
  "重阳节",
  "腊八节",
  "感恩节",
  "万圣节",
  "黑五",
  "平安夜",
  "圣诞节",
] as const;

export type MerchantMemberHolidayPointRule = {
  id: string;
  date: string;
  name: string;
  multiplier: number;
  enabled: boolean;
  sort: number;
};

export type MerchantMemberRechargePlan = {
  id: string;
  title: string;
  enabled: boolean;
  rechargeAmount: number;
  giftAmount: number;
  giftPoints: number;
  sort: number;
};

export type MerchantMemberRedemptionCategory = {
  id: string;
  name: string;
  iconName: string;
  enabled: boolean;
  sort: number;
};

export type MerchantMemberRedemptionItem = {
  id: string;
  categoryId: string;
  code: string;
  barcode: string;
  name: string;
  imageUrl: string;
  iconName: string;
  description: string;
  enabled: boolean;
  pointsCost: number | null;
  referenceAmount: number | null;
  memberPrice: number | null;
  taxRate: number | null;
  stock: number | null;
  pointProduct: boolean;
  recommended: boolean;
  sort: number;
};

export type MerchantMemberGrowthRules = {
  spendAmountGrowth: number;
  rechargeAmountGrowth: number;
  rechargePointGrowth: number;
  spendPointGrowth: number;
  annualRecalculate: boolean;
};

export type MerchantMemberLevelBenefit = {
  pointDiscount: string;
  oneTimeGiftPoints: number;
  oneTimeGiftItem: string;
  oneTimeGiftProduct: string;
  recurringGiftPoints: number;
  recurringGiftItem: string;
  recurringGiftProduct: string;
  birthdayGiftPoints: number;
  birthdayGiftItem: string;
  birthdayGiftProduct: string;
  servicePriority: boolean;
  inStoreService: boolean;
  dedicatedSupport: boolean;
  nextYearKeepLevel: boolean;
};

export type MerchantMemberLevel = {
  id: string;
  name: string;
  requiredGrowthValue: number;
  benefit: MerchantMemberLevelBenefit;
  enabled: boolean;
  sort: number;
};

export type MerchantMemberPointsRules = {
  paidAmount: number;
  paidPoints: number;
  joinPoints: number;
  checkinPoints: number;
  continuousCheckinPoints: number;
  birthdayPoints: number;
  invitationPoints: number;
  reviewPoints: number;
  holidayRules: MerchantMemberHolidayPointRule[];
  holidayNames: string[];
  holidayMultiplier: number;
  deductionAmountPerPoint: number;
  deductionMinOrderAmount: number;
  deductionMaxAmount: number;
  deductionMaxPercent: number;
  pointsNeverExpire: boolean;
  pointsValidDays: number;
};

export type MerchantReceiptFieldSection = "header" | "meta" | "items" | "summary" | "footer";
export type MerchantReceiptFieldWidth = "full" | "half" | "third";
export type MerchantReceiptCutMode = "partial" | "full";

export type MerchantReceiptContentField = {
  key: string;
  section: MerchantReceiptFieldSection;
  label: string;
  visible: boolean;
  width: MerchantReceiptFieldWidth;
  fontSizePx: number;
  letterSpacingPx: number;
};

type MerchantReceiptLocaleCopy = {
  title: string;
  footer: string;
  fieldLabels: Record<string, string>;
};

export const MERCHANT_RECEIPT_AUTO_LOCALE = "auto";

const ZH_RECEIPT_COPY: MerchantReceiptLocaleCopy = {
  title: "积分兑换小票",
  footer: "谢谢惠顾",
  fieldLabels: {
    merchantName: "商户名称",
    siteId: "站点ID",
    receiptNo: "小票号",
    timestamp: "时间",
    memberName: "会员姓名",
    memberNo: "会员卡号",
    itemName: "项目",
    itemCode: "编号",
    itemCategory: "分类",
    unitPoints: "单价",
    itemQuantity: "数量",
    itemSubtotal: "小计",
    couponLineDiscount: "卡券",
    totalQuantity: "项目数",
    grossPoints: "原始积分",
    couponDiscountTotal: "卡券抵扣",
    totalPoints: "扣减积分",
    beforePointBalance: "结算前积分",
    afterPointBalance: "结算后积分",
    note: "备注",
    footerText: "页脚",
  },
};

const RECEIPT_LOCALE_COPY: Record<string, MerchantReceiptLocaleCopy> = {
  zh: ZH_RECEIPT_COPY,
  en: {
    title: "Points redemption receipt",
    footer: "Thank you",
    fieldLabels: {
      merchantName: "Merchant",
      siteId: "Site ID",
      receiptNo: "Receipt No.",
      timestamp: "Time",
      memberName: "Member",
      memberNo: "Member No.",
      itemName: "Item",
      itemCode: "Code",
      itemCategory: "Category",
      unitPoints: "Unit",
      itemQuantity: "Qty",
      itemSubtotal: "Subtotal",
      couponLineDiscount: "Coupon",
      totalQuantity: "Items",
      grossPoints: "Original points",
      couponDiscountTotal: "Coupon discount",
      totalPoints: "Redeemed points",
      beforePointBalance: "Before balance",
      afterPointBalance: "After balance",
      note: "Note",
      footerText: "Footer",
    },
  },
  es: {
    title: "Recibo de canje de puntos",
    footer: "Gracias por su visita",
    fieldLabels: {
      merchantName: "Comercio",
      siteId: "ID del sitio",
      receiptNo: "Recibo",
      timestamp: "Hora",
      memberName: "Socio",
      memberNo: "No. de socio",
      itemName: "Articulo",
      itemCode: "Codigo",
      itemCategory: "Categoria",
      unitPoints: "Unidad",
      itemQuantity: "Cant.",
      itemSubtotal: "Subtotal",
      couponLineDiscount: "Cupon",
      totalQuantity: "Articulos",
      grossPoints: "Puntos originales",
      couponDiscountTotal: "Descuento cupon",
      totalPoints: "Puntos canjeados",
      beforePointBalance: "Puntos antes",
      afterPointBalance: "Puntos despues",
      note: "Nota",
      footerText: "Pie",
    },
  },
  fr: {
    title: "Recu d'echange de points",
    footer: "Merci de votre visite",
    fieldLabels: {
      merchantName: "Commerce",
      siteId: "ID du site",
      receiptNo: "Recu",
      timestamp: "Heure",
      memberName: "Membre",
      memberNo: "No. membre",
      itemName: "Article",
      itemCode: "Code",
      itemCategory: "Categorie",
      unitPoints: "Unite",
      itemQuantity: "Qte",
      itemSubtotal: "Sous-total",
      couponLineDiscount: "Coupon",
      totalQuantity: "Articles",
      grossPoints: "Points initiaux",
      couponDiscountTotal: "Remise coupon",
      totalPoints: "Points deduits",
      beforePointBalance: "Solde avant",
      afterPointBalance: "Solde apres",
      note: "Note",
      footerText: "Pied",
    },
  },
  de: {
    title: "Bon fur Punkteinlosung",
    footer: "Vielen Dank",
    fieldLabels: {
      merchantName: "Handler",
      siteId: "Standort-ID",
      receiptNo: "Beleg",
      timestamp: "Zeit",
      memberName: "Mitglied",
      memberNo: "Mitglieds-Nr.",
      itemName: "Artikel",
      itemCode: "Code",
      itemCategory: "Kategorie",
      unitPoints: "Einheit",
      itemQuantity: "Menge",
      itemSubtotal: "Zwischensumme",
      couponLineDiscount: "Coupon",
      totalQuantity: "Artikel",
      grossPoints: "Ursprungspunkte",
      couponDiscountTotal: "Couponrabatt",
      totalPoints: "Eingeloste Punkte",
      beforePointBalance: "Punkte vorher",
      afterPointBalance: "Punkte nachher",
      note: "Notiz",
      footerText: "Fusszeile",
    },
  },
  it: {
    title: "Ricevuta riscatto punti",
    footer: "Grazie",
    fieldLabels: {
      merchantName: "Esercente",
      siteId: "ID sito",
      receiptNo: "Ricevuta",
      timestamp: "Ora",
      memberName: "Socio",
      memberNo: "No. socio",
      itemName: "Articolo",
      itemCode: "Codice",
      itemCategory: "Categoria",
      unitPoints: "Unita",
      itemQuantity: "Qta",
      itemSubtotal: "Subtotale",
      couponLineDiscount: "Coupon",
      totalQuantity: "Articoli",
      grossPoints: "Punti originali",
      couponDiscountTotal: "Sconto coupon",
      totalPoints: "Punti riscattati",
      beforePointBalance: "Punti prima",
      afterPointBalance: "Punti dopo",
      note: "Nota",
      footerText: "Pie",
    },
  },
  pt: {
    title: "Recibo de troca de pontos",
    footer: "Obrigado",
    fieldLabels: {
      merchantName: "Comerciante",
      siteId: "ID do site",
      receiptNo: "Recibo",
      timestamp: "Hora",
      memberName: "Membro",
      memberNo: "No. membro",
      itemName: "Item",
      itemCode: "Codigo",
      itemCategory: "Categoria",
      unitPoints: "Unidade",
      itemQuantity: "Qtd",
      itemSubtotal: "Subtotal",
      couponLineDiscount: "Cupao",
      totalQuantity: "Itens",
      grossPoints: "Pontos originais",
      couponDiscountTotal: "Desconto cupao",
      totalPoints: "Pontos trocados",
      beforePointBalance: "Pontos antes",
      afterPointBalance: "Pontos depois",
      note: "Nota",
      footerText: "Rodape",
    },
  },
};

export type MerchantReceiptPrintSettings = {
  enabled: boolean;
  autoPrintRedemptionReceipt: boolean;
  silentPrintEnabled: boolean;
  localPrintBridgeUrl: string;
  localPrinterName: string;
  fallbackToBrowserPrint: boolean;
  cutPaperAfterPrint: boolean;
  cutPaperMode: MerchantReceiptCutMode;
  feedLinesBeforeCut: number;
  receiptLocale: string;
  headerLogoUrl: string;
  headerLogoWidthPercent: number;
  title: string;
  subtitle: string;
  footer: string;
  paperWidthMm: number;
  fontSizePx: number;
  copies: number;
  showMerchantName: boolean;
  showSiteId: boolean;
  showMemberName: boolean;
  showMemberNo: boolean;
  showItemCode: boolean;
  showItemCategory: boolean;
  showUnitPoints: boolean;
  showCouponDiscount: boolean;
  showNote: boolean;
  showTimestamp: boolean;
  receiptFields: MerchantReceiptContentField[];
};

export type MerchantMembershipSettings = {
  siteId: string;
  rechargePlans: MerchantMemberRechargePlan[];
  redemptionCategories: MerchantMemberRedemptionCategory[];
  redemptionItems: MerchantMemberRedemptionItem[];
  redemptionShowStock: boolean;
  printSettings: MerchantReceiptPrintSettings;
  growthRules: MerchantMemberGrowthRules;
  levels: MerchantMemberLevel[];
  pointsRules: MerchantMemberPointsRules;
  updatedAt: string | null;
};

export type MerchantMemberHolidayPreset = {
  date: string;
  name: string;
};

function formatDateYmd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getNthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number) {
  const date = new Date(year, monthIndex, 1);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + offset + (nth - 1) * 7);
  return date;
}

function getChineseMonthDayKey(date: Date) {
  try {
    const parts = new Intl.DateTimeFormat("zh-u-ca-chinese", { month: "long", day: "numeric" }).formatToParts(date);
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    return month && day ? `${month}-${day}` : "";
  } catch {
    return "";
  }
}

function getQingmingDate(year: number) {
  const shortYear = year % 100;
  const day = Math.floor(shortYear * 0.2422 + 4.81) - Math.floor(shortYear / 4);
  return new Date(year, 3, Math.max(4, Math.min(6, day)));
}

function getEasterDate(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function getMerchantMemberHolidayNamesForDate(date: Date) {
  if (!Number.isFinite(date.getTime())) return [];
  const year = date.getFullYear();
  const monthDay = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const holidays: string[] = [];
  const fixedHolidayMap: Record<string, string[]> = {
    "01-01": ["元旦"],
    "02-14": ["情人节"],
    "03-08": ["妇女节"],
    "05-01": ["劳动节"],
    "06-01": ["儿童节"],
    "10-01": ["国庆节"],
    "10-31": ["万圣节"],
    "12-24": ["平安夜"],
    "12-25": ["圣诞节"],
  };
  fixedHolidayMap[monthDay]?.forEach((name) => holidays.push(name));
  if (formatDateYmd(getQingmingDate(year)) === formatDateYmd(date)) holidays.push("清明节");
  if (formatDateYmd(getNthWeekdayOfMonth(year, 4, 0, 2)) === formatDateYmd(date)) holidays.push("母亲节");
  if (formatDateYmd(getNthWeekdayOfMonth(year, 5, 0, 3)) === formatDateYmd(date)) holidays.push("父亲节");
  const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4);
  if (formatDateYmd(thanksgiving) === formatDateYmd(date)) holidays.push("感恩节");
  const blackFriday = new Date(thanksgiving);
  blackFriday.setDate(thanksgiving.getDate() + 1);
  if (formatDateYmd(blackFriday) === formatDateYmd(date)) holidays.push("黑五");
  const easter = getEasterDate(year);
  if (formatDateYmd(easter) === formatDateYmd(date)) holidays.push("复活节");

  const lunarHolidayMap: Record<string, string> = {
    "正月-1": "春节",
    "正月-15": "元宵节",
    "五月-5": "端午节",
    "七月-7": "七夕",
    "七月-15": "中元节",
    "八月-15": "中秋节",
    "九月-9": "重阳节",
    "腊月-8": "腊八节",
  };
  const lunarHoliday = lunarHolidayMap[getChineseMonthDayKey(date)];
  if (lunarHoliday) holidays.push(lunarHoliday);
  return Array.from(new Set(holidays));
}

export function buildMerchantMemberHolidayPresets(year = new Date().getFullYear()): MerchantMemberHolidayPreset[] {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const presets: MerchantMemberHolidayPreset[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    getMerchantMemberHolidayNamesForDate(cursor).forEach((name) => {
      presets.push({ date: formatDateYmd(cursor), name });
    });
  }
  return presets.sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name));
}

export function calculateMerchantMemberPointDeduction(input: {
  orderAmount: number;
  pointBalance: number;
  requestedPoints: number;
  settings: MerchantMembershipSettings;
}) {
  const orderAmount = normalizeMoney(input.orderAmount);
  const pointBalance = normalizeInteger(input.pointBalance);
  const requestedPoints = normalizeInteger(input.requestedPoints);
  const rules = input.settings.pointsRules;
  const amountPerPoint = normalizeMoney(rules.deductionAmountPerPoint);
  if (orderAmount <= 0 || pointBalance <= 0 || requestedPoints <= 0 || amountPerPoint <= 0) {
    return { points: 0, amount: 0, maxPoints: 0, maxAmount: 0 };
  }
  if (rules.deductionMinOrderAmount > 0 && orderAmount < rules.deductionMinOrderAmount) {
    return { points: 0, amount: 0, maxPoints: 0, maxAmount: 0 };
  }
  const percentLimitAmount =
    rules.deductionMaxPercent > 0 ? Number(((orderAmount * rules.deductionMaxPercent) / 100).toFixed(2)) : orderAmount;
  const amountLimit = Math.min(
    orderAmount,
    percentLimitAmount,
    rules.deductionMaxAmount > 0 ? rules.deductionMaxAmount : orderAmount,
  );
  const maxPointsByAmount = Math.floor(amountLimit / amountPerPoint);
  const maxPoints = Math.max(0, Math.min(pointBalance, maxPointsByAmount));
  const points = Math.min(requestedPoints, maxPoints);
  return {
    points,
    amount: Number((points * amountPerPoint).toFixed(2)),
    maxPoints,
    maxAmount: Number((maxPoints * amountPerPoint).toFixed(2)),
  };
}

export function parseMerchantMemberPointDiscountRate(value: unknown) {
  const text = trimText(value, 32).replace(/\s+/g, "");
  if (!text) return 1;
  const numericMatch = text.match(/\d+(?:\.\d+)?/);
  if (!numericMatch) return 1;
  const numberValue = Number.parseFloat(numericMatch[0]);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 1;
  if (text.includes("折")) return Math.min(1, Math.max(0.01, numberValue / 10));
  if (text.includes("%") || text.includes("％")) return Math.min(1, Math.max(0.01, numberValue / 100));
  if (numberValue <= 1) return Math.min(1, Math.max(0.01, numberValue));
  if (numberValue <= 10) return Math.min(1, Math.max(0.01, numberValue / 10));
  if (numberValue <= 100) return Math.min(1, Math.max(0.01, numberValue / 100));
  return 1;
}

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeMoney(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Number(numberValue.toFixed(2)));
}

function normalizeInteger(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.round(numberValue));
}

function normalizeIntegerRange(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function normalizeNumberRange(value: unknown, min: number, max: number, fallback: number, precision = 1) {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numberValue)) return fallback;
  const clamped = Math.min(max, Math.max(min, numberValue));
  return Number(clamped.toFixed(precision));
}

function normalizeOptionalMoney(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  return normalizeMoney(value);
}

function normalizeOptionalInteger(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  return normalizeInteger(value);
}

function normalizeSort(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.round(numberValue);
}

function normalizeStringList(value: unknown, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => trimText(item, maxLength))
        .filter(Boolean),
    ),
  );
}

function normalizeId(value: unknown, prefix: string, index: number) {
  return trimText(value, 120) || `${prefix}-${Date.now().toString(36)}-${index}`;
}

function normalizeReceiptLocaleLanguage(locale: string | null | undefined) {
  const normalized = trimText(locale, 40).toLowerCase();
  if (!normalized || normalized === MERCHANT_RECEIPT_AUTO_LOCALE) return "zh";
  const language = normalized.split("-")[0] || "";
  return Object.prototype.hasOwnProperty.call(RECEIPT_LOCALE_COPY, language) ? language : "en";
}

export function getMerchantReceiptLocaleCopy(locale: string | null | undefined) {
  return RECEIPT_LOCALE_COPY[normalizeReceiptLocaleLanguage(locale)] ?? ZH_RECEIPT_COPY;
}

function getMerchantReceiptFieldLabel(locale: string | null | undefined, key: string) {
  const copy = getMerchantReceiptLocaleCopy(locale);
  return copy.fieldLabels[key] ?? ZH_RECEIPT_COPY.fieldLabels[key] ?? key;
}

export function createDefaultMerchantReceiptFields(
  legacy?: Partial<MerchantReceiptPrintSettings>,
  locale?: string | null,
): MerchantReceiptContentField[] {
  const defaultFontSizePx = normalizeIntegerRange(legacy?.fontSizePx, 8, 28, 12);
  return ([
    {
      key: "merchantName",
      section: "header",
      label: getMerchantReceiptFieldLabel(locale, "merchantName"),
      visible: legacy?.showMerchantName ?? true,
      width: "full",
    },
    {
      key: "siteId",
      section: "header",
      label: getMerchantReceiptFieldLabel(locale, "siteId"),
      visible: legacy?.showSiteId ?? false,
      width: "full",
    },
    { key: "receiptNo", section: "meta", label: getMerchantReceiptFieldLabel(locale, "receiptNo"), visible: true, width: "full" },
    {
      key: "timestamp",
      section: "meta",
      label: getMerchantReceiptFieldLabel(locale, "timestamp"),
      visible: legacy?.showTimestamp ?? true,
      width: "full",
    },
    {
      key: "memberName",
      section: "meta",
      label: getMerchantReceiptFieldLabel(locale, "memberName"),
      visible: legacy?.showMemberName ?? true,
      width: "half",
    },
    {
      key: "memberNo",
      section: "meta",
      label: getMerchantReceiptFieldLabel(locale, "memberNo"),
      visible: legacy?.showMemberNo ?? true,
      width: "half",
    },
    { key: "itemName", section: "items", label: getMerchantReceiptFieldLabel(locale, "itemName"), visible: true, width: "full" },
    {
      key: "itemCode",
      section: "items",
      label: getMerchantReceiptFieldLabel(locale, "itemCode"),
      visible: legacy?.showItemCode ?? true,
      width: "third",
    },
    {
      key: "itemCategory",
      section: "items",
      label: getMerchantReceiptFieldLabel(locale, "itemCategory"),
      visible: legacy?.showItemCategory ?? false,
      width: "third",
    },
    {
      key: "unitPoints",
      section: "items",
      label: getMerchantReceiptFieldLabel(locale, "unitPoints"),
      visible: legacy?.showUnitPoints ?? true,
      width: "third",
    },
    { key: "itemQuantity", section: "items", label: getMerchantReceiptFieldLabel(locale, "itemQuantity"), visible: true, width: "third" },
    { key: "itemSubtotal", section: "items", label: getMerchantReceiptFieldLabel(locale, "itemSubtotal"), visible: true, width: "third" },
    {
      key: "couponLineDiscount",
      section: "items",
      label: getMerchantReceiptFieldLabel(locale, "couponLineDiscount"),
      visible: legacy?.showCouponDiscount ?? true,
      width: "third",
    },
    { key: "totalQuantity", section: "summary", label: getMerchantReceiptFieldLabel(locale, "totalQuantity"), visible: true, width: "full" },
    { key: "grossPoints", section: "summary", label: getMerchantReceiptFieldLabel(locale, "grossPoints"), visible: true, width: "full" },
    {
      key: "couponDiscountTotal",
      section: "summary",
      label: getMerchantReceiptFieldLabel(locale, "couponDiscountTotal"),
      visible: legacy?.showCouponDiscount ?? true,
      width: "full",
    },
    { key: "totalPoints", section: "summary", label: getMerchantReceiptFieldLabel(locale, "totalPoints"), visible: true, width: "full" },
    {
      key: "beforePointBalance",
      section: "summary",
      label: getMerchantReceiptFieldLabel(locale, "beforePointBalance"),
      visible: true,
      width: "full",
    },
    {
      key: "afterPointBalance",
      section: "summary",
      label: getMerchantReceiptFieldLabel(locale, "afterPointBalance"),
      visible: true,
      width: "full",
    },
    { key: "note", section: "footer", label: getMerchantReceiptFieldLabel(locale, "note"), visible: legacy?.showNote ?? true, width: "full" },
    { key: "footerText", section: "footer", label: getMerchantReceiptFieldLabel(locale, "footerText"), visible: true, width: "full" },
  ] satisfies Array<Omit<MerchantReceiptContentField, "fontSizePx" | "letterSpacingPx">>).map((field) => ({
    ...field,
    fontSizePx: defaultFontSizePx,
    letterSpacingPx: 0,
  }));
}

export function applyMerchantReceiptLocaleDefaults<T extends Partial<MerchantReceiptPrintSettings>>(
  settings: T,
  locale: string | null | undefined,
): T & Pick<MerchantReceiptPrintSettings, "receiptLocale" | "title" | "footer" | "receiptFields"> {
  const effectiveLocale = trimText(locale, 40) || MERCHANT_RECEIPT_AUTO_LOCALE;
  const copy = getMerchantReceiptLocaleCopy(effectiveLocale);
  const defaults = createDefaultMerchantReceiptFields(settings, effectiveLocale);
  const defaultsByKey = new Map(defaults.map((field) => [field.key, field]));
  const sourceFields = Array.isArray(settings.receiptFields) ? settings.receiptFields : defaults;
  return {
    ...settings,
    receiptLocale: effectiveLocale,
    title: copy.title,
    footer: copy.footer,
    receiptFields: sourceFields.map((field) => {
      const defaultField = defaultsByKey.get(field.key);
      return defaultField ? { ...field, label: defaultField.label } : field;
    }),
  };
}

export function createEmptyMerchantMembershipSettings(siteId: string): MerchantMembershipSettings {
  return {
    siteId: trimText(siteId, 64),
    rechargePlans: [],
    redemptionCategories: [],
    redemptionItems: [],
    redemptionShowStock: true,
    printSettings: {
      enabled: true,
      autoPrintRedemptionReceipt: true,
      silentPrintEnabled: false,
      localPrintBridgeUrl: "http://127.0.0.1:17658",
      localPrinterName: "",
      fallbackToBrowserPrint: true,
      cutPaperAfterPrint: false,
      cutPaperMode: "partial",
      feedLinesBeforeCut: 4,
      receiptLocale: MERCHANT_RECEIPT_AUTO_LOCALE,
      headerLogoUrl: "",
      headerLogoWidthPercent: 42,
      title: "积分兑换小票",
      subtitle: "",
      footer: "谢谢惠顾",
      paperWidthMm: 58,
      fontSizePx: 12,
      copies: 1,
      showMerchantName: true,
      showSiteId: false,
      showMemberName: true,
      showMemberNo: true,
      showItemCode: true,
      showItemCategory: false,
      showUnitPoints: true,
      showCouponDiscount: true,
      showNote: true,
      showTimestamp: true,
      receiptFields: createDefaultMerchantReceiptFields(),
    },
    growthRules: {
      spendAmountGrowth: 0,
      rechargeAmountGrowth: 0,
      rechargePointGrowth: 0,
      spendPointGrowth: 0,
      annualRecalculate: false,
    },
    levels: [],
    pointsRules: {
      paidAmount: 1,
      paidPoints: 0,
      joinPoints: 0,
      checkinPoints: 0,
      continuousCheckinPoints: 0,
      birthdayPoints: 0,
      invitationPoints: 0,
      reviewPoints: 0,
      holidayRules: [],
      holidayNames: [],
      holidayMultiplier: 1,
      deductionAmountPerPoint: 0,
      deductionMinOrderAmount: 0,
      deductionMaxAmount: 0,
      deductionMaxPercent: 0,
      pointsNeverExpire: true,
      pointsValidDays: 0,
    },
    updatedAt: null,
  };
}

function normalizeRechargePlans(value: unknown): MerchantMemberRechargePlan[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = readRecord(item);
      if (!record) return null;
      const rechargeAmount = normalizeMoney(record.rechargeAmount ?? record.amount);
      const giftAmount = normalizeMoney(record.giftAmount);
      const giftPoints = normalizeInteger(record.giftPoints);
      const title =
        trimText(record.title, 120) ||
        (rechargeAmount > 0 ? `充 ${rechargeAmount.toFixed(2)}` : `充值方案 ${index + 1}`);
      return {
        id: normalizeId(record.id, "recharge", index),
        title,
        enabled: normalizeBoolean(record.enabled, true),
        rechargeAmount,
        giftAmount,
        giftPoints,
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberRechargePlan => Boolean(item))
    .sort((left, right) => left.sort - right.sort);
}

function normalizeRedemptionCategories(value: unknown): MerchantMemberRedemptionCategory[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = readRecord(item);
      if (!record) return null;
      return {
        id: normalizeId(record.id, "category", index),
        name: trimText(record.name ?? record.title, 120) || `分类 ${index + 1}`,
        iconName: trimText(record.iconName ?? record.icon ?? record.categoryIcon ?? record.category_icon ?? record.icon_name, 80),
        enabled: normalizeBoolean(record.enabled, true),
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberRedemptionCategory => Boolean(item))
    .sort((left, right) => left.sort - right.sort);
}

function normalizeRedemptionItems(value: unknown): MerchantMemberRedemptionItem[] {
  if (!Array.isArray(value)) return [];
  const items: MerchantMemberRedemptionItem[] = [];
  value.forEach((item, index) => {
    const record = readRecord(item);
    if (!record) return;
    items.push({
      id: normalizeId(record.id, "item", index),
      categoryId: trimText(record.categoryId, 120),
      code: trimText(record.code, 120),
      barcode: trimText(record.barcode ?? record.barCode ?? record.goodsBarcode, 120),
      imageUrl: trimText(record.imageUrl ?? record.image ?? record.goodsImage, 1000),
      iconName: trimText(record.iconName ?? record.icon ?? record.goodsIcon, 80),
      name: trimText(record.name ?? record.title, 160) || `兑换项目 ${index + 1}`,
      description: trimText(record.description, 500),
      enabled: normalizeBoolean(record.enabled, true),
      pointsCost: normalizeOptionalInteger(record.pointsCost ?? record.points),
      referenceAmount: normalizeOptionalMoney(record.referenceAmount ?? record.price),
      memberPrice: normalizeOptionalMoney(record.memberPrice ?? record.vipPrice ?? record.uprice),
      taxRate: normalizeOptionalMoney(record.taxRate ?? record.tax),
      stock: normalizeOptionalInteger(record.stock),
      pointProduct: normalizeBoolean(record.pointProduct ?? record.isPointProduct, true),
      recommended: normalizeBoolean(record.recommended ?? record.isRecommended ?? record.recommend),
      sort: normalizeSort(record.sort, index),
    });
  });
  return items.sort((left, right) => left.sort - right.sort);
}

function normalizeLevelBenefit(value: unknown): MerchantMemberLevelBenefit {
  const record = readRecord(value) ?? {};
  const legacyOneTimeGift = trimText(record.oneTimeGift, 500);
  const legacyRecurringGift = trimText(record.recurringGift, 500);
  const legacyBirthdayGift = trimText(record.birthdayGift, 500);
  return {
    pointDiscount: trimText(record.pointDiscount, 120),
    oneTimeGiftPoints: normalizeInteger(record.oneTimeGiftPoints),
    oneTimeGiftItem: trimText(record.oneTimeGiftItem, 500) || legacyOneTimeGift,
    oneTimeGiftProduct: trimText(record.oneTimeGiftProduct, 500),
    recurringGiftPoints: normalizeInteger(record.recurringGiftPoints),
    recurringGiftItem: trimText(record.recurringGiftItem, 500) || legacyRecurringGift,
    recurringGiftProduct: trimText(record.recurringGiftProduct, 500),
    birthdayGiftPoints: normalizeInteger(record.birthdayGiftPoints),
    birthdayGiftItem: trimText(record.birthdayGiftItem, 500) || legacyBirthdayGift,
    birthdayGiftProduct: trimText(record.birthdayGiftProduct, 500),
    servicePriority: normalizeBoolean(record.servicePriority),
    inStoreService: normalizeBoolean(record.inStoreService),
    dedicatedSupport: normalizeBoolean(record.dedicatedSupport),
    nextYearKeepLevel: normalizeBoolean(record.nextYearKeepLevel),
  };
}

function normalizeLevels(value: unknown): MerchantMemberLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = readRecord(item);
      if (!record) return null;
      return {
        id: normalizeId(record.id, "level", index),
        name: trimText(record.name, 120),
        requiredGrowthValue: normalizeInteger(record.requiredGrowthValue),
        benefit: normalizeLevelBenefit(record.benefit),
        enabled: normalizeBoolean(record.enabled, true),
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberLevel => Boolean(item))
    .sort((left, right) => left.requiredGrowthValue - right.requiredGrowthValue || left.sort - right.sort);
}

function normalizeGrowthRules(value: unknown): MerchantMemberGrowthRules {
  const record = readRecord(value) ?? {};
  return {
    spendAmountGrowth: normalizeMoney(record.spendAmountGrowth),
    rechargeAmountGrowth: normalizeMoney(record.rechargeAmountGrowth),
    rechargePointGrowth: normalizeMoney(record.rechargePointGrowth),
    spendPointGrowth: normalizeMoney(record.spendPointGrowth),
    annualRecalculate: normalizeBoolean(record.annualRecalculate),
  };
}

function normalizeDateText(value: unknown) {
  const raw = trimText(value, 32);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(`${raw}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  const [year, month, day] = match.slice(1);
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day)
  ) {
    return "";
  }
  return raw;
}

function normalizeHolidayRules(value: unknown, fallbackMultiplier = 1): MerchantMemberHolidayPointRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item, index) => {
      const record = readRecord(item);
      if (!record) return null;
      const date = normalizeDateText(record.date);
      const name = trimText(record.name ?? record.title, 120);
      if (!date || !name) return null;
      const key = `${date}:${name.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: normalizeId(record.id, "holiday", index),
        date,
        name,
        multiplier: normalizeMoney(record.multiplier ?? record.holidayMultiplier ?? record.pointsMultiplier, fallbackMultiplier),
        enabled: normalizeBoolean(record.enabled, true),
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberHolidayPointRule => Boolean(item))
    .sort((left, right) => left.date.localeCompare(right.date) || left.sort - right.sort);
}

function normalizePointsRules(value: unknown): MerchantMemberPointsRules {
  const record = readRecord(value) ?? {};
  const pointsValidDays = normalizeInteger(record.pointsValidDays);
  const pointsNeverExpire = normalizeBoolean(record.pointsNeverExpire, pointsValidDays <= 0);
  const holidayMultiplier = normalizeMoney(record.holidayMultiplier, 1);
  return {
    paidAmount: normalizeMoney(record.paidAmount, 1),
    paidPoints: normalizeInteger(record.paidPoints),
    joinPoints: normalizeInteger(record.joinPoints),
    checkinPoints: normalizeInteger(record.checkinPoints),
    continuousCheckinPoints: normalizeInteger(record.continuousCheckinPoints),
    birthdayPoints: normalizeInteger(record.birthdayPoints),
    invitationPoints: normalizeInteger(record.invitationPoints),
    reviewPoints: normalizeInteger(record.reviewPoints),
    holidayRules: normalizeHolidayRules(record.holidayRules, holidayMultiplier),
    holidayNames: normalizeStringList(record.holidayNames),
    holidayMultiplier,
    deductionAmountPerPoint: normalizeMoney(record.deductionAmountPerPoint),
    deductionMinOrderAmount: normalizeMoney(record.deductionMinOrderAmount),
    deductionMaxAmount: normalizeMoney(record.deductionMaxAmount),
    deductionMaxPercent: Math.min(100, normalizeMoney(record.deductionMaxPercent)),
    pointsNeverExpire,
    pointsValidDays: pointsNeverExpire ? 0 : pointsValidDays,
  };
}

function normalizeReceiptFieldWidth(value: unknown, fallback: MerchantReceiptFieldWidth): MerchantReceiptFieldWidth {
  const width = trimText(value, 20);
  return width === "full" || width === "half" || width === "third" ? width : fallback;
}

function normalizeReceiptFieldLabel(value: unknown, fallback: string) {
  return value === null || value === undefined ? fallback : trimText(value, 80);
}

function normalizeReceiptContentFields(value: unknown, legacy: Partial<MerchantReceiptPrintSettings>) {
  const defaults = createDefaultMerchantReceiptFields(legacy, legacy.receiptLocale);
  if (!Array.isArray(value)) return defaults;
  const defaultsByKey = new Map(defaults.map((field) => [field.key, field]));
  const seen = new Set<string>();
  const normalized: MerchantReceiptContentField[] = [];
  value.forEach((item) => {
    const record = readRecord(item);
    if (!record) return;
    const key = trimText(record.key, 80);
    const fallback = defaultsByKey.get(key);
    if (!fallback || seen.has(key)) return;
    seen.add(key);
    normalized.push({
      key,
      section: fallback.section,
      label: normalizeReceiptFieldLabel(record.label ?? record.name, fallback.label),
      visible: normalizeBoolean(record.visible ?? record.status, fallback.visible),
      width: normalizeReceiptFieldWidth(record.width, fallback.width),
      fontSizePx: normalizeIntegerRange(record.fontSizePx ?? record.fontSize, 8, 28, fallback.fontSizePx),
      letterSpacingPx: normalizeNumberRange(
        record.letterSpacingPx ?? record.letterSpacing,
        0,
        8,
        fallback.letterSpacingPx,
      ),
    });
  });
  defaults.forEach((field) => {
    if (!seen.has(field.key)) normalized.push(field);
  });
  return normalized;
}

function normalizeReceiptPrintSettings(value: unknown): MerchantReceiptPrintSettings {
  const fallback = createEmptyMerchantMembershipSettings("").printSettings;
  const record = readRecord(value) ?? {};
  const normalized = {
    enabled: normalizeBoolean(record.enabled ?? record.receiptEnabled, fallback.enabled),
    autoPrintRedemptionReceipt: normalizeBoolean(
      record.autoPrintRedemptionReceipt ?? record.redemptionAutoPrint ?? record.autoPrintCheckout,
      fallback.autoPrintRedemptionReceipt,
    ),
    silentPrintEnabled: normalizeBoolean(
      record.silentPrintEnabled ?? record.localPrintBridgeEnabled ?? record.directPrintEnabled,
      fallback.silentPrintEnabled,
    ),
    localPrintBridgeUrl:
      trimText(record.localPrintBridgeUrl ?? record.printBridgeUrl, 240) || fallback.localPrintBridgeUrl,
    localPrinterName: trimText(record.localPrinterName ?? record.printerName, 160),
    fallbackToBrowserPrint: normalizeBoolean(
      record.fallbackToBrowserPrint ?? record.browserPrintFallback,
      fallback.fallbackToBrowserPrint,
    ),
    cutPaperAfterPrint: normalizeBoolean(
      record.cutPaperAfterPrint ?? record.autoCutAfterPrint ?? record.cutPaperEnabled,
      fallback.cutPaperAfterPrint,
    ),
    cutPaperMode: record.cutPaperMode === "full" ? "full" : fallback.cutPaperMode,
    feedLinesBeforeCut: normalizeIntegerRange(
      record.feedLinesBeforeCut ?? record.cutFeedLines ?? record.feedBeforeCut,
      0,
      10,
      fallback.feedLinesBeforeCut,
    ),
    receiptLocale: trimText(record.receiptLocale ?? record.receiptLanguage ?? record.locale, 40) || fallback.receiptLocale,
    headerLogoUrl: trimText(record.headerLogoUrl ?? record.receiptLogoUrl ?? record.logoUrl, 1000),
    headerLogoWidthPercent: normalizeIntegerRange(
      record.headerLogoWidthPercent ?? record.receiptLogoWidthPercent ?? record.logoWidthPercent,
      20,
      80,
      fallback.headerLogoWidthPercent,
    ),
    title: trimText(record.title, 120) || fallback.title,
    subtitle: trimText(record.subtitle, 160),
    footer: trimText(record.footer, 240) || fallback.footer,
    paperWidthMm: normalizeIntegerRange(record.paperWidthMm ?? record.paperWidth, 40, 120, fallback.paperWidthMm),
    fontSizePx: normalizeIntegerRange(record.fontSizePx ?? record.fontSize, 9, 18, fallback.fontSizePx),
    copies: normalizeIntegerRange(record.copies, 1, 3, fallback.copies),
    showMerchantName: normalizeBoolean(record.showMerchantName, fallback.showMerchantName),
    showSiteId: normalizeBoolean(record.showSiteId, fallback.showSiteId),
    showMemberName: normalizeBoolean(record.showMemberName, fallback.showMemberName),
    showMemberNo: normalizeBoolean(record.showMemberNo, fallback.showMemberNo),
    showItemCode: normalizeBoolean(record.showItemCode, fallback.showItemCode),
    showItemCategory: normalizeBoolean(record.showItemCategory, fallback.showItemCategory),
    showUnitPoints: normalizeBoolean(record.showUnitPoints, fallback.showUnitPoints),
    showCouponDiscount: normalizeBoolean(record.showCouponDiscount, fallback.showCouponDiscount),
    showNote: normalizeBoolean(record.showNote, fallback.showNote),
    showTimestamp: normalizeBoolean(record.showTimestamp, fallback.showTimestamp),
  };
  return {
    ...normalized,
    receiptFields: normalizeReceiptContentFields(record.receiptFields ?? record.contentFields, normalized),
  };
}

export function normalizeMerchantMembershipSettings(siteId: string, value: unknown): MerchantMembershipSettings {
  const fallback = createEmptyMerchantMembershipSettings(siteId);
  const record = readRecord(value) ?? {};
  const redemptionItemsRecord = Array.isArray(record.redemptionItems) ? record.redemptionItems : [];
  const legacyRedemptionShowStock = redemptionItemsRecord.some((item) => {
    const itemRecord = readRecord(item);
    return itemRecord
      ? normalizeBoolean(itemRecord.showStock ?? itemRecord.stockVisible ?? itemRecord.displayStock, true) === false
      : false;
  })
    ? false
    : true;
  return {
    siteId: trimText(record.siteId, 64) || fallback.siteId,
    rechargePlans: normalizeRechargePlans(record.rechargePlans),
    redemptionCategories: normalizeRedemptionCategories(record.redemptionCategories),
    redemptionItems: normalizeRedemptionItems(record.redemptionItems),
    redemptionShowStock: normalizeBoolean(
      record.redemptionShowStock ?? record.showRedemptionStock ?? record.redemptionStockVisible,
      legacyRedemptionShowStock,
    ),
    printSettings: normalizeReceiptPrintSettings(record.printSettings ?? record.receiptPrintSettings),
    growthRules: normalizeGrowthRules(record.growthRules),
    levels: normalizeLevels(record.levels),
    pointsRules: normalizePointsRules(record.pointsRules),
    updatedAt: trimText(record.updatedAt, 80) || null,
  };
}

export function createMerchantMemberSettingsId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
