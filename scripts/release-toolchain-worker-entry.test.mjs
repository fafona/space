import test from 'node:test';import assert from 'node:assert/strict';
import {bookingWorkerEntryMode,assertOwnedWorkerEntryCohort} from './release-toolchain-worker-entry.mjs';
import path from 'node:path';import {pathToFileURL} from 'node:url';
const file=path.resolve('owned/scripts/booking-atomic-worker.mjs'),url=pathToFileURL(file).href,wrapper=path.resolve('owned/node_modules/pm2/lib/ProcessContainerFork.js');
test('direct worker CLI remains an entrypoint',()=>assert.equal(bookingWorkerEntryMode(url,{argv:['node',file],env:{}}),'direct'));
test('actual PM2 ESM wrapper can enter without changing argv',()=>assert.equal(bookingWorkerEntryMode(url,{argv:['node',wrapper],env:{pm_exec_path:file},connected:true,send(){}}),'pm2'));
test('ordinary imports, unrelated IPC, injected flags and extra arguments are not worker entrypoints',()=>{
 for(const v of [{argv:['node','/other.mjs'],env:{}},{argv:['node',wrapper],env:{pm_exec_path:file}},
  {argv:['node',wrapper],env:{pm_exec_path:'/other'},connected:true,send(){}},
  {argv:['node','/owned/node_modules/other/lib/ProcessContainerFork.js'],env:{pm_exec_path:file},connected:true,send(){}},
  {argv:['node',wrapper,'--force'],env:{pm_exec_path:file},connected:true,send(){}}])assert.equal(bookingWorkerEntryMode(url,v),null);
});
test('cache-busting query and fragment imports never start duplicate worker loops',()=>{
 for(const suffix of ['?duplicate=1','#duplicate'])assert.equal(bookingWorkerEntryMode(url+suffix,{argv:['node',wrapper],env:{pm_exec_path:file},connected:true,send(){}}),null);
});
test('the actual ESM CI probe has an explicit fourth-child topology, never a widened original three-process observer',()=>{
 const before=[0,1,2].map(id=>({name:'old-'+id,pm_id:id,pid:100+id,pm2_env:{kept:'exact'}})),probe={name:'owned-esm-worker-entry',pm_id:3,pid:103,pm2_env:{status:'online',pm_exec_path:'/private/probe.mjs',pm_cwd:'/private/app',exec_interpreter:'/usr/bin/node',exec_mode:'fork_mode',autorestart:false,watch:false,restart_time:0,args:[],node_args:[]}},after=[...structuredClone(before),probe],options={name:probe.name,script:probe.pm2_env.pm_exec_path,cwd:probe.pm2_env.pm_cwd,pmId:3};
 assert.deepEqual(assertOwnedWorkerEntryCohort(before,after,options),probe);
 for(const mutate of [rows=>rows.push(structuredClone(probe)),rows=>rows[0].pid++,rows=>rows[3].pm_id=2,rows=>rows[3].pm2_env.pm_exec_path='/foreign',rows=>rows[3].pm2_env.autorestart=true]){const bad=structuredClone(after);mutate(bad);assert.throws(()=>assertOwnedWorkerEntryCohort(before,bad,options));}
});
