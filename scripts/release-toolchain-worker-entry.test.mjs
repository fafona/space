import test from 'node:test';import assert from 'node:assert/strict';
import {bookingWorkerEntryMode} from './release-toolchain-worker-entry.mjs';
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
