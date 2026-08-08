import type { TypographyEditableProps } from "@/data/homeBlocks";

export const MERCHANT_BUSINESS_CARD_RATIO_OPTIONS = [
  { id: "85:54", label: "名片横版", width: 85, height: 54 },
  { id: "16:9", label: "16:9", width: 16, height: 9 },
  { id: "3:2", label: "3:2", width: 3, height: 2 },
  { id: "1:1", label: "1:1", width: 1, height: 1 },
] as const;

export const MERCHANT_BUSINESS_CARD_PHONE_LIMIT = 2;

export type MerchantBusinessCardRatioOptionId =
  | (typeof MERCHANT_BUSINESS_CARD_RATIO_OPTIONS)[number]["id"]
  | "custom";

export type MerchantBusinessCardFieldKey =
  | "merchantName"
  | "title"
  | "website"
  | "contactName"
  | "phone"
  | "email"
  | "address"
  | "wechat"
  | "whatsapp"
  | "twitter"
  | "weibo"
  | "telegram"
  | "linkedin"
  | "discord"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "douyin"
  | "xiaohongshu"
  | "googleReview";

export type MerchantBusinessCardTextLayout = Record<
  MerchantBusinessCardFieldKey,
  { x: number; y: number }
>;

export type MerchantBusinessCardTypographyKey = "name" | "title" | "website" | "info";

export type MerchantBusinessCardTypographyMap = Record<
  MerchantBusinessCardTypographyKey,
  TypographyEditableProps
>;

export type MerchantBusinessCardFieldTypographyMap = Record<
  MerchantBusinessCardFieldKey,
  TypographyEditableProps
>;

export type MerchantBusinessCardCustomText = {
  id: string;
  text: string;
  x: number;
  y: number;
  typography: TypographyEditableProps;
};

export type MerchantBusinessCardContactSectionKey = "image" | "contacts" | "coupons" | "poll";

export type MerchantBusinessCardPollOption = {
  pollId: string;
  blockId: string;
  label: string;
  pageName: string;
};

export type MerchantBusinessCardCustomContactLink = {
  id: string;
  label: string;
  displayText: string;
  url: string;
  iconPreset: string;
  iconUrl: string;
  bgColor: string;
};

export type MerchantBusinessCardContacts = {
  contactName: string;
  phone: string;
  phones: string[];
  email: string;
  address: string;
  wechat: string;
  whatsapp: string;
  twitter: string;
  weibo: string;
  telegram: string;
  linkedin: string;
  discord: string;
  facebook: string;
  instagram: string;
  tiktok: string;
  douyin: string;
  xiaohongshu: string;
  googleReview: string;
};

export type MerchantBusinessCardInvoiceInfo = {
  name: string;
  taxNumber: string;
  address: string;
};

export type MerchantBusinessCardContactDisplayKey = Exclude<keyof MerchantBusinessCardContacts, "phones">;

export const MERCHANT_BUSINESS_CARD_CONTACT_FIELD_KEYS = [
  "contactName",
  "phone",
  "email",
  "address",
  "wechat",
  "whatsapp",
  "twitter",
  "weibo",
  "facebook",
  "instagram",
  "tiktok",
  "xiaohongshu",
  "douyin",
  "telegram",
  "linkedin",
  "discord",
  "googleReview",
] as const satisfies readonly MerchantBusinessCardContactDisplayKey[];

export type MerchantBusinessCardPrimaryContactOnlyKey = "merchantName";
export type MerchantBusinessCardContactOnlyFieldKey =
  | MerchantBusinessCardPrimaryContactOnlyKey
  | MerchantBusinessCardContactDisplayKey;

export const MERCHANT_BUSINESS_CARD_CONTACT_ONLY_FIELD_KEYS = [
  "merchantName",
  ...MERCHANT_BUSINESS_CARD_CONTACT_FIELD_KEYS,
] as const satisfies readonly MerchantBusinessCardContactOnlyFieldKey[];

export type MerchantBusinessCardContactOnlyFields = Record<
  MerchantBusinessCardContactDisplayKey,
  boolean
> &
  Partial<Record<MerchantBusinessCardPrimaryContactOnlyKey, boolean>>;

export type MerchantBusinessCardContactDisplayTarget = {
  businessCard: boolean;
  contactCard: boolean;
};

export type MerchantBusinessCardContactDisplayFields = Record<
  MerchantBusinessCardContactOnlyFieldKey,
  MerchantBusinessCardContactDisplayTarget
>;

export type MerchantBusinessCardMode = "image" | "link";
export type MerchantBusinessCardCornerMode = "rounded" | "square";

export const MERCHANT_BUSINESS_CARD_INTRO_IMAGE_DEFAULT_DURATION_SECONDS = 5;
export const MERCHANT_BUSINESS_CARD_INTRO_IMAGE_MIN_DURATION_SECONDS = 1;
export const MERCHANT_BUSINESS_CARD_INTRO_IMAGE_MAX_DURATION_SECONDS = 15;

export type MerchantBusinessCardDraft = {
  mode: MerchantBusinessCardMode;
  name: string;
  contactIntroVideoUrl: string;
  contactIntroVideoPosterUrl: string;
  contactIntroVideoMuted: boolean;
  contactIntroImageUrl: string;
  contactIntroImageDurationSeconds: number;
  contactIntroMusicUrl: string;
  contactPageImageUrl: string;
  contactPageImageHeight: number;
  contactPageImageLinkUrl: string;
  contactPageImageX: number;
  contactPageImageY: number;
  contactPageImageScale: number;
  contactPageImageOpacity: number;
  contactPageSectionOrder: MerchantBusinessCardContactSectionKey[];
  showContactPoll: boolean;
  contactPagePollId: string;
  contactPagePollBlockId: string;
  showContactSaveButton: boolean;
  showContactWebsiteButton: boolean;
  customContactLinks: MerchantBusinessCardCustomContactLink[];
  backgroundImageUrl: string;
  backgroundImageSnapshotOnly: boolean;
  backgroundImageX: number;
  backgroundImageY: number;
  backgroundImageScale: number;
  backgroundImageOpacity: number;
  backgroundColor: string;
  backgroundColorOpacity: number;
  contactBackgroundMusicUrl: string;
  width: number;
  height: number;
  cornerMode?: MerchantBusinessCardCornerMode;
  ratioMode: MerchantBusinessCardRatioOptionId;
  title: string;
  websiteLabel: string;
  showWebsiteUrl: boolean;
  showQr: boolean;
  contacts: MerchantBusinessCardContacts;
  invoice: MerchantBusinessCardInvoiceInfo;
  contactFieldOrder: MerchantBusinessCardContactDisplayKey[];
  contactOnlyFields: MerchantBusinessCardContactOnlyFields;
  contactDisplayFields: MerchantBusinessCardContactDisplayFields;
  customTexts: MerchantBusinessCardCustomText[];
  textLayout: MerchantBusinessCardTextLayout;
  qr: {
    x: number;
    y: number;
    size: number;
  };
  typography: MerchantBusinessCardTypographyMap;
  fieldTypography: MerchantBusinessCardFieldTypographyMap;
};

