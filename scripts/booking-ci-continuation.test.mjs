import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {BOOKING_CI_BASE,BOOKING_CI_RECEIPT} from './booking-ci-continuation-policy.mjs';
import {BOOKING_FORMAL_RECEIPT} from './booking-formal-backup-policy.mjs';
import {bookingCurrentReceiptName} from './booking-ci-continuation.mjs';
const source=readFileSync(new URL('./booking-ci-continuation.mjs',import.meta.url),'utf8');
test('dispatcher keeps the original case and requires a separate strict attester for every successor',()=>{
 const ast=ts.createSourceFile('dispatch.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 for(const [name,oldFn,newFn]of [
  ['assertBookingCurrentToolSource','assertBookingFormalToolSource','assertBookingCiToolSource'],
  ['assertBookingCurrentContinuation','assertBookingFormalContinuation','assertBookingCiContinuation'],
  ['assertBookingCurrentRuntimeContinuation','assertBookingFormalRuntimeContinuation','assertBookingCiRuntimeContinuation']]){
  const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name),calls=[];let reject=false;
  const fn=runInNewContext(n.getText(ast).replace(/^export /,'')+'\n'+name,{BOOKING_CI_BASE,
   [oldFn]:input=>{calls.push(['old',input]);return 'old';},[newFn]:input=>{calls.push(['new',input]);if(reject)throw Error('unverified_source');return 'new';}});
  const oldInput=name==='assertBookingCurrentToolSource'?BOOKING_CI_BASE:{toolRevision:BOOKING_CI_BASE,phase:'database-ready'};
  const newInput=name==='assertBookingCurrentToolSource'?'f'.repeat(40):{toolRevision:'f'.repeat(40),phase:'database-ready'};
  assert.equal(fn(oldInput),'old');assert.equal(fn(newInput),'new');assert.equal(calls[0][1],oldInput);assert.equal(calls[1][1],newInput);
  reject=true;assert.throws(()=>fn(newInput),/unverified_source/);
 }
 assert.equal(bookingCurrentReceiptName(BOOKING_CI_BASE),BOOKING_FORMAL_RECEIPT);
 assert.equal(bookingCurrentReceiptName('f'.repeat(40)),BOOKING_CI_RECEIPT);
});
test('backup receipt selection follows mandatory source attestation; runtime imports use new attesters without changing their bodies',()=>{
 const backup=readFileSync(new URL('./booking-formal-backup.mjs',import.meta.url),'utf8');
 assert.ok(backup.indexOf('const source=assertBookingFormalToolSource(toolRevision)')<backup.indexOf('bookingCurrentReceiptName(toolRevision)'));
 assert.match(backup,/assertBookingCurrentToolSource as assertBookingFormalToolSource/);
 assert.match(backup,/assertBookingCurrentContinuation as assertBookingFormalContinuation/);
 for(const file of ['booking-handoff-host-io','booking-handoff-journal','booking-handoff-routing','booking-handoff-legacy','booking-handoff-runtime','online-traffic-release']){
  const code=readFileSync(new URL('./'+file+'.mjs',import.meta.url),'utf8');
  assert.match(code,file==='booking-handoff-runtime'?/assertBookingDependencyToolClosure as assertBookingHandoffToolClosure/:/assertBookingReadyClosure as assertBookingHandoffToolClosure/);
 }
 assert.match(readFileSync(new URL('./booking-handoff-runtime.mjs',import.meta.url),'utf8'),/assertBookingDependencyRuntimeContinuation as assertBookingFormalRuntimeContinuation/);
});
