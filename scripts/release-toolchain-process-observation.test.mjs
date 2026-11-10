import test from 'node:test';import assert from 'node:assert/strict';
import {assertResurrectedManagerDefinition} from './release-toolchain-process-observation.mjs';
const uuid=n=>'10000000-0000-4000-8000-00000000000'+n;
function fixture(status='stopped'){
 const saved={status,name:'owned',pm_cwd:'/owned',pm_exec_path:'/owned/app.cjs',exec_interpreter:'/usr/bin/node',pm_uptime:100,restart_time:1,created_at:90,unique_id:uuid(1),env:{KEEP:'synthetic-private',unique_id:uuid(1)},pm_pid_path:'/home/pm2/pids/owned-7.pid',axm_monitor:{}};
 const current={...structuredClone(saved),pm_id:4,pm_uptime:200,restart_time:status==='online'?0:1,env:{KEEP:'synthetic-private',unique_id:uuid(2)},...(status==='online'?{unique_id:uuid(2),pm_pid_path:'/home/pm2/pids/owned-4.pid'}:{})};
 return{saved,current,before:{name:'owned',pmId:7,status,pid:status==='online'?100:0},after:{name:'owned',pmId:4,status,pid:status==='online'?200:0},home:'/home/pm2'};
}
test('stopped resurrection retains historical PID-file path/outer UUID while nested environment UUID is independently rebound',()=>{
 const f=fixture();const proof=assertResurrectedManagerDefinition(f);assert.equal(proof.afterUniqueId,uuid(2));assert.equal(f.current.unique_id,uuid(1));
 // After a second host boot, the stopped path still has its original ID.
 f.saved=structuredClone(f.current);f.before.pmId=4;f.current.env.unique_id=uuid(3);f.current.pm_id=3;f.after.pmId=3;assertResurrectedManagerDefinition(f);
});
test('online resurrection binds both actual manager IDs and matching runtime/configured UUIDs',()=>{assertResurrectedManagerDefinition(fixture('online'));});
test('no other launch/environment change, resurrected stopped process or arbitrary outer/path replacement is accepted',()=>{
 for(const change of [f=>f.current.env.KEEP='changed',f=>f.current.exec_interpreter='/foreign',f=>f.current.created_at++,f=>f.current.pm_pid_path='/home/pm2/pids/owned-4.pid',f=>f.current.unique_id=uuid(3),f=>f.after.pid=123,f=>f.current.env.unique_id='invalid',f=>f.current.EXTRA='unknown']){const f=fixture();change(f);assert.throws(()=>assertResurrectedManagerDefinition(f));}
 for(const change of [f=>f.current.pm_pid_path='/home/pm2/pids/owned-7.pid',f=>f.current.unique_id=uuid(3)]){const f=fixture('online');change(f);assert.throws(()=>assertResurrectedManagerDefinition(f));}
});
