//226 optional, inert security samples in the caller-owned synthetic namespace.
//No cluster/database/migration starts; no public production credentials or data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
const require=createRequire(import.meta.url),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const sid=n=>id(226800000+n),utc6=ms=>new Date(ms).toISOString().replace(/\.([0-9]{3})Z$/,'.$1000Z');
export const attendanceRecoverySecuritySite='99990226';
// Full-row JSON includes timestamptz/bytea/interval values: source and restored
// connections must never inherit different cluster serialization defaults.
const serializationSql="set local time zone 'UTC';set local datestyle='ISO,YMD';set local extra_float_digits=3;set local bytea_output='hex';set local intervalstyle='postgres';";

export function attendanceRecoverySecurityFactsSql(names){
 return `begin;reset role;${serializationSql}select ${outageNativeFingerprintSql(names)};rollback;`;
}

export function createAttendanceRecoverySecurityPlan({owner,now}){
 assert.match(owner,uuid);assert(typeof now==='string'&&/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(now)&&Number.isFinite(Date.parse(now)));
 const site=attendanceRecoverySecuritySite,location=sid(1),role=sid(2),delegateRole=sid(3);
 const target={employee:sid(10),auth:sid(11),worker:sid(12),workerNo:'SYNTHETIC226-PIN',name:'Synthetic226 credential subject'};
 const paused={employee:sid(20),auth:sid(21),worker:sid(22),workerNo:'SYNTHETIC226-PAUSE',name:'Synthetic226 paused subject'};
 const delegate={employee:sid(30),auth:sid(31)},validFrom=utc6(Date.parse(now)-60000),validUntil=utc6(Date.parse(now)+86400000);
 const common={delegateEmployeeId:delegate.employee,delegateAuthUserId:delegate.auth,workerId:target.worker,employeeId:target.employee,employeeAuthUserId:target.auth,validFrom,validUntil,reason:'Synthetic226 explicit grant before revocation'};
 const grants={missing:{action:'grant',operationId:sid(101),...common,locationId:location},
  application:{action:'grant',operationId:sid(111),...common,category:'leave',kinds:[],includePending:false},
  schedule:{action:'grant',operationId:sid(121),...common,locationId:location,actions:['publish','cancel'],includeExistingFuture:false}};
 const revokes=Object.fromEntries(Object.entries(grants).map(([kind,c],i)=>[kind,{action:'revoke',operationId:sid(102+i*10),grantId:c.operationId,expectedRevision:1,reason:'Synthetic226 revoke before recovery copy'}]));
 const terminals=[{id:sid(40),pairHash:hash('synthetic226-active-pair'),deviceHash:hash('synthetic226-active-device'),label:'Synthetic226 active PIN probe'},
  {id:sid(41),pairHash:hash('synthetic226-revoked-pair'),deviceHash:hash('synthetic226-revoked-device'),label:'Synthetic226 revoked terminal'}];
 return {site,owner,location,role,delegateRole,target,paused,delegate,grants,revokes,terminals,
  pinOperations:[sid(51),sid(52)],statusOperations:[sid(61),sid(62)],lease:sid(71),day:now.slice(0,10)};
}

// Protect every preexisting row, even in tables receiving this fixture's rows.
// New writes are excluded ONLY by our fresh site's explicit tenant column.
export function attendanceRecoverySecurityProtectedSql(names){
 outageNativeFingerprintSql(names); // shares the strict identifier inventory guard
 return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>
  `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r where ${name==='merchants'?"to_jsonb(r)->>'id'":"to_jsonb(r)->>'merchant_id'"} is distinct from ${quote(attendanceRecoverySecuritySite)}) rows`).join(' union all ')+') protected_rows)';
}

