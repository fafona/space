import { createDefaultMerchantPermissionConfig, type MerchantServicePermissionConfig } from "@/data/platformControlStore";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";

type AuthMetadata = Record<string, unknown> | null | undefined;

export type PersonalAccountServiceConfig = {
  servicePaused: boolean;
  businessCardLimit: number;
  allowBusinessCardLinkMode: boolean;
  businessCardBackgroundImageLimitKb: number;
  businessCardContactImageLimitKb: number;
};

function cloneMetadata(metadata: AuthMetadata) {
  return metadata && typeof metadata === "object" ? { ...metadata } : {};
}

function readMetadataBoolean(metadata: AuthMetadata, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function readMetadataNumber(metadata: AuthMetadata, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readMetadataRecord(metadata: AuthMetadata, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return null;
  for (const key of keys) {
    const value = metadata[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function normalizeInt(value: unknown, fallback: number, min: number, max: number) {
  const next = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, next));
}

export function createDefaultPersonalAccountServiceConfig(): PersonalAccountServiceConfig {
  return {
    servicePaused: false,
    businessCardLimit: 1,
    allowBusinessCardLinkMode: false,
    businessCardBackgroundImageLimitKb: 100,
    businessCardContactImageLimitKb: 200,
  };
}

export function normalizePersonalAccountServiceConfig(value: unknown): PersonalAccountServiceConfig {
  const source = value && typeof value === "object" ? (value as Partial<PersonalAccountServiceConfig>) : {};
  const fallback = createDefaultPersonalAccountServiceConfig();
  return {
    servicePaused: typeof source.servicePaused === "boolean" ? source.servicePaused : fallback.servicePaused,
    businessCardLimit: normalizeInt(source.businessCardLimit, fallback.businessCardLimit, 1, 100),
    allowBusinessCardLinkMode:
      typeof source.allowBusinessCardLinkMode === "boolean"
        ? source.allowBusinessCardLinkMode
        : fallback.allowBusinessCardLinkMode,
    businessCardBackgroundImageLimitKb: normalizeInt(
      source.businessCardBackgroundImageLimitKb,
      fallback.businessCardBackgroundImageLimitKb,
      50,
      5000,
    ),
    businessCardContactImageLimitKb: normalizeInt(
      source.businessCardContactImageLimitKb,
      fallback.businessCardContactImageLimitKb,
      50,
      5000,
    ),
  };
}

export function readPersonalAccountServiceConfigFromMetadata(user: MerchantAuthUserSummary | null | undefined) {
  const userMetadata = user?.user_metadata ?? null;
  const appMetadata = user?.app_metadata ?? null;
  const record =
    readMetadataRecord(userMetadata, "personal_service_config", "personalServiceConfig") ??
    readMetadataRecord(appMetadata, "personal_service_config", "personalServiceConfig");
  const fallback = createDefaultPersonalAccountServiceConfig();
  return normalizePersonalAccountServiceConfig({
    ...(record ?? {}),
    servicePaused:
      readMetadataBoolean(record, "servicePaused", "service_paused") ??
      readMetadataBoolean(userMetadata, "personal_service_paused", "personalServicePaused") ??
      readMetadataBoolean(appMetadata, "personal_service_paused", "personalServicePaused") ??
      fallback.servicePaused,
    businessCardLimit:
      readMetadataNumber(record, "businessCardLimit", "business_card_limit") ??
      readMetadataNumber(userMetadata, "personal_business_card_limit", "personalBusinessCardLimit") ??
      readMetadataNumber(appMetadata, "personal_business_card_limit", "personalBusinessCardLimit") ??
      fallback.businessCardLimit,
    allowBusinessCardLinkMode:
      readMetadataBoolean(record, "allowBusinessCardLinkMode", "allow_business_card_link_mode") ??
      readMetadataBoolean(
        userMetadata,
        "personal_allow_business_card_link_mode",
        "personalAllowBusinessCardLinkMode",
      ) ??
      readMetadataBoolean(
        appMetadata,
        "personal_allow_business_card_link_mode",
        "personalAllowBusinessCardLinkMode",
      ) ??
      fallback.allowBusinessCardLinkMode,
    businessCardBackgroundImageLimitKb:
      readMetadataNumber(record, "businessCardBackgroundImageLimitKb", "business_card_background_image_limit_kb") ??
      readMetadataNumber(
        userMetadata,
        "personal_business_card_background_image_limit_kb",
        "personalBusinessCardBackgroundImageLimitKb",
      ) ??
      readMetadataNumber(
        appMetadata,
        "personal_business_card_background_image_limit_kb",
        "personalBusinessCardBackgroundImageLimitKb",
      ) ??
      fallback.businessCardBackgroundImageLimitKb,
    businessCardContactImageLimitKb:
      readMetadataNumber(record, "businessCardContactImageLimitKb", "business_card_contact_image_limit_kb") ??
      readMetadataNumber(
        userMetadata,
        "personal_business_card_contact_image_limit_kb",
        "personalBusinessCardContactImageLimitKb",
      ) ??
      readMetadataNumber(
        appMetadata,
        "personal_business_card_contact_image_limit_kb",
        "personalBusinessCardContactImageLimitKb",
      ) ??
      fallback.businessCardContactImageLimitKb,
  });
}

export function buildPersonalAccountPermissionConfig(
  value: PersonalAccountServiceConfig | null | undefined,
): MerchantServicePermissionConfig {
  const fallback = createDefaultMerchantPermissionConfig();
  const config = normalizePersonalAccountServiceConfig(value);
  return {
    ...fallback,
    businessCardLimit: config.businessCardLimit,
    allowBusinessCardLinkMode: config.allowBusinessCardLinkMode,
    businessCardBackgroundImageLimitKb: config.businessCardBackgroundImageLimitKb,
    businessCardContactImageLimitKb: config.businessCardContactImageLimitKb,
  };
}

export function buildPersonalAccountServiceMetadataPatch(
  user: MerchantAuthUserSummary | null | undefined,
  value: PersonalAccountServiceConfig | null | undefined,
) {
  const config = normalizePersonalAccountServiceConfig(value);
  const userMetadata = cloneMetadata(user?.user_metadata);
  const appMetadata = cloneMetadata(user?.app_metadata);
  userMetadata.personal_service_config = config;
  userMetadata.personalServiceConfig = config;
  userMetadata.personal_service_paused = config.servicePaused;
  userMetadata.personalServicePaused = config.servicePaused;
  userMetadata.personal_business_card_limit = config.businessCardLimit;
  userMetadata.personalBusinessCardLimit = config.businessCardLimit;
  userMetadata.personal_allow_business_card_link_mode = config.allowBusinessCardLinkMode;
  userMetadata.personalAllowBusinessCardLinkMode = config.allowBusinessCardLinkMode;
  userMetadata.personal_business_card_background_image_limit_kb = config.businessCardBackgroundImageLimitKb;
  userMetadata.personalBusinessCardBackgroundImageLimitKb = config.businessCardBackgroundImageLimitKb;
  userMetadata.personal_business_card_contact_image_limit_kb = config.businessCardContactImageLimitKb;
  userMetadata.personalBusinessCardContactImageLimitKb = config.businessCardContactImageLimitKb;
  appMetadata.personal_service_config = config;
  appMetadata.personalServiceConfig = config;
  appMetadata.personal_service_paused = config.servicePaused;
  appMetadata.personalServicePaused = config.servicePaused;
  appMetadata.personal_business_card_limit = config.businessCardLimit;
  appMetadata.personalBusinessCardLimit = config.businessCardLimit;
  appMetadata.personal_allow_business_card_link_mode = config.allowBusinessCardLinkMode;
  appMetadata.personalAllowBusinessCardLinkMode = config.allowBusinessCardLinkMode;
  appMetadata.personal_business_card_background_image_limit_kb = config.businessCardBackgroundImageLimitKb;
  appMetadata.personalBusinessCardBackgroundImageLimitKb = config.businessCardBackgroundImageLimitKb;
  appMetadata.personal_business_card_contact_image_limit_kb = config.businessCardContactImageLimitKb;
  appMetadata.personalBusinessCardContactImageLimitKb = config.businessCardContactImageLimitKb;
  return {
    user_metadata: userMetadata,
    app_metadata: appMetadata,
  };
}
