import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertWebPresentationReleaseScope,webPresentationProxy,webReleaseRuntimeEnvironment,WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';
const source=readFileSync(new URL('./web-presentation-release.mjs',import.meta.url),'utf8');
test('fresh processes keep app configuration but never inherit PM2 IPC descriptors',()=>{
 const result=webReleaseRuntimeEnvironment('NODE_ENV=production\0APP_URL=https://example.test/?a=b\0NODE_CHANNEL_FD=3\0NODE_CHANNEL_SERIALIZATION_MODE=json\0NODE_UNIQUE_ID=1\0NODE_APP_INSTANCE=0\0PM2_USAGE=CLI\0lowercase=private\0');
 assert.deepEqual(result,{NODE_ENV:'production',APP_URL:'https://example.test/?a=b'});
});
test('only reviewed presentation files and predecessor card fixes are eligible',()=>{
 assert.doesNotThrow(()=>assertWebPresentationReleaseScope(['src/components/admin/BusinessCardQrTextControls.tsx','src/lib/platformMerchantSnapshot.ts','src/app/card/[card]/route.ts']));
 for(const file of ['package.json','package-lock.json','src/middleware.ts','src/instrumentation.ts','src/app/api/auth/route.ts','scripts/supabase-migrations/one.sql','src/lib/merchantBookings.server.ts'])assert.throws(()=>assertWebPresentationReleaseScope([file]));
 assert.throws(()=>assertWebPresentationReleaseScope([]));
});
test('proxy rewrites only known application upstreams and preserves headers/fallbacks',()=>{
 const input='location ^~ / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }';
 const result=webPresentationProxy(input,WEB_RELEASE_FILES[0],'a'.repeat(40));
 assert.match(result,/127\.0\.0\.1:3102/);assert.match(result,/proxy_set_header Host \$host/);
 const card='location ^~ /card/ { proxy_pass http://127.0.0.1:3101; add_header X-Faolla-Card-Release "'+'b'.repeat(40)+'" always; } location @old { proxy_pass http://127.0.0.1:3000; }';
 const rewritten=webPresentationProxy(card,WEB_RELEASE_FILES[2],'a'.repeat(40));
 assert.match(rewritten,/location @old \{ proxy_pass http:\/\/127\.0\.0\.1:3000/);
 assert.ok(rewritten.includes(`X-Faolla-Card-Release "${'a'.repeat(40)}"`));
 assert.throws(()=>webPresentationProxy(input,'supabase_www.faolla.com.conf','a'.repeat(40)));
 assert.throws(()=>webPresentationProxy(input,WEB_RELEASE_FILES[0],'invalid'));
});
test('live lane leaves baseline and workers running; candidate has no duplicate jobs',()=>{
 assert.match(source,/FAOLLA_BACKGROUND_JOBS_PAUSED:'1'/);
 assert.match(source,/MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0'/);
 assert.match(source,/'start','-H','127\.0\.0\.1','-p'/);
 assert.doesNotMatch(source,/\['(?:stop|delete|restart|reload)',/);
 assert.doesNotMatch(source,/maintenance-control\.mjs.*(?:prepare|end)/);
 assert.match(source,/processes.*merchant-space-enterprise-automation-worker/);
 assert.match(source,/p\.pid!==saved\.pid/);
});
test('stage validates scope and dependencies before building and never changes routing',()=>{
 const stage=source.slice(source.indexOf("if(action==='stage')"),source.indexOf("if(action==='activate')"));
 assert.ok(stage.indexOf('assertWebPresentationReleaseScope')<stage.indexOf('mkdirSync(state.directory'));
 assert.ok(stage.indexOf("fail('dependencies_changed')")<stage.indexOf('mkdirSync(state.directory'));
 assert.doesNotMatch(stage,/atomic\(`\$\{proxy\}/);
 assert.match(stage,/web_release_focused_tests/);assert.match(stage,/npm','run','build/);
 assert.match(source,/flock.*--nonblock/s);assert.match(source,/mkdirSync\(operationLock/);
});
test('activation is hash-bound, additive for assets, and restores exact originals on failure',()=>{
 assert.match(source,/static_collision/);assert.match(source,/constants\.COPYFILE_EXCL/);
 assert.ok(source.indexOf('state.staticFiles=publishStatic')<source.indexOf('writeFileSync(marker,content'));
 assert.match(source,/await smoke\(state,true\)/);assert.match(source,/catch\(error\)\{restoreConfigs\(state\);throw error;/);
 assert.match(source,/rollback_proxy_not_owned/);assert.match(source,/rollback_marker_not_owned/);
 assert.doesNotMatch(source,/rmSync|rm -rf|git reset|proxy_next_upstream non_idempotent/);
});
test('other entrypoints refuse an active live web release',()=>{
 for(const file of ['deploy.production.sh','production-maintenance-control.mjs','contact-card-release.mjs'])assert.match(readFileSync(new URL(file,import.meta.url),'utf8'),/faolla_web_release\.conf/);
});
