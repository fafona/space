import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bookingCompatibilityInvocation,bookingCompatibilityRollbackMetadataSql,bookingCompatibilityLegacyProbeSql} from './booking-publication-compatibility.mjs';
import {BOOKING_RELEASE_BASELINE as baseline} from './booking-publication-policy.mjs';
const target='a'.repeat(40),rootDir='/www/wwwroot/merchant-space.web-releases/aaaaaaaaaaaa-online',operation='/var/lib/faolla-online-release/'+target;
test('real metadata compatibility is pinned to exact candidate and unique owned isolated database',()=>{
 assert.equal(bookingCompatibilityInvocation({target,baseline,rootDir,operation}),'faolla_booking_compat_aaaaaaaaaaaa');
 for(const patch of [{target:'invalid'},{baseline:'b'.repeat(40)},{rootDir:'/www/wwwroot/merchant-space'},{operation:'/tmp/test'}])assert.throws(()=>bookingCompatibilityInvocation({target,baseline,rootDir,operation,...patch}));
});
test('outside metadata comparison can remove new objects only in a guarded rolled back isolated transaction',()=>{
 const sql=bookingCompatibilityRollbackMetadataSql('faolla_booking_compat_aaaaaaaaaaaa');
 assert.match(sql,/current_database\(\).*faolla_booking_compat_aaaaaaaaaaaa/s);assert.match(sql,/rollback;/);
 assert.match(sql,/drop table public.faolla_booking_mail_jobs,public.faolla_booking_atomic_commands,public.faolla_booking_atomic_control/);
 for(const value of ['postgres','faolla_booking_compat_aaaaaaaaaaaa;drop database postgres','other'])assert.throws(()=>bookingCompatibilityRollbackMetadataSql(value));
 assert.match(bookingCompatibilityLegacyProbeSql(),/rollback;/);
});
test('production commands are schema-only or read-only and success proof is emitted only after real checks',()=>{
 const source=readFileSync(new URL('./booking-publication-compatibility.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('--schema-only --no-comments --no-security-labels --no-publications --no-subscriptions'));
 assert.ok(source.indexOf("'clone_metadata_mismatch'")<source.indexOf("'/booking-compatibility.json'"));
 assert.ok(source.indexOf("'rpc_acls'")<source.indexOf("'/booking-compatibility.json'"));
 assert.doesNotMatch(source,/testOnly|input\.checks|input\.apply|drop database/i);
});