export type MerchantBusinessCardAsset = MerchantBusinessCardDraft & {
  id: string;
  createdAt: string;
  imageUrl: string;
  shareImageUrl?: string;
  contactPagePublicImageUrl?: string;
  shareKey?: string;
  targetUrl: string;
  showInChat?: boolean;
  chatDisplayDisabled?: boolean;
};

export function stripMerchantBusinessCardShareMetadata(
  card: MerchantBusinessCardAsset,
): MerchantBusinessCardAsset {
  const cardWithoutShareMetadata = { ...card };
  delete cardWithoutShareMetadata.shareImageUrl;
  delete cardWithoutShareMetadata.contactPagePublicImageUrl;
  delete cardWithoutShareMetadata.shareKey;
  return cardWithoutShareMetadata;
}

export type MerchantBusinessCardProfileInput = {
  merchantName?: string;
  domainPrefix?: string;
  contactAddress?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  industry?: string;
  location?:
    | {
        country?: string;
        province?: string;
        city?: string;
      }
    | null;
};

export const DEFAULT_MERCHANT_BUSINESS_CARD_WEBSITE_LABEL = "扫码进入网站";
export const MERCHANT_BUSINESS_CARD_CONTACT_SECTION_KEYS = ["image", "contacts", "coupons", "poll"] as const;
export const MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS = [
  "link",
  "star",
  "heart",
  "chat",
  "map",
  "gift",
  "google",
  "download",
  "review",
  "favorite",
  "checkin",
] as const;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const next = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, next));
}

function clampOpacity(value: unknown, fallback: number) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, Math.round(next * 100) / 100));
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeMerchantBusinessCardContactSectionOrder(value: unknown): MerchantBusinessCardContactSectionKey[] {
  const seen = new Set<MerchantBusinessCardContactSectionKey>();
  const source = Array.isArray(value) ? value : [];
  const ordered: MerchantBusinessCardContactSectionKey[] = [];
  for (const item of source) {
    if (typeof item !== "string") continue;
    if (!(MERCHANT_BUSINESS_CARD_CONTACT_SECTION_KEYS as readonly string[]).includes(item)) continue;
    const key = item as MerchantBusinessCardContactSectionKey;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  for (const key of MERCHANT_BUSINESS_CARD_CONTACT_SECTION_KEYS) {
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}

function normalizeMerchantBusinessCardCustomContactLinks(value: unknown): MerchantBusinessCardCustomContactLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const source = item as Partial<MerchantBusinessCardCustomContactLink>;
      const iconPreset = normalizeText(source.iconPreset);
      return {
        id: normalizeText(source.id) || `custom-contact-${index + 1}`,
        label: normalizeText(source.label) || `自定义${index + 1}`,
        displayText: normalizeText(source.displayText),
        url: normalizeText(source.url),
        iconPreset: (MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS as readonly string[]).includes(iconPreset)
          ? iconPreset
          : "link",
        iconUrl: normalizeText(source.iconUrl),
        bgColor: normalizeText(source.bgColor) || "#0f172a",
      } satisfies MerchantBusinessCardCustomContactLink;
    })
    .filter((item): item is MerchantBusinessCardCustomContactLink => Boolean(item && (item.url || item.displayText)));
}

function normalizePhoneList(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .slice(0, MERCHANT_BUSINESS_CARD_PHONE_LIMIT)
    : [];
}

