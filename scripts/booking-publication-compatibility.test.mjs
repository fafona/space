import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bookingCompatibilityInvocation,bookingCompatibilityRollbackMetadataSql,bookingCompatibilityLegacyProbeSql,runBookingCompatibilityAdapter,
 bookingCompatibilityPreservedCloneRead,BOOKING_FAILED_CLONE_EMPTY_SQL,runBookingRegistryCompatibility,
 bookingRegistryPreservedCloneRead,BOOKING_REGISTRY_PRESERVED_ROWS_SQL} from './booking-publication-compatibility.mjs';
import {bookingDatabaseStateSql} from './booking-publication-database.mjs';
import {attendanceCompatibilityMetadataContractSql} from './attendance-production-052-compatibility.mjs';
import {BOOKING_RELEASE_BASELINE as baseline} from './booking-publication-policy.mjs';
const target='a'.repeat(40),rootDir='/www/wwwroot/merchant-space.web-releases/aaaaaaaaaaaa-online',operation='/var/lib/faolla-online-release/'+target;
test('preserved failed clone admits precisely its two real read-only queries, including the generated leading comment',()=>{
 const metadata=attendanceCompatibilityMetadataContractSql();assert.ok(metadata.startsWith('-- attendance_compatibility_metadata_contract\nbegin read only;'));
 assert.equal(bookingCompatibilityPreservedCloneRead(metadata),true);assert.equal(bookingCompatibilityPreservedCloneRead(BOOKING_FAILED_CLONE_EMPTY_SQL),true);
 for(const sql of ['begin read only;select 1;rollback;',metadata+'select 1;',BOOKING_FAILED_CLONE_EMPTY_SQL.replace('read only',''),
  "begin read only;commit;drop schema public cascade;",'-- attendance_compatibility_metadata_contract\nbegin;delete from public.pages;commit;'])
  assert.equal(bookingCompatibilityPreservedCloneRead(sql),false);
});
test('real metadata compatibility is pinned to exact candidate and unique owned isolated database',()=>{
 assert.equal(bookingCompatibilityInvocation({target,baseline,rootDir,operation}),'faolla_booking_compat_aaaaaaaaaaaa');
 for(const patch of [{target:'invalid'},{baseline:'b'.repeat(40)},{rootDir:'/www/wwwroot/merchant-space'},{operation:'/tmp/test'}])assert.throws(()=>bookingCompatibilityInvocation({target,baseline,rootDir,operation,...patch}));
});

test('registry successor preserves both failed clones by exact read-only queries, never replaying either attempt',async()=>{
 for(const sql of [attendanceCompatibilityMetadataContractSql(),bookingDatabaseStateSql,BOOKING_REGISTRY_PRESERVED_ROWS_SQL])assert.equal(bookingRegistryPreservedCloneRead(sql),true);
 for(const sql of [BOOKING_FAILED_CLONE_EMPTY_SQL,'begin read only;select 1;rollback;',BOOKING_REGISTRY_PRESERVED_ROWS_SQL+'select 1;',
  BOOKING_REGISTRY_PRESERVED_ROWS_SQL.replace('read only',''),bookingDatabaseStateSql+'commit;delete from public.pages;'])assert.equal(bookingRegistryPreservedCloneRead(sql),false);
 const source=readFileSync(new URL('./booking-publication-compatibility.mjs',import.meta.url),'utf8');
 for(const token of ['database=registryRepair?BOOKING_REGISTRY_CLONE:',"'booking-compatibility-registry'",'assertBookingRegistryContinuation({toolRevision})',
  'second_failed_clone_metadata_changed','second_failed_clone_rows_changed','bookingRegistryExtensionSupplement(metadata.sql,extensions,schemaAcl)',
  'secondFailedCloneRows=await query','validateBookingRegistry(second,manifest,{installed:true})'])assert.ok(source.includes(token),token);
 assert.ok(source.indexOf("'second_failed_clone_rows_changed'")<source.indexOf("'/booking-compatibility.json'"));
 for(const patch of [{target:'b'.repeat(40)},{runCommand:()=>{}},{checks:{fake:true}}])await assert.rejects(runBookingRegistryCompatibility({target,baseline,rootDir,operation,...patch}));
});
test('outside metadata comparison can remove new objects only in a guarded rolled back isolated transaction',()=>{
 const sql=bookingCompatibilityRollbackMetadataSql('faolla_booking_compat_aaaaaaaaaaaa');
 assert.match(sql,/current_database\(\).*faolla_booking_compat_aaaaaaaaaaaa/s);assert.match(sql,/rollback;/);
 assert.match(sql,/drop table public.faolla_booking_mail_jobs,public.faolla_booking_atomic_commands,public.faolla_booking_atomic_control/);
 for(const value of ['postgres','faolla_booking_compat_aaaaaaaaaaaa;drop database postgres','other'])assert.throws(()=>bookingCompatibilityRollbackMetadataSql(value));
 assert.match(bookingCompatibilityLegacyProbeSql(),/rollback;/);
 assert.match(bookingCompatibilityLegacyProbeSql(),/set local role service_role;[\s\S]+update public.pages[\s\S]+reset role;/);
});
test('production commands are schema-only or read-only and success proof is emitted only after real checks',()=>{
 const source=readFileSync(new URL('./booking-publication-compatibility.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('--schema-only --no-comments --no-security-labels --no-publications --no-subscriptions'));
 assert.ok(source.indexOf("'clone_metadata_mismatch'")<source.indexOf("'/booking-compatibility.json'"));
 assert.ok(source.indexOf("'rpc_acls'")<source.indexOf("'/booking-compatibility.json'"));
 assert.doesNotMatch(source,/testOnly|input\.checks|input\.apply|drop database/i);
});
test('booking adapter preserves the failed clone, exclusive attempt files and every genuine compatibility acceptance gate',async()=>{
 const source=readFileSync(new URL('./booking-publication-compatibility.mjs',import.meta.url),'utf8');
 for(const token of ["prefix=registryRepair?'booking-compatibility-registry':adapter?'booking-compatibility-adapter':'booking-compatibility'",'failed_clone_not_empty','failed_clone_changed',
  'bookingCompatibilityExtensionSupplement(metadata.sql,extensions,schemaAcl)','assertBookingCompatibilityContinuation({toolRevision})',
  'pilotCatalogUnchanged:true','productionMetadataSha256After:formalContract','outside_metadata_changed','rpc_acls','clone_not_empty'])assert.ok(source.includes(token),token);
 for(const patch of [{target:'b'.repeat(40)},{runCommand:()=>{}},{checks:{fake:true}}])await assert.rejects(runBookingCompatibilityAdapter({target,baseline,rootDir,operation,...patch}));
 assert.doesNotMatch(source,/drop database|alter role|create role|input\.adapter/i);
});
