import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
import {withFreshBookingAdmission,requireBookingAdmission,collectFreshBookingAdmission} from './release-toolchain-admission-context.mjs';
test('pure activation, rule planning, database contract and publisher imports initialize in independent fresh processes',()=>{
 for(const names of [['booking-handoff-activation','booking-handoff-rule-repair','booking-publication-database'],['booking-handoff-rule-repair','booking-publication-database','booking-handoff-activation'],['booking-publication-database','booking-handoff-activation','booking-handoff-rule-repair'],['release-toolchain-release','booking-handoff-activation']]){
  const code=names.map(name=>'await import('+JSON.stringify(new URL('./'+name+'.mjs',import.meta.url).href)+');').join('');
  const r=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000,maxBuffer:262144,windowsHide:true});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
 }
});
test('the lightweight capability boundary cannot accept green JSON or collect without the real held lock',async()=>{
 assert.throws(()=>withFreshBookingAdmission({proof:{verified:true}},()=>assert.fail()));assert.throws(()=>requireBookingAdmission('a'.repeat(40)));
 await assert.rejects(collectFreshBookingAdmission({lock:null,directory:'/not-authorized',qualification:{verified:true}}));
 const source=readFileSync(new URL('./release-toolchain-admission-context.mjs',import.meta.url),'utf8');assert.match(source,/await import\('\.\/release-toolchain-booking-admission\.mjs'\)/);
 assert.doesNotMatch(source,/^import .*from ['"].*(?:booking-handoff|booking-ready|booking-publication|full-rehearsal)/m);
});
