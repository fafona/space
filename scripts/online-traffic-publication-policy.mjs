import {hasRecordsUiReleaseAnchor,assertRecordsUiReleaseScope,RECORDS_UI_RELEASE_LANE} from './attendance-records-ui-release-policy.mjs';
import {hasGoogleTransitionReleaseAnchor,assertGoogleTransitionReleaseScope,GOOGLE_TRANSITION_RELEASE_LANE} from './google-oauth-transition-release-policy.mjs';
import {hasScopeNavigationReleaseAnchor,assertScopeNavigationReleaseScope,SCOPE_NAV_RELEASE_LANE} from './attendance-scope-navigation-release-policy.mjs';
import {hasGoogleLoginReleaseAnchor,assertGoogleLoginReleaseScope,GOOGLE_LOGIN_RELEASE_LANE} from './google-login-release-policy.mjs';
import {hasLoginReleaseAnchor,assertLoginReleaseScope,LOGIN_RELEASE_LANE} from './merchant-login-release-policy.mjs';
import {onlineReleaseLane} from './online-traffic-release-policy.mjs';
import {hasContactWechatReleaseAnchor, assertContactWechatReleaseScope} from './contact-wechat-release-policy.mjs';
import {hasBackupReleaseAnchor,assertBackupReleaseScope,BACKUP_RELEASE_LANE} from './super-admin-backup-release-policy.mjs';

// Exact operational support closure reviewed for the two-version rollout.
// This separates application lane classification from source-only tooling; it
// does not authorize running cleanup, retirement, recovery or database actions.
// CI, exact-main source ownership and each operational command's guards remain
// mandatory. No source/runtime/SQL/dependency path is removed by this wrapper.
export const ONLINE_PUBLICATION_SUPPORT_FILES = Object.freeze([
  'docs/legacy-release-retention.md',
  'docs/no-maintenance-release.md',
  'docs/online-release-retention-v2.md',
  'docs/online-release-artifact-retention.md',
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
  'scripts/online-release-artifact-cleanup.mjs',
  'scripts/online-release-artifact-cleanup.test.mjs',
  'scripts/online-release-artifact-policy.mjs',
  'scripts/online-release-artifact-policy.test.mjs',
  'scripts/online-release-artifact-tree.mjs',
  'scripts/online-release-artifact-tree.test.mjs',
  'scripts/online-release-tool-retention.mjs',
  'scripts/online-release-tool-retention.test.mjs',
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
  if(hasRecordsUiReleaseAnchor(files)){assertRecordsUiReleaseScope(files);return RECORDS_UI_RELEASE_LANE;}
  if(hasGoogleTransitionReleaseAnchor(files)){assertGoogleTransitionReleaseScope(files);return GOOGLE_TRANSITION_RELEASE_LANE;}
  if(hasScopeNavigationReleaseAnchor(files)){assertScopeNavigationReleaseScope(files);return SCOPE_NAV_RELEASE_LANE;}
  if(hasGoogleLoginReleaseAnchor(files)){assertGoogleLoginReleaseScope(files);return GOOGLE_LOGIN_RELEASE_LANE;}
  if(hasLoginReleaseAnchor(files)){assertLoginReleaseScope(files);return LOGIN_RELEASE_LANE;}
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !file || /[\0\r\n\\]/.test(file)) ||
      new Set(files).size !== files.length) throw Error('online_publication_files_invalid');
  if(hasBackupReleaseAnchor(files)){assertBackupReleaseScope(files);return BACKUP_RELEASE_LANE;}
  // This dedicated closure is checked BEFORE generic support filtering. Its
  // historical repair paths remain source-only and do not become exemptions
  // for any older application lane or for this lane's exact two-file slice.
  if (hasContactWechatReleaseAnchor(files)) {
    assertContactWechatReleaseScope(files);
    return 'contact-wechat-code-only';
  }
  const applicationFiles = files.filter(file => !support.has(file));
  if (!applicationFiles.length) throw Error('online_publication_ops_only');
  return onlineReleaseLane(applicationFiles);
}
