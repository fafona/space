import test from 'node:test';import assert from 'node:assert/strict';
import {canonicalJson,fingerprint,compareFingerprint,toolOnlyRepairDecision,assertBackupBinding,assertFreshEvidence,safeRelativePath,publicFailure,ToolchainError} from './release-toolchain-contracts.mjs';
export const fixtureApp=()=>({revision:'a'.repeat(40),source:fingerprint('application-source','source'),dependencies:fingerprint('application-dependencies','dependencies'),migrations:fingerprint('application-migrations','migrations')});
export const fixtureDatabase=()=>({environment:'production',containerId:'c'.repeat(64),image:'sha256:'+'d'.repeat(64),dataSource:'/opt/supabase/data',systemIdentifier:'1234567890',databaseOid:'5',serverVersionNum:'150008'});
export const fixtureTime=Date.parse('2026-10-28T03:00:00.000Z');
export const fixtureBackup=()=>({kind:'verified-database-backup',application:fixtureApp(),database:fixtureDatabase(),archive:fingerprint('backup-archive','encrypted-bytes'),verified:true,createdAt:'2026-10-28T02:00:00.000Z',expiresAt:'2026-10-29T02:00:00.000Z'});
test('canonical JSON ignores object property order, not array order or value/type',()=>{
 assert.equal(canonicalJson({b:2,a:{d:3,c:1}}),canonicalJson({a:{c:1,d:3},b:2}));
 assert.notEqual(canonicalJson([1,2]),canonicalJson([2,1]));assert.notEqual(canonicalJson({n:1}),canonicalJson({n:'1'}));
});
test('canonical JSON refuses lossy values, cycles, sparse arrays, prototypes and getters',()=>{
 const cycle={};cycle.self=cycle;let calls=0;const getter=Object.defineProperty({},'value',{enumerable:true,get(){calls++;throw Error('secret');}});
 for(const value of [NaN,Infinity,undefined,()=>{},new Date(),cycle,[,1],getter,JSON.parse('{"__proto__":1}')])assert.throws(()=>canonicalJson(value));assert.equal(calls,0);
});
test('fingerprint comparison is domain- AND representation-qualified, never bare hex',()=>{
 assert.equal(compareFingerprint(fingerprint('evidence',{a:1,b:2},'canonical-json-v1'),fingerprint('evidence',{b:2,a:1},'canonical-json-v1')),true);
 for(const pair of [[fingerprint('evidence','x'),fingerprint('tool-bundle','x')],[fingerprint('evidence','{}'),fingerprint('evidence',{},'canonical-json-v1')]])
  assert.throws(()=>compareFingerprint(...pair),/scheme_mismatch/);
 assert.throws(()=>compareFingerprint('a'.repeat(64),'a'.repeat(64)));
 assert.throws(()=>compareFingerprint(fingerprint('evidence','a'),fingerprint('evidence','b')),/fingerprint_mismatch/);
});
test('tool repair preserves already built application only when ALL immutable bindings match',()=>{
 const before={application:fixtureApp(),build:{application:fixtureApp(),artifact:fingerprint('application-build','build'),verified:true},tool:{revision:'b'.repeat(40),bundle:fingerprint('tool-bundle','old')}},after=structuredClone(before);
 after.tool={revision:'f'.repeat(40),bundle:fingerprint('tool-bundle','new')};assert.deepEqual(toolOnlyRepairDecision(before,after),{applicationUnchanged:true,applicationRebuildRequired:false,toolChanged:true,fullRevalidationRequired:true});
 for(const field of ['revision','source','dependencies','migrations']){const changed=structuredClone(after);changed.application[field]=field==='revision'?'e'.repeat(40):fingerprint(after.application[field].domain,'changed');assert.throws(()=>toolOnlyRepairDecision(before,changed));}
 const rebuilt=structuredClone(after);rebuilt.build.artifact=fingerprint('application-build','different-bytes');assert.throws(()=>toolOnlyRepairDecision(before,rebuilt));
});
test('backup is bound to application and exact production database, not tool version or pilot',()=>{
 const expected={application:fixtureApp(),database:fixtureDatabase(),nowMs:fixtureTime,maxAgeMs:86400000};assert.equal(assertBackupBinding(fixtureBackup(),expected),true);
 const wrongApp=fixtureBackup();wrongApp.application.revision='f'.repeat(40);assert.throws(()=>assertBackupBinding(wrongApp,expected),/backup_source_mismatch/);
 for(const key of ['environment','containerId','image','dataSource','systemIdentifier','databaseOid','serverVersionNum']){const wrong=fixtureBackup();wrong.database[key]=key==='environment'?'isolated':key==='containerId'?'e'.repeat(64):key==='image'?'sha256:'+'f'.repeat(64):key==='dataSource'?'/opt/pilot/data':key==='serverVersionNum'?'150009':'99';assert.throws(()=>assertBackupBinding(wrong,expected),/backup_database_mismatch/);}
});
test('expired, future, malformed or over-age evidence stops at preflight',()=>{
 for(const patch of [{expiresAt:'2026-10-28T03:00:00.000Z'},{createdAt:'2026-10-28T03:00:00.001Z'},{createdAt:'2026-10-20T02:00:00.000Z'},{createdAt:'2026-02-30T00:00:00.000Z'},{expiresAt:'never'}])
  assert.throws(()=>assertFreshEvidence({...fixtureBackup(),...patch},{nowMs:fixtureTime,maxAgeMs:86400000}),/evidence_stale|evidence_invalid/);
});
test('portable artifact paths refuse traversal, absolute paths, duplicate slashes and Windows devices',()=>{
 assert.equal(safeRelativePath('scripts/tool-v2.mjs'),'scripts/tool-v2.mjs');for(const value of ['../x','/root/x','C:/x','a//b','a/./b','a/../b','a\\b','a/CON.txt','a.','a\0b',''])assert.throws(()=>safeRelativePath(value),/invalid_path/);
});
test('public errors contain only stable stage and fixed codes, never exception text or getters',()=>{
 const error=Object.assign(Error('smtp-password-secret'),{code:'smtp-password-secret',stack:'smtp-password-secret'});
 assert.ok(!JSON.stringify(publicFailure(error,{stage:'backup'})).includes('smtp-password-secret'));
 assert.equal(publicFailure(new ToolchainError('backup_database_mismatch'),{stage:'backup'}).code,'backup_database_mismatch');
 const hostile=new Proxy({}, {getPrototypeOf(){throw Error('secret');},getOwnPropertyDescriptor(){throw Error('secret');}});assert.doesNotThrow(()=>publicFailure(hostile,{stage:'source'}));
});
