import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  CONTACT_WECHAT_RELEASE_LANE, CONTACT_WECHAT_RELEASE_BASELINE,
  CONTACT_WECHAT_APPROVED_TOOL_REVISION, CONTACT_WECHAT_APPLICATION_FILES,
  CONTACT_WECHAT_APPROVED_SUPPORT_FILES, CONTACT_WECHAT_APPROVED_SUPPORT_SHA256,
  CONTACT_WECHAT_RELEASE_TOOL_FILES, hasContactWechatReleaseAnchor,
  assertContactWechatReleaseScope, assertContactWechatApprovedClosure,
} from './contact-wechat-release-policy.mjs';
import {
  onlineReleaseLane, onlineReleaseStageStatus, onlineReleaseActivationStatus,
  assertOnlineReleaseDatabaseAllowed, onlineReleaseMigrationTarget,
  assertPendingOnlineReleaseMigrations, assertOnlineTrafficScope,
} from './online-traffic-release-policy.mjs';
import {onlinePublicationLane, ONLINE_PUBLICATION_SUPPORT_FILES} from './online-traffic-publication-policy.mjs';

const full = [...CONTACT_WECHAT_APPLICATION_FILES, ...CONTACT_WECHAT_APPROVED_SUPPORT_FILES, ...CONTACT_WECHAT_RELEASE_TOOL_FILES];
const proof = () => ({baseline: CONTACT_WECHAT_RELEASE_BASELINE, files: [...full],
  sourceSha256ByFile: {...CONTACT_WECHAT_APPROVED_SUPPORT_SHA256}});
const historical = [
  'docs/attendance-staged-tool-repair-20261010.md',
  'scripts/attendance-extension-metadata.mjs', 'scripts/attendance-extension-metadata.test.mjs',
  'scripts/attendance-production-052-compatibility.mjs', 'scripts/attendance-production-052-compatibility.test.mjs',
  'scripts/attendance-production-database-migrations.mjs', 'scripts/attendance-production-database-migrations.test.mjs',
  'scripts/attendance-production-multiphase-guards-native.mjs', 'scripts/attendance-production-multiphase-guards-native.test.mjs',
  'scripts/attendance-staged-tool-repair-policy.mjs', 'scripts/attendance-staged-tool-repair-policy.test.mjs',
  'scripts/attendance-staged-tool-repair.mjs', 'scripts/attendance-staged-tool-repair.test.mjs',
  'scripts/online-unpublished-candidate.test.mjs',
  'scripts/prepare-online-release-tool.mjs', 'scripts/prepare-online-release-tool.test.mjs',
  'scripts/test-helpers/attendance-extension-metadata.mjs',
];

test('contact-WeChat is a separately frozen exact two-application-file lane, not a traffic or attendance expansion', () => {
  assert.equal(CONTACT_WECHAT_RELEASE_LANE, 'contact-wechat-code-only');
  assert.equal(CONTACT_WECHAT_RELEASE_BASELINE, 'a535a308e21f121e7cf410a6f7d84c974eb370a6');
  assert.equal(CONTACT_WECHAT_APPROVED_TOOL_REVISION, '4e482a849bc9d8668d00b6da1895d09414fa5d34');
  assert.deepEqual(CONTACT_WECHAT_APPLICATION_FILES, ['src/app/card/[card]/route.ts', 'src/lib/merchantBusinessCardWebsiteRoute.test.ts']);
  assert.deepEqual(CONTACT_WECHAT_APPROVED_SUPPORT_FILES, historical);
  assert.equal(new Set(full).size, full.length);
  for (const value of [CONTACT_WECHAT_APPLICATION_FILES, CONTACT_WECHAT_APPROVED_SUPPORT_FILES,
    CONTACT_WECHAT_APPROVED_SUPPORT_SHA256, CONTACT_WECHAT_RELEASE_TOOL_FILES]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => assertOnlineTrafficScope(CONTACT_WECHAT_APPLICATION_FILES), /online_release_scope_rejected/);
  assert.equal(onlineReleaseLane(['src/app/card/[card]/route.ts']), 'traffic', 'the historical route-only traffic classifier is unchanged');
  for (const files of [CONTACT_WECHAT_APPLICATION_FILES, full, [...full].reverse()]) {
    assert.doesNotThrow(() => assertContactWechatReleaseScope(files));
    assert.equal(onlineReleaseLane(files), CONTACT_WECHAT_RELEASE_LANE);
    assert.equal(onlinePublicationLane(files), CONTACT_WECHAT_RELEASE_LANE);
  }
});

