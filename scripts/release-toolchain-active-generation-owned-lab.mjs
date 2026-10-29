// Closed, owned CI resources for the complete active-incident reconciliation.
// These capabilities cannot be serialized or used by formal-host admission.
import {assertSameNodeProcess} from './release-toolchain-process-identity.mjs';
import {assertSameLongLivedDaemon} from './release-toolchain-daemon-identity.mjs';
import * as fs from 'node:fs';import path from 'node:path';
import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';import {isDeepStrictEqual} from 'node:util';
import {createOwnedIsolation,loadOwnedIsolation,stopOwnedIsolation,isolatedPg,isolatedPgArguments,verifyIsolatedArchiveBytes} from './release-toolchain-isolation.mjs';
import {inspectPinnedExecutionSource,ownedReleasePath} from './release-toolchain-source.mjs';
import {collectOwnedCiPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {stablePm2RegistryRow,assertCompletePm2DumpSet} from './release-toolchain-pm2-transition.mjs';
import {BOOKING_SCOPE} from './booking-publication-policy.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {bookingHostRead,bookingHostWriteOnce,bookingHostSync} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,fingerprint,requireToolchain as need} from './release-toolchain-contracts.mjs';
const scopes=new WeakMap(),source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),revision=path.basename(source);
const anchors=['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'];
const same=(a,b)=>need(isDeepStrictEqual(a,b),'owned_lab_observation_changed');
export const ACTIVE_LAB_CASES=Object.freeze(['normal','after-metadata','after-save','after-archive','controller-death-after-metadata','controller-death-after-save','controller-death-after-archive']);
const POST_SAVE_LAB_CASES=Object.freeze(['post-save','post-save-incomplete']);
// Pure path derivation only: never a capability or a selectable formal path.
export function activeReconciliationCaseLocation(directory){
 need(typeof directory==='string'&&/^\/var\/lib\/faolla-active-reconciliation-ci-[A-Za-z0-9]+\/(normal|after-metadata|after-save|after-archive|controller-death-after-metadata|controller-death-after-save|controller-death-after-archive|post-save|post-save-incomplete)$/.test(directory),'invalid_path');
 return Object.freeze({root:path.posix.dirname(directory),directory});
}
const identity=s=>Object.fromEntries(['dev','ino','uid','mode'].map(k=>[k,s[k]]));
export const sealOwnedLab=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
function ci(){need(process.platform==='linux'&&process.getuid?.()===0&&process.version==='v20.20.1'&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.FAOLLA_RELEASE_PRODUCTION_EQ==='1'&&!anchors.some(f=>fs.existsSync(f)),'ci_only');need(source==='/var/lib/faolla-online-code/'+revision&&/^[a-f0-9]{40}$/.test(revision),'source_changed');}
const dir=file=>identity(ownedReleasePath(file,{directory:true,privateMode:true}));
const read=file=>{const text=bookingHostRead(file),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;};
function make(parent,name){dir(parent);const file=parent+'/'+name;fs.mkdirSync(file,{mode:0o700});bookingHostSync(parent);dir(file);return file;}
function sameDaemon(actual,expected){same(actual.commandLine,expected.commandLine);return assertSameLongLivedDaemon(actual.fact,expected.fact);}
const captureDaemon=pid=>{const {commandLine,...fact}=captureProcessFact(pid);return{fact,commandLine};};
function check(s){
 ci();same(dir(s.root),s.rootIdentity);same(dir(s.directory),s.directoryIdentity);same(bookingHostRead(s.directory+'/owner.json'),s.ownerText);
 sameDaemon(captureDaemon(s.daemon.fact.pid),s.daemon);need(s.daemon.commandLine.length===1&&s.daemon.commandLine[0]==='PM2 v6.0.14: God Daemon ('+s.pm2Root+'/pm2)','owned_resource_changed');
 for(const [name,digest]of Object.entries(s.sourceHashes))need(sha256(fs.readFileSync(source+'/scripts/'+name))===digest,'source_changed');
 return s;
}
export function ownedActiveReconciliationScope(capability){const s=scopes.get(capability);need(s,'owned_lab_capability_required');return check(s);}
function issue(owner){
 const location=activeReconciliationCaseLocation(owner.directory),rootIdentity=dir(location.root),directoryIdentity=dir(location.directory),ownerText=bookingHostRead(location.directory+'/owner.json');
 const isolation=loadOwnedIsolation(owner.isolationRoot),daemon=captureDaemon(owner.daemonPid),capability=Object.freeze({kind:'owned-active-reconciliation-capability'});
 const s={...owner,...location,rootIdentity,directoryIdentity,ownerText,isolation,daemon};scopes.set(capability,s);check(s);return capability;
}
const dataSql="begin read only;select jsonb_build_object('pages',(select jsonb_agg(to_jsonb(p) order by id) from public.pages p),'registry',(select jsonb_agg(to_jsonb(m) order by version) from public.faolla_schema_migrations m),'control',(select jsonb_agg(to_jsonb(c)) from public.faolla_booking_atomic_control c),'commands',(select jsonb_agg(to_jsonb(c) order by site_id,command_key) from public.faolla_booking_atomic_commands c),'mail',(select jsonb_agg(to_jsonb(j) order by id) from public.faolla_booking_mail_jobs j));rollback;";
function seedActiveFixture(isolation){
 const database='faolla_booking_activation_'+randomUUID().replaceAll('-','').slice(0,16);
 isolatedPg(isolation,'postgres','create database "'+database+'" with template template0 owner supabase_admin;');
 isolatedPg(isolation,database,`create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.faolla_schema_migrations(version bigint primary key,name text not null);
insert into public.faolla_schema_migrations select n,'owned-lab-registry-'||n from generate_series(1,209) n;
grant usage on schema public to service_role;grant select,insert,update,delete on public.pages to service_role;
create function public.set_current_timestamp_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
create trigger set_pages_updated_at before update on public.pages for each row execute function public.set_current_timestamp_updated_at();
insert into public.pages(merchant_id,slug,blocks) values('__faolla_booking_persistence__','__merchant_booking_records__:v1','{"version":1,"records":[]}'::jsonb);`);
 for(const name of ['202610250211_booking_atomic_preparation.sql','202610250212_booking_atomic_runtime.sql']){const text=fs.readFileSync(source+'/scripts/supabase-migrations/'+name,'utf8');need(sha256(text.replaceAll('\r\n','\n'))===BOOKING_SCOPE.pins['scripts/supabase-migrations/'+name],'source_changed');isolatedPg(isolation,database,text);}
 // ONLY new, network-none owned fixture initialization. This is not the formal
 // activation body and can never execute against the formal cluster capsule.
 isolatedPg(isolation,database,'update public.faolla_booking_atomic_control set active=true where singleton;');
 return database;
}
export const createOwnedActiveReconciliationCases=pm2Root=>createCases(pm2Root,ACTIVE_LAB_CASES);
export const createOwnedPostSaveCases=pm2Root=>createCases(pm2Root,POST_SAVE_LAB_CASES);
async function createCases(pm2Root,names){
 ci();need(/^\/var\/lib\/faolla-eq-[A-Za-z0-9]+$/.test(pm2Root),'invalid_path');dir(pm2Root);
 const tool=inspectPinnedExecutionSource({revision,directory:source}),physical=collectOwnedCiPm2Registry(pm2Root);assertCompletePm2DumpSet(physical.rows,physical.filteredRegistry);
 need(physical.rows.length===3&&physical.rows.some(r=>r.name==='eq-next'&&r.pm2_env.env.FAOLLA_BACKGROUND_JOBS_PAUSED==='1')&&physical.rows.some(r=>r.name==='owned-gated-worker'&&r.pm_id===2),'owned_resource_changed');
 const root=fs.mkdtempSync('/var/lib/faolla-active-reconciliation-ci-');fs.chmodSync(root,0o700);sealOwnedLab(root+'/started.json',{kind:'owned-active-reconciliation-started',toolRevision:revision,inventorySha256:tool.inventorySha256,publicationAuthority:false,at:new Date().toISOString()});
 let isolation;
 try{
  isolation=createOwnedIsolation();const database=seedActiveFixture(isolation),cases=[];
  const sourceNames=['release-toolchain-active-generation-owned-lab.mjs','release-toolchain-active-generation-reconciliation.mjs','release-toolchain-active-generation-reconciliation-case.mjs','release-toolchain-active-generation-preservation.mjs','release-toolchain-active-generation-metadata.mjs','release-toolchain-active-generation-persistence.mjs','online-release-retention-writer.mjs','release-toolchain-pm2-observation.mjs'];
  const sourceHashes=Object.fromEntries(sourceNames.map(name=>[name,sha256(fs.readFileSync(source+'/scripts/'+name))]));
  for(const name of names){
   const directory=make(root,name),evidence=make(directory,'old-evidence');make(directory,'operation.lock');bookingHostWriteOnce(directory+'/deploy.lock','owned active reconciliation kernel lease\n');
   const oldText=canonicalJson({kind:'owned-previous-interrupted-operation',publicationCompleted:false,fixtureOnly:true})+'\n';bookingHostWriteOnce(evidence+'/old-operation.json',oldText);
   const beforeText='{"target":"owned-lab-stale-metadata"}',afterText='{"target":"owned-lab-compatible"}';bookingHostWriteOnce(directory+'/active.json',beforeText);
   const owner={kind:'owned-active-reconciliation-case',name,directory,pm2Root,daemonPid:physical.daemon.pid,isolationRoot:isolation.root,database,toolRevision:revision,inventorySha256:tool.inventorySha256,sourceHashes,beforeText,afterText,pins:[['old-operation.json',Buffer.byteLength(oldText),sha256(oldText)]]};
   sealOwnedLab(directory+'/owner.json',owner);cases.push(issue(owner));
  }
  return{root,isolation,cases,tool};
 }catch(error){if(isolation)stopOwnedIsolation(isolation);throw error;}
}
export function loadOwnedActiveReconciliationCase(directory){
 ci();activeReconciliationCaseLocation(directory);dir(directory);
 const owner=read(directory+'/owner.json');need(owner.kind==='owned-active-reconciliation-case'&&owner.directory===directory&&[...ACTIVE_LAB_CASES,...POST_SAVE_LAB_CASES].includes(owner.name)&&directory.endsWith('/'+owner.name)&&owner.toolRevision===revision&&/^\/var\/lib\/faolla-eq-[A-Za-z0-9]+$/.test(owner.pm2Root),'owned_resource_changed');
 return issue(owner);
}
export function ownedActiveReconciliationBoundary(capability,boundary){
 const s=ownedActiveReconciliationScope(capability);need(['after-metadata','after-save','after-archive'].includes(boundary),'invalid_contract');
 if(s.name===boundary)throw Error('owned_lab_'+boundary.replaceAll('-','_')+'_unknown');
 if(s.name==='post-save-incomplete'&&boundary==='after-save')throw Error('owned_lab_post_save_incomplete_unknown');
 if(s.name==='controller-death-'+boundary)process.kill(process.pid,'SIGKILL');
}
export async function observeOwnedActiveReconciliation(capability){
 const s=ownedActiveReconciliationScope(capability),physical=collectOwnedCiPm2Registry(s.pm2Root);sameDaemon(captureDaemon(physical.daemon.pid),s.daemon);assertCompletePm2DumpSet(physical.rows,physical.filteredRegistry);
 const database=JSON.parse(isolatedPg(s.isolation,s.database,bookingHandoffActivationSnapshotSql));need(database.active===true&&database.protocol===2&&database.systemIdentifier!=='7612049595342295079','database_identity_mismatch');
 const rows=physical.rows.map(stablePm2RegistryRow),processes=physical.rows.map(row=>{need(row.pid>0&&row.pm2_env.pm_cwd===s.pm2Root+'/app','owned_resource_changed');return captureProcessFact(row.pid);});
 const next=physical.rows.find(row=>row.name==='eq-next');need(next?.pm2_env.env.FAOLLA_BACKGROUND_JOBS_PAUSED==='1','owned_resource_changed');
 const port=next.pm2_env.args.at(-1);need(/^[1-9][0-9]{0,4}$/.test(port),'evidence_invalid');
 const response=await fetch('http://127.0.0.1:'+port,{headers:{Connection:'close'},signal:AbortSignal.timeout(3000)}),body=await response.text();need(response.status===200&&Buffer.byteLength(body)<=65536,'owned_lab_public_probe');
 check(s);return{kind:'owned-active-reconciliation-observation',database,rowsSha256:sha256(canonicalJson(rows)),processes,daemon:s.daemon,status:response.status,bodySha256:sha256(body),activeText:bookingHostRead(s.directory+'/active.json'),mailEnabled:false,publicationAuthority:false};
}
export function assertOwnedActiveReconciliationDelta(before,after,{metadata=false}={}){
 sameDaemon(after.daemon,before.daemon);need(after.processes.length===before.processes.length,'owned_resource_changed');after.processes.forEach((value,index)=>assertSameNodeProcess(value,before.processes[index]));
 const actual={...after,daemon:before.daemon,processes:before.processes},expected=structuredClone(before);if(metadata)expected.activeText='{"target":"owned-lab-compatible"}';same(actual,expected);return true;
}
export const createOwnedActiveReconciliationBackup=capability=>createBackup(capability,'backup.dump','backup-verified.json');
export const createOwnedPostSaveBackup=capability=>createBackup(capability,'post-save-backup.dump','post-save-backup-verified.json');
function createBackup(capability,archiveName,reportName){
 const s=ownedActiveReconciliationScope(capability),before=JSON.parse(isolatedPg(s.isolation,s.database,dataSql)),file=s.directory+'/'+archiveName;
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{const r=spawnSync('docker',isolatedPgArguments(s.isolation,s.database,{program:'pg_dump'}),{stdio:['ignore',fd,'pipe'],env:{PATH:'/usr/bin:/bin'},timeout:60000,maxBuffer:1024**2});need(r.status===0&&!r.signal&&!r.error,'owned_lab_dump_failed');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}bookingHostSync(s.directory);
 const archive=fs.readFileSync(file),binding=fingerprint('backup-archive',archive),restoredDatabase='faolla_booking_activation_'+randomUUID().replaceAll('-','').slice(0,16);
 isolatedPg(s.isolation,'postgres','create database "'+restoredDatabase+'" with template template0 owner supabase_admin;');
 const restored=spawnSync('docker',isolatedPgArguments(s.isolation,restoredDatabase,{program:'pg_restore'}),{input:verifyIsolatedArchiveBytes(archive,binding),env:{PATH:'/usr/bin:/bin'},timeout:60000,maxBuffer:1024**2});need(restored.status===0&&!restored.signal&&!restored.error,'owned_lab_restore_failed');
 same(JSON.parse(isolatedPg(s.isolation,restoredDatabase,dataSql)),before);same(JSON.parse(isolatedPg(s.isolation,s.database,dataSql)),before);
 const corrupt=Buffer.from(archive);corrupt[Math.floor(corrupt.length/2)]^=1;let refused=false;try{verifyIsolatedArchiveBytes(corrupt,binding);}catch{refused=true;}need(refused,'owned_lab_corruption_not_refused');
 const proof={kind:'owned-active-reconciliation-dump-restore',containerId:s.isolation.owner.containerId,sourceDatabase:s.database,restoredDatabase,archive:binding,activeRowsPreserved:true,corruptArchiveRefused:true,formalDatabaseTouched:false,publicationAuthority:false,at:new Date().toISOString()};sealOwnedLab(s.directory+'/'+reportName,proof);return proof;
}
