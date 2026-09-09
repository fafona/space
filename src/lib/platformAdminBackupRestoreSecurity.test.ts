import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformAdminDataBackupEntry, buildPlatformAdminDataBackupBlocks,
  PLATFORM_ADMIN_DATA_BACKUP_SLUG, PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG,
  type PlatformAdminDataBackupEntry, type PlatformAdminDataBackupRestoreScope } from "./platformAdminDataBackup";
import { createPlatformAdminDataBackupHandlers } from "./platformAdminDataBackupRoute";
import { buildPlatformMerchantSnapshotBlocks, PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG } from "./platformMerchantSnapshot";
import { buildPlatformMerchantConfigArchiveBlocks, PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG } from "./platformMerchantConfigArchive";
import { buildPlatformSupportInboxBlocks, PLATFORM_SUPPORT_INBOX_SLUG } from "./platformSupportInbox";
import {
  buildPlatformAdminBackupRestorePreview,
  isPlatformAdminBackupRestoreAction,
  isPlatformAdminBackupRestoreScope,
  type PlatformAdminBackupRestoreCurrent,
} from "./platformAdminBackupRestorePreview.server";
import type { PlatformSupportInboxPayload } from "./platformSupportInbox";

const AT = "2026-09-08T12:00:00.000Z";
const PRIVATE = "PRIVATE-MEMBER private@example.invalid ORIGINAL-REQUEST-SECRET";

function inbox(): PlatformSupportInboxPayload {
  return { threads: [{ merchantId: "10000000", siteId: "10000000", merchantName: PRIVATE,
    merchantEmail: "private@example.invalid", updatedAt: AT,
    messages: [{ id: "message-1", sender: "merchant", text: PRIVATE, createdAt: AT },
      { id: "message-2", sender: "super_admin", text: "Synthetic second message", createdAt: AT }],
  }] };
}

function target(): PlatformAdminDataBackupEntry {
  const entry = createPlatformAdminDataBackupEntry({ source: "manual", operator: PRIVATE, summary: PRIVATE,
    snapshot: {
      platformState: { version: 1, tenants: [], sites: [], planTemplates: [], industryCategories: [],
        homeLayout: { heroTitle: PRIVATE, heroSubtitle: "", featuredCategoryIds: [],
          merchantDefaultSortRule: "created_desc", sections: [] },
        roles: [], users: [], pageAssets: [], publishRecords: [], approvals: [], alerts: [], audits: [] },
      merchantSnapshot: { revision: "snapshot-target", snapshot: [], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} },
      merchantConfigArchive: { audits: [], backups: [] }, supportInbox: inbox(), merchantAccounts: [],
    } });
  entry.id = "synthetic-backup"; entry.at = AT;
  return entry;
}

function currentUser(): Extract<PlatformAdminBackupRestoreCurrent, { scope: "user_manage" }> {
  return { scope: "user_manage", merchantSnapshot: { revision: "snapshot-current", snapshot: [],
    defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} }, merchantConfigArchive: { audits: [], backups: [] } };
}

function currentSupport(): Extract<PlatformAdminBackupRestoreCurrent, { scope: "support_messages" }> {
  return { scope: "support_messages", supportInbox: inbox() };
}

test("restore security: reordered source arrays remain a content change even when counts do not change", () => {
  const entry = target(); const current = currentSupport();
  const original = buildPlatformAdminBackupRestorePreview(entry, current);
  const changed = structuredClone(current); changed.supportInbox.threads[0].messages.reverse();
  const reversedMessages = buildPlatformAdminBackupRestorePreview(entry, changed);
  assert.deepEqual(reversedMessages.counts, original.counts);
  assert.notEqual(reversedMessages.confirmationToken, original.confirmationToken);
});

