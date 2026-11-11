// Read-only adapter. The original 213 verifier and all of its pins are unchanged.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {assertRecordedSchemaDatabase as original,assertRecordedSchemaObservation,recordedSchemaReadOnlySql} from './application-release-recorded-schema.mjs';
import {TEMPLATE_SCHEMA,TEMPLATE_TABLE_EXPRESSION,templateNeed as need,templateHash,assertTemplateTable} from './application-release-template-contract.mjs';
export const TEMPLATE_CONTAINER='0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416';
export const TEMPLATE_HEAD='/var/lib/faolla-template-schema/installed.json';
const ORIGINAL='/var/lib/faolla-booking-safeupdate-online/ba27e903ba13f8e9f17be357da4412c1fe5792d6/41985686554-1';
const HASHES={'before.json':'68a5e1f60cc01af728528145cb453d0d6299901ade7e9e024801b2196205fad6',
 'apply-result.json':'fa0dadff3f46ed0ad0b1ecfc89c7fa076499fb982875c5fe2a50f885fd1db8f1',
 'applied.json':'5c4de93db6bfb2b12d5b31da5c2864d7507108c157f449d4e4ec8aceb63ff6ea'};
export function templatePrivateJson(file){ownedReleasePath(file,{privateMode:true});return JSON.parse(fs.readFileSync(file,'utf8'));}
export function templateOriginalEvidence(){
 const evidence={};for(const [file,hash]of Object.entries(HASHES)){
  const full=ORIGINAL+'/'+file;ownedReleasePath(full,{privateMode:true});const bytes=fs.readFileSync(full);
  need(templateHash(bytes)===hash,'original_evidence_changed');evidence[file==='before.json'?'before':file==='applied.json'?'applied':'result']=JSON.parse(bytes);
 }return evidence;
}
export const templateStateSql=recordedSchemaReadOnlySql.replace("'registry',",`'templateTable',${TEMPLATE_TABLE_EXPRESSION},\n 'registry',`);
export function assertTemplateDatabaseObservation(state,evidence,receipt=null){
 const table=state?.templateTable,projected=structuredClone(state);delete projected.templateTable;
 if(receipt){
  need(receipt.kind==='website-template-schema-installed'&&receipt.version===TEMPLATE_SCHEMA.version&&receipt.migrationSha256===TEMPLATE_SCHEMA.sha256&&
   receipt.createdRowCount===0&&receipt.businessDataWritten===false&&receipt.mailEnabled===false&&receipt.processesUnchanged===true,'receipt');
  need(state.registry?.at(-1)?.version===TEMPLATE_SCHEMA.version&&state.registry.at(-1).name===TEMPLATE_SCHEMA.name,'registry_tail');
  projected.registry=state.registry.slice(0,-1);assertTemplateTable(table);
  need(isDeepStrictEqual(table,receipt.table),'schema_changed');
 }else need(table===null,'table_already_exists');
 // No extra registry rows, booking schema/ACL changes, or identity shortcuts.
 const oldProof=assertRecordedSchemaObservation(projected,evidence);
 return {kind:'website-template-schema-readonly-verified',version:receipt?TEMPLATE_SCHEMA.version:null,original:oldProof,
  databaseExecutionPerformed:false,businessDataWritten:false,mailEnabled:false};
}
function run(command,args,input){
 const result=spawnSync(command,args,{input,encoding:'utf8',timeout:20000,maxBuffer:4*1024**2,windowsHide:true});
 need(!result.error&&!result.signal&&result.status===0,'database_command_failed');return result.stdout.trim();
}
// Fixed normal configured database credentials remain inside the container.
export function templateQuery(sql){
 need(process.platform==='linux'&&process.getuid?.()===0,'host_runtime');
 const c=JSON.parse(run('docker',['inspect',TEMPLATE_CONTAINER]))[0];
 need(c.Id===TEMPLATE_CONTAINER&&c.Name==='/supabase-db'&&c.State.Running===true&&c.Mounts.some(m=>m.Type==='bind'&&
  m.Source==='/opt/supabase/docker/volumes/db/data'&&m.RW===true),'container');
 const shell=['set -eu',': "${POSTGRES_PASSWORD:?}"',': "${POSTGRES_DB:?}"','export PGPASSWORD="$POSTGRES_PASSWORD"',
  "export PGOPTIONS='-c lock_timeout=2s -c statement_timeout=10s'",'exec psql -h localhost -U supabase_admin -d "$POSTGRES_DB" --no-password -X -qAt -v ON_ERROR_STOP=1'].join('\n');
 return run('docker',['exec','-i',TEMPLATE_CONTAINER,'sh','-lc',shell],sql);
}
export function templateInstalledReceipt(){
 const head=templatePrivateJson(TEMPLATE_HEAD);
 need(head.kind==='website-template-schema-head'&&/^[a-f0-9]{40}$/.test(head.target??'')&&
  /^\/var\/lib\/faolla-template-schema\/[a-f0-9]{40}\/[1-9][0-9]*-[1-9][0-9]*\/applied\.json$/.test(head.receipt??'')&&
  head.receipt.split('/')[4]===head.target&&/^[a-f0-9]{64}$/.test(head.sha256??''),'head');
 ownedReleasePath(head.receipt,{privateMode:true});const bytes=fs.readFileSync(head.receipt);need(templateHash(bytes)===head.sha256,'receipt_changed');
 const receipt=JSON.parse(bytes);need(receipt.target===head.target,'receipt_target');return receipt;
}
export function assertRecordedSchemaDatabase(manifest){
 if(manifest?.schemaVersion!==3)return original(manifest);
 need(isDeepStrictEqual(manifest.templateSchema,TEMPLATE_SCHEMA),'descriptor');
 return assertTemplateDatabaseObservation(JSON.parse(templateQuery(templateStateSql)),templateOriginalEvidence(),templateInstalledReceipt());
}