export function normalizeMerchantBusinessCardContactFieldOrder(value: unknown): MerchantBusinessCardContactDisplayKey[] {
  const seen = new Set<MerchantBusinessCardContactDisplayKey>();
  const normalized = Array.isArray(value)
    ? value.filter(
        (item): item is MerchantBusinessCardContactDisplayKey =>
          typeof item === "string" &&
          (MERCHANT_BUSINESS_CARD_CONTACT_FIELD_KEYS as readonly string[]).includes(item),
      )
    : [];

  const ordered: MerchantBusinessCardContactDisplayKey[] = [];
  for (const key of normalized) {
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  for (const key of MERCHANT_BUSINESS_CARD_CONTACT_FIELD_KEYS) {
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}

function createDefaultContactOnlyFields(): MerchantBusinessCardContactOnlyFields {
  return {
    merchantName: false,
    contactName: false,
    phone: false,
    email: false,
    address: false,
    wechat: false,
    whatsapp: false,
    twitter: false,
    weibo: false,
    telegram: false,
    linkedin: false,
    discord: false,
    facebook: false,
    instagram: false,
    tiktok: false,
    douyin: false,
    xiaohongshu: false,
    googleReview: false,
  };
}

function createDefaultContactDisplayFields(): MerchantBusinessCardContactDisplayFields {
  return Object.fromEntries(
    MERCHANT_BUSINESS_CARD_CONTACT_ONLY_FIELD_KEYS.map((key) => [
      key,
      { businessCard: true, contactCard: true },
    ]),
  ) as MerchantBusinessCardContactDisplayFields;
}

function normalizeContactDisplayFields(input: {
  value: unknown;
  legacyContactOnlyFields: Partial<MerchantBusinessCardContactOnlyFields>;
  fallback: MerchantBusinessCardContactDisplayFields;
}): MerchantBusinessCardContactDisplayFields {
  const source = input.value && typeof input.value === "object"
    ? (input.value as Partial<Record<MerchantBusinessCardContactOnlyFieldKey, Partial<MerchantBusinessCardContactDisplayTarget>>>)
    : {};

  return Object.fromEntries(
    MERCHANT_BUSINESS_CARD_CONTACT_ONLY_FIELD_KEYS.map((key) => {
      const fallbackTarget = input.fallback[key] ?? { businessCard: true, contactCard: true };
      const sourceTarget = source[key] && typeof source[key] === "object" ? source[key] : null;
      const hasBusinessCard = typeof sourceTarget?.businessCard === "boolean";
      const hasContactCard = typeof sourceTarget?.contactCard === "boolean";
      if (hasBusinessCard || hasContactCard) {
        return [
          key,
          {
            businessCard: hasBusinessCard ? sourceTarget.businessCard === true : fallbackTarget.businessCard,
            contactCard: hasContactCard ? sourceTarget.contactCard === true : fallbackTarget.contactCard,
          },
        ];
      }
      return [
        key,
        input.legacyContactOnlyFields[key] === true
          ? { businessCard: false, contactCard: true }
          : { ...fallbackTarget },
      ];
    }),
  ) as MerchantBusinessCardContactDisplayFields;
}

function buildLegacyContactOnlyFieldsFromDisplayFields(
  contactDisplayFields: MerchantBusinessCardContactDisplayFields,
): MerchantBusinessCardContactOnlyFields {
  return Object.fromEntries(
    MERCHANT_BUSINESS_CARD_CONTACT_ONLY_FIELD_KEYS.map((key) => [
      key,
      contactDisplayFields[key]?.businessCard === false && contactDisplayFields[key]?.contactCard === true,
    ]),
  ) as MerchantBusinessCardContactOnlyFields;
}

function normalizeTypographyStyle(
  value: unknown,
  fallback: TypographyEditableProps,
): TypographyEditableProps {
  const source = value && typeof value === "object" ? (value as Partial<TypographyEditableProps>) : {};
  const normalizedWeight = normalizeText(source.fontWeight);
  const normalizedStyle = normalizeText(source.fontStyle);
  const normalizedDecoration = normalizeText(source.textDecoration);
  return {
    fontFamily: normalizeText(source.fontFamily) || normalizeText(fallback.fontFamily),
    fontSize: clampInt(source.fontSize, fallback.fontSize ?? 16, 10, 80),
    fontColor: normalizeText(source.fontColor) || normalizeText(fallback.fontColor),
    fontWeight:
      normalizedWeight === "bold" || normalizedWeight === "normal"
        ? normalizedWeight
        : fallback.fontWeight,
    fontStyle:
      normalizedStyle === "italic" || normalizedStyle === "normal"
        ? normalizedStyle
        : fallback.fontStyle,
    textDecoration:
      normalizedDecoration === "underline" || normalizedDecoration === "none"
        ? normalizedDecoration
        : fallback.textDecoration,
  };
}

export function buildMerchantBusinessCardAddress(profile: MerchantBusinessCardProfileInput) {
  const segments = [
    normalizeText(profile.contactAddress),
    normalizeText(profile.location?.city),
    normalizeText(profile.location?.province),
    normalizeText(profile.location?.country),
  ].filter(Boolean);
  return segments.join(" / ");
}

function createDefaultMerchantBusinessCardTextLayout(): MerchantBusinessCardTextLayout {
  const contactLayout = buildOrderedMerchantBusinessCardContactTextLayout(MERCHANT_BUSINESS_CARD_CONTACT_FIELD_KEYS);
  return {
    merchantName: { x: 36, y: 34 },
    title: { x: 36, y: 92 },
    website: { x: 36, y: 136 },
    ...contactLayout,
  };
}

const LEGACY_MERCHANT_BUSINESS_CARD_TEXT_LAYOUT: MerchantBusinessCardTextLayout = {
  merchantName: { x: 36, y: 34 },
  title: { x: 36, y: 92 },
  website: { x: 36, y: 136 },
  contactName: { x: 36, y: 190 },
  phone: { x: 36, y: 226 },
  email: { x: 36, y: 262 },
  address: { x: 36, y: 298 },
  wechat: { x: 36, y: 334 },
  whatsapp: { x: 36, y: 370 },
  twitter: { x: 36, y: 406 },
  weibo: { x: 36, y: 442 },
  telegram: { x: 360, y: 334 },
  linkedin: { x: 360, y: 370 },
  discord: { x: 360, y: 406 },
  facebook: { x: 360, y: 190 },
  instagram: { x: 360, y: 226 },
  tiktok: { x: 360, y: 262 },
  douyin: { x: 360, y: 442 },
  xiaohongshu: { x: 360, y: 298 },
  googleReview: { x: 360, y: 430 },
};

const MERCHANT_BUSINESS_CARD_CONTACT_LAYOUT_SLOTS = [
  { x: 36, y: 190 },
  { x: 36, y: 220 },
  { x: 36, y: 250 },
  { x: 36, y: 280 },
  { x: 36, y: 310 },
  { x: 36, y: 340 },
  { x: 36, y: 370 },
  { x: 36, y: 400 },
  { x: 360, y: 190 },
  { x: 360, y: 220 },
  { x: 360, y: 250 },
  { x: 360, y: 280 },
  { x: 360, y: 310 },
  { x: 360, y: 340 },
  { x: 360, y: 370 },
  { x: 360, y: 400 },
  { x: 360, y: 430 },
] as const;

export function buildOrderedMerchantBusinessCardContactTextLayout(
  order: readonly MerchantBusinessCardContactDisplayKey[],
): Record<MerchantBusinessCardContactDisplayKey, { x: number; y: number }> {
  const normalizedOrder = normalizeMerchantBusinessCardContactFieldOrder(order);
  return Object.fromEntries(
    normalizedOrder.map((key, index) => {
      const slot =
        MERCHANT_BUSINESS_CARD_CONTACT_LAYOUT_SLOTS[index] ??
        MERCHANT_BUSINESS_CARD_CONTACT_LAYOUT_SLOTS[MERCHANT_BUSINESS_CARD_CONTACT_LAYOUT_SLOTS.length - 1];
      return [key, { x: slot.x, y: slot.y }];
    }),
  ) as Record<MerchantBusinessCardContactDisplayKey, { x: number; y: number }>;
}

export function applyMerchantBusinessCardContactFieldOrderToTextLayout(
  textLayout: MerchantBusinessCardTextLayout,
  order: readonly MerchantBusinessCardContactDisplayKey[],
): MerchantBusinessCardTextLayout {
  return {
    ...textLayout,
    ...buildOrderedMerchantBusinessCardContactTextLayout(order),
  };
}

function resolveTextLayoutEntry(
  key: MerchantBusinessCardFieldKey,
  source: Partial<MerchantBusinessCardTextLayout>,
  fallback: MerchantBusinessCardTextLayout,
) {
  const rawEntry = source[key];
  const next = {
    x: clampInt(rawEntry?.x, fallback[key].x, 0, 2000),
    y: clampInt(rawEntry?.y, fallback[key].y, 0, 2000),
  };
  const legacy = LEGACY_MERCHANT_BUSINESS_CARD_TEXT_LAYOUT[key];
  return next.x === legacy.x && next.y === legacy.y ? { ...fallback[key] } : next;
}

export function getMerchantBusinessCardRequiredFields(profile: MerchantBusinessCardProfileInput) {
  const missing: string[] = [];
  if (!normalizeText(profile.domainPrefix)) missing.push("域名前缀");
  return missing;
}

export function createDefaultMerchantBusinessCardDraft(
  profile: MerchantBusinessCardProfileInput,
): MerchantBusinessCardDraft {
  const contactFieldOrder = normalizeMerchantBusinessCardContactFieldOrder(MERCHANT_BUSINESS_CARD_CONTACT_FIELD_KEYS);
  const contactDisplayFields = createDefaultContactDisplayFields();
  const textLayout = createDefaultMerchantBusinessCardTextLayout();
  const typography: MerchantBusinessCardTypographyMap = {
    name: {
      fontFamily: "",
      fontSize: 36,
      fontColor: "#0f172a",
      fontWeight: "bold",
      fontStyle: "normal",
      textDecoration: "none",
    },
    title: {
      fontFamily: "",
      fontSize: 18,
      fontColor: "#334155",
      fontWeight: "bold",
      fontStyle: "normal",
      textDecoration: "none",
    },
    website: {
      fontFamily: "",
      fontSize: 14,
      fontColor: "#475569",
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
    },
    info: {
      fontFamily: "",
      fontSize: 14,
      fontColor: "#0f172a",
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
    },
  };

  return {
    mode: "image",
    name: normalizeText(profile.merchantName) || "未命名名片",
    contactIntroVideoUrl: "",
    contactIntroVideoPosterUrl: "",
    contactIntroVideoMuted: true,
    contactIntroImageUrl: "",
    contactIntroImageDurationSeconds: MERCHANT_BUSINESS_CARD_INTRO_IMAGE_DEFAULT_DURATION_SECONDS,
    contactIntroMusicUrl: "",
    contactPageImageUrl: "",
    contactPageImageHeight: 346,
    contactPageImageLinkUrl: "",
    contactPageImageX: 0,
    contactPageImageY: 0,
    contactPageImageScale: 1,
    contactPageImageOpacity: 1,
    contactPageSectionOrder: normalizeMerchantBusinessCardContactSectionOrder(undefined),
    showContactPoll: false,
    contactPagePollId: "",
    contactPagePollBlockId: "",
    showContactSaveButton: true,
    showContactWebsiteButton: true,
    customContactLinks: [],
    backgroundImageUrl: "",
    backgroundImageSnapshotOnly: false,
    backgroundImageX: 0,
    backgroundImageY: 0,
    backgroundImageScale: 1,
    backgroundImageOpacity: 1,
    backgroundColor: "#f8fafc",
    backgroundColorOpacity: 1,
    contactBackgroundMusicUrl: "",
    width: 680,
    height: 432,
    cornerMode: "rounded",
    ratioMode: "85:54",
    title: "",
    websiteLabel: "",
    showWebsiteUrl: true,
    showQr: true,
    contacts: {
      contactName: normalizeText(profile.contactName),
      phone: normalizeText(profile.contactPhone),
      phones: normalizeText(profile.contactPhone) ? [normalizeText(profile.contactPhone)] : [],
      email: normalizeText(profile.contactEmail),
      address: buildMerchantBusinessCardAddress(profile),
      wechat: "",
      whatsapp: "",
      twitter: "",
      weibo: "",
      telegram: "",
      linkedin: "",
      discord: "",
      facebook: "",
      instagram: "",
      tiktok: "",
      douyin: "",
      xiaohongshu: "",
      googleReview: "",
    },
    invoice: {
      name: "",
      taxNumber: "",
      address: "",
    },
    contactFieldOrder,
    contactOnlyFields: createDefaultContactOnlyFields(),
    contactDisplayFields,
    customTexts: [],
    textLayout,
    qr: {
      x: 508,
      y: 126,
      size: 136,
    },
    typography,
    fieldTypography: {
      merchantName: { ...typography.name },
      title: { ...typography.title },
      website: { ...typography.website },
      contactName: { ...typography.info },
      phone: { ...typography.info },
      email: { ...typography.info },
      address: { ...typography.info },
      wechat: { ...typography.info },
      whatsapp: { ...typography.info },
      twitter: { ...typography.info },
      weibo: { ...typography.info },
      telegram: { ...typography.info },
      linkedin: { ...typography.info },
      discord: { ...typography.info },
      facebook: { ...typography.info },
      instagram: { ...typography.info },
      tiktok: { ...typography.info },
      douyin: { ...typography.info },
      xiaohongshu: { ...typography.info },
      googleReview: { ...typography.info },
    },
  };
}

export function createBlankMerchantBusinessCardDraft(): MerchantBusinessCardDraft {
  return {
    ...createDefaultMerchantBusinessCardDraft({}),
    name: "",
    showWebsiteUrl: false,
    showQr: false,
  };
}

export function normalizeMerchantBusinessCardDraft(value: unknown): MerchantBusinessCardDraft {
  const fallback = createDefaultMerchantBusinessCardDraft({});
  const source = value && typeof value === "object" ? (value as Partial<MerchantBusinessCardDraft>) : {};
  const normalizedPhoneList = normalizePhoneList((source.contacts as { phones?: unknown } | undefined)?.phones);
  const contactFieldOrder = normalizeMerchantBusinessCardContactFieldOrder(
    (source as { contactFieldOrder?: unknown }).contactFieldOrder,
  );
  const textLayoutFallback = {
    ...fallback.textLayout,
    ...buildOrderedMerchantBusinessCardContactTextLayout(contactFieldOrder),
  };
  const ratioMode = normalizeText(source.ratioMode) as MerchantBusinessCardRatioOptionId;
  const contactIntroVideoUrl = normalizeText(
    (source as { contactIntroVideoUrl?: unknown }).contactIntroVideoUrl,
  );
  const contactIntroImageUrl = contactIntroVideoUrl
    ? ""
    : normalizeText((source as { contactIntroImageUrl?: unknown }).contactIntroImageUrl);
  const textLayoutSource =
    source.textLayout && typeof source.textLayout === "object"
      ? (source.textLayout as Partial<MerchantBusinessCardTextLayout>)
      : {};
  const typographySource =
    source.typography && typeof source.typography === "object"
      ? (source.typography as Partial<MerchantBusinessCardTypographyMap>)
      : {};
  const fieldTypographySource =
    source.fieldTypography && typeof source.fieldTypography === "object"
      ? (source.fieldTypography as Partial<MerchantBusinessCardFieldTypographyMap>)
      : {};
  const contactOnlyFieldsSource =
    source.contactOnlyFields && typeof source.contactOnlyFields === "object"
      ? (source.contactOnlyFields as Partial<MerchantBusinessCardContactOnlyFields>)
      : {};
  const contactDisplayFields = normalizeContactDisplayFields({
    value: (source as { contactDisplayFields?: unknown }).contactDisplayFields,
    legacyContactOnlyFields: contactOnlyFieldsSource,
    fallback: fallback.contactDisplayFields,
  });
  const customTexts = Array.isArray(source.customTexts)
    ? source.customTexts
        .map((item, index) => {
          if (!item || typeof item !== "object") return null;
          const custom = item as Partial<MerchantBusinessCardCustomText>;
          return {
            id: normalizeText(custom.id) || `custom-text-${index + 1}`,
            text: normalizeText(custom.text),
            x: clampInt(custom.x, 36, 0, 2000),
            y: clampInt(custom.y, 334 + index * 36, 0, 2000),
            typography: normalizeTypographyStyle(custom.typography, fallback.typography.info),
          } satisfies MerchantBusinessCardCustomText;
        })
        .filter((item): item is MerchantBusinessCardCustomText => !!item)
    : fallback.customTexts;

  return {
    mode: normalizeText((source as { mode?: unknown }).mode) === "link" ? "link" : "image",
    name: typeof source.name === "string" ? normalizeText(source.name) : fallback.name,
    contactIntroVideoUrl,
    contactIntroVideoPosterUrl: normalizeText(
      (source as { contactIntroVideoPosterUrl?: unknown }).contactIntroVideoPosterUrl,
    ),
    contactIntroVideoMuted: normalizeBoolean(
      (source as { contactIntroVideoMuted?: unknown }).contactIntroVideoMuted,
      fallback.contactIntroVideoMuted,
    ),
    contactIntroImageUrl,
    contactIntroImageDurationSeconds: clampInt(
      (source as { contactIntroImageDurationSeconds?: unknown }).contactIntroImageDurationSeconds,
      fallback.contactIntroImageDurationSeconds,
      MERCHANT_BUSINESS_CARD_INTRO_IMAGE_MIN_DURATION_SECONDS,
      MERCHANT_BUSINESS_CARD_INTRO_IMAGE_MAX_DURATION_SECONDS,
    ),
    contactIntroMusicUrl:
      contactIntroVideoUrl || contactIntroImageUrl
        ? normalizeText((source as { contactIntroMusicUrl?: unknown }).contactIntroMusicUrl)
        : "",
    contactPageImageUrl: normalizeText((source as { contactPageImageUrl?: unknown }).contactPageImageUrl),
    contactPageImageHeight: clampInt(
      (source as { contactPageImageHeight?: unknown }).contactPageImageHeight,
      fallback.contactPageImageHeight,
      120,
      1200,
    ),
    contactPageImageLinkUrl: normalizeText(
      (source as { contactPageImageLinkUrl?: unknown }).contactPageImageLinkUrl,
    ),
    contactPageImageX: clampInt(
      (source as { contactPageImageX?: unknown }).contactPageImageX,
      fallback.contactPageImageX,
      -5000,
      5000,
    ),
    contactPageImageY: clampInt(
      (source as { contactPageImageY?: unknown }).contactPageImageY,
      fallback.contactPageImageY,
      -5000,
      5000,
    ),
    contactPageImageScale: Math.max(
      0.25,
      Math.min(
        3,
        typeof (source as { contactPageImageScale?: unknown }).contactPageImageScale === "number" &&
          Number.isFinite((source as { contactPageImageScale?: unknown }).contactPageImageScale)
          ? Math.round(Number((source as { contactPageImageScale?: unknown }).contactPageImageScale) * 100) / 100
          : fallback.contactPageImageScale,
      ),
    ),
    contactPageImageOpacity: clampOpacity(
      (source as { contactPageImageOpacity?: unknown }).contactPageImageOpacity,
      fallback.contactPageImageOpacity,
    ),
    contactPageSectionOrder: normalizeMerchantBusinessCardContactSectionOrder(
      (source as { contactPageSectionOrder?: unknown }).contactPageSectionOrder,
    ),
    showContactPoll: normalizeBoolean(
      (source as { showContactPoll?: unknown }).showContactPoll,
      fallback.showContactPoll,
    ),
    contactPagePollId: normalizeText(
      (source as { contactPagePollId?: unknown }).contactPagePollId,
    ).slice(0, 96),
    contactPagePollBlockId: normalizeText(
      (source as { contactPagePollBlockId?: unknown }).contactPagePollBlockId,
    ).slice(0, 160),
    showContactSaveButton: normalizeBoolean(
      (source as { showContactSaveButton?: unknown }).showContactSaveButton,
      fallback.showContactSaveButton,
    ),
    showContactWebsiteButton: normalizeBoolean(
      (source as { showContactWebsiteButton?: unknown }).showContactWebsiteButton,
      fallback.showContactWebsiteButton,
    ),
    customContactLinks: normalizeMerchantBusinessCardCustomContactLinks(
      (source as { customContactLinks?: unknown }).customContactLinks,
    ),
    backgroundImageUrl: normalizeText(source.backgroundImageUrl),
    backgroundImageSnapshotOnly: normalizeBoolean(
      (source as { backgroundImageSnapshotOnly?: unknown }).backgroundImageSnapshotOnly,
      fallback.backgroundImageSnapshotOnly,
    ),
    backgroundImageX: clampInt(source.backgroundImageX, fallback.backgroundImageX, -5000, 5000),
    backgroundImageY: clampInt(source.backgroundImageY, fallback.backgroundImageY, -5000, 5000),
    backgroundImageScale: Math.max(
      0.25,
      Math.min(
        3,
        typeof source.backgroundImageScale === "number" && Number.isFinite(source.backgroundImageScale)
          ? Math.round(source.backgroundImageScale * 100) / 100
          : fallback.backgroundImageScale,
      ),
    ),
    backgroundImageOpacity: clampOpacity(source.backgroundImageOpacity, fallback.backgroundImageOpacity),
    backgroundColor: normalizeText(source.backgroundColor) || fallback.backgroundColor,
    backgroundColorOpacity: clampOpacity(source.backgroundColorOpacity, fallback.backgroundColorOpacity),
    contactBackgroundMusicUrl: normalizeText(
      (source as { contactBackgroundMusicUrl?: unknown }).contactBackgroundMusicUrl,
    ),
    width: clampInt(source.width, fallback.width, 320, 1600),
    height: clampInt(source.height, fallback.height, 180, 1600),
    cornerMode: normalizeText((source as { cornerMode?: unknown }).cornerMode) === "square" ? "square" : fallback.cornerMode,
    ratioMode:
      ratioMode === "custom" || MERCHANT_BUSINESS_CARD_RATIO_OPTIONS.some((item) => item.id === ratioMode)
        ? ratioMode
        : fallback.ratioMode,
    title: normalizeText(source.title),
    websiteLabel:
      typeof source.websiteLabel === "string" &&
      source.websiteLabel.trim() &&
      source.websiteLabel.trim() !== DEFAULT_MERCHANT_BUSINESS_CARD_WEBSITE_LABEL
        ? source.websiteLabel.trim()
        : fallback.websiteLabel,
    showWebsiteUrl: normalizeBoolean(source.showWebsiteUrl, fallback.showWebsiteUrl),
    showQr: normalizeBoolean((source as { showQr?: unknown }).showQr, fallback.showQr),
    contacts: {
      contactName: normalizeText(source.contacts?.contactName),
      phone: normalizedPhoneList[0] || normalizeText(source.contacts?.phone),
      phones: normalizedPhoneList,
      email: normalizeText(source.contacts?.email),
      address: normalizeText(source.contacts?.address),
      wechat: normalizeText(source.contacts?.wechat),
      whatsapp: normalizeText(source.contacts?.whatsapp),
      twitter: normalizeText((source.contacts as { twitter?: unknown } | undefined)?.twitter),
      weibo: normalizeText((source.contacts as { weibo?: unknown } | undefined)?.weibo),
      telegram: normalizeText((source.contacts as { telegram?: unknown } | undefined)?.telegram),
      linkedin: normalizeText((source.contacts as { linkedin?: unknown } | undefined)?.linkedin),
      discord: normalizeText((source.contacts as { discord?: unknown } | undefined)?.discord),
      facebook: normalizeText(source.contacts?.facebook),
      instagram: normalizeText(source.contacts?.instagram),
      tiktok: normalizeText(source.contacts?.tiktok),
      douyin: normalizeText((source.contacts as { douyin?: unknown } | undefined)?.douyin),
      xiaohongshu: normalizeText(source.contacts?.xiaohongshu),
      googleReview: normalizeText((source.contacts as { googleReview?: unknown } | undefined)?.googleReview),
    },
    invoice: {
      name: normalizeText((source.invoice as { name?: unknown } | undefined)?.name),
      taxNumber: normalizeText((source.invoice as { taxNumber?: unknown } | undefined)?.taxNumber),
      address: normalizeText((source.invoice as { address?: unknown } | undefined)?.address),
    },
    contactFieldOrder,
    contactOnlyFields: buildLegacyContactOnlyFieldsFromDisplayFields(contactDisplayFields),
    contactDisplayFields,
    customTexts,
    textLayout: {
      merchantName: resolveTextLayoutEntry("merchantName", textLayoutSource, textLayoutFallback),
      title: resolveTextLayoutEntry("title", textLayoutSource, textLayoutFallback),
      website: resolveTextLayoutEntry("website", textLayoutSource, textLayoutFallback),
      contactName: resolveTextLayoutEntry("contactName", textLayoutSource, textLayoutFallback),
      phone: resolveTextLayoutEntry("phone", textLayoutSource, textLayoutFallback),
      email: resolveTextLayoutEntry("email", textLayoutSource, textLayoutFallback),
      address: resolveTextLayoutEntry("address", textLayoutSource, textLayoutFallback),
      wechat: resolveTextLayoutEntry("wechat", textLayoutSource, textLayoutFallback),
      whatsapp: resolveTextLayoutEntry("whatsapp", textLayoutSource, textLayoutFallback),
      twitter: resolveTextLayoutEntry("twitter", textLayoutSource, textLayoutFallback),
      weibo: resolveTextLayoutEntry("weibo", textLayoutSource, textLayoutFallback),
      telegram: resolveTextLayoutEntry("telegram", textLayoutSource, textLayoutFallback),
      linkedin: resolveTextLayoutEntry("linkedin", textLayoutSource, textLayoutFallback),
      discord: resolveTextLayoutEntry("discord", textLayoutSource, textLayoutFallback),
      facebook: resolveTextLayoutEntry("facebook", textLayoutSource, textLayoutFallback),
      instagram: resolveTextLayoutEntry("instagram", textLayoutSource, textLayoutFallback),
      tiktok: resolveTextLayoutEntry("tiktok", textLayoutSource, textLayoutFallback),
      douyin: resolveTextLayoutEntry("douyin", textLayoutSource, textLayoutFallback),
      xiaohongshu: resolveTextLayoutEntry("xiaohongshu", textLayoutSource, textLayoutFallback),
      googleReview: resolveTextLayoutEntry("googleReview", textLayoutSource, textLayoutFallback),
    },
    qr: {
      x: clampInt(source.qr?.x, fallback.qr.x, 0, 2000),
      y: clampInt(source.qr?.y, fallback.qr.y, 0, 2000),
      size: clampInt(source.qr?.size, fallback.qr.size, 48, 600),
    },
    typography: {
      name: normalizeTypographyStyle(typographySource.name, fallback.typography.name),
      title: normalizeTypographyStyle(typographySource.title, fallback.typography.title),
      website: normalizeTypographyStyle(typographySource.website, fallback.typography.website),
      info: normalizeTypographyStyle(typographySource.info, fallback.typography.info),
    },
    fieldTypography: {
      merchantName: normalizeTypographyStyle(
        fieldTypographySource.merchantName,
        typographySource.name ? normalizeTypographyStyle(typographySource.name, fallback.typography.name) : fallback.fieldTypography.merchantName,
      ),
      title: normalizeTypographyStyle(
        fieldTypographySource.title,
        typographySource.title ? normalizeTypographyStyle(typographySource.title, fallback.typography.title) : fallback.fieldTypography.title,
      ),
      website: normalizeTypographyStyle(
        fieldTypographySource.website,
        typographySource.website ? normalizeTypographyStyle(typographySource.website, fallback.typography.website) : fallback.fieldTypography.website,
      ),
      contactName: normalizeTypographyStyle(
        fieldTypographySource.contactName,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.contactName,
      ),
      phone: normalizeTypographyStyle(
        fieldTypographySource.phone,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.phone,
      ),
      email: normalizeTypographyStyle(
        fieldTypographySource.email,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.email,
      ),
      address: normalizeTypographyStyle(
        fieldTypographySource.address,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.address,
      ),
      wechat: normalizeTypographyStyle(
        fieldTypographySource.wechat,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.wechat,
      ),
      whatsapp: normalizeTypographyStyle(
        fieldTypographySource.whatsapp,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.whatsapp,
      ),
      twitter: normalizeTypographyStyle(
        (fieldTypographySource as Partial<MerchantBusinessCardFieldTypographyMap>).twitter,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.twitter,
      ),
      weibo: normalizeTypographyStyle(
        (fieldTypographySource as Partial<MerchantBusinessCardFieldTypographyMap>).weibo,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.weibo,
      ),
      telegram: normalizeTypographyStyle(
        (fieldTypographySource as Partial<MerchantBusinessCardFieldTypographyMap>).telegram,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.telegram,
      ),
      linkedin: normalizeTypographyStyle(
        (fieldTypographySource as Partial<MerchantBusinessCardFieldTypographyMap>).linkedin,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.linkedin,
      ),
      discord: normalizeTypographyStyle(
        (fieldTypographySource as Partial<MerchantBusinessCardFieldTypographyMap>).discord,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.discord,
      ),
      facebook: normalizeTypographyStyle(
        fieldTypographySource.facebook,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.facebook,
      ),
      instagram: normalizeTypographyStyle(
        fieldTypographySource.instagram,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.instagram,
      ),
      tiktok: normalizeTypographyStyle(
        fieldTypographySource.tiktok,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.tiktok,
      ),
      douyin: normalizeTypographyStyle(
        (fieldTypographySource as Partial<MerchantBusinessCardFieldTypographyMap>).douyin,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.douyin,
      ),
      xiaohongshu: normalizeTypographyStyle(
        fieldTypographySource.xiaohongshu,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.xiaohongshu,
      ),
      googleReview: normalizeTypographyStyle(
        fieldTypographySource.googleReview,
        typographySource.info ? normalizeTypographyStyle(typographySource.info, fallback.typography.info) : fallback.fieldTypography.googleReview,
      ),
    },
  };
}

export function normalizeMerchantBusinessCards(value: unknown): MerchantBusinessCardAsset[] {
  if (!Array.isArray(value)) return [];
  const normalizedCards = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const source = item as Partial<MerchantBusinessCardAsset>;
      const draft = normalizeMerchantBusinessCardDraft(source);
      const imageUrl = normalizeText(source.imageUrl);
      const shareImageUrl = normalizeText(source.shareImageUrl);
      const contactPagePublicImageUrl = normalizeText((source as { contactPagePublicImageUrl?: unknown }).contactPagePublicImageUrl);
      const shareKey = normalizeText(source.shareKey);
      const targetUrl = normalizeText(source.targetUrl);
      const id = normalizeText(source.id) || `business-card-${index + 1}`;
      const createdAt = normalizeText(source.createdAt) || new Date().toISOString();
      if (!imageUrl) return null;
      return {
        ...draft,
        id,
        createdAt,
        imageUrl,
        ...(shareImageUrl ? { shareImageUrl } : {}),
        ...(contactPagePublicImageUrl ? { contactPagePublicImageUrl } : {}),
        ...(shareKey ? { shareKey } : {}),
        targetUrl,
        ...(typeof source.showInChat === "boolean" ? { showInChat: source.showInChat } : {}),
        ...(typeof source.chatDisplayDisabled === "boolean" ? { chatDisplayDisabled: source.chatDisplayDisabled } : {}),
      } satisfies MerchantBusinessCardAsset;
    })
    .filter((item): item is MerchantBusinessCardAsset => !!item);
  return normalizeMerchantBusinessCardChatDisplaySelection(normalizedCards);
}

