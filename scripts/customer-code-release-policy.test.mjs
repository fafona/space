import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import test from 'node:test';
import {
  CUSTOMER_CODE_PERFORMANCE_FILES,
  CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS,
  onlineReleaseLane,
  onlineReleaseStageStatus,
  onlineReleaseActivationStatus,
  assertOnlineReleaseDatabaseAllowed,
  onlineReleaseMigrationTarget,
  assertPendingOnlineReleaseMigrations,
} from './online-traffic-release-policy.mjs';

const anchor='src/lib/merchantCustomerListView.ts';
const lane='customer-code-performance';
const migration='scripts/supabase-migrations/202609280060_customer_membership_profile_projection.sql';
const source=readFileSync(new URL('./online-traffic-release-policy.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const sha=value=>createHash('sha256').update(value).digest('hex');

test('customer lane admits exactly the reviewed 55-path live-to-candidate closure and two new release files',()=>{
  assert.ok(Object.isFrozen(CUSTOMER_CODE_PERFORMANCE_FILES));
  assert.equal(CUSTOMER_CODE_PERFORMANCE_FILES.length,57);
  assert.equal(new Set(CUSTOMER_CODE_PERFORMANCE_FILES).size,57);
  // Independently derived from git diff 57dbac3a..426dd705 plus precisely this
  // policy test and docs/customer-code-release-2026-09-28.md. No Git is needed
  // while testing a copied/checked-out release candidate.
  assert.equal(sha(JSON.stringify([...CUSTOMER_CODE_PERFORMANCE_FILES].sort())),
    '15e1fe7bc650f277537a38877dbbfa6bea67e5893f019aed963b2b48b7d918f4');
  assert.equal(onlineReleaseLane([...CUSTOMER_CODE_PERFORMANCE_FILES]),lane);
  assert.equal(onlineReleaseLane([...CUSTOMER_CODE_PERFORMANCE_FILES].reverse()),lane);
  for(const file of CUSTOMER_CODE_PERFORMANCE_FILES){
    assert.equal(onlineReleaseLane(file===anchor?[anchor]:[anchor,file]),lane,file);
  }
});

test('new anchor precedes the old customer-search anchor without widening older lanes',()=>{
  assert.equal(onlineReleaseLane([anchor,'src/lib/merchantCustomerSearch.ts']),lane);
  assert.equal(onlineReleaseLane(['src/lib/merchantCustomerSearch.ts']),'runtime-performance');
  assert.equal(onlineReleaseLane(['src/lib/merchantBookingPersistenceStore.ts']),'booking-merge-cpu');
  assert.throws(()=>onlineReleaseLane(['src/lib/merchantCustomerSearch.ts',migration]),/runtime_performance_release_scope_rejected/);
  assert.throws(()=>onlineReleaseLane(['src/lib/merchantBookingPersistenceStore.ts',migration]),/booking_merge_cpu_release_scope_rejected/);
  assert.throws(()=>onlineReleaseLane(CUSTOMER_CODE_PERFORMANCE_FILES.filter(file=>file!==anchor)),/runtime_performance_release_scope_rejected/);
  assert.throws(()=>onlineReleaseLane([]),/online_release_scope_rejected/);
});

test('adjacent authority, authentication, worker, dependency, workflow and unrelated SQL changes fail closed',()=>{
  const rejected=[
    'src/app/api/bookings/route.ts','src/app/api/orders/route-handler.ts','src/app/api/memberships/route.ts',
    'src/lib/merchantBookings.server.ts','src/lib/merchantBookingPersistenceStore.ts',
    'src/lib/merchantBookingCreateAdmission.server.ts','src/lib/merchantBookingPolicyPreparationCandidate.server.ts',
    'src/lib/merchantBookingSemanticRecoveryCandidate.server.ts','src/lib/merchantCustomerQueryStore.server.ts',
    'src/lib/personalAccountSession.server.ts','src/lib/ordinaryAccountAuthorization.server.ts',
    'src/lib/serverMerchantSession.ts','src/lib/superAdminServer.ts','src/lib/merchantIdentity.ts',
    'src/lib/merchantMemberships.ts','src/lib/merchantOrders.ts','src/lib/merchantOrderMembershipTransaction.server.ts',
    'src/lib/merchantOutboxWorker.server.ts','scripts/run-outbox-v1-once.test.ts',
    'scripts/online-release-retirement-policy.mjs','scripts/online-release-rolling-policy.mjs',
    'scripts/online-release-rolling.mjs','scripts/online-static-recovery.mjs',
    'scripts/apply-production-database-migrations.mjs','scripts/deploy-production.sh',
    '.github/workflows/ci.yml','.github/workflows/database-migrate.yml','scripts/run-ci-tests.mjs',
    'package.json','package-lock.json','.env.local','PROJECT_RULES.md',
    'scripts/supabase-migrations/202609280059_booking_authority.sql',
    'scripts/supabase-migrations/202609280061_customer_projection.sql',
    'scripts/supabase-migrations/202609280060_different_projection.sql',
    'scripts/supabase-migrations/202609080045_order_membership_atomic_mutation.sql',
    'scripts/supabase-init.sql','docs/unreviewed-release.md',
  ];
  for(const file of rejected){
    assert.throws(()=>onlineReleaseLane([...CUSTOMER_CODE_PERFORMANCE_FILES,file]),
      /customer_code_performance_release_scope_rejected/,file);
  }
});

test('path aliases and lookalikes cannot expand the exact source closure',()=>{
  for(const file of ['./'+anchor,anchor.replaceAll('/','\\'),anchor.toUpperCase(),anchor+' ',
    'src/lib/../lib/merchantCustomerListView.ts',migration+'.bak',migration.replace('.sql','.SQL'),
    '/'+anchor,'docs/customer-code-release-2026-09-29.md']){
    assert.throws(()=>onlineReleaseLane([anchor,file]),/customer_code_performance_release_scope_rejected/,file);
  }
});

test('060 is inert source: both stage states are no-database and every database helper refuses the lane',()=>{
  assert.equal(onlineReleaseStageStatus(lane),'ready-no-database');
  assert.equal(onlineReleaseActivationStatus(lane),'ready-no-database');
  assert.deepEqual(CUSTOMER_CODE_PERFORMANCE_FILES.filter(file=>file.endsWith('.sql')),[migration]);
  assert.throws(()=>assertOnlineReleaseDatabaseAllowed(lane),/customer_code_performance_database_forbidden/);
  assert.throws(()=>onlineReleaseMigrationTarget(lane),/customer_code_performance_database_forbidden/);
  const poisonous=new Proxy([],{get(){assert.fail('database denial must precede reading pending migrations');}});
  for(const pending of [undefined,[],[{version:'202609280060',name:'customer_membership_profile_projection',fileName:migration}],poisonous]){
    assert.throws(()=>assertPendingOnlineReleaseMigrations(lane,pending),/customer_code_performance_database_forbidden/);
  }
});

test('precisely reversing the separately added contact-WeChat, attendance and customer lanes leaves the complete prior policy byte-identical',()=>{
  let original=source;
  const contactInsertions=["import {hasContactWechatReleaseAnchor, assertContactWechatReleaseScope} from './contact-wechat-release-policy.mjs';\n",
    "  if(hasContactWechatReleaseAnchor(files)){assertContactWechatReleaseScope(files);return 'contact-wechat-code-only';}\n",
    "  if(lane==='contact-wechat-code-only')return true;\n",
    "  if(lane==='contact-wechat-code-only')throw Error('contact_wechat_code_only_database_forbidden');\n"];
  for(const insertion of contactInsertions){assert.equal(original.split(insertion).length,2);original=original.replace(insertion,'');}
  // The attendance lane is separately verified against the complete later
  // e1d1b213 policy in online-traffic-publication-policy.test.mjs. Remove only
  // its exact insertions here before reconstructing the older customer base;
  // neither historical SHA is repinned or inferred from the current file.
  const attendanceInsertions=["import {readFileSync} from 'node:fs';\n\n",
    "  if(files.includes('src/lib/merchantAttendance.ts')){assertAttendanceReleaseScope(files);return 'attendance';}\n",
    "  if(lane==='attendance')return false;\n","  if(lane==='attendance')return;\n"];
  for(const insertion of attendanceInsertions){assert.equal(original.split(insertion).length,2);original=original.replace(insertion,'');}
  const managerInsertion="  if(lane==='attendance')throw Error('attendance_database_manager_required');\n";
  assert.equal(original.split(managerInsertion).length,3);original=original.replaceAll(managerInsertion,'');
  const removeRegion=(start,end)=>{
    assert.equal(original.split(start).length,2,start);
    const from=original.indexOf(start),to=original.indexOf(end,from);
    assert.ok(to>from,end);
    original=original.slice(0,from)+original.slice(to);
  };
  removeRegion('// 2026-09-28: separately authorized customer code-only performance release.','export function onlineReleaseLane(files) {');
  const laneBranch="  if (files.includes(customerCodePerformanceAnchor)) {\n    if (files.some(file => !customerCodePerformanceFiles.has(file))) throw Error('customer_code_performance_release_scope_rejected');\n    return 'customer-code-performance';\n  }\n";
  for(const insertion of [laneBranch,"  if (lane === 'customer-code-performance') return true;\n",
    "  if (lane === 'customer-code-performance') throw Error('customer_code_performance_database_forbidden');\n"]){
    assert.equal(original.split(insertion).length,2);
    original=original.replace(insertion,'');
  }
  removeRegion('// Pinned application/compatibility and pure tooling tests.','// This one failed pre-build attempt retains its original application identity.');
  // Complete 426dd705 policy SHA, independently read from its Git object.
  assert.equal(sha(original),'fc12e0dd782ff1ebc55fb9e21615b51e3b9ab3a7a52b304c34df47cd5d9ff2e5');
});

test('focused tests are frozen, exact, present once and never execute the native PostgreSQL entrypoint',()=>{
  assert.ok(Object.isFrozen(CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS));
  assert.equal(CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS.length,81);
  assert.equal(new Set(CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS).size,81);
  assert.equal(sha(JSON.stringify(CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS)),
    'cf30ea3ae5aa4aa12bebc7ec593f6b8a312424c8ae764f7561c5ef20234e4ee3');
  for(const file of CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS){
    assert.match(file,/\.test\.(?:ts|mjs)$/);
    assert.ok(statSync(new URL('../'+file,import.meta.url)).isFile(),file);
  }
  assert.ok(CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS.includes('scripts/customer-membership-profile-projection-native.unit.test.mjs'));
  assert.ok(!CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS.includes('scripts/customer-membership-profile-projection-native.mjs'));
  for(const common of ['src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts',
    'scripts/online-traffic-release.test.mjs']){
    assert.ok(!CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS.includes(common),'controller appends its existing common gate only once');
  }
});

test('focused set retains every file of the recorded 717-test selection plus the explicit safety contracts',()=>{
  const original=readdirSync(new URL('../src/lib/',import.meta.url))
    .filter(file=>/^merchant(?:Order|Customer|Membership|Bookings).*\.test\.ts$/.test(file))
    .map(file=>'src/lib/'+file);
  original.push(
    'src/app/api/merchant-customers/route.test.ts','src/app/api/merchant-customers/route.booking-merge.test.ts',
    'src/app/api/orders/route.test.ts','src/app/api/orders/catalog/route.test.ts','src/app/api/orders/export/route.test.ts',
    'src/components/admin/MerchantCustomerManager.contract.test.ts','src/components/admin/MerchantCustomerManager.behavior.test.ts',
    'scripts/fixtures/merchantCustomerGetBaselineHarness.test.ts',
    'scripts/benchmark-merchant-customer-order-normalization.test.mjs','scripts/benchmark-merchant-customer-membership-profile.test.mjs',
    'scripts/benchmark-merchant-customer-get.test.mjs','scripts/benchmark-merchant-customer-reducer.test.mjs',
    'scripts/customer-membership-profile-projection-migration.test.mjs','scripts/customer-membership-profile-projection-native.unit.test.mjs',
  );
  assert.equal(original.length,72);
  const extra=[
    'src/lib/merchantBookingPersistenceStore.test.ts','src/lib/merchantBookingMergeParity.test.ts',
    'scripts/check-release-baseline.test.mjs','scripts/online-static-recovery.test.mjs',
    'scripts/run-ci-tests.test.mjs','scripts/ci-workflow-contract.test.mjs',
    'scripts/production-maintenance-pm2-connection.test.mjs','scripts/repair-startup.test.mjs',
    'scripts/customer-code-release-policy.test.mjs',
  ];
  assert.deepEqual([...CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS].sort(),[...original,...extra].sort());
});
