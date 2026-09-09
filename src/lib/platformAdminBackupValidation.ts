import { createDefaultMerchantPermissionConfig, FEATURE_CATALOG, MERCHANT_INDUSTRY_OPTIONS,
  MERCHANT_SORT_RULES, PERMISSION_CATALOG } from "@/data/platformControlStore";
import { createDefaultMerchantBusinessCardDraft, MERCHANT_BUSINESS_CARD_CONTACT_FIELD_KEYS,
  MERCHANT_BUSINESS_CARD_CONTACT_SECTION_KEYS, MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS,
  MERCHANT_BUSINESS_CARD_RATIO_OPTIONS } from "@/lib/merchantBusinessCards";
import { PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE } from "@/lib/platformAdminBackupStrictRead";
import { readPlatformAdminDataBackupFromBlocks } from "@/lib/platformAdminDataBackup";
import { readPlatformMerchantConfigArchiveFromBlocks } from "@/lib/platformMerchantConfigArchive";
import { normalizePlatformMerchantSnapshotPayload } from "@/lib/platformMerchantSnapshot";
import { readPlatformSupportInboxFromBlocks } from "@/lib/platformSupportInbox";

/**
 * Backup-only raw validation. Normalizers run AFTER these checks and are never
 * evidence that an unreadable source was empty or that no entries were dropped.
 * Missing optional presentation fields/new feature flags are legacy-compatible;
 * present malformed values, unknown fields in structured records, and duplicate
 * identities are not. Template block payloads remain intentionally opaque JSON.
 */
type Check = (value: unknown) => void;
type Fields = Record<string, Check>;
function fail(): never { throw new Error(PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  return value as Record<string, unknown>;
}
const text: Check = (value) => { if (typeof value !== "string") fail(); };
const identity: Check = (value) => { text(value); if (!(value as string).trim()) fail(); };
const merchantId: Check = (value) => { identity(value); if (!/^\d{8}$/.test((value as string).trim())) fail(); };
const bool: Check = (value) => { if (typeof value !== "boolean") fail(); };
function number(min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, integer = false): Check {
  return (value) => { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
    (integer && !Number.isSafeInteger(value))) fail(); };
}
const count = number(0, Number.MAX_SAFE_INTEGER, true);
const nullable = (check: Check): Check => (value) => { if (value !== null) check(value); };
const oneOf = (values: readonly unknown[]): Check => (value) => { if (!values.includes(value)) fail(); };
const timestamp: Check = (value) => {
  identity(value);
  const source = (value as string).trim();
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (!match || !Number.isFinite(Date.parse(source))) fail();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3])) fail();
};
const optionalDate: Check = (value) => { if (value !== null && value !== "") timestamp(value); };
function object(fields: Fields, required: readonly string[] = []): Check {
  return (value) => {
    const source = record(value);
    for (const key of required) if (!Object.hasOwn(source, key)) fail();
    for (const [key, entry] of Object.entries(source)) {
      if (!Object.hasOwn(fields, key)) fail();
      fields[key](entry);
    }
  };
}
function fields(names: string, check: Check = text): Fields {
  return Object.fromEntries(names.split(" ").filter(Boolean).map((name) => [name, check]));
}
function list(check: Check, key?: string, max = 1_000_000): Check {
  return (value) => {
    if (!Array.isArray(value) || value.length > max) fail();
    const seen = new Set<string>();
    for (const entry of value as unknown[]) {
      check(entry);
      if (key) {
        const id = record(entry)[key]; identity(id);
        const canonical = (id as string).trim();
        if (seen.has(canonical)) fail();
        seen.add(canonical);
      }
    }
  };
}
function uniqueStrings(check: Check = identity, max = 1_000_000): Check {
  return (value) => {
    list(check, undefined, max)(value);
    const keys = (value as string[]).map((item) => item.trim());
    if (new Set(keys).size !== keys.length) fail();
  };
}
function dictionary(key: Check, entry: Check): Check {
  return (value) => {
    const source = record(value); const seen = new Set<string>();
    for (const [name, item] of Object.entries(source)) {
      key(name); if (["__proto__", "constructor", "prototype"].includes(name) || seen.has(name.trim())) fail();
      seen.add(name.trim()); entry(item);
    }
  };
}
const json: Check = (value) => {
  const visited = new WeakSet<object>(); let remaining = 1_000_000;
  const visit = (entry: unknown, depth: number) => {
    if (--remaining < 0 || depth > 64) fail();
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return;
    if (typeof entry === "number") { number()(entry); return; }
    if (!entry || typeof entry !== "object" || visited.has(entry)) fail();
    visited.add(entry);
    if (Array.isArray(entry)) entry.forEach((item) => visit(item, depth + 1));
    else for (const [key, item] of Object.entries(record(entry))) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail();
      visit(item, depth + 1);
    }
    visited.delete(entry);
  };
  visit(value, 0);
};

