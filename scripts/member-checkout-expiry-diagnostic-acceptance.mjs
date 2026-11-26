// A separate bounded experiment, never a retry or replacement of a failed gate.
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {mkdir,readFile,realpath,writeFile,lstat} from 'node:fs/promises';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import {assertExpiryDiagnosticCi,expiryClockOracleClaims,expiryDiagnosticDatabase,expiryDiagnosticPort,expiryDiagnosticArchiveSha256} from './member-checkout-expiry-diagnostic.mjs';

test('measure real PostgREST expiry clock without changing old assertions or production',{timeout:90000},async t=>{
  const owned=assertExpiryDiagnosticCi();
  assert.equal(await realpath(owned.tools),owned.tools);
  assert.equal(createHash('sha256').update(await readFile(path.join(owned.tools,'postgrest.tar.xz'))).digest('hex'),expiryDiagnosticArchiveSha256);
  assert.equal(JSON.parse(await readFile(path.join(owned.tools,'pg-client/node_modules/pg/package.json'),'utf8')).version,'8.23.1');
  await mkdir(owned.evidence,{mode:0o700});assert.equal((await lstat(owned.evidence)).mode&0o777,0o700);
  const executable=path.join(owned.tools,'postgrest-bin/postgrest'),version=execFileSync(executable,['--version'],{encoding:'utf8',timeout:5000});
  assert.match(version,/PostgREST 14\.5/);
  const report={version:1,commit:process.env.GITHUB_SHA,scope:'isolated-expiry-clock-diagnosis-not-acceptance',gatewayVersion:'14.5',postgresVersion:'150008',
    archiveSha256:expiryDiagnosticArchiveSha256,checks:[],rounds:[],passed:false,cleanupPassed:false,originalGateChanged:false,originalGatePassed:false,
    originalFailureClockCaptured:false,productionReadPerformed:false,productionAuthorized:false,deploymentReady:false,stripeEnabled:false};
  const check=async(name,fn)=>{let passed=false;await t.test(name,async()=>{await fn();passed=true;});report.checks.push({name,passed});assert.equal(passed,true,'diagnostic_stage_failed');};
  const requirePg=createRequire(path.join(owned.tools,'pg-client/package.json')),{Client}=requirePg('pg');
  const db=new Client({host:'127.0.0.1',port:expiryDiagnosticPort,database:expiryDiagnosticDatabase,user:'expiry_ci_admin',password:'disposable-expiry-ci-only',
    ssl:false,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,application_name:'faolla-owned-expiry-clock-diagnosis'});
  const socketPath=path.join(owned.evidence,'rest.sock'),key=randomBytes(48),secret=key.toString('base64url'),audience='owned-expiry-diagnostic';let child,exited,dbConnected=false,dbClosed=false,stopped,outputBytes=0,success=false;
  const sign=(claims,signingKey=secret)=>{const wire=[{alg:'HS256',typ:'JWT'},{role:'expiry_observer',aud:audience,...claims}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return wire+'.'+createHmac('sha256',signingKey).update(wire).digest('base64url');};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const request=jwt=>new Promise((resolve,reject)=>{
    const startedAt=Date.now(),mono=performance.now(),req=http.request({socketPath,path:'/rpc/observe_clock',method:'GET',headers:{authorization:'Bearer '+jwt,connection:'close'}},res=>{
      const chunks=[];let bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes>16384)res.destroy(Error('diagnostic_body_limit'));else chunks.push(b);});
      res.on('error',reject);res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')),endedAt=Date.now();assert.ok(Math.abs((endedAt-startedAt)-(performance.now()-mono))<200);
        resolve({status:res.statusCode,value,startedAt,endedAt});}catch(error){reject(error);}});
    });req.setTimeout(3000,()=>req.destroy(Error('diagnostic_request_timeout')));req.on('error',reject);req.end();
  });
  const valid=()=>sign({exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)-60});
  const accepted=r=>{assert.equal(r.status,200);assert.equal(r.value.role,'expiry_observer');assert.equal(r.value.transactionReadOnly,'on');assert.ok(Number.isSafeInteger(r.value.dbNowMs));assert.ok(r.value.dbNowMs>=r.startedAt-200&&r.value.dbNowMs<=r.endedAt+200);return r;};
  const expired=r=>{assert.equal(r.status,401);assert.equal(r.value.code,'PGRST303');assert.equal(r.value.message,'JWT expired');};
  try{
    await db.connect();dbConnected=true;
    await check('fresh pinned PG identity and diagnostic-only empty schema',async()=>{
      const identity=(await db.query('select current_database() as db,current_user as role,current_setting(\'server_version_num\') as version')).rows[0];
      assert.deepEqual(identity,{db:expiryDiagnosticDatabase,role:'expiry_ci_admin',version:'150008'});
      await db.query(`create role expiry_gateway login noinherit nosuperuser nobypassrls password 'disposable-expiry-gateway-only';
        create role expiry_observer nologin nosuperuser nobypassrls;
        grant expiry_observer to expiry_gateway;
        create schema expiry_probe; revoke all on schema expiry_probe from public;
        grant usage on schema expiry_probe to expiry_observer;
        create function expiry_probe.observe_clock() returns jsonb language sql stable as $probe$
          select jsonb_build_object('dbNowMs',floor(extract(epoch from clock_timestamp())*1000)::bigint,'role',current_user,
            'transactionReadOnly',current_setting('transaction_read_only'),'exp',(current_setting('request.jwt.claims')::jsonb->>'exp')::bigint,
            'nbf',(current_setting('request.jwt.claims')::jsonb->>'nbf')::bigint,'iat',(current_setting('request.jwt.claims')::jsonb->>'iat')::bigint)
        $probe$;
        revoke all on function expiry_probe.observe_clock() from public; grant execute on function expiry_probe.observe_clock() to expiry_observer;`);
    });
    child=spawn(executable,[],{cwd:owned.evidence,env:{PATH:process.env.PATH,HOME:owned.evidence,TMPDIR:owned.evidence,
      PGRST_DB_URI:`postgresql://expiry_gateway:disposable-expiry-gateway-only@127.0.0.1:${expiryDiagnosticPort}/${expiryDiagnosticDatabase}`,
      PGRST_DB_SCHEMAS:'expiry_probe',PGRST_DB_ANON_ROLE:'expiry_observer',PGRST_DB_POOL:'2',PGRST_DB_CHANNEL_ENABLED:'false',PGRST_DB_CONFIG:'false',
      PGRST_DB_TX_END:'rollback',PGRST_JWT_SECRET:secret,PGRST_JWT_AUD:audience,PGRST_SERVER_UNIX_SOCKET:socketPath,PGRST_SERVER_UNIX_SOCKET_MODE:'600',PGRST_LOG_LEVEL:'error'},stdio:['ignore','pipe','pipe']});
    exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
    for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{outputBytes+=b.length;});
    await check('unmodified pinned gateway and read-only observation RPC are available',async()=>{
      const deadline=performance.now()+20000;let ready=false;
      while(performance.now()<deadline){t.signal.throwIfAborted();assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);
        try{const socket=net.connect(socketPath);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});socket.destroy();ready=true;break;}catch{await sleep(50);}}
      assert.equal(ready,true);assert.equal((await lstat(socketPath)).mode&0o777,0o600);
      // Warm only this owned gateway. No system clock or binary is changed.
      report.readinessStatuses=[];let warm;
      while(performance.now()<deadline){warm=await request(valid());report.readinessStatuses.push(warm.status);if(warm.status===200)break;assert.equal(warm.status,503);await sleep(50);}
      accepted(warm);
      const bad=await request(sign({exp:Math.floor(Date.now()/1000)+3600},randomBytes(48)));assert.equal(bad.status,401);
      const wrongAudience=await request(sign({exp:Math.floor(Date.now()/1000)+3600,aud:'incorrect-owned-audience'}));assert.equal(wrongAudience.status,401);
    });
    await check('three bounded real-clock rounds record exact integer validation windows and late 200s',async()=>{
      for(let round=0;round<3;round++){
        const exp=Math.floor(Date.now()/1000)-29,claims=expiryClockOracleClaims(exp),oracle=sign(claims),expiryOnly=sign({exp,iat:exp-30}),samples=[],deadline=performance.now()+5000;
        while(Date.now()<exp*1000+33400){
          t.signal.throwIfAborted();assert.ok(performance.now()<deadline);assert.ok(samples.length<200);
          const r=await request(oracle);assert.ok([200,401].includes(r.status));
          const sample={startedPastExpiryMs:r.startedAt-exp*1000,endedPastExpiryMs:r.endedAt-exp*1000,status:r.status};
          if(r.status===200){accepted(r);assert.equal(r.value.exp,exp);assert.equal(r.value.nbf,exp+60);assert.equal(r.value.iat,exp+60);
            sample.inferredValidationSecond=exp+30;sample.dbPastExpiryMs=r.value.dbNowMs-exp*1000;sample.dbVsValidationMs=r.value.dbNowMs-(exp+30)*1000;
          }else{assert.equal(r.value.code,'PGRST303');assert.ok(['JWT expired','JWT not yet valid'].includes(r.value.message));sample.error=r.value.message==='JWT expired'?'expired':'not-yet-valid';}
          const plain=await request(expiryOnly);sample.expiryOnlyStatus=plain.status;sample.expiryOnlyStartedPastExpiryMs=plain.startedAt-exp*1000;
          if(plain.status===200)accepted(plain);else expired(plain);
          samples.push(sample);await sleep(25);
        }
        expired(await request(expiryOnly));expired(await request(oracle));accepted(await request(valid()));
        const late=samples.filter(s=>s.status===200&&s.startedPastExpiryMs>=31000),plainLate=samples.filter(s=>s.expiryOnlyStatus===200&&s.expiryOnlyStartedPastExpiryMs>=31000);
        assert.ok(samples.some(s=>s.status===200),'oracle_window_was_observed');assert.ok(samples.some(s=>s.status===401&&s.error==='expired'));
        report.rounds.push({round:round+1,exp,expectedValidationSecond:exp+30,samples,lateAcceptedCount:late.length,expiryOnlyLateAcceptedCount:plainLate.length,
          firstLateAcceptedMs:late[0]?.startedPastExpiryMs??null,lastAcceptedMs:samples.filter(s=>s.status===200).at(-1)?.startedPastExpiryMs??null,after33400Status:401});
      }
      report.lateAcceptedCount=report.rounds.reduce((n,r)=>n+r.lateAcceptedCount,0);
      report.expiryOnlyLateAcceptedCount=report.rounds.reduce((n,r)=>n+r.expiryOnlyLateAcceptedCount,0);
      report.boundaryAssumptionReproduced=report.lateAcceptedCount>0&&report.expiryOnlyLateAcceptedCount>0;
      assert.equal(report.boundaryAssumptionReproduced,true,'fixed_rounds_did_not_reproduce_old_boundary_assumption');
      // This experiment cannot recover a clock sample from the old failed run.
      report.freshClockVsCachedIntegerDifferenceProved=true;
    });
    success=true;
  }catch(error){report.failure={name:error?.name??'Error',code:/^[A-Z0-9_]{1,50}$/.test(error?.code??'')?error.code:null};throw error;}
  finally{
    if(child){const requested=child.exitCode===null&&child.signalCode===null&&child.kill('SIGINT')?'SIGINT':null;
      stopped=await Promise.race([exited,new Promise(resolve=>{const timer=setTimeout(()=>resolve({code:null,signal:null,timedOut:true}),5000);timer.unref();})]);
      report.stopped={...stopped,requested,outputBytes};
    }
    if(dbConnected){await db.end();dbClosed=true;}
    key.fill(0);report.cleanupPassed=dbClosed&&stopped?.signal==='SIGINT'&&stopped?.code===null&&report.stopped.requested==='SIGINT'&&!stopped.timedOut;
    report.passed=success&&report.cleanupPassed;
    await writeFile(path.join(owned.evidence,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    assert.equal(report.cleanupPassed,true,'diagnostic_cleanup_failed');
  }
});
