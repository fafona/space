// Retains signed backups, SSH trust, exact source, no-maintenance and postflight checks.
import assert from 'node:assert/strict';
import {GUEST_BASELINE,GUEST_SCHEMA} from './application-release-guest-chat-contract.mjs';
import {TEMPLATE_BASELINE,TEMPLATE_SCHEMA} from './application-release-template-contract.mjs';
export function guestMigrationWorkflow(original){
 let source=original.replaceAll('\r\n','\n');
 const replace=(a,b,count)=>{assert.equal(source.split(a).length-1,count,'guest workflow source drift: '+a);source=source.replaceAll(a,b);};
 replace('name: Apply Website Template Table Online','name: Apply Merchant Guest Chat Online',1);replace(TEMPLATE_BASELINE,GUEST_BASELINE,2);
 replace(TEMPLATE_SCHEMA.version,GUEST_SCHEMA.version,4);replace('APPLY_WEBSITE_TEMPLATE_TABLE_202611160215','APPLY_MERCHANT_GUEST_CHAT_202611160215',2);
 replace('Verify Pinned Website Template Table Scope','Verify Pinned Merchant Guest Chat Scope',1);replace('scripts/application-release-template-migrate.mjs','scripts/application-release-guest-chat-migrate.mjs',6);
 return source;
}