const permissionRanges: Record<string, [number, number]> = {
  planLimit: [1, 200], pageLimit: [1, 500], businessCardLimit: [1, 100], businessCardIntroVideoLimitMb: [1, 80],
  businessCardBackgroundImageLimitKb: [50, 5000], businessCardContactImageLimitKb: [50, 5000],
  businessCardExportImageLimitKb: [50, 5000], commonBlockImageLimitKb: [50, 5000], galleryBlockImageLimitKb: [50, 5000],
  publishSizeLimitMb: [1, 100],
};
const permissionFields = Object.fromEntries(Object.entries(createDefaultMerchantPermissionConfig()).map(([key, value]) => {
  if (typeof value === "boolean") return [key, bool];
  const range = permissionRanges[key]; if (!range) fail();
  return [key, number(range[0], range[1], true)];
}));
const permissionConfig = object(permissionFields);
const sortRule = oneOf(MERCHANT_SORT_RULES);
const sortConfig = object(fields("recommendedCountryRank recommendedProvinceRank recommendedCityRank industryCountryRank industryProvinceRank industryCityRank", nullable(number(1, Number.MAX_SAFE_INTEGER, true))));
const contactVisibility = object(fields("phoneHidden emailHidden businessCardHidden", bool));
const location = object(fields("countryCode country provinceCode province city"));
const configFields: Fields = {
  serviceExpiresAt: optionalDate, permissionConfig,
  ...fields("merchantCardImageUrl chatAvatarImageUrl"), merchantCardImageOpacity: number(0, 1), contactVisibility, sortConfig,
};
const configSnapshot = object(configFields, ["permissionConfig"]);
const historyEntry = object({ ...fields("id operator summary"), at: timestamp, changes: list(identity), before: configSnapshot, after: configSnapshot },
  ["id", "at", "changes", "before", "after"]);
const history = list(historyEntry, "id");
const historyBySite = dictionary(merchantId, history);

// Derive only known presentation field names/primitive types from the canonical
// draft factory, not from a normalized candidate. Collections get explicit rules.
function draftShape(sample: unknown): Check {
  if (typeof sample === "string") return text;
  if (typeof sample === "boolean") return bool;
  if (typeof sample === "number") return number();
  if (Array.isArray(sample)) return list(json);
  return object(Object.fromEntries(Object.entries(record(sample)).map(([key, value]) => [key, draftShape(value)])));
}
const cardDraft = createDefaultMerchantBusinessCardDraft({});
const typography = object({ ...fields("fontFamily fontColor"), fontSize: number(10, 80, true),
  fontWeight: oneOf(["normal", "bold"]), fontStyle: oneOf(["normal", "italic"]), textDecoration: oneOf(["none", "underline"]) });