test("restore security: action and scope validators never normalize alternate or omitted commands", () => {
  for (const action of ["preview", "restore"]) assert.equal(isPlatformAdminBackupRestoreAction(action), true);
  for (const scope of ["user_manage", "support_messages"]) assert.equal(isPlatformAdminBackupRestoreScope(scope), true);
  for (const invalid of [null, undefined, false, [], {}, "", "RESTORE", "restore ", " preview", "execute", "delete", "user_manage ", "USER_MANAGE"]) {
    assert.equal(isPlatformAdminBackupRestoreAction(invalid), false);
    assert.equal(isPlatformAdminBackupRestoreScope(invalid), false);
  }
});

test("restore security: counts are derived from records rather than cached or forged entry counts", () => {
  const entry = target(); entry.supportCounts = { threadCount: 9999, messageCount: 9999 };
  const preview = buildPlatformAdminBackupRestorePreview(entry, currentSupport());
  assert.deepEqual(preview.counts.map(({ key, current, target: after }) => [key, current, after]),
    [["support_threads", 1, 1], ["support_messages", 2, 2]]);
  assert.equal(preview.requiresEmptyConfirmation, false);
});

test("restore security: existing thread with messages cannot silently restore as a zero-message thread", () => {
  const entry = target(); entry.snapshot.supportInbox.threads[0].messages = [];
  const preview = buildPlatformAdminBackupRestorePreview(entry, currentSupport());
  assert.equal(preview.requiresEmptyConfirmation, true);
  assert.deepEqual(preview.emptyKeys, ["support_messages"]);
});

test("restore security: wholly empty support remains explicit even when current state is also empty", () => {
  const entry = target(); entry.snapshot.supportInbox.threads = [];
  const current = currentSupport(); current.supportInbox.threads = [];
  const preview = buildPlatformAdminBackupRestorePreview(entry, current);
  assert.equal(preview.requiresEmptyConfirmation, true);
  assert.deepEqual(preview.emptyKeys, ["support_threads", "support_messages"]);
});

test("restore security: browser-local current counts remain unknown and empty replacement is flagged", () => {
  const preview = buildPlatformAdminBackupRestorePreview(target(), currentUser());
  const browser = preview.counts.filter((item) => item.source === "browser");
  assert.equal(browser.length, 4);
  assert.ok(browser.every((item) => item.current === null && item.target === 0));
  assert.ok(browser.every((item) => preview.emptyKeys.includes(item.key)));
  assert.equal(preview.requiresEmptyConfirmation, true);
  assert.match(preview.warning, /本浏览器当前数据未由服务器核对/);
});

test("restore security: preview generation is pure and returned exclusion arrays are detached", () => {
  const entry = target(); const current = currentSupport();
  const beforeEntry = structuredClone(entry); const beforeCurrent = structuredClone(current);
  const first = buildPlatformAdminBackupRestorePreview(entry, current);
  first.excluded.length = 0; first.counts[0].target = 999;
  const second = buildPlatformAdminBackupRestorePreview(entry, current);
  assert.deepEqual(entry, beforeEntry); assert.deepEqual(current, beforeCurrent);
  assert.ok(second.excluded.length > 0); assert.equal(second.counts[0].target, 1);
});

type QueryResult = { data: unknown; error: { message: string } | null };

