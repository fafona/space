// Read-only verification of one previously executed repair. No migration runner,
// caller-provided SQL, DDL/DML, compensation or automatic retry is exposed.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {ownedReleasePath} from './release-toolchain-source.mjs';
const CONTAINER='0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416';
const AUDIT='/var/lib/faolla-booking-safeupdate-online/ba27e903ba13f8e9f17be357da4412c1fe5792d6/41985686554-1';
const HASHES={
 'before.json':'68a5e1f60cc01af728528145cb453d0d6299901ade7e9e024801b2196205fad6',
 'apply-result.json':'fa0dadff3f46ed0ad0b1ecfc89c7fa076499fb982875c5fe2a50f885fd1db8f1',
 'applied.json':'5c4de93db6bfb2b12d5b31da5c2864d7507108c157f449d4e4ec8aceb63ff6ea',
};
const need=(value,reason)=>{if(!value)throw Error('application_recorded_schema_'+reason);};
export const recordedSchemaReadOnlySql=`begin read only;
select jsonb_build_object('actor',current_user,'database',current_database(),
 'oid',(select oid::text from pg_database where datname=current_database()),
 'systemIdentifier',(select system_identifier::text from pg_control_system()),'serverVersionNum',current_setting('server_version_num'),
 'control',(select to_jsonb(c) from public.faolla_booking_atomic_control c where singleton),
 'function',(select jsonb_build_object('oid',oid,'owner',pg_get_userbyid(proowner),'acl',proacl,'config',proconfig,'definer',prosecdef,
 'bodyMd5',md5(replace(prosrc,chr(13),''))) from pg_proc where oid='public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)'::regprocedure),
 'access',jsonb_build_object('anon',has_function_privilege('anon','public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)','EXECUTE'),
 'authenticated',has_function_privilege('authenticated','public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)','EXECUTE'),
 'service',has_function_privilege('service_role','public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)','EXECUTE')),
 'registry',(select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations));
commit;`;
export function assertRecordedSchemaObservation(observed,{before,applied,result}){
 need(applied?.target==='ba27e903ba13f8e9f17be357da4412c1fe5792d6'&&applied.processesUnchanged===true&&applied.mailEnabled===false&&applied.transactionCheckedBookingRowsAndAcl===true,'original_receipt');
 need(isDeepStrictEqual(result?.executed,[{version:'202611050213',name:'booking_atomic_safeupdate_singleton',fileName:'202611050213_booking_atomic_safeupdate_singleton.sql'}])&&result.ok===true&&result.status==='applied','original_execution');
 const expected=applied.state;
 need(before?.state?.function?.bodyMd5==='310b382802e94af2997b1b9751fab0bc'&&expected?.function?.bodyMd5==='09fa13e69856221d61b6eaa544927b2a','original_function');
 for(const field of ['actor','database','oid','systemIdentifier','serverVersionNum','function','access','registry'])need(isDeepStrictEqual(observed?.[field],expected[field]),'database_'+field);
 need(observed.actor==='supabase_admin'&&observed.database==='postgres'&&observed.oid==='5'&&observed.systemIdentifier==='7612049595342295079'&&observed.serverVersionNum==='150008','database_identity');
 need(observed.control?.singleton===true&&observed.control.active===true&&observed.control.protocol===2&&observed.control.generation===expected.control.generation,'generation');
 need(observed.registry.length===212&&observed.registry.at(-1).version==='202611050213','registry');
 return{kind:'recorded-booking-schema-readonly-verified',version:'202611050213',functionBodyMd5:observed.function.bodyMd5,
  originalEvidencePreserved:true,databaseExecutionPerformed:false,at:new Date().toISOString()};
}
function run(command,args,input){
 const r=spawnSync(command,args,{input,encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024,windowsHide:true});
 need(r.status===0&&!r.error&&!r.signal,'read_failed');return r.stdout.trim();
}
export function assertRecordedSchemaDatabase(manifest){
 if(manifest?.schemaVersion!==2)return null;
 need(manifest.recordedSchema?.kind==='already-applied-booking-safeupdate-v1'&&manifest.recordedSchema.databaseExecution==='forbidden','descriptor');
 need(process.platform==='linux'&&process.getuid?.()===0,'runtime');
 const evidence={};
 for(const [file,hash]of Object.entries(HASHES)){
  const full=AUDIT+'/'+file;ownedReleasePath(full,{privateMode:true});const bytes=fs.readFileSync(full);
  need(createHash('sha256').update(bytes).digest('hex')===hash,'original_evidence_changed');
  evidence[file==='before.json'?'before':file==='applied.json'?'applied':'result']=JSON.parse(bytes);
 }
 const container=JSON.parse(run('docker',['inspect',CONTAINER]))[0];
 need(container.Id===CONTAINER&&container.Name==='/supabase-db'&&container.State.Running===true&&
  container.Mounts.some(m=>m.Type==='bind'&&m.Source==='/opt/supabase/docker/volumes/db/data'&&m.RW===true),'container');
 const shell=['set -eu',': "${POSTGRES_PASSWORD:?}"',': "${POSTGRES_DB:?}"','export PGPASSWORD="$POSTGRES_PASSWORD"',
  "export PGOPTIONS='-c lock_timeout=2s -c statement_timeout=10s'",
  'exec psql -h localhost -U supabase_admin -d "$POSTGRES_DB" --no-password -X -qAt -v ON_ERROR_STOP=1'].join('\n');
 return assertRecordedSchemaObservation(JSON.parse(run('docker',['exec','-i',CONTAINER,'sh','-lc',shell],recordedSchemaReadOnlySql)),evidence);
}