const cardFields: Fields = Object.fromEntries(Object.entries(cardDraft).map(([key, value]) => [key, draftShape(value)]));
Object.assign(cardFields, {
  id: identity, createdAt: timestamp, ...fields("imageUrl targetUrl shareImageUrl contactPagePublicImageUrl shareKey"),
  showInChat: bool, chatDisplayDisabled: bool, mode: oneOf(["image", "link"]), cornerMode: oneOf(["rounded", "square"]),
  ratioMode: oneOf(["custom", ...MERCHANT_BUSINESS_CARD_RATIO_OPTIONS.map((item) => item.id)]),
  contactFieldOrder: uniqueStrings(oneOf(MERCHANT_BUSINESS_CARD_CONTACT_FIELD_KEYS)),
  contactPageSectionOrder: uniqueStrings(oneOf(MERCHANT_BUSINESS_CARD_CONTACT_SECTION_KEYS)),
  contacts: object({ ...fields(Object.keys(cardDraft.contacts).filter((key) => key !== "phones").join(" ")), phones: list(identity, undefined, 2) }),
  customTexts: list(object({ id: identity, text, x: number(0, 2000, true), y: number(0, 2000, true), typography }, ["id", "text"]), "id"),
  typography: object(Object.fromEntries(Object.keys(cardDraft.typography).map((key) => [key, typography]))),
  fieldTypography: object(Object.fromEntries(Object.keys(cardDraft.fieldTypography).map((key) => [key, typography]))),
  textLayout: object(Object.fromEntries(Object.keys(cardDraft.textLayout).map((key) => [key, object({ x: number(0, 2000, true), y: number(0, 2000, true) })]))),
  qr: object({ x: number(0, 2000, true), y: number(0, 2000,  true), size: number(48, 600, true) }),
  width: number(320, 1600, true), height: number(180, 1600, true), contactIntroImageDurationSeconds: number(1, 15, true),
  contactPageImageHeight: number(120, 1200, true),
  ...fields("contactPageImageX contactPageImageY backgroundImageX backgroundImageY", number(-5000, 5000, true)),
  ...fields("contactPageImageScale backgroundImageScale", number(0.25, 3)),
  ...fields("contactPageImageOpacity backgroundImageOpacity backgroundColorOpacity", number(0, 1)),
  customContactLinks: list((value: unknown) => {
    object({ ...fields("id label displayText url iconUrl bgColor"), iconPreset: oneOf(MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS) }, ["id"])(value);
    const row = record(value); if (!(typeof row.url === "string" && row.url.trim()) && !(typeof row.displayText === "string" && row.displayText.trim())) fail();
  }, "id"),
});
const businessCard: Check = (value) => { object(cardFields, ["id", "createdAt", "imageUrl"])(value); identity(record(value).imageUrl); };
const cards = list(businessCard, "id");

const snapshotSiteFields: Fields = {
  id: merchantId, ...fields("merchantName signature domainPrefix domainSuffix name domain category contactAddress contactName contactPhone contactEmail merchantCardImageUrl chatAvatarImageUrl"),
  industry: oneOf(["", ...MERCHANT_INDUSTRY_OPTIONS]), location, ...configFields,
  businessCards: cards, chatBusinessCard: nullable(businessCard), status: oneOf(["online", "maintenance", "offline"]),
  createdAt: optionalDate,
};
const snapshotSites = list(object(snapshotSiteFields, ["id"]), "id");
function validateSnapshotPayload(value: unknown) {
  const source = record(value);
  object({ snapshot: snapshotSites, sites: snapshotSites, publishedMerchantSnapshot: snapshotSites,
    revision: text, platformMerchantSnapshotRevision: text, defaultSortRule: sortRule, publishedMerchantDefaultSortRule: sortRule,
    merchantConfigHistoryBySiteId: historyBySite, publishedMerchantConfigHistoryBySiteId: historyBySite,
    platformMerchantSnapshotVersion: oneOf([1]),
  })(source);
  for (const aliases of [["snapshot", "sites", "publishedMerchantSnapshot"], ["revision", "platformMerchantSnapshotRevision"],
    ["defaultSortRule", "publishedMerchantDefaultSortRule"], ["merchantConfigHistoryBySiteId", "publishedMerchantConfigHistoryBySiteId"]]) {
    const present = aliases.filter((key) => Object.hasOwn(source, key));
    if (present.length > 1 || (aliases[0] === "snapshot" && present.length !== 1)) fail();
  }
}

const archiveBase = { ...fields("id merchantName operator summary sourceHistoryEntryId"), siteId: identity,
  at: timestamp, source: oneOf(["update", "rollback", "restore"]), changes: list(identity) };
const archive = object({
  audits: list(object({ ...archiveBase, before: configSnapshot, after: configSnapshot }, ["id", "siteId", "at", "changes", "before", "after"]), "id", 2400),
  backups: list(object({ ...archiveBase, snapshot: configSnapshot }, ["id", "siteId", "at", "changes", "snapshot"]), "id", 1200),
}, ["audits", "backups"]);
const support = object({ threads: list(object({
  merchantId: identity, ...fields("siteId merchantName merchantEmail"), updatedAt: timestamp,
  messages: list(object({ id: identity, sender: oneOf(["merchant", "super_admin"]), text: identity, createdAt: timestamp },
    ["id", "sender", "text", "createdAt"]), "id"),
}, ["merchantId", "messages", "updatedAt"]), "merchantId") }, ["threads"]);

