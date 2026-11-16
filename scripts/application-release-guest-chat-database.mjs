// Read-only installed proof. No migration, retry, DDL or arbitrary SQL entrypoint.
import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {templateStateSql,templateQuery,templateOriginalEvidence,templateInstalledReceipt,assertTemplateDatabaseObservation} from './application-release-template-database.mjs';
import {GUEST_SCHEMA,GUEST_SCHEMA_EXPRESSION,guestNeed as need,guestHash,assertGuestSchema} from './application-release-guest-chat-contract.mjs';
export const GUEST_HEAD='/var/lib/faolla-guest-chat-schema/installed.json';
export const guestStateSql=templateStateSql.replace("'registry',",`'guestSchema',${GUEST_SCHEMA_EXPRESSION},\n 'registry',`);
export function guestInstalledReceipt(){
 ownedReleasePath(GUEST_HEAD,{privateMode:true});const head=JSON.parse(fs.readFileSync(GUEST_HEAD));
 need(head.kind==='merchant-guest-chat-schema-head'&&/^[a-f0-9]{40}$/.test(head.target??'')&&
  /^\/var\/lib\/faolla-guest-chat-schema\/[a-f0-9]{40}\/[1-9][0-9]*-[1-9][0-9]*\/applied\.json$/.test(head.receipt??'')&&head.receipt.split('/')[4]===head.target,'head');
 ownedReleasePath(head.receipt,{privateMode:true});const bytes=fs.readFileSync(head.receipt);need(guestHash(bytes)===head.sha256,'receipt_changed');
 const receipt=JSON.parse(bytes);need(receipt.target===head.target,'receipt_target');return receipt;
}
export function assertGuestDatabaseObservation(state,evidence,templateReceipt,receipt=null){
 const projected=structuredClone(state),schema=projected.guestSchema;delete projected.guestSchema;
 if(receipt){
  need(receipt.kind==='merchant-guest-chat-schema-installed'&&receipt.version===GUEST_SCHEMA.version&&receipt.migrationSha256===GUEST_SCHEMA.sha256&&
   receipt.createdRowCount===0&&receipt.businessDataWritten===false&&receipt.mailEnabled===false&&receipt.processesUnchanged===true,'receipt');
  need(isDeepStrictEqual(projected.registry?.at(-1),{version:GUEST_SCHEMA.version,name:GUEST_SCHEMA.name}),'registry_tail');
  projected.registry=projected.registry.slice(0,-1);assertGuestSchema(schema);need(isDeepStrictEqual(schema,receipt.schema),'schema_changed');
 }else need(schema?.tables?.length===0&&schema.functions?.length===0&&schema.sequence===null,'schema_already_exists');
 const original=assertTemplateDatabaseObservation(projected,evidence,templateReceipt);
 return{kind:'merchant-guest-chat-schema-readonly-verified',version:receipt?GUEST_SCHEMA.version:null,original,databaseExecutionPerformed:false,businessDataWritten:false,mailEnabled:false};
}
export function assertGuestSchemaDatabase(manifest){
 need(manifest.schemaVersion===5&&isDeepStrictEqual(manifest.guestSchema,GUEST_SCHEMA),'descriptor');
 return assertGuestDatabaseObservation(JSON.parse(templateQuery(guestStateSql)),templateOriginalEvidence(),templateInstalledReceipt(),guestInstalledReceipt());
}
