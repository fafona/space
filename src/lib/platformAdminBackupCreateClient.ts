import type { PlatformAdminDataBackupListItem } from "./platformAdminDataBackup";
import { PLATFORM_ADMIN_DATA_BACKUP_SCOPE } from "./platformAdminDataBackupScope";

const summaryKeys = ["id", "at", "operator", "source", "scheduleDateKey", "summary", "userManageCounts", "supportCounts"];
const userCountKeys = ["siteCount", "userCount", "roleCount", "merchantAccountCount", "merchantSnapshotCount", "merchantConfigBackupCount"] as const;
const supportCountKeys = ["threadCount", "messageCount"] as const;
function fail(): never { throw new Error("super_admin_backup_create_ack_unconfirmed"); }
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || Reflect.ownKeys(value).some((key) =>
    typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
    !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim()) fail();
  return value;
}
function dateKey(value: unknown): string {
  const source = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match) fail();
  const [year, month, day] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail();
  return source;
}
function timestamp(value: unknown): string {
  const source = text(value);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/.exec(source);
  if (!match || !Number.isFinite(Date.parse(source))) fail();
  dateKey(match[1]);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 ||
      (match[5] !== "Z" && (Number(match[6]) > 23 || Number(match[7]) > 59))) fail();
  return source;
}
function counts<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> {
  const input = record(value, keys);
  return Object.fromEntries(keys.map((key) => {
    const count = input[key];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) fail();
    return [key, count];
  })) as Record<K, number>;
}
function summary(value: unknown): PlatformAdminDataBackupListItem {
  const input = record(value, summaryKeys);
  if (input.source !== "manual" && input.source !== "auto") fail();
  return {
    id: text(input.id), at: timestamp(input.at), operator: text(input.operator), source: input.source,
    scheduleDateKey: input.scheduleDateKey === null ? null : dateKey(input.scheduleDateKey),
    summary: text(input.summary), userManageCounts: counts(input.userManageCounts, userCountKeys),
    supportCounts: counts(input.supportCounts, supportCountKeys),
  };
}

/** The actual route includes this public contract. Accept only its exact known
 * shape and values, not arbitrary metadata or a claim of full-database recovery.
 * Descriptor checks keep getters/prototypes out of the acknowledgement boundary.
 */
function scopeContract(value: unknown, expected: unknown): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length !== expected.length || Reflect.ownKeys(value).length !== expected.length + 1) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < expected.length; index++) {
      const entry = descriptors[index];
      if (!entry?.enumerable || !Object.hasOwn(entry, "value")) fail();
      scopeContract(entry.value, expected[index]);
    }
    return;
  }
  if (expected !== null && typeof expected === "object") {
    const input = record(value, Object.keys(expected));
    for (const [key, entry] of Object.entries(expected)) scopeContract(input[key], entry);
    return;
  }
  if (value !== expected) fail();
}

/** A create acknowledgement is a bounded list of summaries, never a full backup.
 * Unknown/partial/error responses must be treated as an unconfirmed write by the
 * caller. Parsing never repairs missing fields or exposes raw internal errors.
 */
export function parsePlatformAdminBackupCreateAck(value: unknown): {
  created: boolean; backups: PlatformAdminDataBackupListItem[];
} | null {
  try {
    const input = record(value, ["ok", "created", "backups"], ["backup", "backupScope"]);
    if (Object.hasOwn(input, "backupScope")) scopeContract(input.backupScope, PLATFORM_ADMIN_DATA_BACKUP_SCOPE);
    if (input.ok !== true || typeof input.created !== "boolean" ||
        Object.hasOwn(input, "backup") !== input.created) fail();
    const list = input.backups;
    if (!Array.isArray(list) || Object.getPrototypeOf(list) !== Array.prototype || list.length > 8 ||
        Reflect.ownKeys(list).length !== list.length + 1) fail();
    const descriptors = Object.getOwnPropertyDescriptors(list);
    for (let index = 0; index < list.length; index++) {
      if (!descriptors[index]?.enumerable || !Object.hasOwn(descriptors[index], "value")) fail();
    }
    const backups = list.map(summary);
    if (new Set(backups.map((item) => item.id)).size !== backups.length) fail();
    if (input.created) {
      const created = summary(input.backup);
      const listed = backups.find((item) => item.id === created.id);
      if (!listed || JSON.stringify(created) !== JSON.stringify(listed)) fail();
    }
    return { created: input.created, backups };
  } catch { return null; }
}
