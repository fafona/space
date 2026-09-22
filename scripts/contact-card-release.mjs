import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmdirSync, realpathSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertContactReleaseScope, contactReleaseConfig, CONTACT_RELEASE_CONFIG as config, CONTACT_RELEASE_ROOT as root } from './contact-card-release-policy.mjs';

const app = '/www/wwwroot/merchant-space', port = 3101, processName = 'merchant-space-contact-card';
const nginx = '/www/server/nginx/sbin/nginx';
const [action, target, baseline] = process.argv.slice(2);
const fail = message => { throw new Error(message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const read = path => readFileSync(path, 'utf8');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4*1024*1024, ...options });
  if (result.status !== 0) fail(`contact_release_command_failed:${command}:${result.status}`);
  return result.stdout;
}
function atomic(path, value) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, value, { mode: 0o600, flag: 'wx' }); renameSync(temp, path);
}
const stateFile = `${root}/state.json`;
const save = state => atomic(stateFile, JSON.stringify(state, null, 2));
const pm = () => JSON.parse(run('pm2', ['jlist']));
function baseProcess() {
  const p = pm().find(p => p.name === 'merchant-space');
  if (!p || p.pm2_env.status !== 'online' || p.pm2_env.PORT !== '3000') fail('base_process_not_online');
  return p;
}
async function response(url, expected = 200, options = {}) {
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(35_000), ...options });
  if (r.status !== expected) fail(`contact_release_http_failed:${r.status}`);
  return r;
}
async function verifyBase(state) {
  const maintenance = JSON.parse(read('/var/lib/faolla-maintenance/merchant-space/state.json'));
  if (maintenance.phase !== 'ended' || maintenance.targetSha !== state.baseline) fail('maintenance_not_ended');
  const p = baseProcess();
  if (p.pid !== state.basePid || p.pm2_env.pm_cwd !== state.baseDirectory || realpathSync(`${app}.current`) !== state.baseDirectory) fail('baseline_changed');
  const version = await (await response('http://127.0.0.1:3000/api/app-web-version')).json();
  if (version.buildId !== state.baseline) fail('baseline_build_mismatch');
}
function candidate(state) {
  const p = pm().find(p => p.name === processName);
  if (!p || p.pm2_env.status !== 'online' || p.pm2_env.pm_cwd !== state.directory || p.pm2_env.FAOLLA_BACKGROUND_JOBS_PAUSED !== '1') fail('candidate_identity_invalid');
  return p;
}
function removeOwnedConfig(state) {
  if (!existsSync(config)) return;
  if (lstatSync(config).isSymbolicLink() || hash(read(config)) !== state.configHash) fail('proxy_config_changed');
  renameSync(config, `${root}/proxy-rolled-back-${Date.now()}.conf`);
}