/** In-memory PostgREST-shaped fake; no service client, environment loading or network. */
function handlerFixture() {
  const entry = target();
  const rows = new Map<string, unknown>();
  for (const slug of [PLATFORM_ADMIN_DATA_BACKUP_SLUG, PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG]) {
    rows.set(slug, buildPlatformAdminDataBackupBlocks({ backups: [entry] }));
  }
  for (const slug of [PLATFORM_MERCHANT_SNAPSHOT_SLUG, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
    PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG]) {
    rows.set(slug, buildPlatformMerchantSnapshotBlocks(currentUser().merchantSnapshot!));
  }
  for (const slug of [PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG, PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG]) {
    rows.set(slug, buildPlatformMerchantConfigArchiveBlocks({ audits: [], backups: [] }));
  }
  rows.set(PLATFORM_SUPPORT_INBOX_SLUG, buildPlatformSupportInboxBlocks(inbox()));
  const reads: string[] = []; const writes: string[] = []; const attempts: string[] = [];
  let failingSlug = ""; let failureMode: "error" | "throw" = "error";
  let clientCreations = 0; let authorizations = 0; let authorized = true;
  const client = { from(table: string) {
    assert.equal(table, "pages", "all test data must stay in the in-memory pages fake");
    let slug = ""; let scoped = false; let body: Record<string, unknown> | null = null;
    const execute = async (single: boolean): Promise<QueryResult> => {
      if (body) {
        attempts.push(slug);
        if (slug === failingSlug) {
          if (failureMode === "throw") throw new Error(PRIVATE);
          return { data: null, error: { message: PRIVATE } };
        }
        writes.push(slug); rows.set(slug, structuredClone(body.blocks));
        return { data: single ? { id: slug } : [{ id: slug }], error: null };
      }
      reads.push(`${scoped ? "scoped" : "existence"}:${slug}`);
      const row = rows.has(slug) ? { id: slug, blocks: structuredClone(rows.get(slug)), updated_at: AT } : null;
      return { data: single ? row : row ? [row] : [], error: null };
    };
    const builder = {
      select(columns: string) { assert.ok(columns.length > 0); return builder; },
      is(column: string, value: unknown) { assert.equal(column, "merchant_id"); assert.equal(value, null); scoped = true; return builder; },
      eq(column: string, value: unknown) {
        assert.ok(["slug", "id", "updated_at"].includes(column));
        if (column !== "updated_at") slug = String(value);
        return builder;
      },
      limit(count: number) { assert.ok(count === 1 || count === 2); return builder; },
      maybeSingle() { return execute(true); },
      update(value: Record<string, unknown>) { body = value; return builder; },
      insert(value: Record<string, unknown>) { body = value; slug = String(value.slug); return execute(false); },
      then(resolve: (result: QueryResult) => unknown, reject?: (error: unknown) => unknown) {
        return execute(false).then(resolve, reject);
      },
    };
    return builder;
  } };
  const handlers = createPlatformAdminDataBackupHandlers({
    authorize: async () => { authorizations += 1; return authorized; },
    createClient: () => { clientCreations += 1; return client; },
  });
  return { entry, rows, reads, writes, attempts, handlers,
    deny() { authorized = false; },
    fail(slug: string, mode: "error" | "throw") { failingSlug = slug; failureMode = mode; },
    get clientCreations() { return clientCreations; }, get authorizations() { return authorizations; },
  };
}

function patchRequest(body: unknown, origin = "https://launch.faolla.com") {
  return new Request("https://launch.faolla.com/api/super-admin/data-backups", { method: "PATCH",
    headers: { "content-type": "application/json", origin, "sec-fetch-site": origin === "https://launch.faolla.com" ? "same-origin" : "cross-site" },
    body: JSON.stringify(body) });
}

async function previewRequest(fixture: ReturnType<typeof handlerFixture>, scope: PlatformAdminDataBackupRestoreScope) {
  const response = await fixture.handlers.PATCH(patchRequest({ backupId: fixture.entry.id, scope, action: "preview" }));
  assert.equal(response.status, 200, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.ok, true); assert.deepEqual(fixture.writes, []);
  return payload.preview;
}

const INCOMPLETE = { error: "super_admin_backup_restore_incomplete", outcome: "partial_or_unknown", retrySafe: false };

for (const [scope, failureSlug] of [
  ["user_manage", PLATFORM_MERCHANT_SNAPSHOT_SLUG],
  ["user_manage", PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG],
  ["support_messages", PLATFORM_SUPPORT_INBOX_SLUG],
] as const) {
  for (const failure of ["error", "throw"] as const) {
    test(`restore handler security: ${scope} ${failureSlug} ${failure} never leaks or claims rollback/retry safety`, async () => {
      const f = handlerFixture(); const preview = await previewRequest(f, scope);
      f.fail(failureSlug, failure);
      const response = await f.handlers.PATCH(patchRequest({ backupId: f.entry.id, scope, action: "restore",
        confirmationToken: preview.confirmationToken, confirmEmpty: true }));
      assert.equal(response.status, 500); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), INCOMPLETE);
      assert.ok(f.attempts.includes(failureSlug));
      assert.equal(f.attempts.filter((slug) => slug === failureSlug).length, 1, "no retry of the failed writer");
      assert.ok(!f.writes.includes(failureSlug));
      if (failureSlug === PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG) {
        assert.ok(f.writes.includes(PLATFORM_MERCHANT_SNAPSHOT_SLUG), "earlier writes really happened");
        assert.equal(f.writes.filter((slug) => slug === PLATFORM_MERCHANT_SNAPSHOT_SLUG).length, 1, "no compensating rollback write");
      }
      if (scope === "support_messages") assert.ok(f.writes.includes("__platform_support_inbox_history__"), "history committed before the failed replacement");
    });
  }
}