function countMerchantBusinessCardAssetCompleteness(card: MerchantBusinessCardAsset) {
  const contactValues = card.contacts
    ? [
        card.contacts.contactName,
        card.contacts.phone,
        ...(Array.isArray(card.contacts.phones) ? card.contacts.phones : []),
        card.contacts.email,
        card.contacts.address,
        card.contacts.wechat,
        card.contacts.whatsapp,
        card.contacts.twitter,
        card.contacts.weibo,
        card.contacts.telegram,
        card.contacts.linkedin,
        card.contacts.discord,
        card.contacts.facebook,
        card.contacts.instagram,
        card.contacts.tiktok,
        card.contacts.douyin,
        card.contacts.xiaohongshu,
        card.contacts.googleReview,
      ]
    : [];
  const invoiceValues = card.invoice ? [card.invoice.name, card.invoice.taxNumber, card.invoice.address] : [];
  const customContactValues = Array.isArray(card.customContactLinks)
    ? card.customContactLinks.flatMap((item) => [item.label, item.displayText, item.url, item.iconUrl])
    : [];
  return [
    card.shareKey,
    card.shareImageUrl,
    card.contactPagePublicImageUrl,
    card.contactPageImageUrl,
    card.contactPageImageLinkUrl,
    card.contactIntroVideoUrl,
    card.contactIntroVideoPosterUrl,
    card.contactIntroImageUrl,
    card.contactIntroMusicUrl,
    card.contactPagePollId,
    card.contactPagePollBlockId,
    card.backgroundImageUrl,
    card.contactBackgroundMusicUrl,
    ...contactValues,
    ...invoiceValues,
    ...customContactValues,
  ].filter((value) => normalizeText(value)).length;
}

