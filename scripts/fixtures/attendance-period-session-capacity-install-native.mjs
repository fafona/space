//181 inert migration/archive compatibility probe. Root supplies the owned local
//runtime and an ACTUAL152 source projection. All149 writes AND the153 install
//are inside one rollback transaction; this helper never starts an environment.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './attendance-bound-clocks-native.mjs';

const migration='202610050153_merchant_attendance_period_session_capacity.sql';
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
const lines=value=>value.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
function fingerprint(names){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r) rows`;
  }).join(' union all ')+') archive_install_rows)';
}
const savedMetadata=raw=>{
  const result=structuredClone(raw);
  // Only current actor/access and observation time vary between explicit reads.
  delete result.actorId;delete result.access;delete result.readAt;return result;
};

export async function verifyPeriodSessionCapacityInstallNative({d,native,scope,h,source}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof d?.tableCatalog,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  const q=source?.q,artifact=source?.ownerProjection?.artifact,raw=source?.ownerRaw;
  assert.deepEqual(q,{siteId:d.site,access:'owner',workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate});
  assert.equal(artifact?.worker.employeeId,h.employeeId);assert.equal(artifact.worker.employeeAuthUserId,h.employeeAuthUserId);
  assert.equal(artifact.sourceFingerprint,raw?.sourceFingerprint);assert.equal(digest(raw.sourceText),raw.sourceFingerprint);
  assert.deepEqual(JSON.parse(raw.sourceText),raw.sourceCanonical);assert.deepEqual(artifact.source,raw.sourceCanonical);
  const body=boundClockMigrationBody(native.root,migration);
  assert.doesNotMatch(body,/^\s*(?:begin|commit|rollback)\s*;/im,'archive_install_requires_one_outer_transaction');
  assert.doesNotMatch(body,/create\s+index\s+concurrently/i,'archive_install_no_concurrent_index_in_transaction');
  const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  const indexesSql=`select coalesce(jsonb_agg(jsonb_build_array(c.oid,c.relname,pg_get_indexdef(c.oid),i.indisvalid,i.indisready,i.indislive) order by c.oid),'[]')
    from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace=${owned.oid};`;
  const indexes=d.exec(indexesSql),allHash=fingerprint(names),businessHash=fingerprint(names.filter(name=>name!=='faolla_schema_migrations'));
  const allowed=['faolla_schema_migrations','merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries'];
  const protectedHash=fingerprint(names.filter(name=>!allowed.includes(name)));
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const pid=id(181900001),op=id(181900002),site=quote(d.site),worker=quote(h.workerId);
  const query=(access,mode)=>({...q,access,mode,periodId:pid,operationId:null,version:mode==='export'?1:null});
  const command={action:'send',operationId:op,periodId:pid,expectedRevision:0,expectedVersion:0,
    expectedFingerprint:artifact.sourceFingerprint,reason:'Synthetic181 archive before reader installation'};
  const call=(access,mode,cmd=null,saved=null)=>`public.faolla_attendance_period_closure_v1(${json(query(access,mode))},
    ${quote(access==='owner'?d.owner:h.employeeAuthUserId)},${json(cmd)},${json(saved)},${cmd!==null})`;
  const mark=(kind,sqlHash=allHash)=>prefix+`select jsonb_build_object('kind',${quote(kind)},'hash',${sqlHash});`;
  const read=(label,access)=>mark('before_read')+`set local role service_role;
    select jsonb_build_object('kind','export','label',${quote(label)},'access',${quote(access)},'raw',${call(access,'export')});`+mark('after_read');
  const initial=`do $archive_install_initial$ begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610050152)
      and not exists(select 1 from public.faolla_schema_migrations where version=202610050153),'archive_install_exact152_required';
    assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}),'archive_install_before_period_creation';
    assert exists(select 1 from public.merchant_enterprise_employees e join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
      where e.merchant_id=${site} and e.id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)}
        and e.status='active' and r.status='active' and 'attendance.self.export'=any(r.permissions)),'archive_install_existing_export_permission_required';
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'archive_install_live_guards_required';
  end;$archive_install_initial$;`;
  const steps=['begin;'+prefix+initial+mark('protected_before',protectedHash),
    prefix+`set local role service_role;select jsonb_build_object('kind','send','raw',${call('owner','detail',command,artifact)});`,
    read('before153','owner'),mark('before_install',businessHash),prefix+body,
    prefix+`do $archive_install_applied$ begin
      assert exists(select 1 from public.faolla_schema_migrations where version=202610050153 and name='merchant_attendance_period_session_capacity'),'archive_install153_required';
    end;$archive_install_applied$;`+mark('after_install',businessHash),
    read('after153_owner','owner'),read('after153_self','self'),
    mark('protected_after',protectedHash)+'set constraints all immediate;rollback;'];
  assert(steps.length<=10,'archive_install_bounded_steps');let output;
  try{output=lines(await native.querySteps(steps.map(sql=>scope.sql(sql))));}
  catch(error){throw new Error('period_session_capacity_install_probe_failed:'+String(error?.message??error),{cause:error});}
  finally{
    assert.equal(d.fingerprint(),baseline,'archive_install_rollback_facts');assert.equal(d.definitions(),definitions,'archive_install_rollback_functions');
    assert.equal(d.tableCatalog(),catalog,'archive_install_rollback_catalog');assert.equal(d.exec(indexesSql),indexes,'archive_install_rollback_indexes');
  }
  const one=kind=>{const found=output.filter(row=>row.kind===kind);assert.equal(found.length,1,kind);return found[0];};
  assert.equal(one('protected_before').hash,one('protected_after').hash,'archive_install_old_business_changed');
  assert.equal(one('before_install').hash,one('after_install').hash,'archive_install_modified_saved_or_business_rows');
  const sent=one('send').raw;assert.equal(sent.period.periodId,pid);assert.equal(sent.period.state,'review');assert.equal(sent.period.currentVersion,1);
  assert.equal(sent.period.revision,1);assert.equal(sent.replayed,false);assert.deepEqual(sent.operation.command,command);assert.deepEqual(sent.artifact,artifact);
  const exports=[];
  for(let i=0;i<output.length;i++)if(output[i].kind==='export'){
    const row=output[i],reply=row.raw;
    assert.equal(output[i-1].kind,'before_read');assert.equal(output[i+1].kind,'after_read');
    assert.equal(output[i-1].hash,output[i+1].hash,'archive_export_wrote_rows');
    assert.equal(reply.actorId,row.access==='owner'?d.owner:h.employeeAuthUserId);assert.equal(reply.access,row.access);
    assert.equal(reply.artifactVersion,1);assert.equal(reply.sourceChanged,null);assert.equal(reply.operation,null);assert.equal(reply.replayed,false);
    assert.equal(digest(reply.artifactText),reply.artifactSha256);assert.equal(Buffer.byteLength(reply.artifactText,'utf8'),reply.artifactBytes);
    assert(reply.artifactBytes<=2097152);assert.deepEqual(JSON.parse(reply.artifactText),reply.artifact);assert.deepEqual(reply.artifact,artifact);
    exports.push(row);
  }
  assert.deepEqual(exports.map(row=>row.label),['before153','after153_owner','after153_self']);
  for(const row of exports.slice(1)){
    assert.equal(row.raw.artifactText,exports[0].raw.artifactText);assert.equal(row.raw.artifactSha256,exports[0].raw.artifactSha256);
    assert.equal(row.raw.artifactBytes,exports[0].raw.artifactBytes);assert.deepEqual(savedMetadata(row.raw),savedMetadata(exports[0].raw));
  }
  return {actual149Send:true,actual153Install:true,fixedVersion:1,actualFixedExports:exports.length,
    artifactSha256:exports[0].raw.artifactSha256,artifactBytes:exports[0].raw.artifactBytes,
    sourceFingerprint:artifact.sourceFingerprint,exactSavedTextAndMetadataPreserved:true,installBusinessAndArtifactRowsUnchanged:true,
    allExportReadsZeroWrites:true,outerRollbackTransactions:1,factsFunctionsCatalogIndexesRestored:true,
    syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
    fixtureDisclosure:'Actual149 send of the supplied real152 Node projection, then actual153 migration body and fixed-version owner/self exports within ONE rollback transaction. No fake archive, temporary business table, role change, production data or deployment.'};
}