for (const scope of ["user_manage", "support_messages"] as const) {
  test(`restore handler security: valid ${scope} confirmation executes the existing writer and returns bound success`, async () => {
    const f = handlerFixture(); const preview = await previewRequest(f, scope);
    const response = await f.handlers.PATCH(patchRequest({ backupId: f.entry.id, scope, action: "restore",
      confirmationToken: preview.confirmationToken, confirmEmpty: true }));
    assert.equal(response.status, 200, await response.clone().text());
    const payload = await response.json(); assert.equal(payload.ok, true); assert.equal(payload.scope, scope);
    assert.equal(payload.backup.id, f.entry.id); assert.equal(payload.backupScope.fullDatabaseBackup, false);
    assert.ok(f.writes.includes(scope === "user_manage" ? PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG : PLATFORM_SUPPORT_INBOX_SLUG));
    if (scope === "user_manage") {
      assert.deepEqual(payload.platformState, f.entry.snapshot.platformState);
      assert.deepEqual(payload.merchantAccounts, []);
    } else assert.deepEqual(payload.threads, f.entry.snapshot.supportInbox.threads);
  });

  test(`restore handler security: changed same-count ${scope} source rejects stale confirmation before writes`, async () => {
    const f = handlerFixture(); const preview = await previewRequest(f, scope);
    if (scope === "user_manage") {
      const changed = currentUser().merchantSnapshot!; changed.revision = "changed-source-same-count";
      f.rows.set(PLATFORM_MERCHANT_SNAPSHOT_SLUG, buildPlatformMerchantSnapshotBlocks(changed));
    } else {
      const changed = inbox(); changed.threads[0].messages[0].text = "changed-source-same-count";
      f.rows.set(PLATFORM_SUPPORT_INBOX_SLUG, buildPlatformSupportInboxBlocks(changed));
    }
    const response = await f.handlers.PATCH(patchRequest({ backupId: f.entry.id, scope, action: "restore",
      confirmationToken: preview.confirmationToken, confirmEmpty: true }));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "super_admin_backup_restore_preview_stale" });
    assert.deepEqual(f.attempts, []); assert.deepEqual(f.writes, []);
  });
}

test("restore handler security: fresh authorization is required on confirm, before any reads or client creation", async () => {
  const f = handlerFixture(); const preview = await previewRequest(f, "support_messages");
  f.deny(); const readCount = f.reads.length; const clientCount = f.clientCreations;
  const response = await f.handlers.PATCH(patchRequest({ backupId: f.entry.id, scope: "support_messages", action: "restore",
    confirmationToken: preview.confirmationToken, confirmEmpty: true }));
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(f.reads.length, readCount); assert.equal(f.clientCreations, clientCount); assert.deepEqual(f.writes, []);
});

test("restore handler security: cross-origin preview and confirmation stop even before the auth dependency", async () => {
  const f = handlerFixture();
  for (const action of ["preview", "restore"]) {
    const response = await f.handlers.PATCH(patchRequest({ backupId: f.entry.id, scope: "support_messages", action,
      confirmationToken: "v1." + "a".repeat(64), confirmEmpty: true }, "https://attacker.invalid"));
    assert.equal(response.status, 403);
  }
  assert.equal(f.authorizations, 0); assert.equal(f.clientCreations, 0);
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});
