import type { TypographyEditableProps } from "@/data/homeBlocks";

export const MERCHANT_BUSINESS_CARD_RATIO_OPTIONS = [
  { id: "85:54", label: "名片横版", width: 85, height: 54 },
  { id: "16:9", label: "16:9", width: 16, height: 9 },
  { id: "3:2", label: "3:2", width: 3, height: 2 },
  { id: "1:1", label: "1:1", width: 1, height: 1 },
] as const;

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
  | "xiaohongshu";

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
};

export type MerchantBusinessCardContactDisplayKey = Exclude<keyof MerchantBusinessCardContacts, "phones">;

export type MerchantBusinessCardContactOnlyFields = Record<
  MerchantBusinessCardContactDisplayKey,
  boolean
>;

export type MerchantBusinessCardMode = "image" | "link";

export type MerchantBusinessCardDraft = {
  mode: MerchantBusinessCardMode;
  name: string;
  contactPageImageUrl: string;
  contactPageImageHeight: number;
  backgroundImageUrl: string;
  backgroundImageOpacity: number;
  backgroundColor: string;
  backgroundColorOpacity: number;
  width: number;
  height: number;
  ratioMode: MerchantBusinessCardRatioOptionId;
  title: string;
  websiteLabel: string;
  showWebsiteUrl: boolean;
  showQr: boolean;
  contacts: MerchantBusinessCardContacts;
  contactOnlyFields: MerchantBusinessCardContactOnlyFields;
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
};

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

function createDefaultContactOnlyFields(): MerchantBusinessCardContactOnlyFields {
  return {
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
  };
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

export function getMerchantBusinessCardRequiredFields(profile: MerchantBusinessCardProfileInput) {
  const missing: string[] = [];
  if (!normalizeText(profile.merchantName)) missing.push("商户名称");
  if (!normalizeText(profile.domainPrefix)) missing.push("域名前缀");
  if (!normalizeText(profile.contactAddress)) missing.push("地址");
  if (!normalizeText(profile.contactName)) missing.push("联系人");
  if (!normalizeText(profile.contactPhone)) missing.push("电话");
  if (!normalizeText(profile.contactEmail)) missing.push("邮箱");
  if (!normalizeText(profile.industry)) missing.push("行业");
  if (!normalizeText(profile.location?.country)) missing.push("国家");
  if (!normalizeText(profile.location?.province)) missing.push("省份");
  if (!normalizeText(profile.location?.city)) missing.push("城市");
  return missing;
}

export function createDefaultMerchantBusinessCardDraft(
  profile: MerchantBusinessCardProfileInput,
): MerchantBusinessCardDraft {
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
    contactPageImageUrl: "",
    contactPageImageHeight: 346,
    backgroundImageUrl: "",
    backgroundImageOpacity: 1,
    backgroundColor: "#f8fafc",
    backgroundColorOpacity: 1,
    width: 680,
    height: 432,
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
    },
    contactOnlyFields: createDefaultContactOnlyFields(),
    customTexts: [],
    textLayout: {
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
    },
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
    },
  };
}

