import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {posix as path} from 'node:path';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {ATTENDANCE_BUILD_LIMITS,attendanceOnlineBuildPlan,attendanceBuildEnvironmentText,assertAttendanceBuildAdmission,assertAttendanceBuildSandbox,assertAttendanceBuildEnvironment} from './attendance-online-build.mjs';
const target='a'.repeat(40),input={target,directory:`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`,operation:`/var/lib/faolla-online-release/${target}`};
test('fixed owned target, hard resource limits and complete guarded build only',()=>{
 assert.deepEqual(ATTENDANCE_BUILD_LIMITS,{memoryBytes:4*1024**3,minimumAvailableBytes:6*1024**3,minimumDiskBytes:20*1024**3,heapMiB:3072,tasks:128,seconds:1200});
 const p=attendanceOnlineBuildPlan(input);assert.deepEqual(p.command,['npm','run','build']);
 for(const property of ['MemoryMax=4294967296','CPUQuota=100%','TasksMax=128','RuntimeMaxSec=1200','KillMode=control-group','SendSIGKILL=yes','PrivateNetwork=yes'])assert.ok(p.properties.includes(property));
 assert.equal(p.environment.FAOLLA_BUILD_SINGLE_WORKER,'1');assert.equal(p.environment.NODE_OPTIONS,'--max-old-space-size=3072');
 assert.ok(!p.properties.some(p=>p.startsWith('MemorySwapMax=')));
 for(const changed of [{directory:'/www/wwwroot/merchant-space'},{operation:'/opt/faolla-attendance-pilot'},{target:'main'},{directory:input.directory+'/../foreign'}])assert.throws(()=>attendanceOnlineBuildPlan({...input,...changed}),/identity_invalid/);
});
test('admission requires six GiB available, twenty GiB free, and real zero swap',()=>{
 const good={meminfo:'MemAvailable: 6291456 kB\nSwapTotal: 0 kB\n',diskBytes:20n*1024n**3n,swaps:'Filename Type Size Used Priority\n'};assert.doesNotThrow(()=>assertAttendanceBuildAdmission(good));
 for(const bad of [{meminfo:'MemAvailable: 6291455 kB\nSwapTotal: 0 kB\n'},{diskBytes:good.diskBytes-1n},{meminfo:'MemAvailable: 6291456 kB\nSwapTotal: 1 kB\n'},{swaps:good.swaps+'swap file 1 0 -2\n'},{meminfo:'unknown'}])assert.throws(()=>assertAttendanceBuildAdmission({...good,...bad}),/resource_admission_rejected/);
});
test('actual cgroup limits and private network namespace must be demonstrable',()=>{
 const good={memoryLimit:'4294967296\n',cpuQuota:'100000\n',cpuPeriod:'100000\n',pidsMax:'128\n',selfNetwork:'net:[2]',hostNetwork:'net:[1]',devices:'Inter-| Receive\n lo: 0 0\n',swaps:'Filename Type Size Used Priority\n'};assert.doesNotThrow(()=>assertAttendanceBuildSandbox(good));
 for(const bad of [{memoryLimit:'max'},{memoryLimit:'3221225472'},{memoryLimit:'4294967297'},{cpuQuota:'-1'},{cpuPeriod:'0'},{pidsMax:'max'},{selfNetwork:'net:[1]'},{devices:good.devices+'eth0: 0 0\n'}])assert.throws(()=>assertAttendanceBuildSandbox({...good,...bad}),/sandbox_not_enforced|network_not_isolated/);
});
test('EnvironmentFile values are compared without exposing credentials',()=>{
 const saved={NEXT_PUBLIC_SUPABASE_URL:'https://isolated.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic-not-real',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0'};
 const actual={...saved,FAOLLA_BUILD_SINGLE_WORKER:'1',NODE_OPTIONS:'--max-old-space-size=3072'};assert.doesNotThrow(()=>assertAttendanceBuildEnvironment(actual,saved));
 for(const options of ['--max-old-space-size=1792','--max-old-space-size=4096','--max-old-space-size=3072 --require unexpected'])assert.throws(()=>assertAttendanceBuildEnvironment({...actual,NODE_OPTIONS:options},saved),/environment_mismatch/);
 for(const key of Object.keys(saved))assert.throws(()=>assertAttendanceBuildEnvironment({...actual,[key]:'changed'},saved),e=>e.message==='attendance_build_environment_mismatch'&&!e.message.includes('synthetic'));
});
test('controller never copies dependencies, starts an application or bypasses native build guards',()=>{
 const source=readFileSync(new URL('./attendance-online-build.mjs',import.meta.url),'utf8');assert.ok(source.includes("spawnSync('npm',['run','build']"));assert.ok(source.includes("fs.readFileSync('/proc/net/dev'"));assert.ok(!source.includes('/sys/class/net'));assert.ok(!source.includes("spawnSync('next'"));assert.ok(!source.includes('ignore-scripts'));assert.ok(!source.includes("['ci'"));assert.ok(!source.includes("spawnSync('pm2'"));assert.equal(ATTENDANCE_BUILD_LIMITS.seconds,1200);
});

const buildSource=readFileSync(new URL('./attendance-online-build.mjs',import.meta.url),'utf8');
const savedRuntime=()=>({NEXT_PUBLIC_SUPABASE_URL:'https://isolated.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic-not-real',FAOLLA_MAINTENANCE_LAUNCH_NONCE:'synthetic-live-only',FAOLLA_ORIGIN_FIX_LOCKED:'1',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0'});

// A limited model of v239's quoted EnvironmentFile grammar, not a Linux probe.
// It deliberately does not evaluate variables, commands or shell syntax.
function quotedEnvironment(text){
 const result=Object.create(null);let offset=0;
 while(offset<text.length){
  const key=/^([A-Za-z_][A-Za-z0-9_]*)="/.exec(text.slice(offset));assert.ok(key);offset+=key[0].length;let value='',closed=false;
  while(offset<text.length){const c=text[offset++];if(c==='"'){closed=true;break;}if(c==='\\'){const next=text[offset++];assert.notEqual(next,undefined);if(next!=='\n')value+=next;}else value+=c;}
  assert.ok(closed);assert.equal(text[offset++],'\n');result[key[1]]=value;
 }
 return result;
}

function memoryBuildFixture(){
 const files=new Map(),fds=new Map(),events=[];let inode=1,descriptor=10;
 const make=(full,bytes=null,extra={})=>{files.set(full,{bytes:bytes===null?null:Buffer.from(bytes),uid:0,gid:0,nlink:bytes===null?2:1,mode:bytes===null?0o40700:0o100600,dev:1,ino:inode++,mtimeMs:1,ctimeMs:1,...extra});return files.get(full);};
 const directories=full=>{let current=full;while(!files.has(current)){make(current);const parent=path.dirname(current);if(parent===current)break;current=parent;}};
 const put=(full,bytes,extra)=>{directories(path.dirname(full));return make(full,bytes,extra);};
 const entry=full=>{if(!files.has(full))throw Object.assign(Error('fixture_missing'),{code:'ENOENT'});return files.get(full);};
 const stat=e=>({...e,size:e.bytes?.length??0,isFile:()=>e.bytes!==null,isDirectory:()=>e.bytes===null,isSymbolicLink:()=>e.symlink===true});
 const constants={O_RDONLY:0,O_WRONLY:1,O_CREAT:64,O_EXCL:128,O_NOFOLLOW:131072,O_DIRECTORY:65536};
 const fs={constants,lstatSync:full=>stat(entry(full)),realpathSync:full=>full,existsSync:full=>files.has(full),
  openSync(full,flags,mode){events.push(['open',full,flags,mode]);if(flags&constants.O_CREAT){if(files.has(full)&&flags&constants.O_EXCL)throw Object.assign(Error('fixture_exists'),{code:'EEXIST'});if(!files.has(full))put(full,Buffer.alloc(0),{mode:0o100000|mode});}const e=entry(full);if(e.symlink&&flags&constants.O_NOFOLLOW)throw Error('fixture_symlink');const fd=descriptor++;fds.set(fd,{full,e});return fd;},
  fstatSync:fd=>stat(fds.get(fd).e),
  readFileSync(full,encoding){const e=typeof full==='number'?fds.get(full).e:entry(full);const bytes=Buffer.from(e.bytes);return encoding?bytes.toString(encoding):bytes;},
  writeFileSync(full,bytes,options){if(typeof full!=='number'){if(options?.flag==='wx'&&files.has(full))throw Error('fixture_exists');put(full,bytes,{mode:0o100000|(options?.mode??0o600)});return;}const {e}=fds.get(full);events.push(['write',fds.get(full).full]);e.bytes=Buffer.from(bytes);e.mtimeMs++;e.ctimeMs++;},
  fsyncSync(fd){events.push(['fsync',fds.get(fd).full]);},closeSync(fd){events.push(['close',fds.get(fd).full]);fds.delete(fd);},
  mkdirSync:full=>{if(files.has(full))throw Error('fixture_exists');directories(full);},statfsSync:()=>({bavail:20n*1024n**3n,bsize:1n}),
  readlinkSync:full=>full==='/proc/self/ns/net'?'net:[2]':'net:[1]',
 };
 const saved=savedRuntime();directories(input.directory);directories(input.operation);
 put(`${input.operation}/runtime.json`,JSON.stringify(saved));put(`${input.directory}/.env.local`,'FAOLLA_BACKGROUND_JOBS_PAUSED=1\n');
 put('/proc/meminfo','MemAvailable: 6291456 kB\nSwapTotal: 0 kB\n');put('/proc/swaps','Filename Type Size Used Priority\n');put('/proc/net/dev','Inter-| Receive\n lo: 0 0\n');put('/proc/self/cgroup','1:memory:/fixture\n2:cpu,cpuacct:/fixture\n3:pids:/fixture\n');
 for(const [controller,file,value] of [['memory','memory.limit_in_bytes','4294967296'],['cpu,cpuacct','cpu.cfs_quota_us','100000'],['cpu,cpuacct','cpu.cfs_period_us','100000'],['pids','pids.max','128']])put(`/sys/fs/cgroup/${controller}/fixture/${file}`,value);
 const fixture={fs,files,fds,events,put,saved,spawn:()=>({status:0,stdout:'not-found\n'})};
 const actual={...saved,...attendanceOnlineBuildPlan(input).environment};
 const context={fs,path,Buffer,fileURLToPath:value=>fileURLToPath(value,{windows:false}),process:{platform:'linux',getuid:()=>0,cwd:()=>input.directory,execPath:'/usr/bin/node',env:actual},spawnSync:(...args)=>fixture.spawn(...args)};
 const source=buildSource.slice(0,buildSource.indexOf('if(process.argv[1]')).replace(/^import .+;\r?\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url',JSON.stringify(`file://${input.directory}/scripts/attendance-online-build.mjs`));
 runInNewContext(source+'\nglobalThis.helpers={buildEnvironmentSnapshot,readPrivateBuildFile,writeBuildEnvironmentFile,verifyBuildEnvironmentFile,inner,buildAttendanceOnlineCandidate};',context,{timeout:1000});
 fixture.helpers=context.helpers;fixture.plan=attendanceOnlineBuildPlan(input);return fixture;
}

test('only guarded saved values transfer and protected build environment is final',()=>{
 const saved={...savedRuntime(),PATH:'/poison/bin',LD_PRELOAD:'/poison/library',NODE_OPTIONS:'--require poison --max-old-space-size=4096',FAOLLA_BUILD_SINGLE_WORKER:'0',UNRELATED_SECRET:'not-transferred'};
 const text=attendanceBuildEnvironmentText(saved,input),actual=quotedEnvironment(text),plan=attendanceOnlineBuildPlan(input);
 assertAttendanceBuildEnvironment(actual,saved);
 for(const [key,value] of Object.entries(plan.environment))assert.equal(actual[key],value);
 for(const key of ['PATH','LD_PRELOAD','UNRELATED_SECRET'])assert.equal(Object.hasOwn(actual,key),false);
 assert.equal(actual.FAOLLA_MAINTENANCE_LAUNCH_NONCE,saved.FAOLLA_MAINTENANCE_LAUNCH_NONCE);assert.equal(actual.FAOLLA_ORIGIN_FIX_LOCKED,'1');
 assert.deepEqual(plan.properties.filter(p=>p.startsWith('EnvironmentFile=')),[`EnvironmentFile=${input.directory}/.env.local`,`EnvironmentFile=${input.operation}/attendance-build.env`]);
 assert.equal(attendanceBuildEnvironmentText(Object.fromEntries(Object.entries(saved).reverse()),input),text);
});

test('quoted values preserve LF, TAB, Unicode, backslashes, quotes and literal variable syntax',()=>{
 const values=['',' Chinese中文 español 🚀 ','quote"single\'backslash\\tail\\','line1\nline2\nline3\tend','\\\n\\\n"\nFAOLLA_INJECTED="1','$HOME ${SUPABASE_SECRET} $(command) `command` %n # ; ='];
 for(const value of values){const saved={...savedRuntime(),MAIL_PASSWORD:value},parsed=quotedEnvironment(attendanceBuildEnvironmentText(saved,input));assert.equal(parsed.MAIL_PASSWORD,value);assert.equal(Object.hasOwn(parsed,'FAOLLA_INJECTED'),false);assertAttendanceBuildEnvironment(parsed,saved);}
});

test('invalid selected values and names fail generically before any file is written',()=>{
 for(const value of [undefined,null,1,true,[],{},'synthetic-secret\0suffix','\ud800','\udfff','\ufdd0','\ufdef','\ufffe','\uffff','\u{1fffe}','\u{10ffff}'])assert.throws(()=>attendanceBuildEnvironmentText({...savedRuntime(),SMTP_PASSWORD:value},input),e=>e.message==='attendance_build_environment_invalid');
 for(const key of ['MAIL_BAD\nFAOLLA_INJECTED','SMTP_BAD=KEY','NEXT_PUBLIC_bad','FAOLLA_BAD-KEY'])assert.throws(()=>attendanceBuildEnvironmentText({...savedRuntime(),[key]:'synthetic-secret'},input),/environment_invalid/);
 for(const code of [0xfdcf,0xfdf0,0xfffd,0x1fffd,0x10fffd])assert.doesNotThrow(()=>attendanceBuildEnvironmentText({...savedRuntime(),MAIL_VALUE:String.fromCodePoint(code)},input));
 for(const saved of [null,[],{...savedRuntime(),FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},{...savedRuntime(),MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'1'}])assert.throws(()=>attendanceBuildEnvironmentText(saved,input),/environment_invalid|environment_mismatch/);
 assert.throws(()=>attendanceBuildEnvironmentText({...savedRuntime(),MAIL_VALUE:'\\'.repeat(2*1024**2)},input),/environment_invalid/);
});

test('actual v239 rejected ASCII controls fail before launch without normalization',()=>{
 for(let code=0;code<=0x7f;code++){
  if(code>=0x20&&code!==0x7f||code===9||code===10)continue;
  const value=`synthetic-before${String.fromCharCode(code)}synthetic-after`;
  assert.throws(()=>attendanceBuildEnvironmentText({...savedRuntime(),FAOLLA_ORIGIN_FIX_LOCKED:value},input),e=>e.message==='attendance_build_environment_invalid');
  const f=memoryBuildFixture();f.put(`${input.operation}/runtime.json`,JSON.stringify({...f.saved,FAOLLA_ORIGIN_FIX_LOCKED:value}));let calls=0;f.spawn=()=>{calls++;throw Error('must_not_launch');};
  assert.throws(()=>f.helpers.buildAttendanceOnlineCandidate(input),/environment_invalid/);assert.equal(calls,0);assert.equal(f.fds.size,0);
  for(const leaf of ['build-home','build-cache','build-tmp','attendance-build.env','attendance-build-proof.json'])assert.equal(f.files.has(`${input.operation}/${leaf}`),false);
 }
});

test('private environment writes are exclusive, root-owned, no-follow, durable and read back',()=>{
 const f=memoryBuildFixture(),snapshot=f.helpers.buildEnvironmentSnapshot(f.plan),result=f.helpers.writeBuildEnvironmentFile(f.plan,snapshot),full=`${input.operation}/attendance-build.env`;
 assert.equal(result.bytes.toString(),attendanceBuildEnvironmentText(f.saved,input));assert.equal(f.files.get(full).mode&0o777,0o600);assert.equal(f.fds.size,0);
 const open=f.events.find(e=>e[0]==='open'&&e[1]===full);assert.equal(open[2],1|64|128|131072);assert.equal(open[3],0o600);
 assert.ok(f.events.filter(e=>e[0]==='open').every(e=>e[2]&f.fs.constants.O_NOFOLLOW));
 assert.deepEqual(f.events.filter(e=>e[0]==='fsync').map(e=>e[1]),[full,input.operation]);
 assert.throws(()=>f.helpers.writeBuildEnvironmentFile(f.plan,snapshot),/fixture_exists/);assert.equal(f.files.get(full).bytes.toString(),result.bytes.toString());
});

test('runtime private-file ownership, mode, links, UTF-8 and identity fail closed',()=>{
 const runtime=`${input.operation}/runtime.json`;
 for(const change of [{uid:1},{mode:0o100640},{mode:0o100400},{nlink:2},{symlink:true}]){const f=memoryBuildFixture();Object.assign(f.files.get(runtime),change);assert.throws(()=>f.helpers.buildEnvironmentSnapshot(f.plan),/unsafe_path|private_file_invalid/);assert.equal(f.fds.size,0);}
 for(const bytes of [Buffer.from([0xff]),Buffer.from('{invalid'),Buffer.from(JSON.stringify({...savedRuntime(),SMTP_PASSWORD:1}))]){const f=memoryBuildFixture();f.put(runtime,bytes);assert.throws(()=>f.helpers.buildEnvironmentSnapshot(f.plan),/environment_invalid/);assert.equal(f.fds.size,0);}
 const f=memoryBuildFixture(),original=f.fs.openSync;f.fs.openSync=(full,...args)=>{const fd=original(full,...args);if(full===runtime)f.put(full,f.files.get(full).bytes);return fd;};assert.throws(()=>f.helpers.buildEnvironmentSnapshot(f.plan),/private_file_changed/);assert.equal(f.fds.size,0);
});

test('partial writes, fsync failure and swapped readback retain evidence and close descriptors',()=>{
 const full=`${input.operation}/attendance-build.env`;
 for(const failure of ['write','file-sync','directory-sync','replacement','content']){
  const f=memoryBuildFixture(),snapshot=f.helpers.buildEnvironmentSnapshot(f.plan);
  if(failure==='write'){const original=f.fs.writeFileSync;f.fs.writeFileSync=(...args)=>{original(...args);throw Error('fixture_write_failed');};}
  if(failure.endsWith('sync')){const original=f.fs.fsyncSync;f.fs.fsyncSync=fd=>{original(fd);const name=f.fds.get(fd).full;if(name===(failure==='file-sync'?full:input.operation))throw Error('fixture_sync_failed');};}
  if(failure==='replacement'||failure==='content'){const original=f.fs.closeSync;f.fs.closeSync=fd=>{const name=f.fds.get(fd).full;original(fd);if(name===full&&!f.events.some(e=>e[0]==='replaced')){f.events.push(['replaced']);f.put(full,failure==='content'?'changed':snapshot.bytes);}};}
  assert.throws(()=>f.helpers.writeBuildEnvironmentFile(f.plan,snapshot),/fixture_write_failed|fixture_sync_failed|environment_file_changed/);assert.equal(f.fds.size,0);assert.ok(f.files.has(full));
  assert.equal(f.events.some(e=>e[0]==='unlink'||e[0]==='chmod'),false);
 }
});

test('post-build verification detects byte, inode, metadata and runtime changes',()=>{
 const runtime=`${input.operation}/runtime.json`,full=`${input.operation}/attendance-build.env`;
 for(const changed of ['bytes','inode','metadata','runtime-bytes','runtime-inode']){
  const f=memoryBuildFixture(),snapshot=f.helpers.buildEnvironmentSnapshot(f.plan),prior=f.helpers.writeBuildEnvironmentFile(f.plan,snapshot);
  if(changed==='bytes')f.files.get(full).bytes[0]^=1;
  if(changed==='inode')f.put(full,snapshot.bytes);
  if(changed==='metadata')f.files.get(full).ctimeMs++;
  if(changed==='runtime-bytes')f.files.get(runtime).bytes[1]^=1;
  if(changed==='runtime-inode')f.put(runtime,snapshot.runtime.bytes);
  assert.throws(()=>f.helpers.verifyBuildEnvironmentFile(f.plan,snapshot,prior),/environment_file_changed|runtime_file_changed/);assert.equal(f.fds.size,0);
 }
});

test('actual inner build refuses altered environment before npm and after npm before proof',()=>{
 const full=`${input.operation}/attendance-build.env`,proof=`${input.operation}/attendance-build-proof.json`;
 for(const phase of ['clean','before','after']){
  const f=memoryBuildFixture(),snapshot=f.helpers.buildEnvironmentSnapshot(f.plan);f.helpers.writeBuildEnvironmentFile(f.plan,snapshot);let calls=0;
  f.spawn=(command,args)=>{calls++;assert.equal(command,'npm');assert.deepEqual([...args],['run','build']);f.put(`${input.directory}/.next/BUILD_ID`,'synthetic-build');if(phase==='after')f.files.get(full).bytes[0]^=1;return {status:0};};
  if(phase==='before')f.files.get(full).bytes[0]^=1;
  if(phase==='clean'){assert.doesNotThrow(()=>f.helpers.inner(f.plan));assert.equal(calls,1);assert.equal(JSON.parse(f.files.get(proof).bytes).memoryBytes,4*1024**3);}
  else{assert.throws(()=>f.helpers.inner(f.plan),/environment_file_changed/);assert.equal(calls,phase==='before'?0:1);assert.equal(f.files.has(proof),false);}
  assert.equal(f.fds.size,0);
 }
});

test('actual outer launch passes only fixed paths and protected non-secret setenv arguments',()=>{
 const f=memoryBuildFixture(),secret=f.saved.SUPABASE_SERVICE_ROLE_KEY,nonce=f.saved.FAOLLA_MAINTENANCE_LAUNCH_NONCE;let launches=0;
 f.spawn=(command,args)=>{if(command==='systemctl')return {status:0,stdout:'not-found\n'};assert.equal(command,'systemd-run');launches++;
  assert.deepEqual([...args].filter(a=>a.startsWith('--property=EnvironmentFile=')),[`--property=EnvironmentFile=${input.directory}/.env.local`,`--property=EnvironmentFile=${input.operation}/attendance-build.env`]);
  assert.equal(args.some(a=>a.includes(secret)||a.includes(nonce)),false);
  assert.deepEqual([...args].filter(a=>a.startsWith('--setenv=')),Object.entries(f.plan.environment).map(([key,value])=>`--setenv=${key}=${value}`));
  f.put(`${input.operation}/attendance-build-proof.json`,JSON.stringify({target,guardedCommand:'npm run build',memoryBytes:4*1024**3,privateNetworkVerified:true,swapBytes:0}));return {status:0};};
 assert.doesNotThrow(()=>f.helpers.buildAttendanceOnlineCandidate(input));assert.equal(launches,1);assert.equal(f.fds.size,0);
});

test('original environment guard remains byte-for-byte unchanged',()=>{
 const start=buildSource.indexOf('export function assertAttendanceBuildEnvironment('),end=buildSource.indexOf('\nfunction systemdBuildValue(',start),guard=buildSource.slice(start,end).replaceAll('\r\n','\n');
 assert.equal(createHash('sha256').update(guard).digest('hex'),'348d6509d8b89cae4de5aafd4ad0d710e3d7cfdd2407534414092ab74cbc5f67');
});
