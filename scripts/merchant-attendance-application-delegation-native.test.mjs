// Static runner contract only. These checks do not start PG, invoke SQL or
//claim that the actual race/archive/browser acceptance has run.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const driver=read('./merchant-attendance-application-delegation-native.mjs');
const fixture=read('./fixtures/attendance-application-delegation-native.mjs');
const race=read('./merchant-attendance-lifecycle-native-support.mjs');
function includes(source,values){for(const value of values)assert(source.includes(value),`missing contract witness: ${value}`);}
function inOrder(source,values){let previous=-1;for(const value of values){const index=source.indexOf(value,previous+1);assert(index>previous,`missing or reordered witness: ${value}`);previous=index;}}

test('entry is import-inert and uses only the guarded existing cluster and a single owned namespace',()=>{
  includes(driver,['export async function runApplicationDelegationNative(args,browserCheck=null,afterVerified=null)',
    'runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>',
    'preparePlanAdoptionViewNative(native,scope)',
    'if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))',
    "args.filter(x=>x!=='--with-browser')"]);
  assert.equal((driver.match(/withAttendanceConcurrencySandbox\(native/g)??[]).length,1);
  assert.doesNotMatch(driver+fixture,/\binitdb\b|\bcreatedb\b|\bpg_ctl\b|DISABLE\s+(?:TRIGGER|ROW)|session_replication_role|next\s+build/i);
  includes(fixture,['assert(d?.syntheticOnly===true&&h?.syntheticOnly===true)',
    'assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned)']);
});
test('CIC migrations preserve their transaction boundaries; additive reapply protects prior facts and exact old definitions',()=>{
  includes(driver,["native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610050151_merchant_attendance_period_source_ranges.sql'),'utf8')))"]);
  includes(fixture,["native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610060160_merchant_attendance_missing_delegation.sql'),'utf8')))",
    "d.inventory().filter(t=>t!=='faolla_schema_migrations')",'facts=d.fingerprint(prior)',
    "p.proname<>'faolla_valid_merchant_enterprise_permissions_v1'",'pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef',
    'install();assert.equal(d.fingerprint(prior),facts);assert.equal(oldDefs(),originalDefs)',
    'install();assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions)',
    'install();assert.equal(d.fingerprint(),finalFacts);assert.equal(d.definitions(),finalDefs);assert.equal(oldDefs(),originalDefs)']);
});
test('genuine old155 sealed artifact precedes156+ and retains exact bytes and SHA after the complete workflow',()=>{
  includes(driver,['202610050155_merchant_attendance_period_fixed_boundaries.sql','old155ArchiveBytes:original.artifactBytes,old155ArchivePreserved:true']);
  inOrder(driver,["const preview=await period(pq())","command('send')","command('confirm',current)","command('seal',current)",'assert(current.period.sealed)',
    "pq('export','owner',periodId),version:1",'const original=archive();for(const m of beforeDelegation)',
    'assert.equal(archive().artifactText,original.artifactText)',
    'result=await verifyApplicationDelegationNative({d,h,native,scope},browserCheck,afterVerified)',
    'assert.equal(retained.artifactText,original.artifactText);assert.equal(retained.artifactSha256,original.artifactSha256)']);
});
test('real routes/services and old self writers supply requests, actual actors, canonical old commands and notifications',()=>{
  includes(fixture,['parseApplicationDelegationResult(value,q,{authUserId:a},c)',
    'handleApplicationDelegation(request,{enabled:()=>enabled','execute:input=>executeApplicationDelegation(input,service)',
    'executeApplicationDelegation({query:q,command:c,authUserId:a,allowWrite:allow},service)',
    "assert.equal(name,rpcFor(a.p_query))",'set local role service_role;select ',
    "category==='leave'?executeLeave:executeWorkArrangement",'expectedSettingsVersion:home.settingsVersion','expectedPolicyRevision:home.policy.revision',
    'assert.equal(entry.actor,delegateAuth);assert.deepEqual(entry.command,command.decision)',
    'merchant_attendance_leave_notifications where merchant_id=',
    'assert.equal(oldWork.detail.history.at(-1).actorId,delegateAuth)']);
  assert.doesNotMatch(fixture,/insert\s+into\s+public\.merchant_attendance_(?:leave|work_arrangement)_(?:requests|entries)/i);
});
test('history and kind scopes, read-only GET/error checks and sealed approval boundary remain actual SQL assertions',()=>{
  includes(fixture,['const before=d.fingerprint(),r=raw(q,null,allow,a);assert.equal(d.fingerprint(),before);reads++',
    'const before=d.fingerprint();assert.throws(()=>raw(q,c,allow,a)', 'assert.equal(d.fingerprint(),before);rejections++',
    'includePending:false',"const historical=await submit(),lg=grant()",'items.some(x=>x.requestId===historical.requestId),false',
    "grant('leave',{includePending:true})", "submit('work_arrangement','trip')", "submit('work_arrangement','remote')",
    'assert(JSON.stringify(preview.preview.artifact).includes(fresh.requestId))',
    "pc('send')","pc('confirm',current)","pc('seal',current)",'assert(sv.sealed&&!sv.canApprove)',
    "reject('attendance_period_sealed|attendance_access_denied'", "decide(lg.operationId,sealedRequest,sv,'reject')"]);
});
test('revoke/approve uses two actual connections and witnessed blocker PID, not a synthetic race or timing-only sleep',()=>{
  includes(fixture,["const prefix=\"reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';\"+d.guard+'set local role service_role;'",
    'lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql}',
    "expr(ownerQuery({mode:'detail',grantId:rg.operationId}),revokeRace)",'expr(post(rg.operationId,rr),rc)',
    'assert(race.witnessed&&race.right.error)','assert.match(String(race.right.error)',
    "assert.equal((await oldRead('leave',rr.requestId)).detail.status,'submitted')"]);
  includes(race,['const holder=connect()','waiter=connect()',"holder.step('select pg_backend_pid();')",'pg_stat_activity',
    "wait_event_type='Lock'",'any(pg_blocking_pids(pid))',"assert(witnessed,'lifecycle_exact_blocker_not_witnessed')",
    "await holder.step(rollback?'rollback;':'commit;')",'finally{','await Promise.all([holder.close(),waiter?.close()])']);
});
test('feature-off original recovery preserves revoked receipt; temporary removal of self/review permission always restores exact original role',()=>{
  inOrder(fixture,["raw(ownerQuery({mode:'detail',grantId:lg.operationId}),revoke,false)",'assert.deepEqual(read(recovery,false).receipt,terminal.receipt)',
    "const handlerResponse=await handle(new Request", "'delegate',false)",'assert.deepEqual((await handlerResponse.json()).receipt,terminal.receipt)']);
  const start=fixture.indexOf('const roleWithoutSelf=async callback=>'),end=fixture.indexOf('const context=',start);assert(start>=0&&end>start);const scoped=fixture.slice(start,end);
  includes(scoped,['assertLifecycleSandbox','const before=d.fingerprint()',"'permissions',r.permissions",'e.id=${quote(delegateEmployee)}',
    "permissions=array['enterprise.view']::text[]", "['enterprise.view']",'const withdrawn=d.fingerprint(),result=await callback()',
    "assert.equal(d.fingerprint(),withdrawn,'recovery_after_role_withdrawal_wrote')",'finally{',
    'permissions=array(select jsonb_array_elements_text(${json(role.permissions)}))',
    'where merchant_id=${quote(d.site)} and id=${quote(role.id)}',"assert.equal(d.fingerprint(),before,'synthetic_role_not_restored')"]);
  includes(fixture,['fingerprint,roleWithoutSelf,','approved:{request:fresh,query,command,receipt:terminal.receipt,recovery}',
    'revokedGrantId:lg.operationId',"import('./attendance-delegation-recovery-browser.mjs')",'.runDelegationRecoveryBrowserAcceptance(context)']);
});
test('all modified fixture-only feature/secret environment values restore in finally and runtime claims remain bounded',()=>{
  includes(driver,["keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER']",'previous=keys.map(k=>process.env[k])',
    'finally{keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];})']);
  includes(fixture,['previousCapture=process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED',
    'finally{if(previousCapture===undefined)delete process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED;else process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED=previousCapture;}',
    'existingDatabaseReused:true,productionAccess:false,newDatabase:false,deployment:false']);
});
