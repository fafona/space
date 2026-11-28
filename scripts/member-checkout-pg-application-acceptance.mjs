// Fresh hosted PG15.8 + real GoTrue2.186 + PostgREST14.5 + copied actual Next.
// No production endpoint, synthetic Auth response, runtime JWT or deployment.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {createRequire} from 'node:module';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import forge from 'node-forge';
import {chromium} from 'playwright';
import {verifyOwnedTools,authReleases,safeError} from './member-checkout-real-auth-support.mjs';
import {prepareOwnedNextFixture} from './member-checkout-next-session-cases.mjs';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';
import {loadCheckout047Revision} from './member-checkout-047-revision.mjs';
import {createOwnedCheckoutData} from './fixtures/member-checkout-real-auth-database.mjs';
import {materializePgApplicationCandidate,ownedPgApplicationPilotEnvironment} from './member-checkout-pg-application-candidate.mjs';
import {applicationFingerprint} from './member-checkout-compatibility-check.mjs';
import {createPgRuntimeCore} from './fixtures/merchant-checkout-pg-core.ts';
import {pgRuntimeConfiguration,pgLoginRole} from './fixtures/merchant-checkout-pg-entry.ts';
import points from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import configuration from '../src/lib/merchantCheckoutConfiguration.ts';

const exec=promisify(execFile),database='faolla_member_checkout_auth_test',databasePort=56463;
const guard=()=>{
 assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
 assert.equal(process.env.GITHUB_REPOSITORY,'fafona/space');assert.equal(process.env.GITHUB_REF,'refs/heads/acceptance/member-checkout-pg-app-20261128');assert.ok(process.getuid()>0);
 for(const key of Object.keys(process.env))if(/SUPABASE|STRIPE|SMTP|DATABASE_URL|^PGHOST$|^PGPORT$|^PGPASSWORD$|^PGDATABASE$|^PGUSER$|^FAOLLA_CHECKOUT_RUNTIME_JWT$/.test(key))assert.ok(!process.env[key],'configured_backend_refused');
};
test('separate PG candidate: real login, owner permission, strict TLS and original points/coupon booking',{timeout:360000},async t=>{
 guard();const tools=path.join(process.env.RUNNER_TEMP,'faolla-pg-app-tools');await verifyOwnedTools(tools,'current-auth');
 const evidence=path.join(process.env.RUNNER_TEMP,'faolla-pg-app-evidence');fs.mkdirSync(evidence,{mode:0o700});
 const report={version:1,scope:'isolated-pg-application-not-production',commit:process.env.GITHUB_SHA,phase:'database',checks:[],paths:[],stopped:[],passed:false,cleanupPassed:false,failure:null,
  productionConnected:false,productionChanged:false,deployed:false,stripeEnabled:false,runtimeJwtProvisioned:false,syntheticAuthResponses:false,productionTopologyProven:false,poolingValidated:false};
 const {Client}=createRequire(path.join(tools,'pg-client/package.json'))('pg'),clients=new Set(),children=[],servers=[],logs=[];
 let db,browser,fixture,pgEnvironment,nextEvents=[];
 const secret=randomBytes(48).toString('base64url'),audience='direct-pg-owned-auth',pgPassword=randomBytes(32).toString('base64url');
 const token=role=>{const s=[{alg:'HS256',typ:'JWT'},{role,aud:audience,exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return s+'.'+createHmac('sha256',secret).update(s).digest('base64url');};
 const serviceJwt=token('service_role'),anonJwt=token('anon');
 const check=async(name,run)=>{report.phase=name;let passed=false;await t.test(name,async()=>{await run();passed=true;});report.checks.push({name,passed});assert.equal(passed,true,'pg_application_prerequisite_failed');};
 const open=async config=>{const c=new Client(config);clients.add(c);c.on('error',()=>{});await c.connect();return c;};
 const adminConfig={host:'127.0.0.1',port:databasePort,database,user:'checkout_ci_admin',password:'disposable-checkout-ci-only',ssl:false,options:'',connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000};
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{servers.push(server);resolve(server.address().port);});});
 const held=[];
 const reserve=async()=>{const s=net.createServer(),port=await listen(s);held.push(s);return port;};
 const release=async s=>{await new Promise(resolve=>s.close(resolve));servers.splice(servers.indexOf(s),1);};
 const start=(name,executable,args,environment,cwd=evidence)=>{
  const log=fs.createWriteStream(path.join(evidence,name+'.private.log'),{flags:'wx',mode:0o600});logs.push(log);
  const child=spawn(executable,args,{cwd,env:{PATH:process.env.PATH,HOME:evidence,TMPDIR:tmpdir(),...environment},stdio:['ignore','pipe','pipe',...(name==='next'?['ipc']:[])]});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const row={name,child,done:once(child,'exit').then(([code,signal])=>({code,signal}),()=>({code:-1,signal:null}))};child.on('error',()=>{row.spawnFailed=true;});children.push(row);return child;
 };
 const ready=async(child,url)=>{const limit=Date.now()+30000;while(Date.now()<limit){assert.equal(child.exitCode,null,'owned_child_exited');try{const r=await fetch(url,{signal:AbortSignal.timeout(800)});await r.arrayBuffer();if(r.status===200)return;}catch{}await delay(75);}assert.fail('owned_child_readiness_failed');};
 try{
  db=await open(adminConfig);assert.deepEqual(await one("SELECT current_database() db,current_user::text actor,current_setting('server_version_num') version"),{db:database,actor:'checkout_ci_admin',version:'150008'});
  assert.equal((await one("SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).n,0);
  const plan=await loadInstallationPlan(),revision=await loadCheckout047Revision();
  await db.query(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
   CREATE TABLE public.pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz DEFAULT clock_timestamp());
   CREATE TABLE public.faolla_schema_migrations(version bigint PRIMARY KEY,name text NOT NULL);
   GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE,DELETE ON public.pages TO service_role;
   CREATE FUNCTION public.set_pages_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=now();RETURN NEW;END;$$;
   CREATE TRIGGER set_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_pages_updated_at();`);
  await db.query('INSERT INTO public.pages(merchant_id,slug,blocks) VALUES($1,$2,$3)',['__faolla_booking_persistence__','__merchant_booking_records__:v1',{version:1,records:[]}]);
  for(const p of plan.originals)await db.query(p.source);await db.query(revision.legacySql);for(const p of plan.steps)await db.query('BEGIN;'+p.body+'COMMIT;');await db.query(revision.adapterSql);for(const p of revision.patches)await db.query(p.sql);
  await db.query(`CREATE ROLE ${pgLoginRole} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 6 PASSWORD '${pgPassword}';
   GRANT CONNECT ON DATABASE ${database} TO ${pgLoginRole};GRANT USAGE ON SCHEMA public TO ${pgLoginRole};GRANT EXECUTE ON FUNCTION public.faolla_checkout_runtime_v1(text,jsonb) TO ${pgLoginRole};
   CREATE ROLE checkout_local_gateway LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'disposable-gateway-ci-only';GRANT anon,authenticated,service_role TO checkout_local_gateway;
   CREATE ROLE postgres NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   CREATE ROLE checkout_ci_auth LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'disposable-auth-ci-only';CREATE SCHEMA auth AUTHORIZATION checkout_ci_auth;
   GRANT CREATE ON DATABASE ${database} TO checkout_ci_auth;ALTER ROLE checkout_ci_auth SET search_path=auth;
   CREATE TABLE public.merchant_enterprise_employees(id text PRIMARY KEY,auth_user_id text NOT NULL);
   CREATE TABLE public.merchants(id text PRIMARY KEY,name text,user_id text,auth_user_id text,owner_user_id text,owner_id text,auth_id text,created_by text,created_by_user_id text,email text,owner_email text,contact_email text,user_email text);
   GRANT SELECT ON public.merchant_enterprise_employees,public.merchants TO service_role;`);
  await check('strict PG TLS accepts the owned CA and rejects wrong CA and wrong host identity',async()=>{
   const keys=forge.pki.rsa.generateKeyPair(2048),cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='01'+randomBytes(12).toString('hex');cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date(Date.now()+86400000);
   cert.setSubject([{name:'commonName',value:'checkout-pg-owned'}]);cert.setIssuer(cert.subject.attributes);
   cert.setExtensions([{name:'basicConstraints',cA:true},{name:'keyUsage',keyCertSign:true,digitalSignature:true,keyEncipherment:true},{name:'extKeyUsage',serverAuth:true},{name:'subjectAltName',altNames:[{type:7,ip:'127.0.0.1'}]}]);cert.sign(keys.privateKey,forge.md.sha256.create());
   const ca=forge.pki.certificateToPem(cert),key=forge.pki.privateKeyToPem(keys.privateKey);fs.writeFileSync(path.join(evidence,'pg-cert.pem'),ca,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(evidence,'pg-key.pem'),key,{flag:'wx',mode:0o600});
   const container=process.env.CHECKOUT_PG_TEST_CONTAINER;assert.match(container??'',/^[a-f0-9]{64}$/);
   assert.equal((await exec('docker',['inspect','--format','{{.Config.Image}}',container])).stdout.trim(),'postgres:15.8');
   for(const file of ['pg-cert.pem','pg-key.pem'])await exec('docker',['cp',path.join(evidence,file),container+':/tmp/'+file]);
   await exec('docker',['exec','-u','0',container,'chown','postgres:postgres','/tmp/pg-cert.pem','/tmp/pg-key.pem']);await exec('docker',['exec','-u','0',container,'chmod','600','/tmp/pg-key.pem']);
   await db.query("ALTER SYSTEM SET ssl_cert_file='/tmp/pg-cert.pem'");await db.query("ALTER SYSTEM SET ssl_key_file='/tmp/pg-key.pem'");await db.query("ALTER SYSTEM SET ssl='on'");await db.query('SELECT pg_reload_conf()');await delay(300);
   const env={FAOLLA_CHECKOUT_PG_HOST:'127.0.0.1',FAOLLA_CHECKOUT_PG_PORT:String(databasePort),FAOLLA_CHECKOUT_PG_DATABASE:database,FAOLLA_CHECKOUT_PG_USER:pgLoginRole,FAOLLA_CHECKOUT_PG_PASSWORD:pgPassword,FAOLLA_CHECKOUT_PG_TLS:'verify-full',FAOLLA_CHECKOUT_PG_CA_PEM:ca};
   const configured=pgRuntimeConfiguration(env,12000);assert.ok(configured);report.pgEnvironment=Object.keys(env).sort();
   const good=await open(configured.config);assert.equal((await good.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl,true);await good.end();clients.delete(good);
   for(const ssl of [{...configured.config.ssl,ca:undefined},{...configured.config.ssl,servername:'wrong.checkout.test'}]){
    const bad=new Client({...configured.config,ssl});bad.on('error',()=>{});clients.add(bad);await assert.rejects(bad.connect());await bad.end();clients.delete(bad);
   }
   report.tlsValidated=true;pgEnvironment=env;
  });
  const gate={active:0},rpc=createPgRuntimeCore({clientFactory:()=>new Client(pgRuntimeConfiguration(pgEnvironment,12000).config),current:()=>true,gate,timeoutMs:12000});
  const runtimeCall=async(name,args)=>{const r=await rpc.rpc(name,args);assert.equal(r.error,null);return r.data;};
  const financial=await createOwnedCheckoutData(db,runtimeCall);
  const authPort=await reserve(),restPort=await reserve();assert.notEqual(authPort,restPort);for(const socket of held)await release(socket);
  const authOrigin='http://127.0.0.1:'+authPort,restOrigin='http://127.0.0.1:'+restPort;
  const auth=start('auth',path.join(tools,'auth-bin/auth'),[],{GOTRUE_API_HOST:'127.0.0.1',PORT:String(authPort),API_EXTERNAL_URL:authOrigin,GOTRUE_SITE_URL:'https://127.0.0.1',
   GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgresql://checkout_ci_auth:disposable-auth-ci-only@127.0.0.1:${databasePort}/${database}?sslmode=disable`,GOTRUE_DB_NAMESPACE:'auth',GOTRUE_DB_MIGRATIONS_PATH:path.join(tools,'auth-'+authReleases['2.186.0'].sourceCommit+'/migrations'),
   GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_AUD:audience,GOTRUE_JWT_EXP:'3600',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',
   GOTRUE_MAILER_AUTOCONFIRM:'false',GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:'1',GOTRUE_SMTP_ADMIN_EMAIL:'noreply@example.invalid',GOTRUE_LOG_LEVEL:'error',GOTRUE_TRACING_ENABLED:'false'});
  await ready(auth,authOrigin+'/health');assert.equal((await(await fetch(authOrigin+'/health')).json()).version,'v2.186.0');
  const rest=start('postgrest',path.join(tools,'postgrest-bin/postgrest'),[],{PGRST_DB_URI:`postgresql://checkout_local_gateway:disposable-gateway-ci-only@127.0.0.1:${databasePort}/${database}`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_DB_POOL:'2',PGRST_DB_CHANNEL_ENABLED:'false',PGRST_JWT_SECRET:secret,PGRST_JWT_AUD:audience,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(restPort),PGRST_LOG_LEVEL:'error'});await ready(rest,restOrigin+'/');
  const gateway=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://127.0.0.1'),isAuth=url.pathname.startsWith('/auth/v1/'),isRest=url.pathname.startsWith('/rest/v1/');
   if(!isAuth&&!isRest){res.writeHead(404);res.end();return;}assert.equal(req.headers.cookie,undefined);report.paths.push(req.method+' '+url.pathname);
   const upstream=http.request({host:'127.0.0.1',port:isAuth?authPort:restPort,method:req.method,path:url.pathname.slice(8)+url.search,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
   upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
  });const gatewayOrigin='http://127.0.0.1:'+await listen(gateway);
  const authCall=async(url,body,credential=serviceJwt,method='POST')=>{const r=await fetch(authOrigin+url,{method,headers:{authorization:'Bearer '+credential,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});return {status:r.status,value:r.status===204?null:await r.json()};};
  const email='direct-'+randomUUID()+'@example.invalid',password='Owned!'+randomBytes(20).toString('hex');
  const created=await authCall('/admin/users',{email,password,email_confirm:false});assert.equal(created.status,200);const userId=created.value.id,f=await financial.seed(userId),metadata={account_type:'personal',account_id:f.principal.accountId};
  assert.equal((await authCall('/admin/users/'+userId,{app_metadata:metadata,user_metadata:metadata},serviceJwt,'PUT')).status,200);
  await check('real Auth refuses unverified email before application checkout',async()=>{assert.equal((await authCall('/token?grant_type=password',{email,password},anonJwt)).status,400);});
  assert.equal((await authCall('/admin/users/'+userId,{email_confirm:true},serviceJwt,'PUT')).status,200);
  process.env.FAOLLA_CHECKOUT_NEXT_ACCEPTANCE='1';fixture=await prepareOwnedNextFixture();const candidate=await materializePgApplicationCandidate(fixture,path.join(tools,'pg-client'));report.candidate=candidate;
  // Lock replay in a NEW empty directory, never npm-ci against shared junctions.
  const lockTest=path.join(evidence,'lock-replay');fs.mkdirSync(lockTest,{mode:0o700});for(const file of ['package.json','package-lock.json'])fs.copyFileSync(path.join(fixture.app,file),path.join(lockTest,file),fs.constants.COPYFILE_EXCL);
  await check('candidate production dependency lock replays without scripts or source mutation',async()=>{await exec('npm',['ci','--prefix',lockTest,'--ignore-scripts','--no-audit','--no-fund'],{timeout:90000,maxBuffer:2*1024*1024});assert.equal(JSON.parse(fs.readFileSync(path.join(lockTest,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');});
  await check('default-off candidate preserves all 12 original ENV transport checks',async()=>{
   const r=await exec(process.execPath,['--import','tsx','--test','--test-reporter=tap','src/lib/merchantCheckoutRuntime.server.test.ts'],{cwd:fixture.app,timeout:30000,maxBuffer:2*1024*1024,
    env:{PATH:process.env.PATH,HOME:evidence,TMPDIR:tmpdir(),NODE_ENV:'test'}});
   fs.writeFileSync(path.join(evidence,'retained-env.private.tap'),r.stdout+r.stderr,{flag:'wx'});assert.match(r.stdout,/# tests 12\b/);assert.match(r.stdout,/# fail 0\b/);assert.match(r.stdout,/# skipped 0\b/);
  });
  const appEnv={NODE_ENV:'development',NODE_OPTIONS:'--max-old-space-size=3072',NEXT_TELEMETRY_DISABLED:'1',FAOLLA_CHECKOUT_NEXT_LOCAL:'1',FAOLLA_CANONICAL_PORTAL_ORIGIN:'https://portal.checkout-auth.test',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.checkout-auth.test',
   SUPABASE_INTERNAL_URL:gatewayOrigin,NEXT_PUBLIC_SUPABASE_URL:gatewayOrigin,NEXT_PUBLIC_SUPABASE_ANON_KEY:anonJwt,SUPABASE_SERVICE_ROLE_KEY:serviceJwt,FAOLLA_CHECKOUT_TRANSPORT:'postgres',...pgEnvironment,
   FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED:'false',MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2',...ownedPgApplicationPilotEnvironment(financial.site)};
  const next=start('next',process.execPath,[path.join(process.cwd(),'scripts/fixtures/member-checkout-next-local-server.mjs'),fixture.app],appEnv,fixture.app);next.on('message',m=>nextEvents.push(m));
  const deadline=Date.now()+60000;while(!nextEvents.some(e=>e.type==='listening')&&Date.now()<deadline){assert.equal(next.exitCode,null);await delay(50);}const listening=nextEvents.find(e=>e.type==='listening');assert.ok(listening);
  const origin='https://portal.checkout-auth.test:'+listening.port,route='/api/member-checkout/single/points/submit';
  browser=await chromium.launch({headless:true,args:['--host-resolver-rules=MAP portal.checkout-auth.test 127.0.0.1','--no-proxy-server']});
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const view=await context.newPage();assert.equal((await view.goto(origin+route,{timeout:90000})).status(),405);
  const call=(url,body,headers={},method)=>view.evaluate(async({url,body,headers,method})=>{const r=await fetch(url,{method:method??(body===undefined?'GET':'POST'),headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,value:await r.json()};},{url,body,headers,method});
  const login=(account=email,pass=password,kind='personal')=>call('/api/auth/merchant-login',{account,password:pass,preferredAccountType:kind});
  await check('unchanged actual login sets Secure HttpOnly cookies and refresh renews a missing access cookie',async()=>{
   assert.equal((await login()).status,200);for(const name of ['__Host-faolla-merchant-auth-v2','__Host-faolla-merchant-refresh-v2']){const c=(await context.cookies(origin)).find(c=>c.name===name);assert.ok(c?.httpOnly&&c.secure&&c.path==='/');}
   assert.equal(await view.evaluate(()=>document.cookie),'');await context.clearCookies({name:'__Host-faolla-merchant-auth-v2'});assert.equal((await call('/api/auth/merchant-session?reauth=1')).status,200);
  });
  const nonce=randomUUID(),initial={...f.selection,method:'points',nonce,confirmationHash:'0'.repeat(64),customer:f.customer},identity=points.checkoutSubmissionIdentity(initial,f.principal);
  const snap=await runtimeCall('faolla_member_checkout_submission_snapshot_v2',{p_site_id:financial.site,p_operation_key:identity.operationKey,p_principal_key:identity.principalKey,p_request_hash:identity.requestHash,p_offer_id:f.offer.id});
  const q=await points.quoteCheckoutSubmissionSnapshot(points.parseCheckoutSubmissionSnapshot(snap.snapshot,identity),identity,f.principal),body={...initial,confirmationHash:q.confirmationHash},scope={'x-checkout-account-scope':f.principal.accountId};
  await check('actual Next submit uses restricted PG TLS, debits selected coupon/points once and replays the original',async()=>{
   const response=await call(route,body,scope);assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.value.result.totalPoints,80);assert.equal(response.value.replayed,false);
   const state=await financial.state();assert.equal((await call(route,body,scope)).value.replayed,true);assert.deepEqual(await financial.state(),state);assert.equal((await financial.page('__merchant_memberships__:'+financial.site)).blocks[0].pointBalance,920);
   assert.equal(report.paths.some(p=>p.includes('/rpc/faolla_checkout_runtime_v1')),false);
  });
  await check('fresh pause, forged scope and forbidden cross-origin request refuse before any debit',async()=>{
   const state=await financial.state();assert.equal((await authCall('/admin/users/'+userId,{app_metadata:{...metadata,personal_service_paused:true}},serviceJwt,'PUT')).status,200);
   assert.equal((await call(route,body,scope)).status,401);assert.equal((await authCall('/admin/users/'+userId,{app_metadata:metadata},serviceJwt,'PUT')).status,200);
   assert.equal((await call(route,body,{'x-checkout-account-scope':'59009999'})).status,401);
   const cross=await new Promise((resolve,reject)=>{
    const request=https.request({hostname:'127.0.0.1',port:listening.port,path:route,method:'POST',ca:fs.readFileSync(path.join(fixture.evidence,'tls-cert.pem')),
     headers:{host:new URL(origin).host,origin:'https://untrusted.example.invalid','content-type':'application/json'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);request.end(JSON.stringify(body));
   });assert.equal(cross,403);assert.deepEqual(await financial.state(),state);
  });
  await check('revoking only PG entry denies replay without HTTP/service-key fallback or another debit',async()=>{
   const state=await financial.state();await db.query(`REVOKE EXECUTE ON FUNCTION public.faolla_checkout_runtime_v1(text,jsonb) FROM ${pgLoginRole}`);
   try{const r=await call(route,body,scope);assert.equal(r.status,503);}finally{await db.query(`GRANT EXECUTE ON FUNCTION public.faolla_checkout_runtime_v1(text,jsonb) TO ${pgLoginRole}`);}
   assert.deepEqual(await financial.state(),state);assert.equal((await call(route,body,scope)).value.replayed,true);assert.equal(report.paths.some(p=>p.includes('/rpc/faolla_checkout_runtime_v1')),false);
  });
  const configRoute='/api/merchant-checkout/configuration?siteId='+financial.site;
  await check('non-owner real login cannot read or alter the merchant checkout configuration',async()=>{const state=await financial.state();assert.equal((await call(configRoute)).status,403);assert.deepEqual(await financial.state(),state);});
  const ownerEmail='owner-'+randomUUID()+'@example.invalid',owner=await authCall('/admin/users',{email:ownerEmail,password,email_confirm:true,app_metadata:{account_type:'merchant',account_id:financial.site},user_metadata:{account_type:'merchant',account_id:financial.site}});assert.equal(owner.status,200);
  await db.query('INSERT INTO public.merchants(id,name,user_id,email) VALUES($1,$2,$3,$4)',[financial.site,'Synthetic owner',owner.value.id,ownerEmail]);
  await check('real owner login reads and saves only through the same PG candidate and loses access when ownership is removed',async()=>{
   assert.equal((await login(ownerEmail,password,'merchant')).status,200);const read=await call(configRoute);assert.equal(read.status,200,JSON.stringify(read));
   const edit={...configuration.checkoutEditFromOffer(f.offer),title:'Synthetic reviewed'};const written=await call(configRoute,{expectedVersion:read.value.snapshot.version,edit},{},'PUT');assert.equal(written.status,200,JSON.stringify(written));
   const state=await financial.state();await db.query('UPDATE public.merchants SET user_id=NULL WHERE id=$1',[financial.site]);assert.equal((await call(configRoute)).status,403);assert.deepEqual(await financial.state(),{...state,'public.merchants':(await financial.state())['public.merchants']});
  });
  await check('logout clears real cookies and blocks checkout without a new financial mutation',async()=>{
   assert.equal((await call('/api/auth/merchant-logout',{})).status,200);const state=await financial.state();assert.equal((await call(route,body,scope)).status,401);assert.deepEqual(await financial.state(),state);
   assert.equal((await context.cookies(origin)).filter(c=>c.name.startsWith('__Host-faolla-merchant-')).length,0);
  });
  await check('candidate typechecks and source fingerprints stay bound; original app remains untouched',async()=>{
   const log=path.join(evidence,'typecheck.private.log');try{const r=await exec(process.execPath,[path.join(fixture.app,'node_modules/typescript/bin/tsc'),'--noEmit','--incremental','false'],{cwd:fixture.app,timeout:120000,maxBuffer:4*1024*1024});fs.writeFileSync(log,r.stdout+r.stderr,{flag:'wx'});}catch(e){fs.writeFileSync(log,(e.stdout??'')+(e.stderr??''),{flag:'wx'});throw Error('candidate_typecheck_failed');}
   assert.deepEqual(await applicationFingerprint(fixture.app),candidate.material.application);assert.deepEqual(await applicationFingerprint(),candidate.material.baseApplication);
   let files=0;const scan=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())scan(file);else if(/\.(?:js|json|map)$/.test(file)){const bytes=fs.readFileSync(file);assert.equal(bytes.includes(Buffer.from('FAOLLA_CHECKOUT_PG_PASSWORD')),false);assert.equal(bytes.includes(Buffer.from(pgPassword)),false);files++;}}};scan(path.join(fixture.app,'.next/static'));assert.ok(files>0);report.clientFilesScanned=files;
  });report.passed=true;
 }catch(error){report.failure=safeError(error);throw error;}
 finally{
  await browser?.close();
  for(const row of [...children].reverse()){
   let requested=null,forced=false;if(row.child.exitCode===null&&row.child.signalCode===null&&!row.spawnFailed){requested=row.name==='next'?'IPC-close':row.name==='postgrest'?'SIGINT':'SIGTERM';if(requested==='IPC-close')row.child.send('close');else row.child.kill(requested);const done=await Promise.race([row.done,delay(10000).then(()=>null)]);if(!done){forced=true;row.child.kill('SIGKILL');}}
   report.stopped.push({name:row.name,requested,forced,...await row.done});
  }
  for(const server of servers.reverse()){server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  for(const c of clients)await c.end().catch(()=>{});for(const log of logs)await new Promise(resolve=>log.end(resolve));
  report.nextShutdown=nextEvents.find(e=>e.type==='stopped')??null;
  report.cleanupPassed=report.stopped.length===3&&report.stopped.every(r=>!r.forced&&(r.code===0&&r.signal===null||r.requested!=='IPC-close'&&r.code===null&&r.signal===r.requested))&&report.nextShutdown?.forbiddenFetches===0;
  report.passed=report.passed&&report.cleanupPassed&&report.checks.every(c=>c.passed)&&report.failure===null;
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  if(!report.cleanupPassed)assert.fail('pg_candidate_owned_cleanup_failed');
 }
});