const platformSite = object({ ...snapshotSiteFields, id: identity, ...fields("tenantId categoryId"),
  features: object(Object.fromEntries(FEATURE_CATALOG.map((item) => [item.key, bool]))),
  publishedVersion: count, lastPublishedAt: nullable(timestamp), updatedAt: timestamp, configHistory: history,
}, ["id", "name", "domain", "status"]);
const dateFields = { createdAt: timestamp, updatedAt: timestamp };
const basic = { id: identity, name: text, ...dateFields };
const platformState = object({
  version: oneOf([1]),
  tenants: list(object({ ...basic, owner: text, status: oneOf(["active", "suspended"]) }, ["id", "name", "status"]), "id"),
  sites: list(platformSite, "id"),
  roles: list(object({ ...basic, description: text, permissions: uniqueStrings(oneOf(PERMISSION_CATALOG.map((item) => item.key))) },
    ["id", "name", "permissions"]), "id"),
  users: list(object({ ...basic, ...fields("email department"), tenantIds: uniqueStrings(), siteIds: uniqueStrings(), roleIds: uniqueStrings(), status: oneOf(["active", "disabled"]) },
    ["id", "name", "tenantIds", "siteIds", "roleIds", "status"]), "id"),
  industryCategories: list(object({ ...basic, ...fields("slug description"), parentId: nullable(identity), sortOrder: count, status: oneOf(["active", "inactive"]) }, ["id", "name"]), "id"),
  homeLayout: object({ ...fields("heroTitle heroSubtitle"), featuredCategoryIds: uniqueStrings(), merchantDefaultSortRule: sortRule,
    sections: list(object({ ...fields("id title description categoryId"), sortOrder: count, visible: bool }, ["id", "title", "categoryId"]), "id"),
  }, ["featuredCategoryIds", "sections"]),
  planTemplates: list(object({ ...basic, category: oneOf(["其他", ...MERCHANT_INDUSTRY_OPTIONS]),
    ...fields("sourceSiteId sourceSiteName sourceSiteDomain coverImageUrl previewImageUrl previewVariant"), sourceIndustry: oneOf(["", ...MERCHANT_INDUSTRY_OPTIONS]),
    planPreviewImageUrls: dictionary(identity, identity), blocks: list(json),
  }, ["id", "blocks"]), "id"),
  pageAssets: list(object({ id: identity, ...fields("siteId pagePath group updatedBy"), tags: list(text), status: oneOf(["draft", "published", "archived"]), updatedAt: timestamp }, ["id", "siteId", "tags", "status"]), "id"),
  publishRecords: list(object({ id: identity, ...fields("tenantId siteId operator notes"), version: count, status: oneOf(["success", "failed", "rollback"]), at: timestamp }, ["id", "siteId", "status", "at"]), "id", 600),
  approvals: list(object({ id: identity, ...fields("tenantId siteId summary requestedBy resultNote"), type: oneOf(["publish", "rollback", "permission_change", "feature_change"]),
    requestedAt: timestamp, status: oneOf(["pending", "approved", "rejected"]), handledBy: nullable(text), handledAt: nullable(timestamp),
  }, ["id", "type", "status", "requestedAt"]), "id", 500),
  alerts: list(object({ id: identity, ...fields("title message"), level: oneOf(["info", "warning", "critical"]), createdAt: timestamp,
    resolvedAt: nullable(timestamp), resolvedBy: nullable(text) }, ["id", "level", "createdAt"]), "id", 400),
  audits: list(object({ ...fields("id operator action targetType targetId detail"), at: timestamp }, ["id", "at"]), "id", 1200),
}, ["version", "tenants", "sites", "roles", "users", "industryCategories", "homeLayout", "planTemplates", "pageAssets", "publishRecords", "approvals", "alerts", "audits"]);

