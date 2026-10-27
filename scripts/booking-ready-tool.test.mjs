import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {bookingReadyImportClosure,bookingReadyBootstrapFiles,assertBookingReadyBootstrapRepairDelta,prepareBookingReadyTool,assertBookingReadySource} from './booking-ready-tool.mjs';
import {BOOKING_READY_BOOTSTRAP_FAILURE as FAILED} from './booking-ready-evidence.mjs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8'),source=read('scripts/booking-ready-tool.mjs');
function node(name){const ast=ts.createSourceFile('x.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);return ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast).replace(/^export /,'');}
test('bootstrap traverses the actual cyclic AST import closure, not a guessed subset',()=>{
 const seen=new Set();function visit(f){if(seen.has(f))return;seen.add(f);const ast=ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  for(const n of ast.statements)if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&!n.moduleSpecifier.text.startsWith('node:')){assert.ok(n.moduleSpecifier.text.startsWith('./'));visit('scripts/'+n.moduleSpecifier.text.slice(2));}}
 visit('scripts/booking-ready-tool.mjs');assert.deepEqual(bookingReadyImportClosure(read),[...seen].sort());assert.throws(()=>bookingReadyImportClosure(()=>"import '../escape.mjs';"));
});
test('raw current/predecessor source, historical checkouts, failed evidence and compiled app/deps are revalidated without mutations',()=>{
 for(const token of ['changes(BASE,revision)','bookingReadyInputs(rows(BASE))','bookingReadyInputs(rows(revision))','changes(PRIOR,BASE)','bookingDependencyInputs(rows(BASE))',
 'verifyHistoricalOnlineTool','assertBookingDependencyReceipt(prior,BASE)','assertBookingFormalPreserved()','assertBookingCiKernelEvidence()',
 'observeBookingReadyApplication()','collectBookingReadyOriginalCohort()','private_web_identity','bootstrap_sparse','bootstrap_entry','O_NOFOLLOW','O_EXCL','fs.fsyncSync','existing_attempt',
 'changes(ORIGINAL,FORMAL)','formalInputs(ORIGINAL)','formalInputs(FORMAL)','changes(FORMAL,PRIOR)','bookingCiInputs(rows(PRIOR))','assertBookingCiReceipt(ci,PRIOR)','prior_ci_source'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/spawnSync|process\.kill|bookingHostSql|unlinkSync|rmSync|projectBooking|\['start'|\['restart'|\['stop'/);
 assert.throws(()=>prepareBookingReadyTool('f'.repeat(40),'wrong'),/approval/);
 if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>assertBookingReadySource('f'.repeat(40)),/invocation/);
});
test('actual preparer stays synchronous under preparation locks, preserves old evidence, and seals only after all rechecks',()=>{
 for(const failure of [null,'source','pending','original','checkout','prepared','exists','drift']){
  const calls=[];let observations=0;const gate=k=>{calls.push(k);if(k===failure)throw Error(k);},need=(v,c)=>{if(!v)throw Error(c);};
  const fn=runInNewContext(node('prepareBookingReadyTool')+'\nprepareBookingReadyTool',{need,Date,JSON,ROOT:'/bootstrap',BASE:'base',OP:'/op',C:'candidate',APP:'/app',RECEIPT:'receipt',
   same:(a,b,c)=>need(isDeepStrictEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b))),c),
   source:(_r,_d,o)=>{gate(o?.bootstrap?'source':'prepared');return {sourceInputsSha256:'inputs',toolClosureSha256:'closure'};},
   original:()=>{gate('original');return {preserved:'pins',seen:failure==='drift'?++observations:1};},assertBookingReadyToolNoPending:()=>gate('pending'),
   assertBookingReadyReceipt:()=>gate('receipt'),process:{umask:()=>0o022},
   fs:{lstatSync:()=>{if(failure==='exists')return {};throw Object.assign(Error('missing'),{code:'ENOENT'});}},
   withOnlineToolPreparationLocks:(locks,work)=>{assert.equal(locks.deployLock,'/app.deploy.lock');calls.push('locks');const v=work();assert.equal(v?.then,undefined);return v;},
   createOnlineReleaseToolPlan:r=>({revision:r}),executeOnlineReleaseToolPlan:()=>{gate('checkout');return {directory:'/tool'};},seal:n=>calls.push('seal:'+n)});
  if(failure){assert.throws(()=>fn('new','approved-booking-bootstrap-manifest-continuation'));assert.ok(!calls.includes('seal:receipt'));}
  else{const result=fn('new','approved-booking-bootstrap-manifest-continuation');for(const k of ['applicationRebuilt','webProcessesChanged','productionDatabaseChanged','trafficChanged','mailEnabled'])assert.equal(result[k],false);assert.deepEqual(calls.filter(k=>k.startsWith('seal:')),['seal:receipt']);}
 }
});

test('bootstrap resource list contains the one immutable manifest and repair rejects any other source delta',()=>{
 const files=['scripts/booking-ready-evidence.mjs','scripts/booking-ready-tool.mjs','scripts/booking-ready-tool.test.mjs'];
 assert.deepEqual(bookingReadyBootstrapFiles(read),[...bookingReadyImportClosure(read),FAILED.resource].sort());
 const resource=readFileSync(new URL('../'+FAILED.resource,import.meta.url)),input={files,originalInputs:'unchanged',currentInputs:'unchanged',resource};
 assert.doesNotThrow(()=>assertBookingReadyBootstrapRepairDelta(input));
 for(const changed of [{files:[...files,'src/app/login/page.tsx']},{files:files.slice(1)},{files:[...files,files[0]]},
  {currentInputs:'changed'},{resource:Buffer.from(resource.toString()+'\n')}])assert.throws(()=>assertBookingReadyBootstrapRepairDelta({...input,...changed}));
 assert.throws(()=>prepareBookingReadyTool('f'.repeat(40),'approved-booking-native-ready-continuation'),/approval/);
});

test('real standard sparse worktree reproduces the missing JSON failure and imports successfully with the fixed exact list',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'faolla-booking-bootstrap-resource-')),repo=path.join(directory,'repo');mkdirSync(repo);
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_OPTIONAL_LOCKS:'0'};
 function git(cwd,args,input){const r=spawnSync('git',args,{cwd,env,input,encoding:'utf8',timeout:30000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout;}
 try{
  const files=bookingReadyBootstrapFiles(read);for(const file of files){const target=path.join(repo,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,readFileSync(new URL('../'+file,import.meta.url)));}
  git(repo,['init','--initial-branch=fixture']);git(repo,['config','core.autocrlf','false']);git(repo,['add','--all']);
  git(repo,['-c','user.name=Bootstrap Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath='+path.join(directory,'no-hooks'),'commit','--no-gpg-sign','-m','fixed source fixture']);
  for(const [name,selected,expected]of [['missing',bookingReadyImportClosure(read),false],['complete',files,true]]){
   const checkout=path.join(directory,name);git(repo,['worktree','add','--detach','--no-checkout',checkout,'HEAD']);
   git(checkout,['-c','index.sparse=false','sparse-checkout','set','--no-cone','--stdin'],selected.map(f=>'/'+f).join('\n')+'\n');
   git(checkout,['config','--worktree','core.sparseCheckoutCone','false']);git(checkout,['config','--worktree','index.sparse','false']);git(checkout,['read-tree','-mu','HEAD']);
   assert.equal(git(checkout,['status','--porcelain=v1','--untracked-files=all']).trim(),'');
   const url=pathToFileURL(path.join(checkout,'scripts/booking-ready-tool.mjs')).href;
   const r=spawnSync(process.execPath,['--input-type=module','-e','import('+JSON.stringify(url)+').then(()=>console.log("bootstrap-import-ok"))'],{env,encoding:'utf8',timeout:15000});
   assert.equal(r.error,undefined);if(expected){assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/bootstrap-import-ok/);}
   else{assert.notEqual(r.status,0);assert.match(r.stderr,/ENOENT/);assert.ok(r.stderr.includes('booking-publication-scope-20261026.json'));}
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('failed-bootstrap continuation is read-only and refuses metadata, source, layout or missing-resource drift',()=>{
 const root='/var/lib/faolla-online-bootstrap/'+FAILED.revision;
 const fixture={revision:FAILED.revision,resource:FAILED.resource,preserved:{[root+'/.git']:{bytes:3,sha256:createHash('sha256').update('git').digest('hex')}}};
 for(const failure of [null,'head','registration','metadata','mode','sparse','config','blob','entry','resource']){
  const need=(v,c)=>{if(!v)throw Error(c);},hash=v=>createHash('sha256').update(v).digest('hex'),oldFiles=Array.from({length:60},(_,i)=>'scripts/f'+i+'.mjs');
  const git=(_dir,args)=>{
   if(args[0]==='worktree')return failure==='registration'?'':'worktree '+root+'\nHEAD '+FAILED.revision+'\ndetached';
   if(args[0]==='status')return '';
   if(args[0]==='config')return failure==='config'?'wrong':args.at(-1)==='core.sparseCheckout'?'true':'false';
   if(args.includes('--abbrev-ref'))return 'HEAD';
   if(args.at(-1)==='HEAD')return failure==='head'?'wrong':FAILED.revision;
   if(args.includes('--show-toplevel'))return root;
   if(args.includes('--git-path'))return 'info/sparse-checkout';
   throw Error('unexpected git command');
  };
  const read=file=>Buffer.from(file.endsWith('/.git')?(failure==='metadata'?'bad':'git'):file.endsWith('sparse-checkout')?(failure==='sparse'?'wrong':oldFiles.map(f=>'/'+f).join('\n')+'\n'):(failure==='blob'?'bad':'source'));
  const fs={lstatSync:file=>{
   if(file===root)return {mode:failure==='mode'?0o755:0o700};
   if(file===root+'/'+FAILED.resource){if(failure==='resource')return {};throw Object.assign(Error('missing'),{code:'ENOENT'});}
   throw Error('unexpected lstat');
  },readdirSync:(dir)=>dir===root?[{name:failure==='entry'?'extra':'.git',isSymbolicLink:()=>false,isDirectory:()=>false}]:[]};
  const fn=runInNewContext(node('assertBookingReadyFailedBootstrap')+'\nassertBookingReadyFailedBootstrap',{
   FAILED:fixture,APP:'/app',git,read,fs,path,hash,need,JSON,Set,Object,Buffer,
   same:(a,b,c)=>need(isDeepStrictEqual(a,b),c),assertOnlineToolOwnedPath:()=>{},bookingReadyImportClosure:()=>oldFiles,runOnlineToolGit:()=>Buffer.from('source')});
  if(failure)assert.throws(fn,undefined,failure);else assert.equal(fn(),hash(JSON.stringify(fixture)));
 }
 assert.doesNotMatch(node('assertBookingReadyFailedBootstrap'),/writeFile|unlink|rename|rmSync|executeOnlineReleaseToolPlan/);
 for(const token of ['changes(FAILED.revision,revision)','assertBookingReadyBootstrapRepairDelta','assertBookingReadyFailedBootstrap()','bookingReadyBootstrapFiles'])assert.ok(source.includes(token));
});
