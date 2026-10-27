import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {assertBookingReadyToolNoPending} from './booking-ready-pending.mjs';
const read=f=>readFileSync(new URL('./'+f,import.meta.url),'utf8').replaceAll('\r\n','\n'),source=read('booking-ready-pending.mjs'),hash=x=>createHash('sha256').update(x).digest('hex');
function node(file,name){const ast=ts.createSourceFile('x.mjs',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n,name);return n.getText(ast);}
test('full predecessor pending collector and terminal validator remain byte-identical; no caller exception exists',()=>{
 for(const name of ['bookingHandoffPendingBody','validateBookingRollbackTerminal','privateRead','originalGuard'])assert.equal(node(source,name),node(read('booking-dependency-pending.mjs'),name));
 assert.throws(()=>assertBookingReadyToolNoPending('fake'),/unexpected_pending_argument/);
});
test('actual pending adapter first checks real ready cohort, exact primary/rollback states and original general guard',()=>{
 const code=node(source,'assertBookingReadyToolNoPending').replace(/^export /,'').replace('import.meta.url',JSON.stringify('file:///scripts/current.mjs'));
 const C='primary',APPLICATION='rollback',pins={primary:'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3',rollback:'12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d'};
 for(const failure of [null,'guard','cohort','ready','primary','rollback']){
  let checked=0;const fn=runInNewContext(code+'\nassertBookingReadyToolNoPending',{URL,JSON,C,APPLICATION,RELEASE_ROOT:'/release',assertOnlineToolOwnedPath:()=>{},
   fs:{readFileSync:()=>failure==='guard'?'bad':'original'},originalGuard:v=>v,BOOKING_BASE_PENDING_GUARD_SHA256:hash('original'),
   sha256:v=>v==='original'?hash(v):v==='bad'?'bad':pins[v],fail:c=>{throw Error(c);},
   collectBookingReadyOriginalCohort:()=>{if(failure==='cohort')throw Error('cohort');},
   privateRead:f=>f.endsWith('/runtime-ready.json')?JSON.stringify({rollbackStateText:failure==='ready'?'bad':'rollback'}):failure===f.split('/')[2]?'bad':f.split('/')[2],
   bookingHandoffPendingBody:(_options,_path,pair)=>{checked++;assert.equal(pair.preserved.primary.stateSha256,pins.primary);return 'checked';}});
  if(failure){assert.throws(()=>fn());assert.equal(checked,0);}else assert.equal(fn(),'checked');
 }
});
