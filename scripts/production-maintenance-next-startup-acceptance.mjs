
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,existsSync,readdirSync,cpSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {STARTUP_PROCESS_FACT_KEYS as keys,captureStartupFixtureProcessFact} from './test-helpers/startup-process-fact.mjs';
if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_NEXT_STARTUP_ACCEPTANCE!=='1'||process.getuid?.()!==0)throw Error('isolated_next_opt_in_required');
const scripts=dirname(fileURLToPath(import.meta.url))+'/';
const {captureProcessFact,captureSupervisionSnapshot}=await import(scripts+'check-production-runtime-supervision.mjs');
const {controlPm2,inspectPm2Registry}=await import(scripts+'production-maintenance-pm2-adapter.mjs');
const fixture=mkdtempSync(join(homedir(),'.fs')),home=fixture+'/p';
const release=fixture+'/app.releases/'+ 'b'.repeat(12)+'-20260917000000';
mkdirSync(home,{mode:0o700});mkdirSync(release+'/node_modules',{recursive:true,mode:0o700});
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const installed=join(dirname(scripts.slice(0,-1)),'node_modules');
for(const name of readdirSync(installed)){
if(name==='next')cpSync(installed+'/next',release+'/node_modules/next',{recursive:true});
else symlinkSync(installed+'/'+name,release+'/node_modules/'+name);
}
mkdirSync(release+'/pages/api',{recursive:true,mode:0o700});
writeFileSync(release+'/pages/index.js',"export default function Page(){return 'Isolated fixture';}",{mode:0o600,flag:'wx'});
writeFileSync(release+'/pages/api/app-web-version.js',"export default function handler(q,r){r.status(200).json({buildId:'"+'b'.repeat(40)+"'})}",{mode:0o600,flag:'wx'});
writeFileSync(release+'/package.json',JSON.stringify({name:'isolated-startup-fixture',private:true}),{mode:0o600,flag:'wx'});
writeFileSync(release+'/next.config.ts',"import type {NextConfig} from 'next';const config:NextConfig={};export default config;",{mode:0o600,flag:'wx'});
const build=spawnSync(realpathSync(process.execPath),[release+'/node_modules/next/dist/bin/next','build','--webpack'],{cwd:release,env:{HOME:fixture,PATH:'/usr/bin:/bin',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'},encoding:'utf8',timeout:120000,maxBuffer:500000});
console.log(JSON.stringify({fixtureBuild:build.status===0,fixturePath:fixture,output:build.status===0?undefined:build.stdout.slice(-4000),error:build.status===0?undefined:build.stderr.slice(-2000)}));
if(build.status!==0)throw Error('isolated_build_failed');
const env={HOME:homedir(),PATH:'/usr/bin:/bin',PM2_HOME:home,NODE_OPTIONS:'',NODE_PATH:'',PM2_NODE_OPTIONS:''};
const npmCli=join(dirname(scripts.slice(0,-1)),'npm/bin/npm-cli.js');
if(!existsSync(npmCli))throw Error('isolated_npm_cli_missing');
const install=spawnSync(realpathSync(process.execPath),[npmCli,'install','--prefix',fixture+'/dependencies','--cache',fixture+'/cache','--registry=https://registry.npmjs.org','--ignore-scripts','--no-audit','--no-fund','pm2@6.0.14'],{env:{...env,PATH:dirname(process.execPath)+':/usr/bin:/bin'},cwd:fixture,encoding:'utf8',timeout:180000});
if(install.status!==0){console.log(JSON.stringify({fixtureInstall:false,status:install.status,errorCode:install.error?.code??null,signal:install.signal}));throw Error('isolated_pm2_install_failed');}
const cli=args=>spawnSync(realpathSync(process.execPath),[fixture+'/dependencies/node_modules/pm2/bin/pm2',...args],{env,cwd:fixture,encoding:'utf8',timeout:20000,maxBuffer:100000});
const boot=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
const fact=pid=>captureStartupFixtureProcessFact(pid,captureProcessFact);
let daemon,initial;
try{
const b=cli(['ping']);if(b.status!==0)throw Error('fixture_bootstrap');daemon=fact(Number(readFileSync(home+'/pm2.pid','utf8')));
if(!captureProcessFact(daemon.pid).commandLine[0].endsWith('('+home+')'))throw Error('fixture_daemon_mismatch');
const values={SUPABASE_INTERNAL_URL:'http://127.0.0.1:1',NEXT_PUBLIC_SUPABASE_URL:'https://database.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-key',MERCHANT_STAFF_BUSINESS_RBAC_MODE:'off',MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS:'',FAOLLA_CANONICAL_PORTAL_ORIGIN:'https://portal.invalid',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',PORT:String(port),MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'false',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'false'};
const digest=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(values).sort().map(k=>[k,values[k]])))).digest('hex');
await controlPm2(daemon,boot,{action:'prepare',launch:{role:'candidate-web',appName:'isolated-fixture',appPort:port,release,node:realpathSync(process.execPath),nonce:randomUUID(),envDigest:digest,env:values}});
const row=(await inspectPm2Registry(daemon,boot))[0];initial=fact(row.pid);let prior=initial;
let accepted=0;const deadline=Date.now()+60000;
for(let i=0;i<240&&Date.now()<deadline;i++){
const observation=await captureSupervisionSnapshot('isolated-fixture',{runtime:release,nextEntryPath:release+'/node_modules/next/dist/bin/next'},port,'b'.repeat(40));
const current=fact(row.pid);const reg=(await inspectPm2Registry(daemon,boot))[0];
assert.deepEqual(keys.filter(k=>k!=='commandLineDigest'&&prior[k]!==current[k]),[]);
assert.deepEqual(reg,row);
if(['absent','unattributed'].includes(observation.listener.state)){accepted=0;}else{assert.equal(observation.listener.state,'single');assert.equal(observation.listener.pid,row.pid);assert.equal(observation.ownership.state,'owned');assert.equal(observation.ownership.mode,'direct');if(observation.healthVerified)accepted++;}
console.log(JSON.stringify({iteration:i,listener:observation.listener.state,ownership:observation.ownership.state,mode:observation.ownership.mode,health:observation.healthVerified,processChanges:keys.filter(k=>prior[k]!==current[k]),pm2Changes:Object.keys(row.pm2_env).filter(k=>JSON.stringify(row.pm2_env[k])!==JSON.stringify(reg.pm2_env[k]))}));prior=current;
if(accepted>=2)break;
await new Promise(r=>setTimeout(r,250));
}
assert.ok(accepted>=2,'startup never became verified');
}finally{
if(daemon&&existsSync('/proc/'+daemon.pid)&&captureProcessFact(daemon.pid).commandLine[0].endsWith('('+home+')')){const r=cli(['kill']);console.log(JSON.stringify({fixtureCleanup:r.status===0,fixturePath:fixture}));assert.equal(r.status,0);}
}
