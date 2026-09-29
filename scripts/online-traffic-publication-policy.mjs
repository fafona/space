import {onlineReleaseLane} from './online-traffic-release-policy.mjs';

// Exact operational support closure reviewed for the two-version rollout.
// This separates application lane classification from source-only tooling; it
// does not authorize running cleanup, retirement, recovery or database actions.
// CI, exact-main source ownership and each operational command's guards remain
// mandatory. No source/runtime/SQL/dependency path is removed by this wrapper.
export const ONLINE_PUBLICATION_SUPPORT_FILES = Object.freeze([
  'docs/legacy-release-retention.md',
  'docs/no-maintenance-release.md',
  'docs/online-release-retention-v2.md',
  'docs/release-resource-efficiency.md',
  'docs/release-space-cleanup-20260929.md',
  'scripts/legacy-release-archive.test.mjs',
  'scripts/legacy-release-cleanup.mjs',
  'scripts/legacy-release-cleanup.test.mjs',
  'scripts/legacy-release-recovery.mjs',
  'scripts/legacy-release-recovery.test.mjs',
  'scripts/legacy-release-tree.mjs',
  'scripts/legacy-release-tree.test.mjs',
  'scripts/online-release-cache-cleanup.mjs',
  'scripts/online-release-cache-cleanup.test.mjs',
  'scripts/online-release-cache-policy.mjs',
  'scripts/online-release-cache-policy.test.mjs',
  'scripts/online-release-retention-policy.mjs',
  'scripts/online-release-retention-policy.test.mjs',
  'scripts/online-release-retention-publication.mjs',
  'scripts/online-release-retention-publication.test.mjs',
  'scripts/online-release-retention-writer.mjs',
  'scripts/online-release-retention-writer.test.mjs',
  'scripts/online-release-retention.mjs',
  'scripts/online-release-retention.test.mjs',
  'scripts/online-traffic-publication-policy.mjs',
  'scripts/online-traffic-publication-policy.test.mjs',
  'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs',
  'scripts/online-traffic-retention-integration.test.mjs',
  'scripts/prepare-online-release-tool.mjs',
  'scripts/prepare-online-release-tool.test.mjs',
]);
const support = new Set(ONLINE_PUBLICATION_SUPPORT_FILES);

export function onlinePublicationLane(files) {
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !file || /[\0\r\n\\]/.test(file)) ||
      new Set(files).size !== files.length) throw Error('online_publication_files_invalid');
  const applicationFiles = files.filter(file => !support.has(file));
  if (!applicationFiles.length) throw Error('online_publication_ops_only');
  return onlineReleaseLane(applicationFiles);
}
