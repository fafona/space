import assert from 'node:assert/strict';
import {TEMPLATE_BASELINE,TEMPLATE_SCHEMA} from './application-release-template-contract.mjs';
// Derive a separate workflow. Every existing signed-backup, CI, SSH trust,
// identity, source, baseline, postflight and evidence gate stays in place.
export function templateMigrationWorkflow(original){
 let source=original.replaceAll('\r\n','\n');
 const replace=(before,after,count)=>{assert.equal(source.split(before).length-1,count,'template workflow source drift: '+before);source=source.replaceAll(before,after);};
 replace('name: Apply Booking Safeupdate Online','name: Apply Website Template Table Online',1);
 replace('f274ad615550c83717aa7af2ad32339608e6f8aa',TEMPLATE_BASELINE,2);
 replace('202611050213',TEMPLATE_SCHEMA.version,4);
 replace('APPLY_BOOKING_SAFEUPDATE_202611050213','APPLY_WEBSITE_TEMPLATE_TABLE_202611100214',0);
 // The version substitution above intentionally preserves the old confirmation
 // prefix until this independently asserted rename.
 replace('APPLY_BOOKING_SAFEUPDATE_202611100214','APPLY_WEBSITE_TEMPLATE_TABLE_202611100214',2);
 replace('Verify Pinned Booking Safeupdate Online Scope','Verify Pinned Website Template Table Scope',1);
 const uses=source.split('scripts/booking-safeupdate-online.mjs').length-1;assert.equal(uses,6);
 replace('scripts/booking-safeupdate-online.mjs','scripts/application-release-template-migrate.mjs',uses);
 // SSH stdout is the single final apply report. Preflight acknowledgements
 // remain visible as diagnostics, never a second JSON document on that stream.
 replace('node scripts/application-release-template-migrate.mjs dry-run "$dry_report_path"',
  'node scripts/application-release-template-migrate.mjs dry-run "$dry_report_path" >&2',1);
 replace('# The pinned migration holds the existing booking singleton lock and\n          # verifies unchanged booking rows/control/ACLs inside its transaction.',
  '# The pinned additive migration holds the shared migration transaction lock.\n          # Existing booking schema/ACLs, process identities and business baseline remain verified.',1);
 return source;
}
