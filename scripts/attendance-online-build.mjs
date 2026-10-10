import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const ATTENDANCE_BUILD_LIMITS=Object.freeze({memoryBytes:4*1024**3,minimumAvailableBytes:6*1024**3,minimumDiskBytes:20*1024**3,heapMiB:3072,tasks:128,seconds:1200});
const fail=code=>{throw Error(`attendance_build_${code}`);};
export function attendanceOnlineBuildPlan({directory,target,operation}){
  if(!/^[a-f0-9]{40}$/.test(target??'')||directory!==`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`||operation!==`/var/lib/faolla-online-release/${target}`)fail('identity_invalid');
  const unit=`faolla-attendance-build-${target}`;
  return {target,directory,operation,unit,properties:[
    'MemoryAccounting=yes',`MemoryMax=${ATTENDANCE_BUILD_LIMITS.memoryBytes}`,'CPUAccounting=yes','CPUQuota=100%',
    'TasksAccounting=yes',`TasksMax=${ATTENDANCE_BUILD_LIMITS.tasks}`,`RuntimeMaxSec=${ATTENDANCE_BUILD_LIMITS.seconds}`,
    'KillMode=control-group','SendSIGKILL=yes','TimeoutStopSec=15','PrivateNetwork=yes','PrivateTmp=yes','NoNewPrivileges=yes',
    'ProtectHome=yes','ProtectSystem=strict',`ReadWritePaths=${directory} ${operation}`,`WorkingDirectory=${directory}`,`EnvironmentFile=${directory}/.env.local`,`EnvironmentFile=${operation}/attendance-build.env`,
  ],environment:{HOME:`${operation}/build-home`,npm_config_cache:`${operation}/build-cache`,TMPDIR:`${operation}/build-tmp`,NODE_OPTIONS:`--max-old-space-size=${ATTENDANCE_BUILD_LIMITS.heapMiB}`,FAOLLA_BUILD_SINGLE_WORKER:'1',NEXT_TELEMETRY_DISABLED:'1'},command:['npm','run','build']};
}
export function assertAttendanceBuildAdmission({meminfo,diskBytes,swaps}){
  const available=/^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo??''),totalSwap=/^SwapTotal:\s+(\d+)\s+kB$/m.exec(meminfo??'');
  if(!available||!totalSwap||BigInt(available[1])*1024n<BigInt(ATTENDANCE_BUILD_LIMITS.minimumAvailableBytes)||BigInt(totalSwap[1])!==0n||typeof diskBytes!=='bigint'||diskBytes<BigInt(ATTENDANCE_BUILD_LIMITS.minimumDiskBytes)||String(swaps??'').trim().split(/\r?\n/).length!==1)fail('resource_admission_rejected');
}
export function assertAttendanceBuildSandbox({memoryLimit,cpuQuota,cpuPeriod,pidsMax,selfNetwork,hostNetwork,devices,swaps}){
  if(String(memoryLimit).trim()!==String(ATTENDANCE_BUILD_LIMITS.memoryBytes)||String(pidsMax).trim()!==String(ATTENDANCE_BUILD_LIMITS.tasks)||!/^\d+$/.test(String(cpuPeriod).trim())||BigInt(String(cpuPeriod).trim())<=0n||String(cpuQuota).trim()!==String(cpuPeriod).trim()||!/^net:\[\d+\]$/.test(selfNetwork??'')||!/^net:\[\d+\]$/.test(hostNetwork??'')||selfNetwork===hostNetwork||String(swaps??'').trim().split(/\r?\n/).length!==1)fail('sandbox_not_enforced');
  const interfaces=String(devices??'').split(/\r?\n/).filter(line=>line.includes(':')).map(line=>line.split(':')[0].trim());
  if(interfaces.length!==1||interfaces[0]!=='lo')fail('network_not_isolated');
}
function checkedPath(full,kind='directory',privateFile=false){
  let current=full;
  while(true){const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||fs.realpathSync(current)!==current||stat.uid!==0||(stat.mode&0o022)||(current===full&&kind==='file'?(!stat.isFile()||stat.nlink!==1||privateFile&&(stat.mode&0o077)):!stat.isDirectory()))fail('unsafe_path');const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
function admission(directory){const disk=fs.statfsSync(directory,{bigint:true});assertAttendanceBuildAdmission({meminfo:fs.readFileSync('/proc/meminfo','utf8'),diskBytes:disk.bavail*disk.bsize,swaps:fs.readFileSync('/proc/swaps','utf8')});}
export function assertAttendanceBuildEnvironment(actual,saved){
  if(!saved||typeof saved!=='object'||Array.isArray(saved)||actual.FAOLLA_BUILD_SINGLE_WORKER!=='1'||actual.NODE_OPTIONS!==`--max-old-space-size=${ATTENDANCE_BUILD_LIMITS.heapMiB}`)fail('environment_mismatch');
  // Compare values without logging them. EnvironmentFile's parsing is not
  // assumed equivalent to dotenv or to the source process's environment.
  for(const [key,value] of Object.entries(saved))if(/^(?:NEXT_PUBLIC_|FAOLLA_|MERCHANT_|SUPABASE_|GOOGLE_|SMTP_|MAIL_|RESEND_|ORDINARY_)/.test(key)&&key!=='FAOLLA_BUILD_SINGLE_WORKER'&&(typeof value!=='string'||actual[key]!==value))fail('environment_mismatch');
  if(actual.FAOLLA_BACKGROUND_JOBS_PAUSED!=='1'||actual.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED!=='0'||actual.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED!=='0')fail('environment_mismatch');
}
function systemdBuildValue(value){
  // v239 env_value_is_valid permits TAB/LF but rejects other ASCII controls.
  // Do not normalize CR: that would silently change a guarded saved value.
  if(typeof value!=='string'||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)||Buffer.from(value,'utf8').toString('utf8')!==value)return false;
  // Match systemd v239 unichar_is_valid, including Unicode noncharacters.
  for(const character of value){const code=character.codePointAt(0);if(code>=0xfdd0&&code<=0xfdef||(code&0xfffe)===0xfffe)return false;}
  return true;
}
export function attendanceBuildEnvironmentText(saved,input){
  const plan=attendanceOnlineBuildPlan(input),selected=Object.create(null);
  if(!saved||typeof saved!=='object'||Array.isArray(saved))fail('environment_invalid');
  for(const [key,value] of Object.entries(saved)){
    if(!/^(?:NEXT_PUBLIC_|FAOLLA_|MERCHANT_|SUPABASE_|GOOGLE_|SMTP_|MAIL_|RESEND_|ORDINARY_)/.test(key)||key==='FAOLLA_BUILD_SINGLE_WORKER')continue;
    if(!/^[A-Z_][A-Z0-9_]*$/.test(key)||!systemdBuildValue(value))fail('environment_invalid');
    selected[key]=value;
  }
  Object.assign(selected,plan.environment);
  assertAttendanceBuildEnvironment(selected,saved);
  // systemd v239's EnvironmentFile double quotes preserve literal newlines;
  // backslashes and quotes are escaped, with no shell or variable expansion.
  const text=Object.keys(selected).sort().map(key=>`${key}="${selected[key].replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`).join('\n')+'\n';
  if(Buffer.byteLength(text,'utf8')>4*1024**2)fail('environment_invalid');
  return text;
}
const privateFileFields=['dev','ino','size','uid','gid','mode','nlink','mtimeMs','ctimeMs'];
function samePrivateFile(a,b){return privateFileFields.every(key=>a[key]===b[key]);}
function privateBuildFileStat(stat){
  if(!stat.isFile()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o777)!==0o600||!Number.isSafeInteger(stat.size)||stat.size<=0||stat.size>4*1024**2)fail('private_file_invalid');
}
function readPrivateBuildFile(full){
  checkedPath(full,'file',true);
  const before=fs.lstatSync(full);privateBuildFileStat(before);
  const fd=fs.openSync(full,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const opened=fs.fstatSync(fd);privateBuildFileStat(opened);if(!samePrivateFile(before,opened))fail('private_file_changed');
    const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);privateBuildFileStat(after);
    checkedPath(full,'file',true);const linked=fs.lstatSync(full);privateBuildFileStat(linked);
    if(bytes.length!==before.size||!samePrivateFile(before,after)||!samePrivateFile(before,linked))fail('private_file_changed');
    return {bytes,identity:before};
  }finally{fs.closeSync(fd);}
}
function buildEnvironmentSnapshot(plan){
  const runtime=readPrivateBuildFile(`${plan.operation}/runtime.json`),text=runtime.bytes.toString('utf8');
  if(Buffer.from(text,'utf8').compare(runtime.bytes)!==0)fail('environment_invalid');
  let saved;try{saved=JSON.parse(text);}catch{fail('environment_invalid');}
  return {runtime,saved,bytes:Buffer.from(attendanceBuildEnvironmentText(saved,plan),'utf8')};
}
function verifyBuildEnvironmentFile(plan,snapshot,prior){
  const runtime=readPrivateBuildFile(`${plan.operation}/runtime.json`);
  if(!samePrivateFile(runtime.identity,snapshot.runtime.identity)||!runtime.bytes.equals(snapshot.runtime.bytes))fail('runtime_file_changed');
  const current=readPrivateBuildFile(`${plan.operation}/attendance-build.env`);
  if(!current.bytes.equals(snapshot.bytes)||prior&&!samePrivateFile(current.identity,prior.identity))fail('environment_file_changed');
  return current;
}
function syncBuildDirectory(full){
  checkedPath(full);const before=fs.lstatSync(full),fd=fs.openSync(full,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{
    const opened=fs.fstatSync(fd);
    if(!opened.isDirectory()||opened.uid!==0||(opened.mode&0o022)||opened.dev!==before.dev||opened.ino!==before.ino)fail('unsafe_path');
    fs.fsyncSync(fd);checkedPath(full);const after=fs.lstatSync(full);
    if(after.dev!==before.dev||after.ino!==before.ino||after.mode!==before.mode||after.uid!==before.uid)fail('unsafe_path');
  }finally{fs.closeSync(fd);}
}
function writeBuildEnvironmentFile(plan,snapshot){
  const full=`${plan.operation}/attendance-build.env`,fd=fs.openSync(full,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  let written;
  try{
    const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.uid!==0||opened.nlink!==1||(opened.mode&0o777)!==0o600||opened.size!==0)fail('private_file_invalid');
    fs.writeFileSync(fd,snapshot.bytes);fs.fsyncSync(fd);
    written=fs.fstatSync(fd);privateBuildFileStat(written);
    if(written.dev!==opened.dev||written.ino!==opened.ino||written.size!==snapshot.bytes.length)fail('private_file_changed');
  }finally{fs.closeSync(fd);}
  const current=verifyBuildEnvironmentFile(plan,snapshot,{identity:written});syncBuildDirectory(plan.operation);
  return verifyBuildEnvironmentFile(plan,snapshot,current);
}
function cgroupPath(controller,file){
  const lines=fs.readFileSync('/proc/self/cgroup','utf8').trim().split('\n'),matches=lines.map(line=>line.split(':')).filter(parts=>parts.length===3&&parts[1].split(',').includes(controller));
  if(matches.length!==1||!matches[0][2].startsWith('/')||matches[0][2].split('/').some(p=>p==='.'||p==='..'))fail('cgroup_identity_invalid');
  const mount=controller==='cpu'?'/sys/fs/cgroup/cpu,cpuacct':`/sys/fs/cgroup/${controller}`;
  return path.join(mount,matches[0][2],file);
}
function inner(plan){
  checkedPath(plan.directory);checkedPath(plan.operation);checkedPath(`${plan.operation}/runtime.json`,'file',true);
  checkedPath(`${plan.directory}/.env.local`,'file',true);
  if(fs.realpathSync(process.cwd())!==plan.directory||fs.realpathSync(fileURLToPath(import.meta.url))!==`${plan.directory}/scripts/attendance-online-build.mjs`)fail('inner_source_invalid');
  const sandbox={memoryLimit:fs.readFileSync(cgroupPath('memory','memory.limit_in_bytes'),'utf8'),cpuQuota:fs.readFileSync(cgroupPath('cpu','cpu.cfs_quota_us'),'utf8'),cpuPeriod:fs.readFileSync(cgroupPath('cpu','cpu.cfs_period_us'),'utf8'),pidsMax:fs.readFileSync(cgroupPath('pids','pids.max'),'utf8'),selfNetwork:fs.readlinkSync('/proc/self/ns/net'),hostNetwork:fs.readlinkSync('/proc/1/ns/net'),devices:fs.readFileSync('/proc/net/dev','utf8'),swaps:fs.readFileSync('/proc/swaps','utf8')};
  assertAttendanceBuildSandbox(sandbox);
  const snapshot=buildEnvironmentSnapshot(plan),environmentFile=verifyBuildEnvironmentFile(plan,snapshot);
  assertAttendanceBuildEnvironment(process.env,snapshot.saved);
  if(fs.existsSync(`${plan.operation}/attendance-build-proof.json`))fail('proof_already_exists');
  // This executes every existing build guard; no direct Next invocation, no
  // skipped type check, no dependency installation and no network fallback.
  const result=spawnSync('npm',['run','build'],{cwd:plan.directory,env:process.env,stdio:'inherit',timeout:ATTENDANCE_BUILD_LIMITS.seconds*1000,windowsHide:true});
  if(result.status!==0||result.error||result.signal)fail('guarded_command_failed');
  verifyBuildEnvironmentFile(plan,snapshot,environmentFile);
  checkedPath(`${plan.directory}/.next/BUILD_ID`,'file');
  const buildId=fs.readFileSync(`${plan.directory}/.next/BUILD_ID`,'utf8').trim();if(!buildId)fail('build_missing');
  fs.writeFileSync(`${plan.operation}/attendance-build-proof.json`,JSON.stringify({schemaVersion:1,target:plan.target,buildId,guardedCommand:'npm run build',memoryBytes:ATTENDANCE_BUILD_LIMITS.memoryBytes,heapMiB:ATTENDANCE_BUILD_LIMITS.heapMiB,cpuQuotaPercent:100,tasks:128,seconds:1200,privateNetworkVerified:true,swapBytes:0},null,2)+'\n',{mode:0o600,flag:'wx'});
}
export function buildAttendanceOnlineCandidate(input){
  const plan=attendanceOnlineBuildPlan(input);
  if(process.platform!=='linux'||process.getuid?.()!==0)fail('linux_root_required');
  checkedPath(plan.directory);checkedPath(plan.operation);checkedPath(`${plan.directory}/.env.local`,'file',true);
  admission(plan.directory);
  const snapshot=buildEnvironmentSnapshot(plan);
  for(const leaf of ['build-home','build-cache','build-tmp']){const full=`${plan.operation}/${leaf}`;if(fs.existsSync(full))fail('prior_build_state_present');fs.mkdirSync(full,{mode:0o700});checkedPath(full);}
  const occupied=spawnSync('systemctl',['show',`${plan.unit}.service`,'--property=LoadState','--value'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',LANG:'C'},timeout:10000});
  if(occupied.status!==0||occupied.stdout.trim()!=='not-found')fail('unit_not_vacant');
  const environmentFile=writeBuildEnvironmentFile(plan,snapshot);
  const args=['--wait','--pipe','--collect',`--unit=${plan.unit}`,...plan.properties.map(p=>`--property=${p}`),...Object.entries(plan.environment).map(([key,value])=>`--setenv=${key}=${value}`),process.execPath,`${plan.directory}/scripts/attendance-online-build.mjs`,'inner',plan.target];
  const result=spawnSync('systemd-run',args,{cwd:plan.directory,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},stdio:'inherit',timeout:(ATTENDANCE_BUILD_LIMITS.seconds+60)*1000,windowsHide:true});
  if(result.status!==0||result.error||result.signal)fail('bounded_command_failed');
  verifyBuildEnvironmentFile(plan,snapshot,environmentFile);
  checkedPath(`${plan.operation}/attendance-build-proof.json`,'file',true);
  const proof=JSON.parse(fs.readFileSync(`${plan.operation}/attendance-build-proof.json`,'utf8'));
  if(proof.target!==plan.target||proof.guardedCommand!=='npm run build'||proof.memoryBytes!==ATTENDANCE_BUILD_LIMITS.memoryBytes||proof.privateNetworkVerified!==true||proof.swapBytes!==0)fail('proof_invalid');
  return proof;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{if(process.platform!=='linux'||process.getuid?.()!==0||process.argv.length!==4||process.argv[2]!=='inner')fail('invocation_invalid');const target=process.argv[3];inner(attendanceOnlineBuildPlan({target,directory:`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`,operation:`/var/lib/faolla-online-release/${target}`}));}
  catch(error){console.error(/^attendance_build_[a-z_]+$/.test(error?.message??'')?error.message:'attendance_build_unverified');process.exitCode=1;}
}
