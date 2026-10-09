import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ATTENDANCE_BUILD_LIMITS,attendanceOnlineBuildPlan,assertAttendanceBuildAdmission,assertAttendanceBuildSandbox,assertAttendanceBuildEnvironment} from './attendance-online-build.mjs';
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