test('both application files are mandatory and aliases, empty inventories and duplicate paths never normalize into scope', () => {
  for (const files of [undefined, null, {}, 'src/app/card/[card]/route.ts', [],
    ...CONTACT_WECHAT_APPLICATION_FILES.map(file => [file]), CONTACT_WECHAT_APPROVED_SUPPORT_FILES, CONTACT_WECHAT_RELEASE_TOOL_FILES,
    [...full, full[0]], [...full, null], [...full, './src/app/card/[card]/route.ts'],
    [...full, 'src\\app\\card\\[card]\\route.ts'], [...full, 'src/app/card/[card]/route.ts\n']]) {
    assert.throws(() => assertContactWechatReleaseScope(files), /contact_wechat_code_only_scope_rejected/);
  }
  assert.equal(hasContactWechatReleaseAnchor(null), false);
  assert.equal(hasContactWechatReleaseAnchor(CONTACT_WECHAT_APPLICATION_FILES), true);
  assert.equal(hasContactWechatReleaseAnchor(CONTACT_WECHAT_APPROVED_SUPPORT_FILES), false);
});

test('unrelated runtime, vCard endpoint, data writers, dependencies, SQL and generic support cannot be swallowed', () => {
  const poison = [
    'src/app/card/[card]/contact/route.ts', 'src/app/card/[card]/image/route.ts',
    'src/lib/merchantBusinessCardDestination.ts', 'src/lib/merchantAttendance.ts',
    'src/lib/merchantCustomerListView.ts', 'src/lib/visiblePolling.ts',
    'src/app/api/orders/route-handler.ts', 'src/lib/merchantEnterpriseAuth.server.ts',
    'src/instrumentation.ts', 'src/middleware.ts', '.env.example', 'package.json', 'package-lock.json',
    'scripts/supabase-migrations/202610090210_merchant_attendance.sql',
    'scripts/attendance-production-052-compatibility-extra.mjs', 'docs/unreviewed.md',
    'scripts/contact-wechat-release-probe-transport-extra.mjs',
    'scripts/online-release-retention-policy.mjs', 'docs/no-maintenance-release.md',
  ];
  for (const file of poison) for (const files of [[...full, file], [...CONTACT_WECHAT_APPLICATION_FILES, file]]) {
    assert.throws(() => assertContactWechatReleaseScope(files), /contact_wechat_code_only_scope_rejected/, file);
    assert.throws(() => onlinePublicationLane(files), /contact_wechat_code_only_scope_rejected/, file);
    assert.throws(() => onlineReleaseLane(files), /contact_wechat_code_only_scope_rejected/, file);
  }
  // The two prepare-tool paths already belonged to the original generic support
  // list; no other historical repair or new lane file is added to that list.
  for (const file of [...CONTACT_WECHAT_APPROVED_SUPPORT_FILES, ...CONTACT_WECHAT_RELEASE_TOOL_FILES]) {
    if (['scripts/prepare-online-release-tool.mjs', 'scripts/prepare-online-release-tool.test.mjs',
      'scripts/online-traffic-release.mjs', 'scripts/online-traffic-release.test.mjs',
      'scripts/online-traffic-publication-policy.mjs', 'scripts/online-traffic-publication-policy.test.mjs'].includes(file)) continue;
    assert.equal(ONLINE_PUBLICATION_SUPPORT_FILES.includes(file), false, file);
  }
});

