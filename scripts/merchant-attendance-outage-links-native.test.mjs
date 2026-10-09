//Static driver checks only; no runtime import or PostgreSQL acceptance claim.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-outage-links-native.mjs',import.meta.url),'utf8');
test('212 reuses211 sealed owned callback and exactly177, without new environment',()=>{
 assert(source.includes('return runAttendanceOutageNative(args,async ctx=>'));
 assert(source.includes('outageFoundation.rollbackRestored,true'));
 assert(source.includes("outageLinksNativeMigration='202610070177_merchant_attendance_outage_links.sql'"));
 assert(source.includes('assertLifecycleSandbox(sql=>native.query(scope.sql(sql)))'));
 assert(source.includes('assert.deepEqual(owned,d.owned)'));
 for(const forbidden of ['initdb','CREATE DATABASE','pg_dump','spawn(','chromium','playwright','npm run build','supabase.co'])assert(!source.includes(forbidden),forbidden);
});
test('177 install/reentry preserves every preexisting function body, ACL and fact',()=>{
 for(const token of ['pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef','p.oid=any(',
  'outage_links_install_changed_old_facts','outage_links_install_changed_old_functions','outage_links_reapply_changed_facts',
  'assert.equal(d.definitions(),definitions)','assert.equal(d.tableCatalog(),catalog)'])assert(source.includes(token),token);
});
test('fixture rollback and both actually sealed archives precede reporting',()=>{
 const fixture=source.indexOf('await verifyAttendanceOutageLinksNative(ctx)'),rollback=source.indexOf('outage_links_fixture_did_not_rollback'),result=source.indexOf('const result={phase:212');
 assert(fixture>=0&&rollback>fixture&&result>rollback);
 for(const token of ['archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,sealedArchive.artifactText','periodArchive().artifactSha256,sealedArchive.artifactSha256',
  'sourceResolutionImplemented:false,periodOutageGateImplemented:false'])assert(source.includes(token),token);
 assert(!source.includes('set sealed='));assert(!source.includes('reopen'));
});

test('later foundations opt in only after212 rollback and leave default result unchanged',()=>{
 assert(source.includes('runAttendanceOutageLinksNative(args,after=null)'));
 assert(source.includes("assert(after===null||typeof after==='function','outage_links_owned_extension_invalid')"));
 const hook=source.indexOf('if(after!==null)return {...result,extension:await after({...ctx,outageLinksFoundation:result})}');
 assert(hook>source.indexOf('outage_links_fixture_did_not_rollback'));
 assert(hook>source.indexOf('periodArchive().artifactSha256,sealedArchive.artifactSha256'));
 assert(source.slice(hook).includes('return result;'));
});
test('import is inert and direct CLI failure remains nonzero',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));
 assert(source.includes('process.exitCode=1'));assert(!source.includes('process.exit(0)'));
});
