// Explicit local synthetic dump/restore. Uses ONE existing cluster and a new,
// independently owned target database. Never invokes production backup tools.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdtempSync,readFileSync,realpathSync,readdirSync,rmdirSync,statfsSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {attendanceNativeConfig} from './merchant-attendance-foundation-native.mjs';
import {attendanceLabelsReuseDirectory} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {runAttendanceOutageRelationsRacesNative} from './merchant-attendance-outage-relations-races-native.mjs';
import {buildAttendanceRecoveryContentSql,buildAttendanceRecoveryCatalogDiagnosticSql,assertAttendanceRecoveryContentMatch} from './attendance-recovery-content-contract.mjs';
import {captureAttendanceRecoveryBusinessBaseline,verifyAttendanceRecoveryNativeChecks} from './merchant-attendance-recovery-native-checks.mjs';

const MiB=1024*1024;
export const attendanceRecoveryBudgets=Object.freeze({source:64*MiB,target:128*MiB,dump:32*MiB,clusterGrowth:256*MiB,diskReserve:512*MiB});
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
export function attendanceRecoveryTargetIdentity(value,expected){
 assert(value&&Number.isSafeInteger(value.oid)&&value.oid>0,'recovery_target_oid_required');
 assert.match(value.name,/^faolla_attendance_restore_[a-f0-9]{32}$/);
 assert.equal(value.owner,'postgres');assert.match(value.marker,/^faolla-synthetic-restore:[a-f0-9-]{36}$/);
 assert.deepEqual(value,expected,'recovery_target_ownership_changed');return value;
}
export function attendanceRecoveryResourceGuard({source=0,target=0,dump=0,growth=0,free,initial=false}){
 const b=attendanceRecoveryBudgets;
 for(const v of [source,target,dump,growth,free])assert(Number.isSafeInteger(v)&&v>=0,'recovery_resource_measurement_invalid');
 assert(source<=b.source,'recovery_source_budget');assert(target<=b.target,'recovery_target_budget');
 assert(dump<=b.dump,'recovery_dump_budget');assert(growth<=b.clusterGrowth,'recovery_cluster_growth_budget');
 assert(free>=b.diskReserve+(initial?b.clusterGrowth:0),'recovery_free_space_reserve');
}
function treeBytes(directory){
 let bytes=0;
 for(const item of readdirSync(directory,{withFileTypes:true})){
  const p=path.join(directory,item.name),s=lstatSync(p);assert(!s.isSymbolicLink(),'recovery_directory_redirect');
  if(s.isDirectory())bytes+=treeBytes(p);else{assert(s.isFile(),'recovery_unexpected_file_kind');bytes+=s.size;}
 }
 return bytes;
}
const freeBytes=p=>{const s=statfsSync(p);return s.bavail*s.bsize;};
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');

export function attendanceRecoveryWithoutComments(source){
 assert.equal(typeof source,'string');assert(source.length<=MiB,'recovery_function_body_budget');
 let out='',i=0;
 while(i<source.length){
  if(source.startsWith('--',i)){const end=source.indexOf('\n',i);i=end<0?source.length:end;out+=' ';continue;}
  if(source.startsWith('/*',i)){let depth=1;i+=2;while(i<source.length&&depth){
   if(source.startsWith('/*',i)){depth++;i+=2;}else if(source.startsWith('*/',i)){depth--;i+=2;}else i++;
  }assert.equal(depth,0,'recovery_unclosed_comment');out+=' ';continue;}
  const ch=source[i];
  if(ch==="'"||ch==='"'){
   const start=i++;let closed=false;
   while(i<source.length){if(source[i]==='\\'){i+=2;continue;}
    if(source[i]===ch){i++;if(source[i]===ch){i++;continue;}closed=true;break;}i++;}
   assert(closed,'recovery_unclosed_quote');out+=source.slice(start,i);continue;
  }
  const tag=ch==='$'?source.slice(i).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i)?.[0]:null;
  if(tag){const end=source.indexOf(tag,i+tag.length);assert(end>=0,'recovery_unclosed_dollar_quote');out+=source.slice(i,end+tag.length);i=end+tag.length;continue;}
  out+=ch;i++;
 }
 return out;
}
export function attendanceRecoveryDependencyReport(value){
 assert(Array.isArray(value.external)&&Array.isArray(value.textCandidates));
 const references=value.textCandidates.filter(p=>{
  assert(typeof p.name==='string');
  return /\b(?:auth|public|extensions)"?\s*\.\s*"?[a-z_]/i.test(attendanceRecoveryWithoutComments(p.body));
 }).map(p=>p.name);
 return {external:value.external,textReferences:references};
}

