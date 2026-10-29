// Single-producer IPC: the final name is never exposed as an empty/partial
// JSON file. The fixed exclusive staging name arbitrates competing producers;
// failures keep staging evidence and cannot overwrite an existing final file.
import * as fs from 'node:fs';import path from 'node:path';
import {bookingHostRead,bookingHostSync,bookingHostWriteOnce} from './booking-handoff-host-io.mjs';import {ownedReleasePath} from './release-toolchain-source.mjs';import {canonicalJson,requireToolchain as need} from './release-toolchain-contracts.mjs';
export function publishOnceVisibleSequence(operations){operations.assertAbsent();operations.stage();operations.verifyStaged();operations.assertAbsent();operations.publish();operations.sync();operations.verifyFinal();}
export function publishOnceVisible(file,value){
 const parent=path.dirname(file),temporary=file+'.writing',text=canonicalJson(value)+'\n';ownedReleasePath(parent,{directory:true,privateMode:true});
 const absent=()=>{try{fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return;throw error;}need(false,'attempt_replay_forbidden');};
 publishOnceVisibleSequence({assertAbsent:absent,stage:()=>bookingHostWriteOnce(temporary,text),verifyStaged:()=>need(bookingHostRead(temporary)===text,'owned_resource_changed'),publish:()=>fs.renameSync(temporary,file),sync:()=>bookingHostSync(parent),verifyFinal:()=>need(bookingHostRead(file)===text,'owned_resource_changed')});
}
