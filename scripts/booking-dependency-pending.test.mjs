import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {assertBookingDependencyToolNoPending} from './booking-dependency-pending.mjs';
import {BOOKING_DEPENDENCY_STATES as STATES} from './booking-dependency-continuation-policy.mjs';
const read=f=>readFileSync(new URL('./'+f,import.meta.url),'utf8').replaceAll('\r\n','\n'),source=read('booking-dependency-pending.mjs');
function node(file,name){const ast=ts.createSourceFile('x.mjs',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n,name);return n.getText(ast);}
test('the full pending collector is byte-identical, so every old pending case and refusal remains',()=>{
 assert.equal(node(source,'bookingHandoffPendingBody'),node(read('booking-handoff-pending.mjs'),'bookingHandoffPendingBody'));
 assert.equal(node(source,'validateBookingRollbackTerminal'),node(read('booking-handoff-pending.mjs'),'validateBookingRollbackTerminal'));
 assert.equal(node(source,'privateRead'),node(read('booking-handoff-pending.mjs'),'privateRead'));
 assert.throws(()=>assertBookingDependencyToolNoPending('exception'),/unexpected_pending_argument/);
});
test('actual public adapter accepts NO caller exceptions and ONLY the real attested fixed database-ready states',()=>{
 for(const failure of [null,'guard','phase','primary','rollback']){
  const bytes=Object.fromEntries(Object.entries(STATES).map(([k,p])=>[p.target,k]));
  const pins=Object.fromEntries(Object.entries(STATES).map(([k,p])=>[k,{...p,sha256:createHash('sha256').update(k).digest('hex')}]));
  const seen=[];const fn=runInNewContext(node(source,'assertBookingDependencyToolNoPending').replace(/^export /,'').replace('import.meta.url',JSON.stringify('file:///scripts/current.mjs'))+'\nassertBookingDependencyToolNoPending',{
   fs:{readFileSync:()=>failure==='guard'?'changed':'guard'},URL,BOOKING_BASE_PENDING_GUARD_SHA256:createHash('sha256').update('guard').digest('hex'),
   originalGuard:s=>s,sha256:b=>createHash('sha256').update(b).digest('hex'),fail:c=>{throw Error(c);},
   observeBookingFormalContinuation:phase=>{assert.equal(phase,'database-ready');if(failure==='phase')throw Error('phase');return {preserved:Object.fromEntries(Object.values(pins).map(p=>[p.target,{}]))};},
   BOOKING_DEPENDENCY_STATES:pins,RELEASE_ROOT:'/release',privateRead:f=>{const target=f.split('/')[2],key=bytes[target];return failure===key?'changed':key;},
   assertOnlineToolOwnedPath:()=>{},bookingHandoffPendingBody:(options,owned,pair)=>{seen.push(pair);return 'checked';},
  });
  // import.meta is replaced only in the extracted test function.
  if(failure)assert.throws(()=>fn());else{assert.equal(fn(),'checked');assert.equal(seen.length,1);}
 }
});