// Catalog-bound dependencies plus known textual schema references are checked.
// This is a local fixture preflight, not a general PL/pgSQL dependency analyzer.
export function attendanceRecoveryDependencySql(schema){
 assert.match(schema,/^attendance_race_[a-f0-9]{32}$/);
 return `with members as (
 select 'pg_namespace'::regclass classid,oid objid from pg_namespace where nspname='${schema}'
 union all select 'pg_class'::regclass,oid from pg_class where relnamespace='${schema}'::regnamespace
 union all select 'pg_proc'::regclass,oid from pg_proc where pronamespace='${schema}'::regnamespace
 union all select 'pg_type'::regclass,oid from pg_type where typnamespace='${schema}'::regnamespace
 union all select 'pg_constraint'::regclass,oid from pg_constraint where connamespace='${schema}'::regnamespace
 union all select 'pg_trigger'::regclass,t.oid from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='${schema}'::regnamespace
 union all select 'pg_rewrite'::regclass,t.oid from pg_rewrite t join pg_class c on c.oid=t.ev_class where c.relnamespace='${schema}'::regnamespace
 union all select 'pg_attrdef'::regclass,t.oid from pg_attrdef t join pg_class c on c.oid=t.adrelid where c.relnamespace='${schema}'::regnamespace
 union all select 'pg_policy'::regclass,t.oid from pg_policy t join pg_class c on c.oid=t.polrelid where c.relnamespace='${schema}'::regnamespace
 ), dependencies as (
 select distinct r.type,r.schema,r.identity from members m join pg_depend d on d.classid=m.classid and d.objid=m.objid
 cross join lateral pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) r
 where (r.schema is not null and r.schema not in ('${schema}','pg_catalog'))
 or (r.type='schema' and r.identity not in ('${schema}','pg_catalog')) or r.type='extension'
 ) select jsonb_build_object('external',(select coalesce(jsonb_agg(to_jsonb(d) order by d.identity),'[]') from dependencies d),
 'textCandidates',(select coalesce(jsonb_agg(jsonb_build_object('name',proname,'body',prosrc) order by proname),'[]')
 from pg_proc where pronamespace='${schema}'::regnamespace and prokind='f'
 and prosrc ~* '\\m(auth|public|extensions)"?[[:space:]]*\\.'));`;
}

