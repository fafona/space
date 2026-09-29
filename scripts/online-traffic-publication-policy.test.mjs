import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ONLINE_PUBLICATION_SUPPORT_FILES, onlinePublicationLane} from './online-traffic-publication-policy.mjs';
import {onlineReleaseLane, CUSTOMER_CODE_PERFORMANCE_FILES, assertOnlineReleaseDatabaseAllowed} from './online-traffic-release-policy.mjs';

// Frozen b1304d5d..ab6 main operational closure, independent of runtime Git.
const previous = [
  'docs/legacy-release-retention.md', 'docs/no-maintenance-release.md', 'docs/release-resource-efficiency.md',
  'scripts/legacy-release-archive.test.mjs', 'scripts/legacy-release-cleanup.mjs', 'scripts/legacy-release-cleanup.test.mjs',
  'scripts/legacy-release-recovery.mjs', 'scripts/legacy-release-recovery.test.mjs',
  'scripts/legacy-release-tree.mjs', 'scripts/legacy-release-tree.test.mjs',
  'scripts/online-release-cache-cleanup.mjs', 'scripts/online-release-cache-cleanup.test.mjs',
  'scripts/online-release-cache-policy.mjs', 'scripts/online-release-cache-policy.test.mjs',
  'scripts/prepare-online-release-tool.mjs', 'scripts/prepare-online-release-tool.test.mjs',
];
const current = [
  'docs/online-release-retention-v2.md',
  'docs/release-space-cleanup-20260929.md',
  'scripts/online-release-retention-policy.mjs', 'scripts/online-release-retention-policy.test.mjs',
  'scripts/online-release-retention-publication.mjs', 'scripts/online-release-retention-publication.test.mjs',
  'scripts/online-release-retention-writer.mjs', 'scripts/online-release-retention-writer.test.mjs',
  'scripts/online-release-retention.mjs', 'scripts/online-release-retention.test.mjs',
  'scripts/online-traffic-release.mjs', 'scripts/online-traffic-release.test.mjs',
  'scripts/online-traffic-retention-integration.test.mjs',
  'scripts/online-traffic-publication-policy.mjs', 'scripts/online-traffic-publication-policy.test.mjs',
];
const artifacts = [
  'docs/online-release-artifact-retention.md',
  'scripts/online-release-artifact-cleanup.mjs', 'scripts/online-release-artifact-cleanup.test.mjs',
  'scripts/online-release-artifact-policy.mjs', 'scripts/online-release-artifact-policy.test.mjs',
  'scripts/online-release-artifact-tree.mjs', 'scripts/online-release-artifact-tree.test.mjs',
  'scripts/online-release-tool-retention.mjs', 'scripts/online-release-tool-retention.test.mjs',
];
const lanes = [
  ['traffic', 'src/components/PublicTrafficProvider.tsx'],
  ['qr-export', 'src/lib/merchantBusinessCardQrExport.ts'],
  ['performance', 'src/lib/visiblePolling.ts'],
  ['order-attention', 'src/lib/merchantOrderAttention.server.ts'],
  ['bounded-lists', 'src/lib/merchantCustomerPagination.ts'],
  ['read-index', 'src/lib/merchantCatalogReadIndex.ts'],
  ['public-catalog-batch', 'src/app/api/orders/catalog/public/batch-route-handler.ts'],
  ['runtime-performance', 'src/lib/merchantCustomerSearch.ts'],
  ['booking-merge-cpu', 'src/lib/merchantBookingPersistenceStore.ts'],
  ['customer-code-performance', 'src/lib/merchantCustomerListView.ts'],
];

test('support closure is exactly the reviewed operational files, immutable and never a runtime/schema/dependency exemption', () => {
  assert.equal(ONLINE_PUBLICATION_SUPPORT_FILES.length, 40);
  assert.deepEqual([...ONLINE_PUBLICATION_SUPPORT_FILES].sort(), [...previous, ...current, ...artifacts].sort());
  assert.equal(new Set(ONLINE_PUBLICATION_SUPPORT_FILES).size, 40);
  assert.equal(Object.isFrozen(ONLINE_PUBLICATION_SUPPORT_FILES), true);
  assert.throws(() => ONLINE_PUBLICATION_SUPPORT_FILES.push('src/lib/merchantIdentity.ts'), TypeError);
  for (const [, anchor] of lanes) assert.equal(ONLINE_PUBLICATION_SUPPORT_FILES.includes(anchor), false);
});

