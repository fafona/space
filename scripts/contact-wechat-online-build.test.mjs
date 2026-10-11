import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildContactWechatOnlineCandidate,assertContactWechatBuildEnvironmentKeys} from './contact-wechat-online-build.mjs';
import {CONTACT_WECHAT_RELEASE_BASELINE} from './contact-wechat-release-policy.mjs';
import {ATTENDANCE_BUILD_LIMITS,attendanceOnlineBuildPlan} from './attendance-online-build.mjs';
const target='a'.repeat(40),input={lane:'contact-wechat-code-only',baseline:CONTACT_WECHAT_RELEASE_BASELINE,target,directory:`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`,operation:`/var/lib/faolla-online-release/${target}`};
test('code-only build reuses exactly the reviewed guarded isolated budget',()=>{
 let calls=0;
 const proof=buildContactWechatOnlineCandidate(input,value=>{calls++;assert.deepEqual(value,{directory:input.directory,target,operation:input.operation});return attendanceOnlineBuildPlan(value);},()=>({PATH:'/usr/bin:/bin',HOME:'/root',FAOLLA_BACKGROUND_JOBS_PAUSED:'1'}));
 assert.equal(calls,1);assert.deepEqual(proof.command,['npm','run','build']);
 assert.deepEqual(ATTENDANCE_BUILD_LIMITS,{memoryBytes:4*1024**3,minimumAvailableBytes:6*1024**3,minimumDiskBytes:20*1024**3,heapMiB:3072,tasks:128,seconds:1200});
 for(const property of ['MemoryMax=4294967296','CPUQuota=100%','TasksMax=128','RuntimeMaxSec=1200','PrivateNetwork=yes','ProtectSystem=strict'])assert.ok(proof.properties.includes(property));
 assert.equal(proof.environment.NODE_OPTIONS,'--max-old-space-size=3072');
});
test('wrong lane or baseline refuses before sandbox entry, with no database authority',()=>{
 for(const changed of [null,{}, {...input,lane:'attendance'}, {...input,lane:'traffic'}, {...input,baseline:'b'.repeat(40)}])assert.throws(()=>buildContactWechatOnlineCandidate(changed,()=>{throw Error('must_not_launch');}),/contact_wechat_build_scope_invalid/);
 const source=readFileSync(new URL('./contact-wechat-online-build.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/applyProduction|verifyAttendanceProductionDatabase|createProductionDatabase|spawnSync|pm2|--ignore/);
});
test('unknown actual runtime business keys cannot silently miss the reused EnvironmentFile override',()=>{
 const saved={PATH:'/usr/bin:/bin',NODE_OPTIONS:'--max-old-space-size=4096',SUPABASE_SERVICE_ROLE_KEY:'synthetic',FAOLLA_ATTENDANCE_ROLLOUT_ENABLED:'1'};
 assert.doesNotThrow(()=>assertContactWechatBuildEnvironmentKeys(saved));
 for(const key of ['STRIPE_SECRET_KEY','AWS_ACCESS_KEY_ID','AZURE_TOKEN','CUSTOM_API_KEY','SUPER_ADMIN_PASSWORD','FFMPEG_PATH']){
  assert.throws(()=>assertContactWechatBuildEnvironmentKeys({...saved,[key]:'synthetic-secret'}),error=>error.message==='contact_wechat_build_environment_unreviewed');
  assert.throws(()=>buildContactWechatOnlineCandidate(input,()=>{throw Error('must_not_build');},()=>({...saved,[key]:'synthetic-secret'})),/contact_wechat_build_environment_unreviewed/);
 }
 for(const changed of [null,[],{PATH:3}])assert.throws(()=>assertContactWechatBuildEnvironmentKeys(changed),/contact_wechat_build_environment_invalid|contact_wechat_build_environment_unreviewed/);
});
