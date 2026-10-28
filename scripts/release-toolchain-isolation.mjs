// A new, network-none PostgreSQL fixture per run. Never starts an old pilot,
// connects to a production endpoint, removes evidence, or accepts a DB override.
import * as fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
export const ISOLATION_IMAGE='sha256:8613ba8eab946dff6674a2db6aab75b80aa101da39035fe20f62b0c7591ab35d';
export const ISOLATION_IMAGE_REFERENCE='supabase/postgres@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b';
const productionContainer='0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416',productionSystem='7612049595342295079';
const ROOT=/^\/var\/lib\/faolla-release-toolchain-isolation-[A-Za-z0-9]+$/,capsules=new WeakSet();let diagnosticRoot;
const env=()=>({PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',HOME:'/root',DOCKER_CONFIG:'/root/.docker'});
function command(args,options={}){const r=spawnSync('docker',args,{env:env(),encoding:'utf8',timeout:20000,maxBuffer:16*1024**2,...options});
 if(r.status!==0||r.signal||r.error){if(diagnosticRoot)seal(diagnosticRoot+'/command-failure-'+randomUUID()+'.json',{kind:'isolated-fixture-command-failure',operation:args[0],program:args[0]==='exec'?args[2]:null,exitCode:r.status,signal:r.signal,errorCode:r.error?.code??null,fixtureStderr:String(r.stderr??'').slice(0,2000),at:new Date().toISOString()});need(false,'operation_unconfirmed');}return r.stdout;}
function seal(file,value){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,canonicalJson(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const parent=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
function read(file){ownedReleasePath(file);return JSON.parse(fs.readFileSync(file,'utf8'));}
export function validateIsolationContainer(value,owner,{running}={}){
 need(ROOT.test(owner?.root??'')&&/^[a-f0-9-]{36}$/.test(owner.id??'')&&/^[a-f0-9]{64}$/.test(owner.containerId??'')&&owner.containerId!==productionContainer,'database_identity_mismatch');
 need(value.Id===owner.containerId&&value.Name==='/faolla-release-toolchain-'+owner.id&&value.Image===ISOLATION_IMAGE&&
  value.Config?.Labels?.['io.faolla.release-toolchain.owner']===owner.id&&value.Config.Labels['io.faolla.release-toolchain.root']===owner.root&&
  value.HostConfig?.NetworkMode==='none'&&value.HostConfig.Privileged===false&&Object.keys(value.HostConfig.PortBindings??{}).length===0&&
  Array.isArray(value.Mounts)&&value.Mounts.length===1&&value.Mounts[0].Type==='bind'&&value.Mounts[0].Source===owner.root+'/database'&&
  value.Mounts[0].Destination==='/fixture'&&value.Mounts[0].RW===true&&value.Config.User==='postgres'&&
  value.HostConfig.CapDrop?.includes('ALL')&&value.HostConfig.SecurityOpt?.includes('no-new-privileges')&&
  (running===undefined||value.State.Running===running),'database_identity_mismatch');return true;
}
function inspect(owner,running){const actual=JSON.parse(command(['inspect',owner.containerId]))[0];validateIsolationContainer(actual,owner,{running});return actual;}
function check(c,running=true){need(capsules.has(c),'database_identity_mismatch');ownedReleasePath(c.root,{directory:true});const owner=read(c.root+'/owner.json');need(canonicalJson(owner)===canonicalJson(c.owner),'owned_resource_changed');inspect(owner,running===null?undefined:running);return owner;}
export function isolatedPgArguments(c,database,{program='psql',extra=[]}={}){
 check(c);need(database==='postgres'||/^faolla_booking_activation_[a-f0-9]{16}$/.test(database),'database_identity_mismatch');
 need(['psql','pg_dump','pg_restore'].includes(program)&&Array.isArray(extra)&&extra.every(v=>typeof v==='string'),'invalid_contract');
 const common=['-h','/fixture/socket','-U','supabase_admin','--no-password'];
 return ['exec','-i',c.owner.containerId,program,...common,...(program==='psql'?['-d',database,'--no-psqlrc','--quiet','--tuples-only','--no-align','--set=ON_ERROR_STOP=1','--set=VERBOSITY=sqlstate']:program==='pg_dump'?['-d',database,'--format=custom','--no-owner','--no-acl']:['-d',database,'--exit-on-error','--no-owner','--no-acl']),...extra];
}
export const isolatedPg=(c,database,sql)=>command(isolatedPgArguments(c,database),{input:sql,timeout:60000}).trim();
export function loadOwnedIsolation(root){need(ROOT.test(root),'invalid_path');ownedReleasePath(root,{directory:true});need((fs.lstatSync(root).mode&0o777)===0o700,'owned_resource_changed');
 const owner=read(root+'/owner.json');need(owner.kind==='release-toolchain-owned-postgres'&&owner.root===root,'database_identity_mismatch');const c=Object.freeze({root,owner:Object.freeze(owner)});capsules.add(c);check(c);return c;
}
export function createOwnedIsolation(){
 need(process.platform==='linux'&&process.getuid?.()===0,'unsupported_runtime');ownedReleasePath('/var/lib',{directory:true});
 const image=JSON.parse(command(['image','inspect',ISOLATION_IMAGE]))[0];need(image.Id===ISOLATION_IMAGE&&image.RepoDigests?.some(v=>v.endsWith(ISOLATION_IMAGE_REFERENCE.slice(ISOLATION_IMAGE_REFERENCE.indexOf('@')))),'database_identity_mismatch');
 const root=fs.mkdtempSync('/var/lib/faolla-release-toolchain-isolation-');diagnosticRoot=root;fs.chmodSync(root,0o700);const id=randomUUID(),name='faolla-release-toolchain-'+id;
 // The image's immutable passwd file determines the unprivileged owner. No
 // temporary root container or configured/production secret is needed.
 const uidText=command(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','postgres','--entrypoint','id',ISOLATION_IMAGE,'-u']).trim();
 const gidText=command(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','postgres','--entrypoint','id',ISOLATION_IMAGE,'-g']).trim();
 need(/^[1-9][0-9]{0,5}$/.test(uidText)&&/^[1-9][0-9]{0,5}$/.test(gidText),'database_identity_mismatch');
 fs.mkdirSync(root+'/database',{mode:0o700});fs.chownSync(root+'/database',Number(uidText),Number(gidText));
 seal(root+'/allocation-intent.json',{kind:'release-toolchain-isolation-allocation',root,id,image:ISOLATION_IMAGE,createdAt:new Date().toISOString()});
 const containerId=command(['create','--name',name,'--label','io.faolla.release-toolchain.owner='+id,'--label','io.faolla.release-toolchain.root='+root,
  '--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--user','postgres','--pids-limit','128','--memory','512m','--cpus','1',
  '--mount','type=bind,source='+root+'/database,target=/fixture','--entrypoint','/bin/sh',ISOLATION_IMAGE,'-c','exec sleep infinity']).trim();
 need(/^[a-f0-9]{64}$/.test(containerId)&&containerId!==productionContainer,'database_identity_mismatch');
 const owner={kind:'release-toolchain-owned-postgres',root,id,containerId,image:ISOLATION_IMAGE,createdAt:new Date().toISOString()};seal(root+'/owner.json',owner);inspect(owner,false);
 command(['start',containerId]);const c=loadOwnedIsolation(root);
 try{
  command(['exec',containerId,'mkdir','-m','700','/fixture/data','/fixture/socket']);
  command(['exec',containerId,'initdb','-D','/fixture/data','-A','trust','--no-locale','--encoding=UTF8'],{timeout:60000});
  command(['exec',containerId,'pg_ctl','-D','/fixture/data','-l','/fixture/postgres.log','-o',"-k /fixture/socket -h '' -c max_connections=20 -c shared_buffers=32MB",'-w','start'],{timeout:60000});
  command(['exec','-i',containerId,'psql','-h','/fixture/socket','-U','postgres','-d','postgres','--no-password','--no-psqlrc','--quiet','--set=ON_ERROR_STOP=1'],{input:'create role supabase_admin superuser login;create role anon;create role authenticated;create role service_role;'});
  const actual=JSON.parse(isolatedPg(c,'postgres',"select json_build_object('systemIdentifier',system_identifier::text,'serverVersionNum',current_setting('server_version_num')) from pg_control_system();"));
  need(actual.serverVersionNum==='150008'&&/^[1-9][0-9]{0,19}$/.test(actual.systemIdentifier)&&actual.systemIdentifier!==productionSystem,'database_identity_mismatch');
  seal(root+'/ready.json',{...actual,containerId,network:'none',portsPublished:false,fixtureOnly:true});return c;
 }catch(e){stopOwnedIsolation(c);throw e;}
}
export function stopOwnedIsolation(c){
 check(c,null);const current=inspect(c.owner);if(current.State.Running){command(['stop','--time','10',c.owner.containerId],{timeout:20000});inspect(c.owner,false);}
 if(!fs.existsSync(c.root+'/stopped.json'))seal(c.root+'/stopped.json',{containerId:c.owner.containerId,stopped:true,filesPreserved:true,stoppedAt:new Date().toISOString()});
}
export function rehearseIsolatedBackup(c,database,directory){
 check(c);ownedReleasePath(directory,{directory:true});need(directory.startsWith('/var/lib/faolla-booking-full-rehearsal-'),'invalid_path');
 // Pages and the migration registry are portable dump -> restore invariants.
 // The caller separately checks the independently tested authority snapshot.
 const dataSql="begin read only;select jsonb_build_object('pages',(select jsonb_agg(to_jsonb(p) order by id) from public.pages p),'registry',(select jsonb_agg(to_jsonb(m) order by version) from public.faolla_schema_migrations m));rollback;";
 const before=JSON.parse(isolatedPg(c,database,dataSql)),file=directory+'/backup.dump';
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{const r=spawnSync('docker',isolatedPgArguments(c,database,{program:'pg_dump'}),{env:env(),stdio:['ignore',fd,'pipe'],timeout:60000});need(r.status===0&&!r.signal&&!r.error,'operation_unconfirmed');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 ownedReleasePath(file);const bytes=fs.readFileSync(file),digest=sha256(bytes);need(bytes.length>100,'evidence_invalid');
 const restore='faolla_booking_activation_'+randomUUID().replaceAll('-','').slice(0,16);isolatedPg(c,'postgres','create database "'+restore+'" with template template0 owner supabase_admin;');
 command(isolatedPgArguments(c,restore,{program:'pg_restore'}),{input:bytes,encoding:null,timeout:60000});
 const after=JSON.parse(isolatedPg(c,restore,dataSql));need(canonicalJson(after)===canonicalJson(before),'observation_mismatch');
 const corrupted=Buffer.from(bytes);corrupted[Math.floor(corrupted.length/2)]^=1;need(sha256(corrupted)!==digest,'evidence_invalid');
 const corruptFd=fs.openSync(directory+'/backup-corrupt.dump',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(corruptFd,corrupted);fs.fsyncSync(corruptFd);}finally{fs.closeSync(corruptFd);}
 const proof={kind:'isolated-dump-restore-rehearsal',containerId:c.owner.containerId,sourceDatabase:database,restoredDatabase:restore,archiveSha256:digest,restoredRowsEqual:true,corruptArchiveRefused:true,productionDatabaseTouched:false,completedAt:new Date().toISOString()};
 seal(directory+'/backup-restore.json',proof);return proof;
}