export function attendanceRecoverySecurityProbeSql({schema,names,expression}){
 assert.match(schema,/^attendance_race_[a-f0-9]{32}$/);assert(typeof expression==='string'&&expression.length>0&&expression.length<32768);
 const facts=outageNativeFingerprintSql(names);
 return `begin;reset role;${serializationSql}
 set local statement_timeout='15s';set local lock_timeout='3s';
 do $security226$ declare before_hash text;value jsonb;code text;state text;begin
 assert current_user='postgres','security226_owner_required';
 assert exists(select 1 from pg_namespace n where n.nspname=${quote(schema)} and n.nspowner::regrole::text='postgres'
   and obj_description(n.oid,'pg_namespace') like 'faolla-synthetic-concurrency:%'),'security226_namespace_required';
 assert (select n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchants'::regclass)=${quote(schema)},'security226_scope_required';
 before_hash:=${facts};
 begin set local role service_role;value:=(${expression});exception when others then get stacked diagnostics code=message_text,state=returned_sqlstate;end;
 reset role;perform set_config('faolla.recovery_security226',jsonb_build_object('before',before_hash,'value',value,'error',code,'sqlState',state)::text,true);
 end;$security226$;select current_setting('faolla.recovery_security226')::jsonb;rollback;`;
}

export async function runAttendanceRecoverySecurityProbe(exec,config){
 assert.equal(typeof exec,'function');const packet=JSON.parse(String(await exec(attendanceRecoverySecurityProbeSql(config))).trim());
 assert.deepEqual(Object.keys(packet).sort(),['before','error','sqlState','value']);assert.match(packet.before,/^[a-f0-9]{32}$/);
 const after=String(await exec(attendanceRecoverySecurityFactsSql(config.names))).trim();
 assert.equal(after,packet.before,'security226_probe_rollback_all_facts');
 assert((packet.error===null&&packet.sqlState===null)||(typeof packet.error==='string'&&typeof packet.sqlState==='string'));
 return packet;
}

export function attendanceRecoverySecurityProbeCounts(finalProbeCount){
 assert(Number.isSafeInteger(finalProbeCount)&&finalProbeCount>=1&&finalProbeCount<=40);
 // Each case has one RPC rollback plus one independent post-rollback digest
 // transaction. Source also tests enabled PIN once and captures one boundary
 // digest; target has two boundary digests. Setup, ownership/catalog and old-row guard reads are
 // not included in these explicitly scoped probe-transaction counts.
 return {sourceProbeCases:finalProbeCount+1,targetProbeCases:finalProbeCount,
  sourceProbeTransactions:2*(finalProbeCount+1)+1,targetProbeTransactions:2*finalProbeCount+2,
  transactionCountsExcludeSetupAndCatalogReads:true};
}

function delegationQuery(p,kind,mode='list',patch={}){
 return {siteId:p.site,access:'owner',mode,catalog:null,afterId:null,grantId:null,
  ...(kind==='schedule'?{fromDate:null,throughDate:null}:{}),operationId:null,...patch};
}
function delegationExpression(p,kind,q,c=null,allow=true,actor=p.owner){
 const name=kind==='schedule'?'faolla_attendance_schedule_delegation_v1':q.access==='owner'?`faolla_attendance_${kind}_delegations_v1`:
  kind==='missing'?'faolla_attendance_delegated_missing_v1':'faolla_attendance_delegated_applications_v1';
 return `public.${name}(${json(q)},${quote(actor)},${json(c)},${allow}${kind==='application'?',false':''})`;
}