function mergeMerchantBusinessCardContactValues(
  preferred: MerchantBusinessCardContacts,
  fallback: MerchantBusinessCardContacts,
  fillEmptyFromFallback: boolean,
) {
  const merged: MerchantBusinessCardContacts = {
    ...fallback,
    ...preferred,
    phones: normalizePhoneList(preferred.phones).length
      ? normalizePhoneList(preferred.phones)
      : normalizePhoneList(fallback.phones),
  };
  if (!fillEmptyFromFallback) return merged;
  for (const key of MERCHANT_BUSINESS_CARD_CONTACT_FIELD_KEYS) {
    const preferredValue = normalizeText(preferred[key]);
    const fallbackValue = normalizeText(fallback[key]);
    if (!preferredValue && fallbackValue) {
      merged[key] = fallbackValue;
    }
  }
  return merged;
}

export function mergeMerchantBusinessCardAssets(
  primary: MerchantBusinessCardAsset,
  secondary: MerchantBusinessCardAsset,
  options?: { prefer?: "primary" | "secondary" | "richer" },
) {
  const primaryCard = normalizeMerchantBusinessCards([primary])[0];
  const secondaryCard = normalizeMerchantBusinessCards([secondary])[0];
  if (!primaryCard) return secondaryCard ?? secondary;
  if (!secondaryCard) return primaryCard;

  const primaryScore = countMerchantBusinessCardAssetCompleteness(primaryCard);
  const secondaryScore = countMerchantBusinessCardAssetCompleteness(secondaryCard);
  const preferPrimary =
    options?.prefer === "primary" ||
    (options?.prefer !== "secondary" && (options?.prefer === "richer" || !options?.prefer) && primaryScore >= secondaryScore);
  const preferred = preferPrimary ? primaryCard : secondaryCard;
  const fallback = preferPrimary ? secondaryCard : primaryCard;
  const preferredHasBackground = Boolean(normalizeText(preferred.backgroundImageUrl));
  const preferredHasContactImage = Boolean(normalizeText(preferred.contactPageImageUrl));
  const preferredIntroVideoUrl = normalizeText(preferred.contactIntroVideoUrl);
  const preferredIntroImageUrl = preferredIntroVideoUrl ? "" : normalizeText(preferred.contactIntroImageUrl);
  const preferredHasIntroMedia = Boolean(preferredIntroVideoUrl || preferredIntroImageUrl);
  const fallbackIntroVideoUrl = normalizeText(fallback.contactIntroVideoUrl);
  const fallbackIntroImageUrl = fallbackIntroVideoUrl ? "" : normalizeText(fallback.contactIntroImageUrl);
  const merged = {
    ...fallback,
    ...preferred,
    backgroundImageUrl: normalizeText(preferred.backgroundImageUrl) || normalizeText(fallback.backgroundImageUrl),
    backgroundImageSnapshotOnly: preferred.backgroundImageSnapshotOnly || fallback.backgroundImageSnapshotOnly,
    backgroundImageX: preferredHasBackground ? preferred.backgroundImageX : fallback.backgroundImageX,
    backgroundImageY: preferredHasBackground ? preferred.backgroundImageY : fallback.backgroundImageY,
    backgroundImageScale: preferredHasBackground ? preferred.backgroundImageScale : fallback.backgroundImageScale,
    backgroundImageOpacity: preferredHasBackground ? preferred.backgroundImageOpacity : fallback.backgroundImageOpacity,
    contactPageImageUrl: normalizeText(preferred.contactPageImageUrl) || normalizeText(fallback.contactPageImageUrl),
    contactPageImageHeight: preferredHasContactImage ? preferred.contactPageImageHeight : fallback.contactPageImageHeight,
    contactPageImageLinkUrl:
      normalizeText(preferred.contactPageImageLinkUrl) || normalizeText(fallback.contactPageImageLinkUrl),
    contactPageImageX: preferredHasContactImage ? preferred.contactPageImageX : fallback.contactPageImageX,
    contactPageImageY: preferredHasContactImage ? preferred.contactPageImageY : fallback.contactPageImageY,
    contactPageImageScale: preferredHasContactImage ? preferred.contactPageImageScale : fallback.contactPageImageScale,
    contactPageImageOpacity: preferredHasContactImage
      ? preferred.contactPageImageOpacity
      : fallback.contactPageImageOpacity,
    contactPageSectionOrder: preferred.contactPageSectionOrder,
    showContactPoll: preferred.showContactPoll,
    contactPagePollId: normalizeText(preferred.contactPagePollId) || normalizeText(fallback.contactPagePollId),
    contactPagePollBlockId:
      normalizeText(preferred.contactPagePollBlockId) || normalizeText(fallback.contactPagePollBlockId),
    showContactSaveButton: preferred.showContactSaveButton,
    showContactWebsiteButton: preferred.showContactWebsiteButton,
    customContactLinks: preferred.customContactLinks.length ? preferred.customContactLinks : fallback.customContactLinks,
    contactIntroVideoUrl: preferredHasIntroMedia ? preferredIntroVideoUrl : fallbackIntroVideoUrl,
    contactIntroVideoPosterUrl:
      (preferredHasIntroMedia ? preferredIntroVideoUrl : fallbackIntroVideoUrl)
        ? normalizeText(
            preferredHasIntroMedia ? preferred.contactIntroVideoPosterUrl : fallback.contactIntroVideoPosterUrl,
          )
        : "",
    contactIntroVideoMuted: preferred.contactIntroVideoMuted,
    contactIntroImageUrl: preferredHasIntroMedia ? preferredIntroImageUrl : fallbackIntroImageUrl,
    contactIntroImageDurationSeconds: preferredHasIntroMedia
      ? preferred.contactIntroImageDurationSeconds
      : fallback.contactIntroImageDurationSeconds,
    contactIntroMusicUrl: normalizeText(preferred.contactIntroMusicUrl) || normalizeText(fallback.contactIntroMusicUrl),
    contactBackgroundMusicUrl:
      normalizeText(preferred.contactBackgroundMusicUrl) || normalizeText(fallback.contactBackgroundMusicUrl),
    contacts: mergeMerchantBusinessCardContactValues(
      preferred.contacts,
      fallback.contacts,
      !options?.prefer || options.prefer === "richer",
    ),
    invoice:
      !options?.prefer || options.prefer === "richer"
        ? {
            name: normalizeText(preferred.invoice.name) || normalizeText(fallback.invoice.name),
            taxNumber: normalizeText(preferred.invoice.taxNumber) || normalizeText(fallback.invoice.taxNumber),
            address: normalizeText(preferred.invoice.address) || normalizeText(fallback.invoice.address),
          }
        : preferred.invoice,
  } satisfies MerchantBusinessCardAsset;

  return normalizeMerchantBusinessCards([merged])[0] ?? merged;
}