export function normalizeMerchantBusinessCardDraft(value: unknown): MerchantBusinessCardDraft {
  const fallback = createDefaultMerchantBusinessCardDraft({});
  const source = value && typeof value === "object" ? (value as Partial<MerchantBusinessCardDraft>) : {};
  const ratioMode = normalizeText(source.ratioMode) as MerchantBusinessCardRatioOptionId;
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
    name: normalizeText(source.name) || fallback.name,
    contactPageImageUrl: normalizeText((source as { contactPageImageUrl?: unknown }).contactPageImageUrl),
    contactPageImageHeight: clampInt(
      (source as { contactPageImageHeight?: unknown }).contactPageImageHeight,
      fallback.contactPageImageHeight,
      120,
      1200,
    ),
    backgroundImageUrl: normalizeText(source.backgroundImageUrl),
    backgroundImageOpacity: clampOpacity(source.backgroundImageOpacity, fallback.backgroundImageOpacity),
    backgroundColor: normalizeText(source.backgroundColor) || fallback.backgroundColor,
    backgroundColorOpacity: clampOpacity(source.backgroundColorOpacity, fallback.backgroundColorOpacity),
    width: clampInt(source.width, fallback.width, 320, 1600),
    height: clampInt(source.height, fallback.height, 180, 1600),
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
      phone:
        (Array.isArray((source.contacts as { phones?: unknown } | undefined)?.phones)
          ? ((source.contacts as { phones?: unknown[] } | undefined)?.phones ?? [])
              .map((item) => normalizeText(item))
              .find(Boolean)
          : "") || normalizeText(source.contacts?.phone),
      phones:
        (Array.isArray((source.contacts as { phones?: unknown } | undefined)?.phones)
          ? ((source.contacts as { phones?: unknown[] } | undefined)?.phones ?? [])
              .map((item) => normalizeText(item))
              .filter(Boolean)
          : []) || [],
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
    },
    contactOnlyFields: {
      contactName: normalizeBoolean(contactOnlyFieldsSource.contactName, fallback.contactOnlyFields.contactName),
      phone: normalizeBoolean(contactOnlyFieldsSource.phone, fallback.contactOnlyFields.phone),
      email: normalizeBoolean(contactOnlyFieldsSource.email, fallback.contactOnlyFields.email),
      address: normalizeBoolean(contactOnlyFieldsSource.address, fallback.contactOnlyFields.address),
      wechat: normalizeBoolean(contactOnlyFieldsSource.wechat, fallback.contactOnlyFields.wechat),
      whatsapp: normalizeBoolean(contactOnlyFieldsSource.whatsapp, fallback.contactOnlyFields.whatsapp),
      twitter: normalizeBoolean(contactOnlyFieldsSource.twitter, fallback.contactOnlyFields.twitter),
      weibo: normalizeBoolean(contactOnlyFieldsSource.weibo, fallback.contactOnlyFields.weibo),
      telegram: normalizeBoolean(contactOnlyFieldsSource.telegram, fallback.contactOnlyFields.telegram),
      linkedin: normalizeBoolean(contactOnlyFieldsSource.linkedin, fallback.contactOnlyFields.linkedin),
      discord: normalizeBoolean(contactOnlyFieldsSource.discord, fallback.contactOnlyFields.discord),
      facebook: normalizeBoolean(contactOnlyFieldsSource.facebook, fallback.contactOnlyFields.facebook),
      instagram: normalizeBoolean(contactOnlyFieldsSource.instagram, fallback.contactOnlyFields.instagram),
      tiktok: normalizeBoolean(contactOnlyFieldsSource.tiktok, fallback.contactOnlyFields.tiktok),
      douyin: normalizeBoolean(contactOnlyFieldsSource.douyin, fallback.contactOnlyFields.douyin),
      xiaohongshu: normalizeBoolean(contactOnlyFieldsSource.xiaohongshu, fallback.contactOnlyFields.xiaohongshu),
    },
    customTexts,
    textLayout: {
      merchantName: {
        x: clampInt(textLayoutSource.merchantName?.x, fallback.textLayout.merchantName.x, 0, 2000),
        y: clampInt(textLayoutSource.merchantName?.y, fallback.textLayout.merchantName.y, 0, 2000),
      },
      title: {
        x: clampInt(textLayoutSource.title?.x, fallback.textLayout.title.x, 0, 2000),
        y: clampInt(textLayoutSource.title?.y, fallback.textLayout.title.y, 0, 2000),
      },
      website: {
        x: clampInt(textLayoutSource.website?.x, fallback.textLayout.website.x, 0, 2000),
        y: clampInt(textLayoutSource.website?.y, fallback.textLayout.website.y, 0, 2000),
      },
      contactName: {
        x: clampInt(textLayoutSource.contactName?.x, fallback.textLayout.contactName.x, 0, 2000),
        y: clampInt(textLayoutSource.contactName?.y, fallback.textLayout.contactName.y, 0, 2000),
      },
      phone: {
        x: clampInt(textLayoutSource.phone?.x, fallback.textLayout.phone.x, 0, 2000),
        y: clampInt(textLayoutSource.phone?.y, fallback.textLayout.phone.y, 0, 2000),
      },
      email: {
        x: clampInt(textLayoutSource.email?.x, fallback.textLayout.email.x, 0, 2000),
        y: clampInt(textLayoutSource.email?.y, fallback.textLayout.email.y, 0, 2000),
      },
      address: {
        x: clampInt(textLayoutSource.address?.x, fallback.textLayout.address.x, 0, 2000),
        y: clampInt(textLayoutSource.address?.y, fallback.textLayout.address.y, 0, 2000),
      },
      wechat: {
        x: clampInt(textLayoutSource.wechat?.x, fallback.textLayout.wechat.x, 0, 2000),
        y: clampInt(textLayoutSource.wechat?.y, fallback.textLayout.wechat.y, 0, 2000),
      },
      whatsapp: {
        x: clampInt(textLayoutSource.whatsapp?.x, fallback.textLayout.whatsapp.x, 0, 2000),
        y: clampInt(textLayoutSource.whatsapp?.y, fallback.textLayout.whatsapp.y, 0, 2000),
      },
      twitter: {
        x: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).twitter?.x, fallback.textLayout.twitter.x, 0, 2000),
        y: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).twitter?.y, fallback.textLayout.twitter.y, 0, 2000),
      },
      weibo: {
        x: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).weibo?.x, fallback.textLayout.weibo.x, 0, 2000),
        y: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).weibo?.y, fallback.textLayout.weibo.y, 0, 2000),
      },
      telegram: {
        x: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).telegram?.x, fallback.textLayout.telegram.x, 0, 2000),
        y: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).telegram?.y, fallback.textLayout.telegram.y, 0, 2000),
      },
      linkedin: {
        x: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).linkedin?.x, fallback.textLayout.linkedin.x, 0, 2000),
        y: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).linkedin?.y, fallback.textLayout.linkedin.y, 0, 2000),
      },
      discord: {
        x: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).discord?.x, fallback.textLayout.discord.x, 0, 2000),
        y: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).discord?.y, fallback.textLayout.discord.y, 0, 2000),
      },
      facebook: {
        x: clampInt(textLayoutSource.facebook?.x, fallback.textLayout.facebook.x, 0, 2000),
        y: clampInt(textLayoutSource.facebook?.y, fallback.textLayout.facebook.y, 0, 2000),
      },
      instagram: {
        x: clampInt(textLayoutSource.instagram?.x, fallback.textLayout.instagram.x, 0, 2000),
        y: clampInt(textLayoutSource.instagram?.y, fallback.textLayout.instagram.y, 0, 2000),
      },
      tiktok: {
        x: clampInt(textLayoutSource.tiktok?.x, fallback.textLayout.tiktok.x, 0, 2000),
        y: clampInt(textLayoutSource.tiktok?.y, fallback.textLayout.tiktok.y, 0, 2000),
      },
      douyin: {
        x: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).douyin?.x, fallback.textLayout.douyin.x, 0, 2000),
        y: clampInt((textLayoutSource as Partial<MerchantBusinessCardTextLayout>).douyin?.y, fallback.textLayout.douyin.y, 0, 2000),
      },
      xiaohongshu: {
        x: clampInt(textLayoutSource.xiaohongshu?.x, fallback.textLayout.xiaohongshu.x, 0, 2000),
        y: clampInt(textLayoutSource.xiaohongshu?.y, fallback.textLayout.xiaohongshu.y, 0, 2000),
      },
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
    },
  };
}

export function normalizeMerchantBusinessCards(value: unknown): MerchantBusinessCardAsset[] {
  if (!Array.isArray(value)) return [];
  return value
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
      } satisfies MerchantBusinessCardAsset;
    })
    .filter((item): item is MerchantBusinessCardAsset => !!item);
}
