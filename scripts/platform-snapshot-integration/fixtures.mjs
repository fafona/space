// Synthetic physical documents, deliberately not passed through app normalizers.
export const SCOPE_SLUGS = Object.freeze({
  user_manage: Object.freeze([
    "__platform_merchant_snapshot__", "__platform_merchant_snapshot_backup__",
    "__platform_merchant_snapshot_history__", "__platform_merchant_snapshot_history_backup__",
    "__platform_merchant_config_archive__", "__platform_merchant_config_archive_backup__",
  ].sort()),
  support_messages: Object.freeze([
    "__platform_support_inbox__", "__platform_support_inbox_history__", "__platform_support_inbox_history_backup__",
  ].sort()),
  backup_catalog: Object.freeze(["__platform_admin_data_backup__", "__platform_admin_data_backup_backup__"].sort()),
});
export function blocksFor(slug, label) {
  const opaque = { futureUnknownField: { preserve: [null, false, 17, "synthetic"] }, label };
  if (slug === "__platform_support_inbox_history__" || slug === "__platform_support_inbox_history_backup__") {
    return { siteId: "platform-support-inbox", updatedAt: "2026-09-08T12:00:00.000Z", entries: [], ...opaque };
  }
  if (slug.startsWith("__platform_merchant_snapshot")) {
    return [{ type: "common", props: { snapshot: [], merchantConfigHistoryBySiteId: {
      "10000000": [{ id: "synthetic-history-only", before: { retained: true }, after: { retained: false } }],
    }, ...opaque } }];
  }
  return [{ type: "common", props: { ...opaque, payload: { threads: [], audits: [], backups: [] } } }];
}
export function writesFor(scope, label) {
  if (!Object.hasOwn(SCOPE_SLUGS, scope)) throw new Error("invalid_synthetic_scope");
  return SCOPE_SLUGS[scope].map((slug) => ({ slug, blocks: blocksFor(slug, label) }));
}