for (const [lane, anchor] of lanes) test(`all reviewed support preserves the original ${lane} lane and its runtime anchor`, () => {
  assert.equal(onlineReleaseLane([anchor]), lane);
  assert.equal(onlinePublicationLane([anchor]), lane);
  const files = Object.freeze([anchor, ...ONLINE_PUBLICATION_SUPPORT_FILES]);
  assert.equal(onlinePublicationLane(files), lane);
  assert.equal(onlinePublicationLane([...files].reverse()), lane);
  assert.throws(() => onlinePublicationLane(files.filter(file => file !== anchor)), /online_publication_ops_only/);
});

test('operational-only changes cannot become an application publication', () => {
  for (const files of [[], previous, current, [...ONLINE_PUBLICATION_SUPPORT_FILES],
    ...ONLINE_PUBLICATION_SUPPORT_FILES.map(file => [file])])
    assert.throws(() => onlinePublicationLane(files), /online_publication_ops_only/);
  assert.throws(() => onlineReleaseLane(previous), /online_release_scope_rejected/);
});

test('all application lists retain original rejection behavior and unknown paths are not stripped', () => {
  const unknown = ['scripts/unreviewed.mjs', 'scripts/online-release-retention-extra.mjs',
    'scripts/online-release-retention-policy.mjs.backup', './scripts/online-release-retention-policy.mjs',
    'docs/unknown-runbook.md', 'src/lib/merchantIdentity.ts', 'src/lib/merchantAuth.ts',
    'scripts/supabase-migrations/202609290061_unreviewed.sql', 'package.json', 'package-lock.json',
    '.github/workflows/deploy.yml'];
  for (const [, anchor] of lanes) for (const file of unknown) {
    let original;
    try {onlineReleaseLane([anchor, file]);} catch (error) {original = error.message;}
    assert.equal(typeof original, 'string', `${anchor}: ${file}`);
    assert.throws(() => onlinePublicationLane([anchor, file, ...ONLINE_PUBLICATION_SUPPORT_FILES]),
      error => error.message === original);
  }
});

test('the complete customer code lane remains no-database despite inert migration source', () => {
  const files = [...new Set([...CUSTOMER_CODE_PERFORMANCE_FILES, ...ONLINE_PUBLICATION_SUPPORT_FILES])];
  assert.equal(onlinePublicationLane(files), 'customer-code-performance');
  assert.throws(() => assertOnlineReleaseDatabaseAllowed(onlinePublicationLane(files)), /database/);
  const polluted = [...files, 'src/app/api/admin/delete-merchant/route.ts'];
  assert.throws(() => onlinePublicationLane(polluted), /customer_code_performance_release_scope_rejected/);
});

test('conflicting original lane anchors are never silently removed or reclassified', () => {
  for (const anchors of [['src/lib/merchantCustomerListView.ts', 'src/lib/merchantBookingPersistenceStore.ts'],
    ['src/lib/merchantBookingPersistenceStore.ts', 'src/lib/merchantCustomerSearch.ts'],
    ['src/lib/merchantBusinessCardQrExport.ts', 'src/lib/merchantCustomerPagination.ts']]) {
    let original; try {onlineReleaseLane(anchors);} catch (error) {original = error.message;}
    assert.equal(typeof original, 'string');
    assert.throws(() => onlinePublicationLane([...anchors, ...ONLINE_PUBLICATION_SUPPORT_FILES]), error => error.message === original);
  }
});

test('invalid path inventory is rejected without normalizing aliases into the allowlist', () => {
  for (const files of [null, {}, 'src/lib/visiblePolling.ts', [null], [''], ['x\n'], ['x\0'],
    ['scripts\\online-release-retention.mjs'], ['src/lib/visiblePolling.ts', 'src/lib/visiblePolling.ts']])
    assert.throws(() => onlinePublicationLane(files), /online_publication_files_invalid/);
});

test('the complete historical lane policy remains byte-for-byte unchanged', () => {
  const source = readFileSync(new URL('./online-traffic-release-policy.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), 'e1d1b213ea0f7335262c93fa3739622df4a080348c995f44b77cee62067e9eee');
});