export function normalizeMerchantBusinessCardChatDisplaySelection(cards: MerchantBusinessCardAsset[]) {
  const normalizedCards = cards.map((card) => ({
    ...card,
    showInChat: card.showInChat === true,
    chatDisplayDisabled: card.chatDisplayDisabled === true,
  }));
  const selectedIndex = normalizedCards.findIndex((card) => card.showInChat === true);
  if (selectedIndex >= 0) {
    return normalizedCards.map((card, index) => ({
      ...card,
      showInChat: index === selectedIndex,
      chatDisplayDisabled: false,
    }));
  }
  const hasManualDisabledState = normalizedCards.some((card) => card.chatDisplayDisabled === true);
  if (hasManualDisabledState) {
    return normalizedCards.map((card) => ({
      ...card,
      showInChat: false,
      chatDisplayDisabled: true,
    }));
  }
  if (normalizedCards.length === 0) return normalizedCards;
  let defaultIndex = 0;
  let defaultTimestamp = Number.POSITIVE_INFINITY;
  normalizedCards.forEach((card, index) => {
    const timestamp = new Date(card.createdAt).getTime();
    const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
    if (normalizedTimestamp < defaultTimestamp) {
      defaultTimestamp = normalizedTimestamp;
      defaultIndex = index;
    }
  });
  return normalizedCards.map((card, index) => ({
    ...card,
    showInChat: index === defaultIndex,
    chatDisplayDisabled: false,
  }));
}

export function selectMerchantBusinessCardForChat(cards: MerchantBusinessCardAsset[], cardId: string) {
  const normalizedCards = normalizeMerchantBusinessCardChatDisplaySelection(cards);
  const normalizedCardId = normalizeText(cardId);
  if (!normalizedCardId) return normalizedCards;
  return normalizedCards.map((card) => ({
    ...card,
    showInChat: card.id === normalizedCardId,
    chatDisplayDisabled: false,
  }));
}

export function disableMerchantBusinessCardChatDisplay(cards: MerchantBusinessCardAsset[]) {
  return normalizeMerchantBusinessCardChatDisplaySelection(cards).map((card) => ({
    ...card,
    showInChat: false,
    chatDisplayDisabled: true,
  }));
}

export function resolveMerchantBusinessCardForChatDisplay(cards: MerchantBusinessCardAsset[]) {
  const normalizedCards = normalizeMerchantBusinessCardChatDisplaySelection(cards);
  return normalizedCards.find((card) => card.showInChat) ?? null;
}
