import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bookingRegistryExtensionSupplement as adapt,BOOKING_REGISTRY_CLONE,BOOKING_COMPATIBILITY_PILOT_SYSTEM} from './booking-registry-extension.mjs';
import {attendanceExtensionMetadataSupplement as original} from './attendance-extension-metadata.mjs';
import {bookingCompatibilityExtensionSupplement as predecessor} from './booking-compatibility-extension.mjs';
import {syntheticAttendanceGraphqlInitialAclMetadata,syntheticAttendanceGraphqlInitialSchemaAclMetadata,syntheticAttendanceExtensionDump as dump} from './test-helpers/attendance-extension-metadata.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fixture=()=>({snapshot:syntheticAttendanceGraphqlInitialAclMetadata(),schemas:syntheticAttendanceGraphqlInitialSchemaAclMetadata()});

test('the third clone retains every predecessor ACL byte except its separately fixed database identity',()=>{
 const f=fixture(),old=predecessor(dump,f.snapshot,f.schemas),next=adapt(dump,f.snapshot,f.schemas);
 assert.deepEqual(next,{...old,sql:old.sql.replaceAll('faolla_booking_compat_b274ad615550',BOOKING_REGISTRY_CLONE),
  supplementSql:old.supplementSql.replaceAll('faolla_booking_compat_b274ad615550',BOOKING_REGISTRY_CLONE),
  supplementSha256:hash(old.supplementSql.replaceAll('faolla_booking_compat_b274ad615550',BOOKING_REGISTRY_CLONE))});
});
test('independent booking ACL guard binds ONE new database, actual pilot system, PG15 and both identities',()=>{
 const f=fixture(),value=adapt(dump,f.snapshot,f.schemas),sql=value.supplementSql;
 for(const pin of [BOOKING_REGISTRY_CLONE,BOOKING_COMPATIBILITY_PILOT_SYSTEM,"current_user<>'supabase_admin'","session_user<>'supabase_admin'","current_setting('server_version_num')<>'150008'",'pg_control_system()'])assert.ok(sql.includes(pin),pin);
 assert.doesNotMatch(sql,/faolla_attendance_compat_|faolla_booking_compat_f274ad615550/);
 assert.equal(value.operations.length,12);assert.equal(value.operations.filter(x=>x.operation==='booking-clone-restore-actual-initial-acl').length,9);
 assert.equal(value.supplementSha256,hash(sql));
 const firstGrant=sql.indexOf('\n  grant '),lastCheck=sql.lastIndexOf("raise exception 'booking_extension_acl_prestate'");
 assert.ok(firstGrant>lastCheck&&lastCheck>0);assert.equal((sql.match(/raise exception 'booking_extension_acl_prestate'/g)||[]).length,9);
 assert.equal((sql.match(/raise exception 'booking_extension_member'/g)||[]).length,7);
 assert.match(sql,/grant USAGE on schema graphql to postgres with grant option granted by supabase_admin/);
 assert.match(sql,/grant SELECT, UPDATE on sequence graphql.seq_schema_version to supabase_admin granted by supabase_admin/);
 assert.match(sql,/booking_extension_schema_poststate/);assert.match(sql,/attendance_extension_full_metadata_mismatch/);
 assert.doesNotMatch(sql,/create role|alter role|reassign owned|security definer|drop |truncate |pg_authid|password|select net\.http_/i);
});
test('all base dump bytes, shared wrapper/net operations and full final guard remain intact',()=>{
 const f=fixture(),base=original(dump,f.snapshot),value=adapt(dump,f.snapshot,f.schemas);
 const start=value.sql.indexOf('\n-- Booking-only exact initial ACL adaptation;'),end=value.sql.indexOf('\n-- Compare every actual extension member',start);
 assert.ok(start>0&&end>start);assert.equal(value.sql.slice(0,start)+value.sql.slice(end),base.sql);
 const initial=structuredClone(f);adapt(dump,f.snapshot,f.schemas);assert.deepEqual(f,initial);
 assert.deepEqual(value.operations.slice(0,3),base.operations);assert.equal(value.sourceSha256,base.sourceSha256);
});
test('old attendance-specific ACL identity and shared default output are not widened',()=>{
 const f=fixture(),before=original(dump,f.snapshot);
 adapt(dump,f.snapshot,f.schemas);assert.deepEqual(original(dump,f.snapshot),before);
 const old=original(dump,f.snapshot,{restoreGraphqlInitialAcl:true,restoreGraphqlInitialSchemaAcl:true},f.schemas);
 assert.equal((old.sql.match(/current_database\(\)<>'faolla_attendance_compat_a535a308e21f'/g)||[]).length,2);
 assert.ok(!old.sql.includes(BOOKING_REGISTRY_CLONE));
 const source=readFileSync(new URL('./attendance-extension-metadata.mjs',import.meta.url),'utf8');
 assert.ok(!source.includes('booking-compatibility'));
});
test('unknown, partial, widened, owner-changed or missing object ACL inputs fail before SQL delivery',()=>{
 const changes=[f=>f.snapshot[0].version='1.5.12',f=>f.snapshot[0].owner='postgres',
  f=>f.snapshot[0].routines.find(x=>x.signature==='graphql.resolve(text,jsonb,text,jsonb)').acl.pop(),
  f=>f.snapshot[0].routines.find(x=>x.signature==='graphql.resolve(text,jsonb,text,jsonb)').owner='postgres',
  f=>f.snapshot[0].members.find(x=>x.identity==='graphql.seq_schema_version').metadata.acl[0].grantable=true,
  f=>f.schemas.pop(),f=>f.schemas[0].owner='postgres',f=>f.schemas[1].acl[0].grantee='unknown',
  f=>f.schemas[0].initialAcl[0].grantable=true];
 for(const change of changes){const f=fixture();change(f);assert.throws(()=>adapt(dump,f.snapshot,f.schemas));}
});
