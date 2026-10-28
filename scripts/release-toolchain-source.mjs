// Production admission is independently collected, not a caller's green snapshot.
import * as fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {canonicalJson,fingerprint,requireToolchain as need,assertFreshEvidence} from './release-toolchain-contracts.mjs';
export const RELEASE_REPOSITORY='fafona/space';
export const RELEASE_REQUIRED_JOBS=Object.freeze(['Quality','Code, Tests and Build','Isolated Maintenance Contract Tests','Enterprise Browser Journeys',
 'QR Atomic PostgreSQL Acceptance','Order Membership PostgreSQL Acceptance','Redemption PostgreSQL Acceptance','Checkout Context PostgreSQL Acceptance',
 'Pages Client Write ACL PostgreSQL Acceptance','Recovery Content PostgreSQL Acceptance','Isolated Maintenance Ingress Acceptance','Isolated Supabase Scheduler Acceptance']);
export const RELEASE_SAFETY_JOB='Packaged Tools And Real Ingress Boundary';
const revision=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
export function toolOnlySourcePath(file){
 if(/\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)||file.startsWith('scripts/test-support/')||file.startsWith('docs/')||file.startsWith('.github/'))return true;
 return /^scripts\/(?:release-toolchain[\w-]*\.(?:mjs|py)|(?:booking-(?:handoff|ready|dependency|ci|formal|registry|compatibility|publication|built-smoke)[\w-]*|online-(?:traffic|release)[\w-]*|prepare-online-release-tool|production-maintenance-ingress-acceptance|booking-(?:atomic-worker|release-probe)|test_booking_(?:handoff|ready)_pm2_[\w-]+)\.(?:mjs|py))$/.test(file);
}
export function parseSourceTree(raw){
 const rows=new TextDecoder('utf8',{fatal:true}).decode(raw).split('\0').filter(Boolean),seen=new Set();need(rows.length>0,'source_changed');
 return rows.map(row=>{const m=/^(100644|100755) blob ([a-f0-9]{40})\t([^\x00-\x1f\\]+)$/.exec(row);need(m,'source_changed');
  const [,mode,oid,file]=m;need(!seen.has(file)&&!file.startsWith('/')&&!file.split('/').some(p=>!p||p==='.'||p==='..'),'source_changed');seen.add(file);return {mode,oid,file};});
}
export function sourceApplicationIdentity(commit,rows){
 need(revision(commit),'source_changed');const entries=rows.filter(v=>!toolOnlySourcePath(v.file));need(entries.length>0,'source_changed');
 const select=predicate=>rows.filter(predicate).map(v=>[v.mode,v.oid,v.file]);
 return {revision:commit,source:fingerprint('application-source',entries.map(v=>[v.mode,v.oid,v.file]),'canonical-json-v1'),
  dependencies:fingerprint('application-dependencies',select(v=>['package.json','package-lock.json'].includes(v.file)),'canonical-json-v1'),
  migrations:fingerprint('application-migrations',select(v=>v.file.startsWith('scripts/supabase-migrations/')||v.file.startsWith('supabase/migrations/')),'canonical-json-v1')};
}
export function assertUnchangedApplicationSource(applicationRevision,applicationRows,toolRows){
 const a=sourceApplicationIdentity(applicationRevision,applicationRows),b=sourceApplicationIdentity(applicationRevision,toolRows);
 need(canonicalJson(a)===canonicalJson(b),'source_changed');return a;
}
export function validateReviewRuns({revision:sha,main,runs,jobsByRun,production=true,nowMs=Date.now()}){
 need(revision(sha)&&revision(main)&&(!production||main===sha),'source_changed');
 const selected=[];for(const [workflow,required]of [['.github/workflows/ci.yml',RELEASE_REQUIRED_JOBS],['.github/workflows/release-toolchain.yml',[RELEASE_SAFETY_JOB]]]){
  const matches=runs.filter(r=>r.head_sha===sha&&r.path===workflow&&r.repository?.full_name===RELEASE_REPOSITORY&&
   (!production||r.event==='push'&&r.head_branch==='main')).sort((a,b)=>b.id-a.id);
  const run=matches[0];need(run&&Number.isSafeInteger(run.id)&&run.id>0&&run.status==='completed'&&run.conclusion==='success','evidence_invalid');
  const jobs=jobsByRun[run.id];need(Array.isArray(jobs)&&jobs.length===required.length,'evidence_invalid');
  for(const name of required)need(jobs.filter(j=>j.name===name&&j.status==='completed'&&j.conclusion==='success'&&j.run_attempt===run.run_attempt).length===1,'evidence_invalid');
  need(new Set(jobs.map(j=>j.name)).size===jobs.length,'evidence_invalid');selected.push({workflow,runId:run.id,attempt:run.run_attempt,headSha:sha,jobs:[...required]});
 }
 return {kind:'independently-verified-release-review',revision:sha,main,productionEligible:production&&main===sha,runs:selected,
  createdAt:new Date(nowMs).toISOString(),expiresAt:new Date(nowMs+600000).toISOString()};
}
export async function collectRemoteReleaseReview(sha,{production=true,fetcher=fetch,nowMs=Date.now()}={}){
 need(revision(sha),'source_changed');const base='https://api.github.com/repos/'+RELEASE_REPOSITORY;
 const get=async suffix=>{const r=await fetcher(base+suffix,{redirect:'error',headers:{Accept:'application/vnd.github+json','User-Agent':'Faolla-Release-Toolchain','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(10000)});
  need(r.status===200,'evidence_invalid');const text=await r.text();need(Buffer.byteLength(text)<=4*1024**2,'evidence_invalid');return JSON.parse(text);};
 const main=(await get('/branches/main')).commit?.sha,runs=(await get('/actions/runs?head_sha='+sha+'&per_page=100')).workflow_runs;
 need(Array.isArray(runs),'evidence_invalid');const jobsByRun={};
 for(const workflow of ['.github/workflows/ci.yml','.github/workflows/release-toolchain.yml']){
  const run=runs.filter(r=>r.head_sha===sha&&r.path===workflow&&(!production||r.event==='push'&&r.head_branch==='main')).sort((a,b)=>b.id-a.id)[0];
  need(Number.isSafeInteger(run?.id)&&Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0,'evidence_invalid');
  const response=await get('/actions/runs/'+run.id+'/attempts/'+run.run_attempt+'/jobs?per_page=100');
  need(response.total_count===response.jobs?.length,'evidence_invalid');jobsByRun[run.id]=response.jobs;
 }
 return validateReviewRuns({revision:sha,main,runs,jobsByRun,production,nowMs});
}
export function sourceGit(directory,args,input){
 const env={PATH:process.env.PATH,HOME:process.platform==='win32'?process.env.USERPROFILE:'/root',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
 const r=spawnSync('git',['-c','core.hooksPath='+ (process.platform==='win32'?'NUL':'/dev/null'),'-c','core.fsmonitor=false','-c','core.autocrlf=false',...args],{cwd:directory,env,input,encoding:null,timeout:30000,maxBuffer:32*1024**2,windowsHide:true});
 need(r.status===0&&!r.error&&!r.signal,'source_changed');return r.stdout;
}
export function ownedReleasePath(file,{directory=false,privateMode=false}={}){
 need(process.platform==='linux'&&process.getuid()===0&&path.posix.normalize(file)===file&&file.startsWith('/'),'owned_resource_changed');
 for(let p=file;;p=path.dirname(p)){
  const s=fs.lstatSync(p);need(s.uid===0&&!s.isSymbolicLink()&&!(s.mode&0o022)&&fs.realpathSync(p)===p&&
   (p!==file||directory?s.isDirectory():s.isFile()&&s.nlink===1),'owned_resource_changed');if(p==='/')break;
 }
 const st=fs.lstatSync(file);need(!privateMode||(st.mode&0o777)===(directory?0o700:0o600),'owned_resource_changed');return st;
}
export function inspectPinnedExecutionSource({revision:sha,directory,repository='/www/wwwroot/merchant-space'}){
 need(revision(sha)&&directory==='/var/lib/faolla-online-code/'+sha,'source_changed');ownedReleasePath(directory,{directory:true});ownedReleasePath(repository,{directory:true});
 const git=args=>sourceGit(directory,args).toString().trim();need(git(['rev-parse','HEAD'])===sha&&git(['rev-parse','--abbrev-ref','HEAD'])==='HEAD'&&
  git(['rev-parse','--show-toplevel'])===directory&&!git(['status','--porcelain=v1','--untracked-files=all']),'source_changed');
 const rows=parseSourceTree(sourceGit(repository,['ls-tree','-r','-z',sha])),allowed=new Set(['.git']);let count=0;
 for(const row of rows){if(row.file.startsWith('public/downloads/'))continue;const file=directory+'/'+row.file;ownedReleasePath(file);
  const s=fs.lstatSync(file),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),h=createHash('sha1');h.update('blob '+s.size+'\0');
  try{const b=Buffer.alloc(256*1024);let total=0;for(;;){const n=fs.readSync(fd,b,0,b.length,null);if(!n)break;total+=n;h.update(b.subarray(0,n));}
   const t=fs.fstatSync(fd),after=fs.lstatSync(file);need(total===s.size&&['dev','ino','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>s[k]===t[k]&&s[k]===after[k])&&
    ((s.mode&0o111)!==0)===(row.mode==='100755')&&h.digest('hex')===row.oid,'source_changed');
  }finally{fs.closeSync(fd);}count++;const parts=row.file.split('/');while(parts.length){allowed.add(parts.join('/'));parts.pop();}
 }
 const walk=(dir,prefix='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+e.name;need(allowed.has(name)&&!e.isSymbolicLink(),'source_changed');if(e.isDirectory())walk(dir+'/'+e.name,name+'/');}};walk(directory);
 return {revision:sha,directory,sourceFiles:count,inventorySha256:fingerprint('tool-bundle',rows,'canonical-json-v1').value,rows};
}
export function assertReviewFresh(review,sha,nowMs=Date.now()){
 need(review?.kind==='independently-verified-release-review'&&review.revision===sha&&review.main===sha&&review.productionEligible===true,'evidence_invalid');
 assertFreshEvidence(review,{nowMs,maxAgeMs:600000});return review;
}
