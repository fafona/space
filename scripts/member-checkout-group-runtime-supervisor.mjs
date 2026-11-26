// Exact hosted-CI bootstrap only. Root opens a fresh private request, launches
// fixed children, and supervises them; no database, Auth, app build or deployment.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {lstat,realpath,readFile,chown} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {assertIsolatedCi,safeError} from './member-checkout-real-auth-support.mjs';
assert.equal(assertIsolatedCi().profileName,'current-auth');assert.equal(process.env.FAOLLA_CHECKOUT_GROUP_NEXT_ACCEPTANCE,'1');assert.equal(process.getuid(),0);assert.equal(await realpath(process.cwd()),await realpath(process.env.GITHUB_WORKSPACE));
const request=process.argv[2];assert.match(request,/^\/tmp\/faolla-checkout-group-[A-Za-z0-9]+\/request\.private\.json$/);assert.equal(await realpath(request),request);
const rs=await lstat(request);assert.ok(rs.isFile()&&rs.nlink===1&&rs.size>0&&rs.size<32768&&(rs.mode&0o777)===0o600);
const config=JSON.parse(await readFile(request,'utf8'));assert.deepEqual(Object.keys(config).sort(),['app','environment','root','version','writerGid','writerUid']);assert.equal(config.version,1);assert.equal(request,path.join(config.root,'request.private.json'));
for(const n of [config.writerUid,config.writerGid])assert.ok(Number.isInteger(n)&&n>=1000&&n<65533);assert.equal(rs.uid,config.writerUid);assert.equal(rs.gid,config.writerGid);assert.equal((await lstat(process.cwd())).uid,config.writerUid);
assert.match(config.app,/^\/tmp\/faolla-checkout-build-[A-Za-z0-9]+\/app$/);assert.equal(await realpath(config.app),config.app);
for(const [file,mode]of[[config.root,0o750],[path.join(config.root,'delivery'),0o750],[path.join(config.root,'signer'),0o700],[path.join(config.root,'logs'),0o700],[config.app,0o750],[path.dirname(config.app),0o750]]){const s=await lstat(file);assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(s.uid,config.writerUid);assert.equal(s.gid,config.writerGid);assert.equal(s.mode&0o777,mode);}
const e=config.environment;assert.equal(e.NODE_ENV,'production');assert.equal(e.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');assert.equal(e.FAOLLA_CHECKOUT_NEXT_LOCAL,'1');assert.equal(e.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_SOURCE,'file');assert.equal(e.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ACCESS,'group');assert.equal(e.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_DIRECTORY,path.join(config.root,'delivery'));
const allowed=['NODE_ENV','NODE_OPTIONS','NEXT_TELEMETRY_DISABLED','FAOLLA_CHECKOUT_NEXT_LOCAL','FAOLLA_CANONICAL_PORTAL_ORIGIN','FAOLLA_SUPER_ADMIN_ORIGIN','SUPABASE_INTERNAL_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','FAOLLA_CHECKOUT_RUNTIME_JWT','FAOLLA_BACKGROUND_JOBS_PAUSED','MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED','MERCHANT_BOOKING_STORAGE_MODE',
 'MERCHANT_MEMBER_CHECKOUT_PILOT_SITES','MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES','MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES','MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES','MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES',
 ...['SOURCE','DIRECTORY','OWNER_UID','OWNER_GID','ACCESS','ALGORITHM','ISSUER','AUDIENCE'].map(v=>'FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_'+v)];assert.ok(Object.keys(e).every(k=>allowed.includes(k)&&typeof e[k]==='string'));assert.equal(e.MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED,'false');assert.equal(e.MERCHANT_BOOKING_STORAGE_MODE,'atomic-v2');
for(const k of allowed.filter(v=>v.endsWith('_PILOT_SITES')))assert.equal(e[k],'10909992');assert.equal(e.FAOLLA_CANONICAL_PORTAL_ORIGIN,'https://portal.checkout-auth.test');assert.equal(e.FAOLLA_SUPER_ADMIN_ORIGIN,'https://console.checkout-auth.test');
assert.equal(e.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_OWNER_UID,String(config.writerUid));assert.equal(e.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_OWNER_GID,String(config.writerGid));assert.equal(e.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ISSUER,'group-owned-issuer');assert.equal(e.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_AUDIENCE,'group-owned-audience');assert.equal(e.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ALGORITHM,'HS256');
for(const key of ['SUPABASE_INTERNAL_URL','NEXT_PUBLIC_SUPABASE_URL'])assert.match(e[key],/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);assert.equal(e.SUPABASE_INTERNAL_URL,e.NEXT_PUBLIC_SUPABASE_URL);assert.equal(Object.keys(e).some(k=>/SECRET|SIGNING|PRIVATE_KEY|NODE_EXTRA_CA_CERTS|NODE_PATH/.test(k)),false);assert.equal(e.NODE_OPTIONS,'--max-old-space-size=3072');
const children=[],logs=[];let closing=false,stage='spawn',timer;const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
function launch(role){const logFile=path.join(config.root,'logs',role+'.private.log'),log=createWriteStream(logFile,{flags:'wx',mode:0o600});logs.push({log,logFile});
 const env={PATH:process.env.PATH,HOME:config.root,TMPDIR:'/tmp',TMP:'/tmp',TEMP:'/tmp',TSX_DISABLE_CACHE:'1',FAOLLA_CHECKOUT_GROUP_CHILD:'1',...(role==='next'?e:{})};
 const setup={role,root:config.root,app:config.app,writerUid:config.writerUid,writerGid:config.writerGid};const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/member-checkout-group-runtime-worker.mjs',import.meta.url)),Buffer.from(JSON.stringify(setup)).toString('base64url')],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe','ipc']});
 const row={role,child,exit:null,forced:false,requested:null};children.push(row);child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.on('message',event=>output({source:role,...event}));child.on('error',()=>output({type:'worker-failed',source:role,stage:'spawn'}));child.on('exit',(code,signal)=>{row.exit={code,signal};output({type:'child-exit',source:role,code,signal});});return row;
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function close(){if(closing)return;closing=true;clearTimeout(timer);stage='stop';for(const row of children)if(row.exit===null&&row.child.connected){row.requested=row.role==='next'?'IPC-close':'stop';row.child.send(row.role==='next'?'close':'stop');}
 const end=performance.now()+10000;while(children.some(v=>v.exit===null)&&performance.now()<end)await wait(25);for(const row of children)if(row.exit===null){row.forced=true;row.child.kill('SIGKILL');}const killed=performance.now()+2000;while(children.some(v=>v.exit===null)&&performance.now()<killed)await wait(25);
 for(const {log,logFile}of logs){await new Promise(r=>log.end(r));await chown(logFile,config.writerUid,config.writerGid);}
 const processes=children.map(v=>({role:v.role,requested:v.requested,forced:v.forced,...v.exit})),passed=processes.length===2&&processes.every(v=>v.code===0&&v.signal===null&&!v.forced&&v.requested);
 output({type:'supervisor-stopped',passed,processes});process.stdin.destroy();process.exitCode=passed?0:1;
}
try{const writer=launch('issuer'),next=launch('next');let commandBytes=0;process.stdin.on('data',v=>{commandBytes+=v.length;if(commandBytes>4096){output({type:'supervisor-failed',stage:'command',code:'OWNED_COMMAND_OVERFLOW'});void close();}});const lines=createInterface({input:process.stdin});lines.on('line',line=>{try{assert.ok(line.length<128);const c=JSON.parse(line);assert.deepEqual(Object.keys(c),['op']);assert.ok(['start-issuer','fail-issuer','resume-issuer','audit-next','stop'].includes(c.op));if(c.op==='stop'){lines.close();void close();}else if(!closing){(c.op==='audit-next'?next:writer).child.send(c.op);}}catch{output({type:'supervisor-failed',stage:'command',code:'OWNED_COMMAND_REFUSED'});void close();}});lines.on('close',()=>void close());timer=setTimeout(()=>{output({type:'supervisor-failed',stage:'watchdog',code:'OWNED_RUNTIME_TIMEOUT'});void close();},300000);}
catch(error){output({type:'supervisor-failed',stage,...safeError(error)});await close();}
