import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runAttendanceCleanupSteps,deleteAttendanceDownloadOnce} from './fixtures/attendance-cleanup.mjs';

test('successful cleanup executes each resource once in declared order',async()=>{
  const called=[];
  await runAttendanceCleanupSteps(['download','browser','routes','harness'].map(name=>({name,run:()=>{called.push(name);}})));
  assert.deepEqual(called,['download','browser','routes','harness']);
});

test('throwing and rejected download cleanup cannot skip browser, routes or harness',async()=>{
  const called=[],sync=new Error('synthetic delete throw'),asyncError=new Error('synthetic delete rejection');
  await assert.rejects(runAttendanceCleanupSteps([
    {name:'download-0',run:()=>{called.push('download-0');throw sync;}},
    {name:'download-1',run:()=>{called.push('download-1');return Promise.reject(asyncError);}},
    ...['browser','routes','harness'].map(name=>({name,run:()=>{called.push(name);}})),
  ]),error=>{
    assert(error instanceof AggregateError);assert.equal(error.errors.length,2);
    assert.deepEqual(error.errors.map(e=>e.cause),[sync,asyncError]);return true;
  });
  assert.deepEqual(called,['download-0','download-1','browser','routes','harness']);
});

test('real download and browser deadlines still reach rejected route drain and harness shutdown',async()=>{
  const called=[],routeError=new Error('synthetic route drain failed');
  await assert.rejects(runAttendanceCleanupSteps([
    ...['download','browser'].map(name=>({name,timeoutMs:5,run:()=>{called.push(name);return new Promise(()=>{});}})),
    {name:'routes',run:()=>{called.push('routes');throw routeError;}},
    {name:'harness',run:()=>{called.push('harness');}},
  ]),error=>{
    assert(error instanceof AggregateError);assert.equal(error.errors.length,3);
    assert.deepEqual(error.errors.slice(0,2).map(e=>e.cause.message),['attendance_cleanup_timeout:download','attendance_cleanup_timeout:browser']);
    assert.equal(error.errors[2].cause,routeError);return true;
  });
  assert.deepEqual(called,['download','browser','routes','harness']);
});

test('harness shutdown failure is reported alongside earlier failures, not swallowed',async()=>{
  const called=[],failures=['download','browser','routes','harness'].map(name=>new Error(name));
  await assert.rejects(runAttendanceCleanupSteps(failures.map(error=>({name:error.message,run:()=>{called.push(error.message);throw error;}}))),error=>{
    assert(error instanceof AggregateError);assert.deepEqual(error.errors.map(e=>e.cause),failures);return true;
  });
  assert.deepEqual(called,['download','browser','routes','harness']);
});

test('runner routes every owned teardown resource through the all-attempted helper',()=>{
  const source=readFileSync(new URL('./merchant-attendance-audit-shell-browser-check.mjs',import.meta.url),'utf8');
  assert.match(source,/import \{runAttendanceCleanupSteps,deleteAttendanceDownloadOnce\} from '\.\/fixtures\/attendance-cleanup\.mjs'/);
  assert.match(source,/await runAttendanceCleanupSteps\(\[/);
  for(const name of ['browser','routes','harness'])assert(source.includes(`name:'${name}'`));
  assert.match(source,/downloads\.filter\(record=>!record\.deleted\)\.map\(\(record,index\)=>\(\{name:`download-\$\{index\}`/);
  assert.match(source,/finally\{await bounded\(deleteAttendanceDownloadOnce\(tracked\),'audit_shell_download_cleanup_timeout',5000\);\}/);
  assert.match(source,/child\.pid!==undefined&&child\.exitCode===null&&child\.signalCode===null/);
});

test('confirmed download deletion is never repeated and event-count evidence remains intact',async()=>{
  let calls=0;const record={deleted:false,download:{delete:async()=>{if(++calls>1)throw Error('synthetic second delete rejected');}}};
  const downloads=[record];await deleteAttendanceDownloadOnce(record);await deleteAttendanceDownloadOnce(record);
  await runAttendanceCleanupSteps(downloads.filter(item=>!item.deleted).map(item=>({name:'download',run:()=>deleteAttendanceDownloadOnce(item)})));
  assert.equal(calls,1);assert.equal(record.deleted,true);assert.equal(downloads.length,1);
});

test('failed download deletion is not marked complete or swallowed, and remains eligible for cleanup',async()=>{
  let calls=0;const failure=new Error('synthetic first deletion failed');
  const record={deleted:false,download:{delete:async()=>{if(++calls===1)throw failure;}}};
  await assert.rejects(deleteAttendanceDownloadOnce(record),error=>error===failure);
  assert.equal(record.deleted,false);assert.equal(record.deleting,null);
  await runAttendanceCleanupSteps([record].filter(item=>!item.deleted).map(item=>({name:'download',run:()=>deleteAttendanceDownloadOnce(item)})));
  assert.equal(calls,2);assert.equal(record.deleted,true);
});

test('timed-out disposal shares the original in-flight delete and records its eventual success',async()=>{
  let calls=0,finish;const record={deleted:false,download:{delete:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}}};
  const first=deleteAttendanceDownloadOnce(record);assert.equal(deleteAttendanceDownloadOnce(record),first);
  let shutdown=false;
  await assert.rejects(runAttendanceCleanupSteps([
    {name:'download',timeoutMs:5,run:()=>deleteAttendanceDownloadOnce(record)},
    {name:'browser',run:()=>{shutdown=true;}},
  ]),error=>error instanceof AggregateError&&error.errors[0].cause.message==='attendance_cleanup_timeout:download');
  assert.equal(shutdown,true);assert.equal(record.deleted,false);assert.equal(calls,1);
  finish();await first;assert.equal(record.deleted,true);await deleteAttendanceDownloadOnce(record);assert.equal(calls,1);
});
