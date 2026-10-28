import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assertBookingRuntimeLinkFacts,observeBookingRuntimeCache,readReviewedBookingRuntimeCache,BOOKING_SHARED_RUNTIME} from './release-toolchain-legacy-runtime.mjs';
import {BOOKING_HANDOFF_LEGACY_DIRECTORY as LEGACY} from './booking-handoff-policy.mjs';
import {FULL_REHEARSAL_SOURCES} from './release-toolchain-native-inventory.mjs';
const directory=()=>({dev:1,ino:2,uid:0,gid:0,mode:0o40755,nlink:2,size:4096,mtimeMs:1,ctimeMs:1,directory:true,symbolic:false});
function fixture(){return {logical:LEGACY+'/.runtime',target:BOOKING_SHARED_RUNTIME,resolved:BOOKING_SHARED_RUNTIME,link:{dev:1,ino:3,uid:0,gid:0,mode:0o120777,nlink:1,size:64,mtimeMs:1,ctimeMs:1,symbolic:true},parent:directory(),targetDirectory:directory()};}
test('only the fixed root-owned legacy data link and strictly owned target are recognized',()=>{
 assert.equal(assertBookingRuntimeLinkFacts(fixture()),true);
 for(const mutate of [v=>v.logical='/other/.runtime',v=>v.target='/tmp/redirect',v=>v.resolved='/tmp/redirect',v=>v.link.uid=1000,v=>v.link.nlink=2,v=>v.link.symbolic=false,
  v=>v.parent.uid=1000,v=>v.parent.mode|=0o020,v=>v.parent.symbolic=true,v=>v.targetDirectory.uid=1000,v=>v.targetDirectory.mode|=0o002,v=>v.targetDirectory.directory=false]){
  const f=fixture();mutate(f);assert.throws(()=>assertBookingRuntimeLinkFacts(f));
 }
});
test('link, target and parent identity are observed before and after the strict resolved-file read',()=>{
 const events=[],text='{"version":1,"records":[]}\n';
 assert.equal(observeBookingRuntimeCache('merchant-bookings.json',{capture:()=>{events.push('observe');return fixture();},readResolved:name=>{events.push('read');assert.equal(name,'merchant-bookings.json');return text;}}),text);
 assert.deepEqual(events,['observe','read','observe']);
 for(const key of ['link','parent','targetDirectory'])for(const field of ['ino','dev','mtimeMs','ctimeMs']){
  let count=0;assert.throws(()=>observeBookingRuntimeCache('merchant-bookings.json',{capture:()=>{const v=fixture();if(++count===2)v[key][field]++;return v;},readResolved:()=>text}));
 }
 let count=0;assert.throws(()=>observeBookingRuntimeCache('merchant-bookings.json',{capture:()=>{const v=fixture();if(++count===2)v.target='/tmp/swapped';return v;},readResolved:()=>text}));
});
test('no other runtime file, caller path, authority token or owner override is accepted',()=>{
 for(const file of ['../merchant-bookings.json','/etc/passwd','merchant-bookings.json\0','other.json'])assert.throws(()=>observeBookingRuntimeCache(file,{capture:()=>assert.fail(),readResolved:()=>assert.fail()}));
 assert.throws(()=>readReviewedBookingRuntimeCache('merchant-bookings.json','a'.repeat(40)),/source_changed/);
 assert.ok(FULL_REHEARSAL_SOURCES.includes('release-toolchain-legacy-runtime.mjs'));
});
test('the original full JSON equality and legacy strict path reader remain, with no cache/data normalization or writes',()=>{
 const source=readFileSync(new URL('./booking-handoff-execution.mjs',import.meta.url),'utf8'),adapter=readFileSync(new URL('./release-toolchain-legacy-runtime.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("toolRevision&&reviewedBookingExecution(toolRevision)?readReviewedBookingRuntimeCache(file,toolRevision):read(legacy.legacy.cwd+'/.runtime/'+file,{privateMode:false})"));
 assert.ok(source.includes("equal(JSON.parse(text),row(name).blocks,'legacy_cache_changed')"));
 assert.ok(adapter.includes("bookingHostRead(BOOKING_SHARED_RUNTIME+'/'+file,{privateMode:false})"));
 assert.doesNotMatch(adapter,/writeFile|chmod|unlink|replaceSync|process\.kill|\bsort\(/);
});