const account = object({ ...fields("merchantId merchantName email username loginId siteSlug"),
  createdAt: nullable(timestamp), authUserId: nullable(text), emailConfirmedAt: nullable(timestamp), lastSignInAt: nullable(timestamp), siteUpdatedAt: nullable(timestamp),
  ...fields("emailConfirmed manualCreated hasPublishedSite publishedBytesKnown visitsKnown", bool), publishedBytes: count,
  visits: object(fields("today day7 day30 total", count)),
});
export function assertPlatformAdminBackupMerchantAccounts(value: unknown) {
  list(account)(value);
  const identities = new Set<string>();
  for (const entry of value as Record<string, unknown>[]) {
    // The snapshot normalizer still requires one of these display/account
    // fields; authUserId alone would be silently dropped after validation.
    if (!["merchantId", "email", "username", "loginId"].some((key) =>
      typeof entry[key] === "string" && entry[key].trim())) fail();
    // Use only the strongest available identity. Display/fallback usernames
    // (and other aliases) are not globally unique across distinct accounts.
    for (const key of ["authUserId", "merchantId", "loginId", "email", "username"]) {
      const raw = entry[key]; if (typeof raw !== "string" || !raw.trim()) continue;
      const id = key === "email" ? raw.trim().toLowerCase() : raw.trim();
      const identityKey = JSON.stringify([key, id]);
      if (identities.has(identityKey)) fail();
      identities.add(identityKey);
      break;
    }
  }
}
export function assertPlatformAdminBackupPlatformState(value: unknown) { platformState(value); }
export function assertPlatformAdminBackupMerchantSnapshot(value: unknown) { validateSnapshotPayload(value); }
export function assertPlatformAdminBackupMerchantConfigArchive(value: unknown) { archive(value); }
export function assertPlatformAdminBackupSnapshot(value: unknown) {
  object({ platformState, merchantSnapshot: nullable(validateSnapshotPayload), merchantConfigArchive: archive, supportInbox: support,
    merchantAccounts: assertPlatformAdminBackupMerchantAccounts },
  ["platformState", "merchantSnapshot", "merchantConfigArchive", "supportInbox", "merchantAccounts"])(value);
}
const backupEntry = object({ ...fields("id operator summary"), at: timestamp, source: oneOf(["manual", "auto"]),
  scheduleDateKey: nullable((value) => { timestamp(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(value as string)) fail(); }),
  userManageCounts: object(fields("siteCount userCount roleCount merchantAccountCount merchantSnapshotCount merchantConfigBackupCount", count)),
  supportCounts: object(fields("threadCount messageCount", count)), snapshot: assertPlatformAdminBackupSnapshot,
}, ["id", "at", "source", "snapshot"]);

/** Save may add a ninth valid entry before the documented eight-entry retention is applied. */
export function assertPlatformAdminBackupSavePayload(value: unknown) {
  object({ backups: list(backupEntry, "id") }, ["backups"])(value);
}

function envelope(blocks: unknown[] | null, kind: "backup" | "snapshot" | "archive" | "support") {
  if (blocks === null) return null;
  if (!Array.isArray(blocks) || blocks.length !== 1) fail();
  const block = record(blocks[0]);
  object({ id: text, type: oneOf(["common"]), content: text, props: (value) => { record(value); } }, ["props"])(block);
  const props = record(block.props);
  if (kind === "snapshot") {
    if (block.id !== "__platform_merchant_snapshot__" && props.platformMerchantSnapshotVersion !== 1) fail();
    validateSnapshotPayload(props);
    return props;
  }
  const flag = { backup: "isPlatformAdminDataBackup", archive: "isPlatformMerchantConfigArchive", support: "isPlatformSupportInbox" }[kind];
  object({ [flag]: oneOf([true]), version: oneOf([1]), payload: kind === "backup" ? object({ backups: list(backupEntry, "id", 8) }, ["backups"]) : kind === "archive" ? archive : support }, [flag, "payload"])(props);
  return props;
}

export function readPlatformAdminDataBackupBlocksValidated(blocks: unknown[] | null) {
  envelope(blocks, "backup"); return readPlatformAdminDataBackupFromBlocks(blocks);
}

/** Backup entries are immutable by id; stale copies may omit ids, not redefine one. */
export function assertPlatformAdminBackupCopiesConsistent(copies: Array<unknown[] | null>) {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.entries(record(value)).sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  const seen = new Map<string, string>();
  for (const blocks of copies) {
    const props = envelope(blocks, "backup");
    if (!props) continue;
    const backups = record(props.payload).backups as RawBackupEntry[];
    for (const entry of backups) {
      const id = entry.id.trim();
      const originalContents = canonical(entry);
      if (seen.has(id) && seen.get(id) !== originalContents) fail();
      seen.set(id, originalContents);
    }
  }
}
type RawBackupEntry = Record<string, unknown> & { id: string };

export function readPlatformMerchantConfigArchiveBlocksValidated(blocks: unknown[] | null) {
  envelope(blocks, "archive"); return readPlatformMerchantConfigArchiveFromBlocks(blocks);
}
export function readPlatformMerchantSnapshotBlocksValidated(blocks: unknown[] | null) {
  const props = envelope(blocks, "snapshot");
  // A valid existing empty directory can still contain configuration history.
  return props === null ? null : normalizePlatformMerchantSnapshotPayload(props);
}
export function readPlatformSupportInboxBlocksValidated(blocks: unknown[] | null) {
  envelope(blocks, "support"); return readPlatformSupportInboxFromBlocks(blocks);
}