if (process.platform !== 'linux' || process.getuid?.() !== 0 || !['stage','activate','rollback','status'].includes(action)) fail('invalid_release_invocation');
if (!process.env.FAOLLA_CONTACT_RELEASE_LOCKED) {
  // Share the full-release lock. Never unlink or replace its inode.
  const lock = `${app}.deploy.lock`;
  if (existsSync(lock) && lstatSync(lock).isSymbolicLink()) fail('unsafe_deploy_lock');
  const r = spawnSync('flock', ['--nonblock', lock, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, FAOLLA_CONTACT_RELEASE_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}
mkdirSync(root, { recursive: true, mode: 0o700 });
if (lstatSync(root).isSymbolicLink() || (lstatSync(root).mode & 0o077)) fail('unsafe_release_state_directory');
const operationLock = '/var/lib/faolla-maintenance/merchant-space/operation.lock';
mkdirSync(operationLock, { mode: 0o700 });
try {
  if (action === 'stage') {
    if (!/^[a-f0-9]{40}$/.test(target ?? '') || !/^[a-f0-9]{40}$/.test(baseline ?? '')) fail('invalid_commit');
    if (existsSync(config) || existsSync(stateFile) || pm().some(p => p.name === processName)) fail('existing_contact_release_requires_review');
    const p = baseProcess(), baseDirectory = realpathSync(`${app}.current`);
    const state = { baseline, target, basePid: p.pid, baseDirectory, status: 'preparing', startedAt: new Date().toISOString() };
    await verifyBase(state);
    run('git', ['merge-base','--is-ancestor',baseline,target], { cwd: app });
    assertContactReleaseScope(run('git',['diff','--name-only',baseline,target],{cwd:app}).trim().split('\n'));
    const lockText = run('git',['show',`${target}:package-lock.json`],{cwd:app});
    if (hash(lockText) !== hash(read(`${baseDirectory}/package-lock.json`))) fail('dependencies_changed');
    state.directory = `${app}.route-releases/${target.slice(0,12)}-${Date.now()}`;
    mkdirSync(state.directory, { recursive: true, mode: 0o700 });
    save(state);
    const archive = run('git',['archive','--format=tar',target],{cwd:app,encoding:null,maxBuffer:128*1024*1024});
    run('tar',['--no-same-owner','--no-same-permissions','-xf','-','-C',state.directory],{input:archive});
    run('cp',['-a','--reflink=auto',`${baseDirectory}/node_modules`,`${state.directory}/node_modules`],{timeout:180_000});
    // Existing task credentials remain on the server. Never emit environment values.
    const env = Object.fromEntries(read(`/proc/${p.pid}/environ`).split('\0').filter(Boolean).map(item=>{
      const at=item.indexOf('='); return [item.slice(0,at),item.slice(at+1)];
    }).filter(([key])=>/^[A-Z][A-Z0-9_]*$/.test(key) && !['NODE_APP_INSTANCE','PM2_USAGE'].includes(key)));
    const changes = { FAOLLA_WEB_BUILD_ID: target, NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID: target,
      FAOLLA_WEB_RELEASED_AT: new Date().toISOString(), FAOLLA_BACKGROUND_JOBS_PAUSED:'1',
      MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0', MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0', PORT:String(port) };
    const envText = read(`${baseDirectory}/.env.local`).split('\n').filter(line=>!Object.keys(changes).some(key=>line.startsWith(`${key}=`))).join('\n');
    writeFileSync(`${state.directory}/.env.local`,`${envText}\n${Object.entries(changes).map(([k,v])=>`${k}=${v}`).join('\n')}\n`,{mode:0o600,flag:'wx'});
    Object.assign(env,changes,{NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1'});
    console.log('contact_release_build_started');
    run('nice',['-n','10','npm','run','build'],{cwd:state.directory,env,timeout:900_000,stdio:'inherit'});
    if (!existsSync(`${state.directory}/.next/BUILD_ID`)) fail('build_missing');
    await verifyBase(state);
    run('pm2',['start',`${state.directory}/node_modules/next/dist/bin/next`,'--name',processName,'--cwd',state.directory,'--interpreter',process.execPath,'--','start','-H','127.0.0.1','-p',String(port)],{env});
    let ready = false;
    for (let i=0;i<30;i++) {
      try { const r=await(await response(`http://127.0.0.1:${port}/api/app-web-version`)).json(); if(r.buildId===target){ready=true;break;} } catch {}
      await new Promise(r=>setTimeout(r,1000));
    }
    if (!ready) fail('candidate_not_ready');
    candidate(state); state.status='staged'; save(state);
    console.log(JSON.stringify({status:state.status,target,directory:state.directory}));
  } else {
    const state = JSON.parse(read(stateFile));
    await verifyBase(state);
    if (action === 'activate') {
      if (state.status !== 'staged' || existsSync(config)) fail('candidate_not_staged');
      candidate(state);
      // Operator supplies the actual public card and expected saved website.
      const key = target, expected = baseline;
      if (!/^[a-zA-Z0-9_-]{3,160}$/.test(key ?? '') || !/^https:\/\//.test(expected ?? '')) fail('activation_evidence_required');
      const html = await(await response(`http://127.0.0.1:${port}/card/${key}`,200,{headers:{Host:'www.faolla.com'}})).text();
      const escaped = expected.replaceAll('&','&amp;').replaceAll('"','&quot;');
      if (!html.includes(`class="button secondary" href="${escaped}"`) || !html.includes(`data-open-target-url="${escaped}"`)) fail('candidate_website_mismatch');
      const content = contactReleaseConfig(state.target,state.baseline,port);
      state.configHash=hash(content); state.cardKey=key; state.expectedWebsite=expected; state.status='activating'; save(state);
      try {
        writeFileSync(config,content,{mode:0o600,flag:'wx'});
        run(nginx,['-t']); run(nginx,['-s','reload']);
        let verified=false;
        for(let i=0;i<8;i++) {
          const live = await response(`https://www.faolla.com/card/${key}?release_check=${Date.now()}`);
          const body = await live.text();
          if(live.headers.get('x-faolla-card-release')===state.target && body.includes(`class="button secondary" href="${escaped}"`)){verified=true;break;}
          await new Promise(r=>setTimeout(r,1000));
        }
        if(!verified) fail('public_verification_failed');
        await verifyBase(state);
        await response('https://www.faolla.com/'); await response('https://launch.faolla.com/login');
        run('pm2',['save']); state.status='active'; state.activatedAt=new Date().toISOString(); save(state);
      } catch (error) {
        removeOwnedConfig(state); run(nginx,['-t']); run(nginx,['-s','reload']);
        state.status='rolled-back'; save(state); throw error;
      }
    } else if (action === 'rollback') {
      removeOwnedConfig(state); run(nginx,['-t']); run(nginx,['-s','reload']);
      state.status='rolled-back'; save(state);
    }
    console.log(JSON.stringify({status:state.status,target:state.target,baseline:state.baseline,basePid:state.basePid,cardKey:state.cardKey}));
  }
} catch(error) {
  console.error(error.message); process.exitCode=1;
} finally {
  rmdirSync(operationLock);
}