export async function runAttendanceRecoveryNative(args,extension=null){
 assert(extension===null||(typeof extension==='object'&&Object.keys(extension).sort().join(',')==='phase,prepare'
  &&extension.phase===226&&typeof extension.prepare==='function'),'recovery_extension_invalid');
 assert.equal(args.at(-1),'--allow-synthetic-restore','recovery_explicit_target_and_dump_approval_required');
 const reuseArgs=args.slice(0,-1),directory=attendanceLabelsReuseDirectory(reuseArgs,realpathSync(tmpdir()));
 const config=attendanceNativeConfig(['--run-local']);
 const root=fileURLToPath(new URL('../',import.meta.url)),temporaryRoot=realpathSync(path.join(root,'.tmp'));
 assert.equal(temporaryRoot.toLowerCase(),path.resolve(root,'.tmp').toLowerCase(),'recovery_temp_root_redirect');
 const clusterBefore=treeBytes(directory);
 attendanceRecoveryResourceGuard({free:freeBytes(directory),initial:true});
 assert(freeBytes(temporaryRoot)>=64*MiB,'recovery_dump_volume_reserve');
 const bins={...config.binaries,...Object.fromEntries(['pg_dump','pg_restore'].map(n=>[n,path.join(path.dirname(config.binaries.psql),`${n}.exe`)]))};
 for(const bin of Object.values(bins))assert(existsSync(bin),'recovery_binary_missing');
 const windows=process.env.SystemRoot||'C:\\Windows';
 const env={SystemRoot:windows,WINDIR:windows,COMSPEC:path.join(windows,'System32','cmd.exe'),
  PATH:`${path.dirname(config.binaries.psql)};${path.join(windows,'System32')}`,TEMP:directory,TMP:directory,
  PGHOSTADDR:'127.0.0.1',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5',PGPASSFILE:path.join(directory,'no-credentials.pgpass'),
  PGAPPNAME:'faolla_attendance_restore_local',PGOPTIONS:'-c lc_messages=C -c statement_timeout=10000 -c lock_timeout=3000'};
 assert(!existsSync(env.PGPASSFILE),'recovery_must_not_load_credentials');
 const dbArgs=db=>['--host=127.0.0.1',`--port=${config.port}`,'--username=postgres',`--dbname=${db}`,'--no-password'];
 const query=(db,sql)=>{
  assert(db===config.database||db===target,'recovery_database_not_owned');
  const r=spawnSync(bins.psql,[...dbArgs(db),'--no-psqlrc','--quiet','--tuples-only','--no-align','--set=ON_ERROR_STOP=1'],
   {input:sql,env,encoding:'utf8',shell:false,windowsHide:true,timeout:25000,maxBuffer:4*MiB});
  assert(!r.error&&!r.signal,'recovery_sql_process_failed');assert.equal(r.status,0,`recovery_sql_failed:${r.stderr}`);return r.stdout.trim();
 };
 const target=`faolla_attendance_restore_${randomUUID().replaceAll('-','')}`,marker=`faolla-synthetic-restore:${randomUUID()}`;
 let owned=null,provisional=null,artifactDirectory=null,dumpFile=null,dumpIdentity=null,artifactIdentity=null;
 let peakGrowth=0,peakTarget=0,dumpBytes=0,targetRemoved=false,dumpRemoved=false;
 const targetIdentity=()=>JSON.parse(query(config.database,`select jsonb_build_object('oid',oid::bigint,'name',datname,'owner',datdba::regrole::text,'marker',shobj_description(oid,'pg_database')) from pg_database where datname='${target}';`));
 const monitor=()=>{
  const growth=Math.max(0,treeBytes(directory)-clusterBefore),dump=dumpFile&&existsSync(dumpFile)?lstatSync(dumpFile).size:0;
  const targetPath=provisional?path.join(directory,'data','base',String(provisional.oid)):null;
  const targetBytes=targetPath&&existsSync(targetPath)?treeBytes(targetPath):0;
  peakGrowth=Math.max(peakGrowth,growth);peakTarget=Math.max(peakTarget,targetBytes);
  attendanceRecoveryResourceGuard({growth,dump,target:targetBytes,free:freeBytes(directory)});
  assert(freeBytes(temporaryRoot)>=32*MiB,'recovery_dump_volume_reserve');
 };
 const run=async(binary,parameters)=>{
  monitor();
  await new Promise((resolve,reject)=>{
   const p=spawn(binary,parameters,{env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='',failure=null;
   const fail=e=>{failure??=e;p.kill();};
   p.stdout.on('data',v=>{stdout+=v;if(stdout.length>MiB)fail(new Error('recovery_output_budget'));});
   p.stderr.on('data',v=>{stderr=(stderr+v).slice(-MiB);});
   p.once('error',e=>{failure=e;});
   const timer=setTimeout(()=>fail(new Error('recovery_process_deadline')),60000);
   const budget=setInterval(()=>{try{monitor();}catch(e){fail(e);}},250);
   p.once('close',(code,signal)=>{clearTimeout(timer);clearInterval(budget);
    if(failure)reject(failure);else if(code!==0||signal)reject(new Error(`recovery_tool_failed:${path.basename(binary)}:${stderr}`));else resolve();});
  });monitor();
 };
 return runAttendanceOutageRelationsRacesNative(reuseArgs,async ctx=>{
  const {d,scope,native}=ctx;assert(d.syntheticOnly===true);assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned);
  const added=extension===null?null:await extension.prepare(ctx);
  if(added!==null){assert(added&&typeof added.verifyRestored==='function'&&added.summary&&typeof added.summary==='object');
   assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned);}
  const metadataSql=`select jsonb_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,'provider',datlocprovider) from pg_database where datname=current_database();`;
  const sourceMeta=JSON.parse(query(config.database,metadataSql));assert.equal(sourceMeta.provider,'c');
  assert.equal(query(config.database,`select count(*) from pg_database d join pg_tablespace t on t.oid=d.dattablespace where d.datname in (current_database(),'template0') and t.spcname='pg_default';`),'2','recovery_default_tablespace_required');
  assert.equal(query(config.database,`select count(*) from pg_class where relnamespace='${scope.schema}'::regnamespace and reltablespace<>0;`),'0','recovery_external_tablespace_forbidden');
  const rolesSql=`select jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'bypass',rolbypassrls,'super',rolsuper,'inherit',rolinherit) order by rolname) from pg_roles where rolname in ('postgres','anon','authenticated','service_role');`;
  const sourceRoles=JSON.parse(query(config.database,rolesSql));
  assert.deepEqual(sourceRoles.map(r=>r.name),['anon','authenticated','postgres','service_role']);
  for(const r of sourceRoles.filter(r=>r.name!=='postgres'))assert.equal(r.login,false,'recovery_synthetic_role_login_not_expected');
  assert.equal(query(config.database,`select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid();`),'0','recovery_source_not_quiescent');
  const dependencies=attendanceRecoveryDependencyReport(JSON.parse(query(config.database,attendanceRecoveryDependencySql(scope.schema))));
  assert.deepEqual(dependencies,{external:[],textReferences:[]},'recovery_external_dependencies_require_review');
  assert.equal(query(config.database,`select count(*) from pg_proc p,unnest(p.proconfig) c where p.pronamespace='${scope.schema}'::regnamespace and c ~* '^search_path=.*\\m(auth|public|extensions)\\M';`),'0','recovery_external_search_path');
  const sourceBytes=Number(query(config.database,`select coalesce(sum(pg_total_relation_size(oid)),0)::bigint from pg_class where relnamespace='${scope.schema}'::regnamespace and relkind in ('r','m');`));
  const templateBytes=Number(query(config.database,`select pg_database_size('template0');`));
  attendanceRecoveryResourceGuard({source:sourceBytes,free:freeBytes(directory),initial:true});
  assert(sourceBytes+templateBytes<=attendanceRecoveryBudgets.target,'recovery_estimated_target_budget');
  const profile=db=>JSON.parse(query(db,`begin isolation level repeatable read read only;set local timezone='UTC';set local datestyle='ISO,YMD';set local extra_float_digits=3;set local search_path=pg_catalog;set local row_security=off;set local bytea_output='hex';set local intervalstyle='postgres';${buildAttendanceRecoveryContentSql({schema:scope.schema})}commit;`));
  const same=(expected,actual)=>{try{return assertAttendanceRecoveryContentMatch(expected,actual);}catch(error){
   console.error(JSON.stringify({recoveryProfileMismatch:{schemaPresent:actual.schemaPresent,limited:actual.limited,unsupported:actual.unsupported,
    relations:actual.relations.filter((r,i)=>JSON.stringify(r)!==JSON.stringify(expected.relations[i])).map(r=>({name:r.name,present:r.present,limited:r.limited,rowCount:r.rowCount})),
    catalog:Object.entries(actual.catalog).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(expected.catalog[key])).map(([key,value])=>({category:key,count:value.count,limited:value.limited}))}}));throw error;
  }};
  const before=profile(config.database),businessBaseline=await captureAttendanceRecoveryBusinessBaseline(ctx);
  if(added!==null)assert(before.relations.every(r=>r.present),'recovery_extended_roster_incomplete');
  const effectivePrivilegesSql=`select encode(sha256(convert_to(jsonb_agg(jsonb_build_array(c.relname,r.rolname,p.privilege,
   has_table_privilege(r.oid,c.oid,p.privilege),has_table_privilege(r.oid,c.oid,p.privilege||' WITH GRANT OPTION'))
   order by c.relname collate "C",r.rolname collate "C",p.privilege collate "C")::text,'UTF8')),'hex')
   from pg_class c cross join pg_roles r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(privilege)
   where c.relnamespace='${scope.schema}'::regnamespace and c.relkind in ('r','p','v','m','f') and r.rolname in ('postgres','anon','authenticated','service_role');`;
  const effectivePrivileges=query(config.database,effectivePrivilegesSql);
  let result,failure;
  try{
   assert.equal(query(config.database,`select count(*) from pg_database where datname='${target}';`),'0');
   query(config.database,`create database ${target} owner postgres template template0 encoding ${quote(sourceMeta.encoding)} lc_collate ${quote(sourceMeta.collate)} lc_ctype ${quote(sourceMeta.ctype)};`);
   {const candidate=targetIdentity();
    assert(candidate&&Number.isSafeInteger(candidate.oid)&&candidate.oid>0);
    assert.deepEqual(candidate,{oid:candidate.oid,name:target,owner:'postgres',marker:null});provisional=candidate;}
   query(config.database,`comment on database ${target} is '${marker}';`);
   {const candidate=targetIdentity();attendanceRecoveryTargetIdentity(candidate,{...provisional,marker});owned=candidate;}
   assert.deepEqual(JSON.parse(query(target,metadataSql)),sourceMeta);
   assert.deepEqual(JSON.parse(query(target,rolesSql)),sourceRoles);
   assert.equal(query(target,`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema';`),'0','recovery_empty_target_required');
   artifactDirectory=realpathSync(mkdtempSync(path.join(temporaryRoot,'attendance-restore-')));
   assert.equal(path.dirname(artifactDirectory).toLowerCase(),temporaryRoot.toLowerCase());
   artifactIdentity=lstatSync(artifactDirectory);dumpFile=path.join(artifactDirectory,'synthetic.dump');assert(!existsSync(dumpFile));
   try{await run(bins.pg_dump,[...dbArgs(config.database),'--format=custom','--compress=6','--strict-names',`--schema=${scope.schema}`,`--file=${dumpFile}`]);}
   finally{if(existsSync(dumpFile)){
    const current=lstatSync(dumpFile);assert(current.isFile()&&!current.isSymbolicLink(),'recovery_dump_file_kind');
    assert(current.size<=attendanceRecoveryBudgets.dump+MiB,'recovery_partial_dump_retained_over_budget');
    dumpIdentity={size:current.size,sha256:sha(dumpFile)};
   }}
   dumpBytes=dumpIdentity.size;
   assert(dumpBytes>0&&dumpBytes<=attendanceRecoveryBudgets.dump);
   same(before,profile(config.database));
   attendanceRecoveryTargetIdentity(targetIdentity(),owned);
   await run(bins.pg_restore,[...dbArgs(target),'--single-transaction','--exit-on-error',dumpFile]);
   peakTarget=Number(query(config.database,`select pg_database_size('${target}');`));
   attendanceRecoveryResourceGuard({source:sourceBytes,target:peakTarget,dump:dumpBytes,growth:peakGrowth,free:freeBytes(directory)});
   try{same(before,profile(target));}catch(error){
    for(const category of ['relations','constraints']){
     const inspect=db=>JSON.parse(query(db,`begin isolation level repeatable read read only;set local timezone='UTC';set local datestyle='ISO,YMD';set local extra_float_digits=3;set local search_path=pg_catalog;set local row_security=off;set local bytea_output='hex';set local intervalstyle='postgres';${buildAttendanceRecoveryCatalogDiagnosticSql({schema:scope.schema,category})}commit;`));
     const source=inspect(config.database),restored=inspect(target);assert(!source.limited&&!restored.limited);
     const map=new Map(source.entries.map(x=>[JSON.stringify(x.key),x.value]));
     const differences=restored.entries.filter(x=>JSON.stringify(map.get(JSON.stringify(x.key)))!==JSON.stringify(x.value));
     console.error(JSON.stringify({catalogDiagnostic:{category,count:differences.length,items:differences.slice(0,5).map(x=>({key:x.key,
      changes:x.value.flatMap((v,i)=>JSON.stringify(v)===JSON.stringify(map.get(JSON.stringify(x.key))?.[i])?[]:[{field:i,source:map.get(JSON.stringify(x.key))?.[i],restored:v}])}))}}));
   }throw error;
   }
   assert.equal(query(target,effectivePrivilegesSql),effectivePrivileges,'recovery_effective_privileges_changed');
   const business=await verifyAttendanceRecoveryNativeChecks(ctx,{restoredExec:sql=>query(target,scope.sql(sql)),baseline:businessBaseline});
   const extended=added===null?null:await added.verifyRestored(sql=>query(target,scope.sql(sql)));
   same(before,profile(target));same(before,profile(config.database));
   assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned);assert.deepEqual(JSON.parse(query(config.database,rolesSql)),sourceRoles);
   assert.equal(query(config.database,effectivePrivilegesSql),effectivePrivileges);
   assert.deepEqual(dependencies,attendanceRecoveryDependencyReport(JSON.parse(query(target,attendanceRecoveryDependencySql(scope.schema)))));
   native.pass('225 actual synthetic pg_dump/pg_restore preserve attendance rows, catalog protections, archives and original read receipts without changing source');
   if(extended!==null)native.pass('226 restored complete attendance roster and explicit revoked credential, pause and delegation samples remain enforced');
   result={phase:225,sourceBytes,templateBytes,dumpBytes,targetBytes:peakTarget,peakClusterGrowth:peakGrowth,
    relationCoverage:{present:before.relations.filter(r=>r.present).length,missing:before.relations.filter(r=>!r.present).map(r=>r.name)},
    sameSchemaName:true,sourceUnchanged:true,profilesEqual:true,effectivePrivilegesEqual:true,dependencies,business,newCluster:false,globalRolesRestored:false,
    realAuth:false,productionAccess:false,deployed:false,...(extended===null?{}:{extension:{phase:extension.phase,preparation:added.summary,verification:extended}})};
  }catch(e){failure=e;}
  const cleanupErrors=[];
  if(!owned&&provisional){try{
   // A failed COMMENT response may have committed. Recover only our exact new
   // database OID; if the comment did not land, verify the saved pre-comment
   // identity before attaching the independent marker for guarded cleanup.
   const current=targetIdentity();
   if(current?.marker===null){assert.deepEqual(current,provisional);query(config.database,`comment on database ${target} is '${marker}';`);}
   {const candidate=targetIdentity();attendanceRecoveryTargetIdentity(candidate,{...provisional,marker});owned=candidate;}
  }catch(e){cleanupErrors.push(e);}}
  if(owned){try{
   attendanceRecoveryTargetIdentity(targetIdentity(),{...provisional,marker});
   assert.equal(query(config.database,`select count(*) from pg_stat_activity where datname='${target}';`),'0','recovery_target_connections_present');
   query(config.database,`drop database ${target};`);assert.equal(query(config.database,`select count(*) from pg_database where datname='${target}';`),'0');targetRemoved=true;
  }catch(e){cleanupErrors.push(e);}}
  if(artifactDirectory){try{
   assert.equal(realpathSync(artifactDirectory),artifactDirectory);const current=lstatSync(artifactDirectory);
   assert.equal(current.ino,artifactIdentity.ino);assert.equal(current.dev,artifactIdentity.dev);
   assert.deepEqual(readdirSync(artifactDirectory).sort(),dumpFile&&existsSync(dumpFile)?['synthetic.dump']:[]);
   if(dumpFile&&existsSync(dumpFile)){
    assert(dumpIdentity,'recovery_incomplete_dump_retained_for_inspection');assert(!lstatSync(dumpFile).isSymbolicLink());
    assert.deepEqual({size:lstatSync(dumpFile).size,sha256:sha(dumpFile)},dumpIdentity,'recovery_dump_identity_changed');unlinkSync(dumpFile);
   }
   rmdirSync(artifactDirectory);dumpRemoved=true;
  }catch(e){cleanupErrors.push(e);}}
  if(failure||cleanupErrors.length){
   console.error(JSON.stringify({recoveryTarget:target,targetOid:provisional?.oid??null,targetRemoved,artifactDirectory,dumpRemoved,sourceOverwritten:false}));
   throw new AggregateError([failure,...cleanupErrors].filter(Boolean),'attendance_recovery_failed');
  }
  return {...result,targetRemoved,dumpRemoved};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceRecoveryNative(process.argv.slice(2))
 .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
