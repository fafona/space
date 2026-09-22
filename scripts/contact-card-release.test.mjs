import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertContactReleaseScope,contactReleaseConfig} from './contact-card-release-policy.mjs';
const source=readFileSync(new URL('./contact-card-release.mjs',import.meta.url),'utf8');
test('card scope rejects unrelated runtime, dependencies, auth and migrations',()=>{
  assert.doesNotThrow(()=>assertContactReleaseScope(['src/app/card/[card]/route.ts','src/lib/merchantBusinessCardDestination.ts']));
  for(const path of ['package-lock.json','src/middleware.ts','src/instrumentation.ts','src/app/api/login/route.ts','scripts/supabase-migrations/a.sql','src/app/card/[card]/image/route.ts']) assert.throws(()=>assertContactReleaseScope([path]));
  assert.throws(()=>assertContactReleaseScope([]));
});
test('proxy routes only cards and offers old-service fallback on transport errors',()=>{
  const conf=contactReleaseConfig('a'.repeat(40),'b'.repeat(40),3101);
  assert.match(conf,/location \^~ \/card\/ \{/);
  assert.doesNotMatch(conf,/location (?:=|\^~) \/(?:\s|login|api|admin)/);
  assert.match(conf,/error_page 502 504 = @faolla_contact_card_previous/);
  assert.match(conf,/proxy_pass http:\/\/127\.0\.0\.1:3000/);
  assert.match(conf,/proxy_set_header X-Forwarded-Proto \$scheme/);
  assert.throws(()=>contactReleaseConfig('invalid','b'.repeat(40),3101));
  assert.throws(()=>contactReleaseConfig('a'.repeat(40),'b'.repeat(40),3000));
});
test('candidate cannot run background jobs or bind a public interface',()=>{
  assert.match(source,/FAOLLA_BACKGROUND_JOBS_PAUSED:'1'/);
  assert.match(source,/MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0'/);
  assert.match(source,/'start','-H','127\.0\.0\.1','-p'/);
  assert.doesNotMatch(source,/\['(?:delete|stop|restart|reload)',.*merchant-space/);
});
test('scope, baseline and dependency validation precede candidate creation',()=>{
  assert.ok(source.indexOf('assertContactReleaseScope(run')<source.indexOf('mkdirSync(state.directory'));
  assert.ok(source.indexOf("fail('dependencies_changed')")<source.indexOf('mkdirSync(state.directory'));
  assert.match(source,/state\.basePid/);
  assert.match(source,/maintenance\.phase !== 'ended'/);
});
test('activation requires actual website HTML and reload failure has bounded rollback',()=>{
  assert.ok(source.indexOf("fail('candidate_website_mismatch')")<source.indexOf('writeFileSync(config,content'));
  assert.match(source,/hash\(read\(config\)\) !== state\.configHash/);
  assert.match(source,/catch \(error\) \{\s+removeOwnedConfig\(state\); run\(nginx,\['-t'\]\); run\(nginx,\['-s','reload'\]\)/);
  assert.match(source,/flock.*--nonblock/s);
  assert.match(source,/mkdirSync\(operationLock/);
});
test('full release and maintenance fail before pausing the base when overlay is active',()=>{
  const deploy=readFileSync(new URL('./deploy.production.sh',import.meta.url),'utf8');
  const maintenance=readFileSync(new URL('./production-maintenance-control.mjs',import.meta.url),'utf8');
  assert.ok(deploy.indexOf('active contact-card release requires explicit rollback')<deploy.indexOf('\nload_deploy_payload\n'));
  const locking=maintenance.slice(maintenance.indexOf('async function withPrivateOperationLock'));
  assert.ok(locking.indexOf('maintenance_active_contact_release_requires_rollback')<locking.indexOf('secureDirectory(ROOT, true)'));
});