export async function prepareAttendanceRecoverySecurity(ctx){
 const {d,h,native,scope}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native?.query,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);assert.equal(scope.schema,d.owned.schema);
 const p=createAttendanceRecoverySecurityPlan({owner:d.owner,now:d.exec(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');`)});
 assert.notEqual(p.site,d.site);assert.notEqual(p.target.worker,h.workerId);assert.notEqual(p.paused.worker,h.workerId);
 const names=d.inventory().slice().sort(),protectedSql=attendanceRecoverySecurityProtectedSql(names),beforeProtected=d.exec('select '+protectedSql+';');
 const definitions=d.definitions(),catalog=d.tableCatalog(),exec=sql=>native.query(scope.sql(sql));
 const config={schema:scope.schema,names};let setupWrites=0;
 const call=expression=>{const value=JSON.parse(d.exec("begin;set local role service_role;do $security226_service$ begin assert current_user='service_role','security226_service_role_required';end;$security226_service$;select "+expression+';commit;'));setupWrites++;
  assert.equal(d.exec('select '+protectedSql+';'),beforeProtected,'security226_old_rows_unchanged');return value;};
 const cores={missing:require('../../src/lib/merchantAttendanceMissingDelegation.ts'),application:require('../../src/lib/merchantAttendanceApplicationDelegation.ts'),schedule:require('../../src/lib/merchantAttendanceScheduleDelegation.ts')};
 const parsers={missing:cores.missing.parseMissingDelegationResult,application:cores.application.parseApplicationDelegationResult,schedule:cores.schedule.parseScheduleDelegationResult};
 const {parsePinStatus}=require('../../src/lib/merchantAttendancePin.ts');
 const {deriveAttendancePin}=require('../../src/lib/merchantAttendancePin.server.ts');
 const {parseTerminalList,parseTerminalDevice}=require('../../src/lib/merchantAttendanceTerminal.ts');
 const {parseAccountSuspensionResult}=require('../../src/lib/merchantAttendanceAccountSuspension.ts');
 // Explicit synthetic invitation/identity prerequisites, NOT an actual invite or
 // Auth login. No attendance ledger, credential, grant, epoch or raw event seed.
 d.exec(`do $fresh226$ begin assert not exists(select 1 from public.merchants where id=${quote(p.site)}),'security226_site_fresh';
  assert not exists(select 1 from public.merchant_enterprise_employees where id in(${[p.target.employee,p.paused.employee,p.delegate.employee].map(quote).join(',')}) or auth_user_id in(${[p.target.auth,p.paused.auth,p.delegate.auth].map(quote).join(',')})),'security226_identity_fresh';end;$fresh226$;
  insert into public.merchants(id,user_id,name,email) values(${quote(p.site)},${quote(p.owner)},'Synthetic226 recovery security','security226@example.invalid');
  insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
   (${quote(p.role)},${quote(p.site)},'Synthetic226 self',array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.request','attendance.self.leave']),
   (${quote(p.delegateRole)},${quote(p.site)},'Synthetic226 delegated reviewer',array['enterprise.view','attendance.self.view','attendance.missing.review','attendance.leave.review','attendance.schedule.publish','attendance.schedule.cancel']);
  insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
   (${quote(p.target.employee)},${quote(p.site)},${quote(p.target.auth)},'credential226@example.invalid',${quote(p.target.name)},${quote(p.role)},'active',clock_timestamp(),1),
   (${quote(p.paused.employee)},${quote(p.site)},${quote(p.paused.auth)},'paused226@example.invalid',${quote(p.paused.name)},${quote(p.role)},'active',clock_timestamp(),1),
   (${quote(p.delegate.employee)},${quote(p.site)},${quote(p.delegate.auth)},'delegate226@example.invalid','Synthetic226 supervisor',${quote(p.delegateRole)},'active',clock_timestamp(),1);`);
 assert.equal(d.exec('select '+protectedSql+';'),beforeProtected);
 let operation=226800200;
 const admin=(kind,values)=>{const version=Number(d.exec(`select coalesce((select version from public.merchant_attendance_settings where merchant_id=${quote(p.site)}),0);`));
  return call(`public.faolla_attendance_admin_v1(${quote(p.site)},${quote(p.owner)},${json({view:'workers',cursor:null,search:''})},${json({kind,operationId:id(++operation),expectedVersion:version,values})},null)`);};
 admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
 admin('location',{id:p.location,name:'Synthetic226 secure location',timeZone:'UTC',active:true});
 for(const subject of [p.target,p.paused])admin('worker',{id:subject.worker,employeeId:subject.employee,workerNo:subject.workerNo,displayName:subject.name,locationId:p.location,active:true,startsOn:'2000-01-01'});
 const terminalCommands=[];
 const terminalAdmin=(command=null,target=null,allow=false)=>`public.faolla_attendance_terminal_admin_v1(${quote(p.site)},${quote(p.owner)},${json({cursor:null,terminalId:target})},${json(command)},${allow})`;
 for(const terminal of p.terminals){
  const command={action:'create',terminalId:terminal.id,locationId:p.location,label:terminal.label,pairHash:terminal.pairHash};terminalCommands.push(command);
  assert.equal(parseTerminalList(call(terminalAdmin(command,null,true)),{siteId:p.site,cursor:null,terminalId:terminal.id}).items[0].state,'pending');
  assert.equal(parseTerminalDevice(call(`public.faolla_attendance_terminal_device_v1(${quote(p.site)},${quote(terminal.id)},${quote(terminal.pairHash)},${quote(terminal.deviceHash)},true)`),{siteId:p.site,terminalId:terminal.id}).terminal.state,'active');
 }
 const pinPayload={action:'set',operationId:p.pinOperations[0],expectedRevision:0,workerId:p.target.worker,employeeId:p.target.employee,salt:'26'.repeat(16),
  verifier:await deriveAttendancePin('42682642','26'.repeat(16),{siteId:p.site,workerId:p.target.worker,employeeId:p.target.employee},'synthetic226-explicit-local-only-pepper')};
 const pinSet={...pinPayload,commandHash:hash(JSON.stringify(pinPayload))};
 const revokedPayload={action:'revoke',operationId:p.pinOperations[1],expectedRevision:1,workerId:p.target.worker,employeeId:p.target.employee,salt:null,verifier:null};
 const pinRevoke={...revokedPayload,commandHash:hash(JSON.stringify(revokedPayload))};
 const pinAdmin=(command=null,op=null,allow=false)=>`public.faolla_attendance_pin_admin_v1(${quote(p.site)},${quote(p.owner)},${quote(p.target.workerNo)},${quote(op)},${json(command)},${allow})`;
 const parsePin=(raw,op)=>parsePinStatus(raw,{siteId:p.site,workerNo:p.target.workerNo,operationId:op});
 assert.equal(parsePin(call(pinAdmin(pinSet,null,true)),pinSet.operationId).enabled,true);
 const pinBegin=`public.faolla_attendance_pin_begin_v1(${quote(p.site)},${quote(p.terminals[0].id)},${quote(p.terminals[0].deviceHash)},${quote(p.target.workerNo)},${quote(p.lease)},true)`;
 const pinPositive=await runAttendanceRecoverySecurityProbe(exec,{...config,expression:`(${pinBegin})-'salt'-'verifier'`});
 assert.equal(pinPositive.error,null);assert.deepEqual(pinPositive.value,{workerId:p.target.worker,employeeId:p.target.employee,revision:1});
 assert.equal(parsePin(call(pinAdmin(pinRevoke)),pinRevoke.operationId).enabled,false);
 const terminalRevoke={action:'revoke',terminalId:p.terminals[1].id};
 assert.equal(parseTerminalList(call(terminalAdmin(terminalRevoke)),{siteId:p.site,cursor:null,terminalId:p.terminals[1].id}).items[0].state,'revoked');
 const savedDelegations={};
 for(const kind of ['missing','application','schedule']){
  const grant=p.grants[kind],revoke=p.revokes[kind],gq=delegationQuery(p,kind),rq=delegationQuery(p,kind,'detail',{grantId:grant.operationId});
  const first=parsers[kind](call(delegationExpression(p,kind,gq,grant)),gq,{authUserId:p.owner},grant);
  const second=parsers[kind](call(delegationExpression(p,kind,rq,revoke,false)),rq,{authUserId:p.owner},revoke);
  assert.equal(first.receipt.action,'grant');assert.equal(second.receipt.action,'revoke');savedDelegations[kind]={grant:first.receipt,revoke:second.receipt};
 }
 const statusCommands=[];
 for(const [index,status] of ['disabled','active'].entries()){
  const version=Number(d.exec(`select version from public.merchant_enterprise_employees where merchant_id=${quote(p.site)} and id=${quote(p.paused.employee)};`));
  const command={merchant_id:p.site,employee_id:p.paused.employee,expected_version:version,actor_type:'owner',actor_id:p.owner,status,
   ...(status==='disabled'?{offboarding_mode:'unassign'}:{}),attendance_operation_id:p.statusOperations[index],attendance_suspension_enabled:true};
  const result=call(`public.faolla_update_merchant_enterprise_employee_v1(${json(command)})`);assert.equal(result.employee.status,status);statusCommands.push({command,result});
 }
 const epoch=JSON.parse(d.exec(`select jsonb_build_object('generation',ep.generation,'paused',ep.paused,'suspensionId',ep.suspension_id,'active',w.active,'status',e.status)
  from public.merchant_attendance_account_epochs ep join public.merchant_enterprise_employees e on e.merchant_id=ep.merchant_id and e.id=ep.employee_id
  join public.merchant_attendance_workers w on w.merchant_id=e.merchant_id and w.employee_id=e.id where ep.merchant_id=${quote(p.site)} and ep.employee_id=${quote(p.paused.employee)};`));
 assert.equal(epoch.generation,1);assert.equal(epoch.paused,true);assert.equal(epoch.active,false);assert.equal(epoch.status,'active');assert.match(epoch.suspensionId,uuid);
 const probes=[];
 const add=(label,expression,project,error=null)=>probes.push({label,expression,project,error});
 add('revoked_pin_begin',pinBegin,value=>{assert.deepEqual(value,{denied:true});return value;});
 add('revoked_terminal_device',`public.faolla_attendance_terminal_device_v1(${quote(p.site)},${quote(p.terminals[1].id)},${quote(p.terminals[1].deviceHash)},null,false)`,null,'attendance_terminal_denied');
 for(const command of [pinSet,pinRevoke])for(const mode of ['recover','replay'])add('pin_'+command.action+'_'+mode,pinAdmin(mode==='replay'?command:null,mode==='recover'?command.operationId:null),value=>{
  const parsed=parsePin(value,command.operationId);assert.equal(parsed.enabled,false);assert.equal(parsed.revision,2);assert.equal(parsed.receipt.action,command.action);return parsed;});
 for(const command of [terminalCommands[1],terminalRevoke])add('revoked_terminal_'+command.action+'_replay',terminalAdmin(command),value=>{
  const parsed=parseTerminalList(value,{siteId:p.site,cursor:null,terminalId:p.terminals[1].id});assert.equal(parsed.items[0].state,'revoked');return parsed;});
 const accountQuery=operationId=>({siteId:p.site,mode:'recover-status',afterId:null,suspensionId:null,operationId});
 for(const item of statusCommands){const q=accountQuery(item.command.attendance_operation_id);
  add('status_'+item.command.status+'_recover',`public.faolla_attendance_account_suspensions_v1(${json(q)},${quote(p.owner)},null,false)`,value=>{
   const parsed=parseAccountSuspensionResult(value,q,p.owner);assert.equal(parsed.statusReceipt.status,item.command.status);assert.equal(parsed.statusReceipt.suspensionId,epoch.suspensionId);return parsed.statusReceipt;});
  add('status_'+item.command.status+'_replay',`public.faolla_update_merchant_enterprise_employee_v1(${json({...item.command,attendance_suspension_enabled:false})})`,value=>{assert.deepEqual(value,item.result);return value;});
 }
 add('active_member_still_paused_self',`public.faolla_attendance_self_v1(${quote(p.site)},${quote(p.paused.auth)},null,null)`,null,'attendance_access_denied');
 for(const kind of ['missing','application','schedule']){
  const grant=p.grants[kind],revoke=p.revokes[kind],detailQuery=delegationQuery(p,kind,'detail',{grantId:grant.operationId});
  add(kind+'_revoked_owner_detail',delegationExpression(p,kind,detailQuery),value=>{const parsed=parsers[kind](value,detailQuery,{authUserId:p.owner});assert.equal(parsed.detail.status,'revoked');return parsed.detail;});
  for(const command of [grant,revoke])for(const mode of ['recover','replay']){
   const q=mode==='recover'?delegationQuery(p,kind,'recover',{operationId:command.operationId}):command.action==='grant'?delegationQuery(p,kind):detailQuery;
   //160/162 reject owner grant POST at allow=false before receipt lookup;
   //do not mistake their permitted GET recovery for a new universal replay gate.
   const allow=mode==='replay'&&command.action==='grant'&&kind!=='schedule';
   add(kind+'_'+command.action+'_'+mode,delegationExpression(p,kind,q,mode==='replay'?command:null,allow),value=>{
    const parsed=parsers[kind](value,q,{authUserId:p.owner},mode==='replay'?command:null);assert.deepEqual(parsed.receipt,savedDelegations[kind][command.action]);return parsed.receipt;});
  }
  const dq=kind==='schedule'?delegationQuery(p,kind,'schedule',{access:'delegate',grantId:grant.operationId,fromDate:p.day,throughDate:p.day}):
   {siteId:p.site,access:'delegate',mode:'list',grantId:grant.operationId,requestId:null,operationId:null,beforeAt:null,beforeId:null,afterId:null};
  add(kind+'_revoked_delegate_denied',delegationExpression(p,kind,dq,null,true,p.delegate.auth),null,'attendance_access_denied');
  if(kind!=='schedule')add(kind+'_grant_replay_gate_closed',delegationExpression(p,kind,delegationQuery(p,kind),grant,false),null,`attendance_${kind}_delegation_disabled`);
 }
 assert(probes.length<=40);assert.equal(new Set(probes.map(x=>x.label)).size,probes.length);
 const expected=[];
 async function probeAt(targetExec,probe){const packet=await runAttendanceRecoverySecurityProbe(targetExec,{...config,expression:probe.expression});
  assert.equal(packet.error,probe.error,'security226:'+probe.label+':unexpected_error');
  if(probe.error){assert.equal(packet.sqlState,'P0001');assert.equal(packet.value,null);return {error:probe.error};}
  assert.equal(packet.sqlState,null);return probe.project(packet.value);
 }
 for(const probe of probes)expected.push(await probeAt(exec,probe));
 assert.equal(d.exec('select '+protectedSql+';'),beforeProtected);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
 const allFacts=String(d.exec(attendanceRecoverySecurityFactsSql(names))).trim();
 const summary=Object.freeze({protocol:'attendance-recovery-security-v1',siteId:p.site,syntheticOnly:true,
  explicitIdentitySeed:true,actualInvitationOrAuthentication:false,httpOrBrowserFlowsTested:false,actualPinKdf:true,actualPinSetAndRevoke:true,
  actualTerminalCreatePairAndRevoke:true,actualStatusDisableReactivate:true,pauseGeneration:epoch.generation,attendanceRemainsPaused:true,
  actualGrantAndRevoke:['missing','application','schedule'],setupRpcWrites:setupWrites,
  ...attendanceRecoverySecurityProbeCounts(probes.length),
  denialChecks:probes.filter(x=>x.error!==null||x.label==='revoked_pin_begin').length,
  pinRateCountersMayChangeInsideRollback:true,existingRowsPreserved:true,coreIdentityUntouched:true,
  newPunchesCreated:0,newAttendanceEffectsCreated:0,productionAccess:false});
 return {summary,verifyRestored:async restoredExec=>{
  assert.equal(typeof restoredExec,'function');
  const restoredOwned=assertLifecycleSandbox(sql=>restoredExec(sql));
  assert.equal(restoredOwned.schema,scope.schema);assert.equal(restoredOwned.owner,d.owned.owner);assert.equal(restoredOwned.marker,d.owned.marker);
  // OIDs differ after restore. Compare logical all-fact digest, never old OIDs.
  const targetFacts=async()=>String(await restoredExec(attendanceRecoverySecurityFactsSql(names))).trim();
  assert.equal(await targetFacts(),allFacts);
  for(let index=0;index<probes.length;index++)assert.deepEqual(await probeAt(restoredExec,probes[index]),expected[index],'security226_restored:'+probes[index].label);
  assert.equal(await targetFacts(),allFacts);
  return {...summary,restoredDenialsEqual:true,originalReceiptsEqual:true,revokedSamplesRemainRevoked:true,allProbeTransactionsRolledBack:true,allFactsUnchangedAfterProbes:true};
 }};
}
