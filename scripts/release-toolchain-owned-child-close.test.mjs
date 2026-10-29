import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {readFileSync} from 'node:fs';
import {watchOwnedRehearsalChildClose,ownedRehearsalChildCloseSnapshot,waitOwnedRehearsalChildrenClosed,assertOwnedRehearsalChildCloseProof} from './release-toolchain-owned-child-close.mjs';
test('actual child exit is not reported closed before its separate close event; the owned child then finishes naturally',async()=>{
 const child=spawn(process.execPath,['-e','setTimeout(()=>{},10)'],{stdio:'ignore',windowsHide:true}),token=watchOwnedRehearsalChildClose(child,'controller');let snapshotAtExit;
 // Observe IN the exit callback. Awaiting an exit promise can resume only
 // after close has already fired on Windows; that is not the exit boundary.
 child.once('exit',()=>{snapshotAtExit=ownedRehearsalChildCloseSnapshot([token])[0];});
 const proof=await waitOwnedRehearsalChildrenClosed([token]);assert.equal(snapshotAtExit.closed,false);assert.equal(proof[0].closed,true);assert.equal(proof[0].code,0);assert.equal(proof[0].spawnError,false);
});
test('active proof requires all six unique directly spawned roles fully closed with exact source-bound receipt verification',()=>{
 const proof={kind:'owned-active-rehearsal-direct-children-closed',children:['web-baseline','web-primary','web-rollback','worker','controller','nginx'].map((role,index)=>({role,pid:100+index,closed:true,spawnError:false,code:0,signal:null})),publicationAuthority:false,at:'2026-10-29T04:50:00.000Z'};
 assert.equal(assertOwnedRehearsalChildCloseProof(proof),true);
 for(const change of [value=>value.children.pop(),value=>value.children[1].pid=value.children[0].pid,value=>value.children[1].role=value.children[0].role,value=>value.children[0].closed=false,value=>value.children[0].spawnError=true,value=>value.children[0].code=1,value=>Object.assign(value.children[0],{code:null,signal:'SIGSEGV'}),value=>value.publicationAuthority=true]){const changed=structuredClone(proof);change(changed);assert.throws(()=>assertOwnedRehearsalChildCloseProof(changed),/close_invalid/);}
 const runner=readFileSync(new URL('./release-toolchain-full-rehearsal.mjs',import.meta.url),'utf8'),reader=readFileSync(new URL('./release-toolchain-booking-admission.mjs',import.meta.url),'utf8');
 assert.ok(runner.includes('if(activeProfile)directChildren.push(watchOwnedRehearsalChildClose(child,role))'));
 assert.ok(runner.indexOf("children:await reaped()")<runner.indexOf("const receiptFile=root+'/cases/'"));
 assert.ok(runner.includes('if(activeProfile)await reaped();'));assert.ok(runner.includes('assertOwnedRehearsalChildCloseProof(proof);write('));
 assert.ok(reader.includes("report.observationProfile==='fixed-active-incident-connect-only'"));assert.ok(reader.includes("===actual.directChildCloseSha256"));assert.ok(reader.includes("assertOwnedRehearsalChildCloseProof(read(runtime+'/direct-child-close.json'))"));
});
test('a missing close event fails within its bound without signalling or manufacturing a successful lifecycle',async()=>{
 const child=spawn(process.execPath,['-e','setTimeout(()=>{},100)'],{stdio:'ignore',windowsHide:true}),token=watchOwnedRehearsalChildClose(child,'worker');
 try{await assert.rejects(waitOwnedRehearsalChildrenClosed([token],{timeoutMs:1}),/close_unconfirmed/);assert.equal(ownedRehearsalChildCloseSnapshot([token])[0].closed,false);}
 finally{await waitOwnedRehearsalChildrenClosed([token]);}
 await assert.rejects(waitOwnedRehearsalChildrenClosed([JSON.parse('{}')]),/close_invalid/);
 const source=readFileSync(new URL('./release-toolchain-owned-child-close.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/\.kill\(|\.unref\(|\.destroy\(|process\.exit\(/);
});