test('the exact 17-file historical pin literals and current source bytes match without requiring Git history in CI', () => {
  // Independently recorded after read-only Git-object verification of
  // a535a308..4e482a84. Shallow CI checks these literal pins and every present
  // source byte; it never fetches history or conditionally skips this proof.
  assert.deepEqual(Object.keys(CONTACT_WECHAT_APPROVED_SUPPORT_SHA256), historical);
  assert.equal(createHash('sha256').update(JSON.stringify(CONTACT_WECHAT_APPROVED_SUPPORT_SHA256)).digest('hex'),
    'f426864b0816faa4f6a31760f3255483b7374cc141e040a3706d8dcc8a373d88');
  for (const file of historical) {
    const bytes = readFileSync(new URL('../' + file, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), CONTACT_WECHAT_APPROVED_SUPPORT_SHA256[file], file);
  }
});

test('source proof requires the fixed live baseline, all 17 exact unchanged support blobs and no extra hash-map keys', () => {
  assert.equal(assertContactWechatApprovedClosure(proof()), CONTACT_WECHAT_RELEASE_LANE);
  assert.throws(() => assertContactWechatApprovedClosure({...proof(), baseline: CONTACT_WECHAT_APPROVED_TOOL_REVISION}), /baseline_invalid/);
  assert.throws(() => assertContactWechatApprovedClosure({...proof(), baseline: 'b'.repeat(40)}), /baseline_invalid/);
  for (const file of historical) {
    const missingFile = proof(); missingFile.files = missingFile.files.filter(path => path !== file);
    assert.throws(() => assertContactWechatApprovedClosure(missingFile), /approved_support_changed/, file);
    const missingHash = proof(); delete missingHash.sourceSha256ByFile[file];
    assert.throws(() => assertContactWechatApprovedClosure(missingHash), /approved_support_changed/, file);
    const changed = proof(); changed.sourceSha256ByFile[file] = '0'.repeat(64);
    assert.throws(() => assertContactWechatApprovedClosure(changed), /approved_support_changed/, file);
  }
  const extra = proof(); extra.sourceSha256ByFile['package-lock.json'] = 'a'.repeat(64);
  assert.throws(() => assertContactWechatApprovedClosure(extra), /approved_support_changed/);
  const inherited = Object.assign(Object.create(CONTACT_WECHAT_APPROVED_SUPPORT_SHA256),
    Object.fromEntries(historical.map((_, index) => [`unreviewed-${index}`, 'a'.repeat(64)])));
  assert.throws(() => assertContactWechatApprovedClosure({...proof(), sourceSha256ByFile: inherited}), /approved_support_changed/);
  for (const sourceSha256ByFile of [null, [], 'invalid', undefined])
    assert.throws(() => assertContactWechatApprovedClosure({...proof(), sourceSha256ByFile}), /approved_support_changed/);
});

test('no-database readiness is explicit and every database interface denies before accessing migration arguments', () => {
  assert.equal(onlineReleaseStageStatus(CONTACT_WECHAT_RELEASE_LANE), 'ready-no-database');
  assert.equal(onlineReleaseActivationStatus(CONTACT_WECHAT_RELEASE_LANE), 'ready-no-database');
  assert.throws(() => assertOnlineReleaseDatabaseAllowed(CONTACT_WECHAT_RELEASE_LANE), /contact_wechat_code_only_database_forbidden/);
  assert.throws(() => onlineReleaseMigrationTarget(CONTACT_WECHAT_RELEASE_LANE), /contact_wechat_code_only_database_forbidden/);
  const poisonous = new Proxy([], {get() { assert.fail('database denial must precede migration input reads'); }});
  for (const pending of [undefined, [], [{version: '202610090210'}], poisonous])
    assert.throws(() => assertPendingOnlineReleaseMigrations(CONTACT_WECHAT_RELEASE_LANE, pending), /contact_wechat_code_only_database_forbidden/);
  for (const lane of ['traffic', 'order-attention', 'attendance']) {
    assert.equal(onlineReleaseStageStatus(lane), 'staged');
    assert.equal(onlineReleaseActivationStatus(lane), 'database-ready');
    assert.doesNotThrow(() => assertOnlineReleaseDatabaseAllowed(lane));
  }
});
