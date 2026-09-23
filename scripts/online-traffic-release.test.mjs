import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertOnlineTrafficScope,assertPendingTrafficMigrations,onlineProxy,hasExpectedCardWebsite} from './online-traffic-release-policy.mjs';
test('scope accepts analytics only, rejects auth, workers, dependencies and unrelated data migrations',()=>{
 for(const file of ['src/lib/accountTrafficCampaign.server.ts','src/app/api/traffic/collect/route-handler.ts','src/app/api/super-admin/traffic/campaign/route.test.ts','scripts/supabase-migrations/202609230051_account_traffic_outcomes_campaigns_export.sql'])assert.doesNotThrow(()=>assertOnlineTrafficScope([file]));
 for(const file of ['src/app/api/auth/signin/route.ts','package-lock.json','scripts/deploy.production.sh','src/lib/merchantEnterpriseAutomation.server.ts','scripts/supabase-migrations/202609230052_delete.sql'])assert.throws(()=>assertOnlineTrafficScope([file]));
 assert.throws(()=>assertOnlineTrafficScope([]));
});
test('owned upstream changes preserve fallback, real IP, cache, auth and all other nginx bytes',()=>{
 const before='proxy_pass http://127.0.0.1:3102;\nproxy_set_header X-Real-IP $remote_addr;\nproxy_cache off;\nproxy_pass http://127.0.0.1:3000;';
 assert.equal(onlineProxy(before,3102,3103,'a'.repeat(40)),before.replace(':3102;',':3103;'));
 assert.throws(()=>onlineProxy(before,3104,3103,'a'.repeat(40)));assert.throws(()=>onlineProxy(before,3102,3000,'a'.repeat(40)));
});
test('only explicitly approved additive migrations can run',()=>{
 assert.doesNotThrow(()=>assertPendingTrafficMigrations([{version:'202609230049'},{version:'202609230051'}]));
 assert.throws(()=>assertPendingTrafficMigrations([{version:'202609230048'}]));
});
test('website probe checks actual destination, independent of analytics attribute ordering',()=>{
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" data-traffic-action="website_click" href="https://www.haoyouduosevilla.com/">'),true);
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" href="https://www.haoyouduosevilla.com/">'),true);
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" href="https://haoyouduo.faolla.com/">'),false);
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" data-href="https://www.haoyouduosevilla.com/" href="https://other.example/">'),false);
});
test('controller preserves legacy state, workers and assets; backup precedes apply and switch has rollback',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.ok(code.indexOf('verifyProductionDatabaseBackup({')<code.indexOf("through:'202609230051',apply:true"));
 assert.match(code,/COPYFILE_EXCL/);assert.match(code,/static_collision/);assert.match(code,/maintenance_state_changed/);
 assert.match(code,/catch\(error\)\{restoreConfigs\(s\);throw error;\}/);
 assert.doesNotMatch(code,/\['restart','merchant-space'|unlinkSync\(marker|maintenance.*prepare|reset.*--hard/);
});
