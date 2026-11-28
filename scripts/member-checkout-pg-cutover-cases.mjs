// Owned CI rehearsal only: two pinned builds, one disposable DB, no live routing.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createWriteStream} from 'node:fs';
import {readFile, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {isDeepStrictEqual, promisify} from 'node:util';
import {applicationFingerprint} from './member-checkout-compatibility-check.mjs';
import {prepareOwnedNextFixture} from './member-checkout-next-session-cases.mjs';
import {createOwnedPageChecks} from './member-checkout-page-cutover-cases.mjs';
import {checkoutPgRetainedHistoryCases} from './member-checkout-pg-cutover-history.mjs';
import {checkoutPgRetainedLegacyCase} from './member-checkout-pg-cutover-legacy.mjs';
import {createPgCutoverPolicy, startOwnedPgCutoverProxy} from './member-checkout-pg-cutover-proxy.mjs';
import {requestOwnedStop, safeError} from './member-checkout-real-auth-support.mjs';
import {buildOwnedRollback} from './member-checkout-rollback-build.mjs';
import {loadOwnedStaticVersions} from './member-checkout-static-versions.mjs';
import {rollbackApplication, rollbackCommit} from './member-checkout-version-cutover-support.mjs';

const exec = promisify(execFile), site = '10909992', database = 'faolla_member_checkout_auth_test';
const sessionPath = '/api/auth/merchant-session?reauth=1', submit = '/api/member-checkout/single/points/submit';
const reviewPath = '/api/member-checkout/original-service/review', cancelPath = '/api/member-checkout/original-service/cancel';
const gates = ['bundle_pilots', 'intent_pilots'];
const oldEnvKeys = ['NODE_ENV','NODE_OPTIONS','NEXT_TELEMETRY_DISABLED','FAOLLA_CHECKOUT_NEXT_LOCAL',
  'FAOLLA_CANONICAL_PORTAL_ORIGIN','FAOLLA_SUPER_ADMIN_ORIGIN','SUPABASE_INTERNAL_URL','NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','FAOLLA_BACKGROUND_JOBS_PAUSED',
  'MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED','MERCHANT_BOOKING_STORAGE_MODE'];

async function verifyOwnedSource(db, financial, appEnv, version) {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); assert.ok(process.getuid() > 0);
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.env.GITHUB_REPOSITORY, 'fafona/space');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/acceptance/member-checkout-pg-app-20261128');
  assert.match(version, /^[a-f0-9]{40}$/); assert.notEqual(version, rollbackCommit);
  assert.equal(financial.site, site);
  const dbConfig = db.connectionParameters;
  assert.equal(dbConfig.host, '127.0.0.1'); assert.equal(dbConfig.port, 56463);
  assert.equal(dbConfig.database, database); assert.equal(dbConfig.user, 'checkout_ci_admin');
  const {rows} = await db.query("SELECT current_database() db, current_user::text actor, current_setting('server_version_num') version");
  assert.deepEqual(rows, [{db: database, actor: 'checkout_ci_admin', version: '150008'}]);
  for (const key of ['SUPABASE_INTERNAL_URL','NEXT_PUBLIC_SUPABASE_URL']) assert.match(appEnv[key], /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  assert.equal(appEnv.SUPABASE_INTERNAL_URL, appEnv.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(appEnv.FAOLLA_BACKGROUND_JOBS_PAUSED, '1'); assert.equal(appEnv.MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED, 'false');
  assert.equal(Object.hasOwn(process.env, 'FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE'), false);
  const root = await realpath(process.cwd()), source = path.join(root, '.owned-checkout-base');
  assert.equal(await realpath(source), source);
  for (const [args, expected] of [[[ 'rev-parse', 'HEAD' ], rollbackCommit], [['status', '--porcelain', '--untracked-files=all'], '']]) {
    const {stdout} = await exec('git', ['-C', source, ...args], {timeout: 10000}); assert.equal(stdout.trim(), expected);
  }
  assert.deepEqual(await applicationFingerprint(source), rollbackApplication);
  const lock = async dir => JSON.parse(await readFile(path.join(dir, 'package-lock.json'), 'utf8')).packages;
  const oldLock = await lock(source), currentLock = await lock(root);
  for (const [name, entry] of Object.entries(oldLock)) if (name) assert.deepEqual(currentLock[name], entry);
  assert.deepEqual(Object.keys(currentLock).filter(name => !Object.hasOwn(oldLock, name)), ['node_modules/@electric-sql/pglite']);
  return {root, source};
}

export async function checkoutPgCutoverCases(check, {db, financial, f, body, scope, original, fixture, port, appEnv, context, callCandidate, report, signal, signInOther, restoreOriginalSignIn,createOwnerView,getLegacyGuardCount}) {
  const version = process.env.GITHUB_SHA, {root, source} = await verifyOwnedSource(db, financial, appEnv, version);
  const evidence = report.cutover = {scope: 'owned-dual-production-builds-no-production-access', rollbackCommit, rollbackApplication,
    candidateCommit: version, candidateApplication: report.candidate.material.application, transitions: [], cleanupPassed: false, passed: false};
  let old, child, log, exited, proxy, serviceCreated = false, gatesClosed = false, complete = false;
  const events = [], views = [], extraContexts = [], routes = [];
  const state = () => financial.state();
  const setGates = async enabled => {
    await db.query('BEGIN');
    try {
      for (const table of gates) assert.equal((await db.query(`UPDATE faolla_checkout_design.${table} SET enabled=$2 WHERE site_id=$1 AND enabled=$3`, [site, enabled, !enabled])).rowCount, 1);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  };
  const verifyGatesClosed = async () => {
    for (const table of gates) assert.deepEqual((await db.query(`SELECT enabled FROM faolla_checkout_design.${table} WHERE site_id=$1`, [site])).rows, [{enabled:false}]);
    assert.deepEqual((await db.query('SELECT enabled FROM faolla_checkout_design.original_service_pilots WHERE site_id=$1', [site])).rows, [{enabled:true}]);
  };
  const restoreIfUnchanged = (before, after) => assert.ok(isDeepStrictEqual(after,before), 'owned_ledger_changed');
  try {
    await check('isolated pinned rollback build passes the same five production stages', async () => {
      old = await prepareOwnedNextFixture({sourceRoot:source, dependencyRoot:root, productionBuild:true});
      evidence.oldBuild = {};
      process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE = '1';
      try { await buildOwnedRollback(old, signal, evidence.oldBuild); }
      finally { delete process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE; }
    });
    const assets = await loadOwnedStaticVersions({old:old.app,candidate:fixture.app}); evidence.staticAssets = assets.summary;
    assert.ok(assets.summary.oldOnly > 0 && assets.summary.candidateOnly > 0);
    const oldEnv = Object.fromEntries(oldEnvKeys.map(key => {assert.equal(typeof appEnv[key],'string');return [key,appEnv[key]];}));
    log = createWriteStream(path.join(old.evidence,'old-next.private.log'),{flags:'wx',mode:0o600});
    child = spawn(process.execPath,[path.join(root,'scripts/fixtures/member-checkout-rollback-local-server.mjs'),old.app],{
      cwd:old.app,env:{PATH:process.env.PATH,HOME:old.evidence,TMPDIR:tmpdir(),...oldEnv},stdio:['ignore','pipe','pipe','ipc'],
    });
    exited = once(child,'exit').then(([code, signal]) => ({code,signal}),() => ({code:-1,signal:null}));
    child.on('message',v=>events.push(v)); child.stdout.pipe(log,{end:false}); child.stderr.pipe(log,{end:false});
    const deadline = Date.now()+45000;
    while (!events.some(v=>v.type==='listening') && Date.now()<deadline) {
      assert.equal(child.exitCode,null); assert.equal(child.signalCode,null); await delay(50,undefined,{signal});
    }
    const oldPort = events.find(v=>v.type==='listening')?.port; assert.ok(Number.isInteger(oldPort));
    const certificate = evidenceDir => readFile(path.join(evidenceDir,'tls-cert.pem'));
    const policy = createPgCutoverPolicy({site,operationKey:original.operationKey});
    proxy = await startOwnedPgCutoverProxy({policy,assets,key:await readFile(path.join(fixture.evidence,'tls-key.pem')),
      candidate:{port,certificate:await certificate(fixture.evidence),version},old:{port:oldPort,certificate:await certificate(old.evidence),version:rollbackCommit}});
    const allow = async origin => { const url = origin+'/**', handler = route=>route.continue(); await context.route(url,handler); routes.push([url,handler]); };
    const browserCall = (view,route,data,headers=scope,method) => view.evaluate(async ({route,data,headers,method}) => {
      const r = await fetch(route,{method:method??(data===undefined?'GET':'POST'),headers:{'content-type':'application/json',...headers},
        ...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(60000)});
      return {status:r.status,version:r.headers.get('x-owned-source-version'),value:await r.json()};
    },{route,data,headers,method});
    const open = async origin => { await allow(origin); const v=await context.newPage(); views.push(v); assert.equal((await v.goto(origin+sessionPath,{timeout:90000})).status(),200);return v; };
    const oldView = await open('https://portal.checkout-auth.test:'+oldPort), view = await open(proxy.origin);
    const call = (route,data,headers,method) => browserCall(view,route,data,headers,method);
    const resource = '/api/member-checkout/resource?'+new URLSearchParams({siteId:site,kind:original.resourceKind,id:original.resourceId});
    const servicePath = `/member-checkout/${site}/service/${original.operationKey}`, request = {siteId:site,operationKey:original.operationKey};
    const pages = await createOwnedPageChecks({context,origin:proxy.origin,servicePath,assets,evidence,extraContexts,ownedViews:views});
    const transition = async (mode,probe) => {evidence.transitions.push(await policy.promote(mode,policy.snapshot().generation,probe));};
    const realSession = async (routeCall,wanted) => { const r=await routeCall(sessionPath);assert.equal(r.status,200);assert.equal(r.version,wanted); };
    await check('failed readiness keeps old traffic and ledger unchanged, then real candidate takes over',async()=>{
      const before = await state();
      await pages.oldBeforeCutover(rollbackCommit);
      const initial = policy.snapshot(); await assert.rejects(policy.promote('candidate',initial.generation,async()=>false)); assert.deepEqual(policy.snapshot(),initial);
      await realSession(call,rollbackCommit); restoreIfUnchanged(before,await state());
      await transition('candidate',async()=>(await callCandidate(sessionPath)).status===200);
      await realSession(call,version);
      const r=await call(submit,body); assert.equal(r.status,200); assert.equal(r.version,version); assert.equal(r.value.replayed,true); assert.equal(r.value.result.operationKey,original.operationKey);
      restoreIfUnchanged(before,await state());
    });
    await check('original service remains independently closed until synthetic site opt-in',async()=>{
      const before = await state(); assert.deepEqual((await db.query('SELECT site_id FROM faolla_checkout_design.original_service_pilots')).rows,[]);
      const denied=await call(reviewPath,request); assert.equal(denied.status,409); assert.equal(denied.value.error,'checkout_service_disabled'); restoreIfUnchanged(before,await state());
      await db.query('INSERT INTO faolla_checkout_design.original_service_pilots(site_id,enabled) VALUES($1,true)',[site]); serviceCreated=true;
      const allowed=await call(reviewPath,request); assert.equal(allowed.status,200); assert.equal(allowed.value.readOnly,true);
      await pages.candidateEntered(version);
      const expected=structuredClone(before);expected['faolla_checkout_design.original_service_pilots']=[{r:{site_id:site,enabled:true}}];restoreIfUnchanged(expected,await state());
    });
    await check('close both creation gates before rollback; old ordinary traffic, retained original, no new checkout',async()=>{
      await setGates(false); gatesClosed=true; await verifyGatesClosed();
      const before=await state();
      await transition('retained',async()=>(await browserCall(oldView,sessionPath)).status===200&&(await callCandidate(resource,undefined,scope)).status===200);
      await realSession(call,rollbackCommit);
      const r=await call(resource);assert.equal(r.status,200);assert.equal(r.version,version);assert.equal(r.value.result.resourceId,original.resourceId);assert.equal(r.value.readOnly,true);
      const replay=await call(submit,body); assert.equal(replay.status,200);assert.equal(replay.version,version);assert.equal(replay.value.replayed,true);
      const fresh=await call(submit,{...body,nonce:randomUUID()});assert.equal(fresh.status,503);assert.equal(fresh.version,version);assert.equal(fresh.value.error,'checkout_disabled');
      for(const route of ['/api/member-checkout/cart/submit','/api/member-checkout/on-site/submit','/api/member-checkout/single/on-site/submit']) {
        const count=proxy.snapshot().candidateRequests; const denied=await call(route,{});assert.equal(denied.status,503);assert.equal(proxy.snapshot().candidateRequests,count);
      }
      await pages.retained(version,rollbackCommit); restoreIfUnchanged(before,await state());
    });
    await checkoutPgRetainedHistoryCases(check,{call,financial,f,body,scope,original,candidateVersion:version,signInOther,restoreOriginalSignIn});
    await check('retained resume page finds the tracked original and links to exact original service',async()=>{
      const before=await state(), resumeView=await context.newPage();views.push(resumeView);
      await resumeView.setViewportSize({width:390,height:1000});await resumeView.bringToFront();
      const response=await resumeView.goto(`${proxy.origin}/member-checkout/${site}/resume?uiLocale=zh-CN`,{timeout:90000,waitUntil:'domcontentloaded'});
      assert.equal(response.status(),200);assert.equal(response.headers()['x-owned-source-version'],version);
      const panel=resumeView.locator('[data-checkout-resume]'), item=panel.locator('article').filter({hasText:original.resourceId});
      await panel.locator('[data-checkout-history-read]').waitFor({timeout:20000});
      await item.getByText(original.resourceId,{exact:true}).waitFor({timeout:20000});
      const href=await item.locator('[data-original-service-link]').getAttribute('href');assert.ok(href?.startsWith('/'));
      const service=new URL(href,proxy.origin);assert.equal(service.origin,proxy.origin);assert.equal(service.pathname,servicePath);
      restoreIfUnchanged(before,await state());await resumeView.close();evidence.retainedResumePagePassed=true;
    });
    await checkoutPgRetainedLegacyCase(check,{financial,original,rollbackVersion:rollbackCommit,createOwnerView:()=>createOwnerView(proxy.origin),getLegacyGuardCount});
    evidence.legacyOriginalWriteBlocked=true;
    await check('retained path outage does not fall through to old app; ordinary session stays available',async()=>{
      const before=await state(),count=proxy.snapshot().candidateRequests;proxy.setRetainedUnavailable(true);
      try {assert.equal((await call(resource)).status,503);await realSession(call,rollbackCommit);assert.equal(proxy.snapshot().candidateRequests,count);}
      finally {proxy.setRetainedUnavailable(false);}
      assert.equal((await call(resource)).status,200);restoreIfUnchanged(before,await state());
      // Refresh the real browser state after the alternate-account checks.
      await pages.original(version,390);
    });
    await check('lost response to actual cancelled booking is recoverable without duplicate points, coupon or stock release',async()=>{
      const coupon = async () => (await financial.page('__merchant_coupons__:'+site)).blocks.find(v=>v.id===f.selection.couponClaims[0].couponId);
      const stock = async () => (await financial.page('__merchant_membership_settings__:'+site)).blocks.redemptionItems.find(v=>v.id==='booking-stock').stock;
      const before=await coupon();assert.equal(before.redeemEvents.length,1);
      assert.equal(await stock(),9);
      const reviewed=await call(reviewPath,request);assert.equal(reviewed.status,200);const review=reviewed.value.review;
      const cancelBody={...request,reviewHash:review.reviewHash,expectedUpdatedAt:review.original.original.result.resource.updatedAt};
      proxy.dropNextCancellationReply();await pages.loseCancellation();assert.equal(proxy.snapshot().droppedCancellationReplies,1);
      const after=await state(),r=await call(reviewPath,request);assert.equal(r.status,200);const fresh=r.value.review,closed=fresh.original.original.result;
      assert.equal(closed.closed,true);assert.equal(closed.cancellation.pointsReturned,80);assert.equal(closed.cancellation.couponsReturned,1);assert.equal(closed.cancellation.stockReleased,1);
      const stale=await call(cancelPath,cancelBody);assert.equal(stale.status,409);assert.equal(stale.value.error,'checkout_service_changed');restoreIfUnchanged(after,await state());
      const replay=await call(cancelPath,{...request,reviewHash:fresh.reviewHash,expectedUpdatedAt:closed.resource.updatedAt});assert.equal(replay.status,200);assert.equal(replay.value.cancellation.replayed,true);restoreIfUnchanged(after,await state());
      assert.equal((await financial.page('__merchant_memberships__:'+site)).blocks.find(v=>v.id===f.member.id).pointBalance,1000);
      assert.equal(await stock(),10);
      const released=await coupon();assert.equal(released.redeemEvents.length,0);assert.deepEqual(released.claimEvents,before.claimEvents);
      evidence.originalEffects={pointsReturned:80,couponsReturned:1,stockReleased:1};
    });
    await check('candidate restoration preserves closed original and creation gates; both production builds remain pinned',async()=>{
      const before=await state();
      await transition('candidate',async()=>(await callCandidate(sessionPath)).status===200&&(await callCandidate(resource,undefined,scope)).status===200);
      await realSession(call,version); assert.equal((await call(resource)).value.result.closed,true);await pages.resumed(version);
      const denied=await call(submit,{...body,nonce:randomUUID()});assert.equal(denied.status,503);assert.equal(denied.value.error,'checkout_disabled');
      await verifyGatesClosed();restoreIfUnchanged(before,await state());
      assert.deepEqual(await applicationFingerprint(old.app),rollbackApplication);assert.deepEqual(await applicationFingerprint(fixture.app),evidence.candidateApplication);
      assert.deepEqual(evidence.transitions,[{mode:'candidate',generation:1},{mode:'retained',generation:2},{mode:'candidate',generation:3}]);
    });
    complete=true;
  } finally {
    const failures=[], clean=async run=>{try{await run();}catch(error){failures.push(safeError(error));}};
    for(const view of views) await clean(()=>view.close());
    for(const extra of extraContexts) await clean(()=>extra.close());
    for(const [url,handler] of routes) await clean(()=>context.unroute(url,handler));
    if(proxy) await clean(async()=>{await proxy.close();evidence.proxy=proxy.snapshot();assert.equal(evidence.proxy.closed,true);assert.equal(evidence.proxy.activeUpstreams,0);});
    if(gatesClosed) await clean(()=>setGates(true)); // Restore only this disposable fixture for pre-existing owner cases.
    if(serviceCreated) await clean(async()=>assert.equal((await db.query('DELETE FROM faolla_checkout_design.original_service_pilots WHERE site_id=$1 AND enabled=true',[site])).rowCount,1));
    if(child) await clean(async()=>{
      const requested=requestOwnedStop(child,'next','current-auth');
      const stopped=await Promise.race([exited,delay(10000,undefined,{ref:false}).then(()=>null)]);
      if(!stopped){child.kill('SIGKILL');await exited;}
      const ack=events.find(v=>v.type==='stopped');evidence.oldStopped={requested,forced:!stopped,...await exited,forbiddenFetches:ack?.forbiddenFetches};
      assert.equal(requested,'IPC-close');assert.equal(stopped?.code,0);assert.equal(stopped?.signal,null);assert.equal(ack?.forbiddenFetches,0);
    });
    if(log) await clean(()=>new Promise(resolve=>log.end(resolve)));
    evidence.cleanupFailures=failures; evidence.cleanupPassed=failures.length===0; evidence.passed=complete&&evidence.cleanupPassed;
    assert.equal(evidence.cleanupPassed,true,'owned_pg_cutover_cleanup_failed');
  }
}
