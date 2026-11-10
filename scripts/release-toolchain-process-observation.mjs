// Explicit PM2 6.0.14 resurrection representation. Historical normalizers and
// their byte pins remain unchanged; no online/unknown PID is manufactured.
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {isDeepStrictEqual} from 'node:util';
import {rebootHash} from './release-toolchain-host-reboot-contract.mjs';
export function normalizeResurrectedRetirementProcess(raw){
 if(raw?.pid===undefined&&raw?.pm2_env?.status==='stopped'&&!Object.hasOwn(raw,'pid'))return normalizeRetirementProcess({...raw,pid:0});
 return normalizeRetirementProcess(raw);
}
export function assertResurrectedManagerDefinition({saved,current,before,after,home}){
 const need=(v,c)=>{if(!v)throw Error('host_reboot_manager_'+c);};
 const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c),uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
 need(typeof home==='string'&&home.startsWith('/')&&!home.endsWith('/')&&saved&&current&&before.name===after.name&&saved.status===before.status&&current.status===after.status,'shape');
 const stable=v=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='unique_id'));
 const a=saved.env??{},b=current.env??{};same(stable(a),stable(b),'environment');
 const mutable=['restart_time','axm_monitor','pm_uptime','unique_id','env','pm_id','pm_pid_path'];
 const rest=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!mutable.includes(k)));same(rest(saved),rest(current),'definition');
 need([saved.unique_id,current.unique_id,a.unique_id,b.unique_id].every(uuid),'uuid');
 const prefix=home+'/pids/'+before.name+'-',suffix='.pid';
 need(typeof saved.pm_pid_path==='string'&&saved.pm_pid_path.startsWith(prefix)&&saved.pm_pid_path.endsWith(suffix)&&/^(0|[1-9]\d*)$/.test(saved.pm_pid_path.slice(prefix.length,-suffix.length)),'pid_path');
 if(before.status==='stopped'){
  // A stopped definition is NOT executed by resurrect: its outer UUID/PID
  // path remain historical while PM2 regenerates only env.unique_id.
  need(after.status==='stopped'&&after.pid===0&&current.unique_id===saved.unique_id&&current.pm_pid_path===saved.pm_pid_path,'stopped_definition');
 }else{
  need(saved.pm_pid_path===prefix+before.pmId+suffix&&current.pm_pid_path===prefix+after.pmId+suffix&&saved.unique_id===a.unique_id&&current.unique_id===b.unique_id,'online_identity');
 }
 return{name:before.name,beforeSha256:rebootHash(a),afterSha256:rebootHash(b),beforeStableSha256:rebootHash(stable(a)),afterStableSha256:rebootHash(stable(b)),beforeUniqueId:a.unique_id,afterUniqueId:b.unique_id};
}
