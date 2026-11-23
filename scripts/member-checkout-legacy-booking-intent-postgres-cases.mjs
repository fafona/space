// Called ONLY by the owned TEMP order/booking intent acceptance entry point.
// Actual booking service, HTTP handler, runtime, planner and original outbox;
// synthetic session/site metadata. No local files, real mail, push or live IO.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import runtime from '../src/lib/merchantBookingAtomicRuntime.server.ts';
import preparation from '../src/lib/merchantBookingAtomicPreparation.server.ts';
import workbench from '../src/lib/merchantBookingWorkbench.ts';
import settingsStore from '../src/lib/merchantBookingWorkbenchStore.ts';

export async function legacyBookingIntentCases(t,{admin,a,b,seed,submit,ack,state,site,one,evidence}){
 const root=process.cwd(),requireRepo=createRequire(path.join(root,'package.json')),ts=requireRepo('typescript'),primary='__merchant_booking_records__:v1',owner='__faolla_booking_persistence__';
 const keys=['MERCHANT_MEMBER_CHECKOUT_PILOT_SITES','MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES','MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES','MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES'],prior=keys.map(k=>process.env[k]);
 let session=null;const effects=[];
 const moduleFrom=async(relative,overrides)=>{const file=path.join(root,relative),compiled=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,m={exports:{}};
  const require=name=>{if(Object.hasOwn(overrides,name))return overrides[name];if(name.startsWith('@/'))return requireRepo(path.join(root,'src',name.slice(2)+'.ts'));if(name.startsWith('./'))return requireRepo(path.join(path.dirname(file),name+'.ts'));return requireRepo(name);};
  runInNewContext(compiled,{module:m,exports:m.exports,require,process:{cwd:()=>evidence},Date,Buffer,Promise,JSON,Math,structuredClone,Request,Response,URL},{filename:file});return m.exports;};
 const forbidden=name=>()=>{effects.push(name);throw Error(`forbidden ${name}`);};
 const core=await moduleFrom('src/lib/merchantBookings.server.ts',{
  './publishedMerchantService':{loadCurrentMerchantSnapshotSiteBySiteId:async id=>({id,merchantName:'Synthetic',domain:'https://booking.synthetic.invalid',permissionConfig:{allowBookingBlock:true,allowBookingAutoEmail:true},location:{countryCode:'ES'}})},
  './superAdminServer':{createServerSupabaseServiceClient:()=>null},'./resilientJsonFileStore':{readJsonFileWithBackup:forbidden('local read'),writeJsonFileWithBackup:forbidden('local write')},
  './merchantBookingEmails':{sendMerchantBookingStatusEmail:forbidden('email'),sendMerchantBookingReminderEmail:forbidden('reminder')},'./webPush':{notifyMerchantPushSubscribers:forbidden('push')}});
 const http=await moduleFrom('src/app/api/bookings/route.ts',{
  '@/lib/merchantBookings.server':core,'@/lib/personalAccountSession.server':{resolvePersonalAccountSessionFromRequest:async()=>session},
  '@/lib/superAdminServer':{createServerSupabaseServiceClient:()=>null},'@/lib/accountTrafficOutcome.server':{recordTrafficOutcome:async()=>{}},
  '@/lib/frontendAuthProof.server':{verifyFrontendAuthProof:()=>null},'@/lib/personalGuestMerge.server':{hashPersonalGuestMergeToken:()=>''},'@/lib/webPush':{notifyMerchantPushSubscribers:forbidden('HTTP push')}});
 const rpc=(c,options={})=>async(name,args)=>{options.names?.push(name);const fields={faolla_booking_atomic_read_v2:[],faolla_booking_command_result_v2:['p_site_id','p_command_key'],faolla_booking_atomic_snapshot_v1:['p_site_id','p_command_key','p_request_hash'],faolla_booking_atomic_commit_v1:['p_site_id','p_command_key','p_request_hash','p_mutation'],faolla_checkout_legacy_booking_commit_v1:['p_site_id','p_command_key','p_request_hash','p_mutation','p_not_after']}[name];assert.ok(fields,`unexpected booking RPC ${name}`);
  let response;try{response={data:(await one(c,`select public.${name}(${fields.map((_,i)=>'$'+(i+1)).join(',')}) result`,fields.map(k=>k==='p_not_after'&&options.deadlineMs?new Date(Date.now()+options.deadlineMs).toISOString():args[k]))).result,error:null};}catch(error){return{data:null,error:{message:error.message}};}
  if(name==='faolla_checkout_legacy_booking_commit_v1'&&options.lose)throw Error('synthetic lost acknowledgement');return response;};
 const withIo=(c,fn,options)=>runtime.withIsolatedBookingAtomicRpc(rpc(c,options),fn);
 const input=f=>({siteId:site,bookingBlockId:'synthetic-booking',bookingViewport:'desktop',store:'Store',item:'Play',title:'Mx',appointmentAt:'2030-02-01T10:00',customerName:'Synthetic',email:'synthetic@example.invalid',phone:'000',note:'Kept booking note',customerAccountId:f.principal.accountId,customerUserId:f.principal.userId,customerLoginEmail:'synthetic@example.invalid'});
 const identity=value=>({nonce:randomUUID(),principalScope:`personal:${value.customerAccountId}`,semanticInput:value});
 const create=(value,ident=identity(value),c=a,options)=>withIo(c,()=>runtime.withBookingRequestIdentity(ident,()=>core.createMerchantBooking(value)),options);
 const post=(f,nonce=randomUUID(),c=a,options)=>{session={...f.principal,email:'synthetic@example.invalid',user:{email:'synthetic@example.invalid',email_confirmed_at:new Date().toISOString()},servicePaused:false};const body={...input(f),requestNonce:nonce,customerAccountId:'99999999',customerUserId:'forged'};
  return withIo(c,()=>http.POST(new Request('https://booking.synthetic.invalid/api/bookings',{method:'POST',headers:{origin:'https://booking.synthetic.invalid','content-type':'application/json',dnt:'1'},body:JSON.stringify(body)})),options);};
 try{keys.forEach(k=>{process.env[k]=site;});
  await admin.query('insert into pages(merchant_id,slug,blocks) values($1,$2,$3)',[owner,primary,{version:1,records:[]}]);
  await admin.query('update faolla_booking_atomic_control set active=true where singleton');
  await withIo(a,()=>settingsStore.saveMerchantBookingWorkbenchSettings(site,workbench.normalizeMerchantBookingWorkbenchSettings({timeZone:'Europe/Madrid',customerAutoEmailEnabled:true,customerAutoEmailStatuses:['active'],customerEmailReplyTo:'merchant@example.invalid'})));
  await withIo(a,()=>runtime.runAtomicBookingMutation({siteId:site,operation:'synthetic.rules'},async()=>{runtime.stageAtomicBookingPersistence('rules',{version:1,snapshots:{[site]:{version:1,siteId:site,publishedAt:new Date().toISOString(),entries:[{viewport:'desktop',blockId:'synthetic-booking',storeOptions:['Store'],itemOptions:['Play'],titleOptions:['Mx'],availableTimeRanges:['09:00-18:00'],timeSlotRules:[],blockedDates:[],holidayDates:[],maxBookingsPerSlot:0}]}}});return null;}));
  await t.test('actual booking create with points or venue original is refused without booking, command, backup, notification or financial side effect',async()=>{
   for(const method of ['points','on_site']){const f=await seed(method);await submit(f);const before=await state(),names=[];
    await assert.rejects(create(input(f),undefined,a,{names}),/checkout_original_pending/);assert.equal(names.filter(n=>n.includes('commit')).length,1);assert.ok(names.includes('faolla_checkout_legacy_booking_commit_v1'));assert.deepEqual(await state(),before);assert.deepEqual(effects,[]);}
  });
  await t.test('review permits original ordinary booking/outbox; native replay remains read-only even when a newer checkout is pending',async()=>{
   const f=await seed();await submit(f);await ack(f);const value=input(f),ident=identity(value),before=await state(),created=await create(value,ident);
   assert.ok(created.booking.id);assert.ok(created.editToken);const after=await state();for(const k of Object.keys(before).filter(k=>k.startsWith('faolla_checkout_design.')||k==='public.faolla_redemption_operations'))assert.deepEqual(after[k],before[k],k);
   const stored=(await one(admin,'select blocks from pages where slug=$1',[primary])).blocks.records.find(r=>r.id===created.booking.id);assert.equal(stored.customerAccountId,f.principal.accountId);assert.equal(stored.customerUserId,f.principal.userId);assert.equal(stored.appointmentTimeZone,'Europe/Madrid');
   assert.equal((await one(admin,'select count(*)::int n from faolla_booking_mail_jobs where booking_id=$1',[created.booking.id])).n,2);
   f.request.nonce=randomUUID();await submit(f);const pendingState=await state();assert.equal((await create(value,ident,b)).booking.id,created.booking.id);assert.deepEqual(await state(),pendingState);
   await assert.rejects(create(value),/checkout_original_pending/);assert.deepEqual(await state(),pendingState);assert.deepEqual(effects,[]);
  });
  await t.test('actual booking HTTP binds session ownership and privately returns pending/refusal without dispatch',async()=>{
   const f=await seed();await submit(f);const before=await state(),response=await post(f);assert.equal(response.status,409);const body=await response.json();assert.equal(body.error,'checkout_original_pending');assert.ok(!JSON.stringify(body).includes('forged'));assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(await state(),before);
  });
  await t.test('ordinary booking never adopts or bypasses an untracked historical financial original',async()=>{
   const f=await seed(),old=await one(admin,'select b.principal_key from faolla_checkout_design.bundle_results b where b.site_id=$1 and not exists(select 1 from faolla_checkout_design.intent_claims c where c.site_id=b.site_id and c.operation_key=b.operation_key) limit 1',[site]);assert.ok(old);
   const [,accountId,userId]=old.principal_key.split(':');f.principal={accountId,userId};const before=await state();await assert.rejects(create(input(f)),/checkout_intent_review_required/);assert.deepEqual(await state(),before);
  });
  await t.test('actual booking HTTP lost result is unknown; original nonce recovers the one booking and two queued notifications',async()=>{
   const f=await seed(),nonce=randomUUID(),before=await state(),response=await post(f,nonce,a,{lose:true});assert.equal(response.status,503);assert.equal((await response.json()).error,'checkout_create_unconfirmed');
   const recovered=await withIo(a,()=>runtime.findBookingSubmissionResult(site,nonce,`personal:${f.principal.accountId}`));assert.equal(recovered.found,true);const id=recovered.result.booking.id;
   const after=await state();for(const k of Object.keys(before).filter(k=>k.startsWith('faolla_checkout_design.')))assert.deepEqual(after[k],before[k],k);
   const replay=await post(f,nonce,b);assert.equal(replay.status,200);assert.equal((await replay.json()).booking.id,id);assert.deepEqual(await state(),after);assert.equal((await one(admin,'select count(*)::int n from faolla_booking_mail_jobs where booking_id=$1',[id])).n,2);
   assert.equal((await withIo(a,()=>runtime.findBookingSubmissionResult(site,nonce,'personal:59999999'))).found,false);assert.deepEqual(effects,[]);
  });
  await t.test('closing new database enrollment does not release a pending booking guard; guest and another account keep ordinary creation',async()=>{
   const f=await seed();await submit(f);await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);try{const before=await state();await assert.rejects(create(input(f)),/checkout_original_pending/);assert.deepEqual(await state(),before);
    for(const patch of [{customerAccountId:'',customerUserId:'',customerLoginEmail:'',customerGuestHash:'synthetic-guest'},{customerAccountId:'59999999',customerUserId:'other-synthetic'}])assert.ok((await create({...input(f),...patch})).booking.id);
   }finally{await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
  });
  await t.test('all application gates closed: actual booking POST still cannot create past the durable original, then review restores native create/replay',async()=>{
   const f=await seed();await submit(f);keys.forEach(k=>{process.env[k]='';});await admin.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1',[site]);
   try{const before=await state(),names=[],response=await post(f,undefined,a,{names});assert.equal(response.status,409);assert.equal((await response.json()).error,'checkout_original_pending');assert.ok(names.includes('faolla_booking_atomic_commit_v1'));assert.ok(!names.includes('faolla_checkout_legacy_booking_commit_v1'));assert.deepEqual(await state(),before);assert.deepEqual(effects,[]);
    await ack(f);const nonce=randomUUID(),created=await post(f,nonce,a,{names});assert.equal(created.status,200);const id=(await created.json()).booking.id,stable=await state(),replay=await post(f,nonce,b);assert.equal(replay.status,200);assert.equal((await replay.json()).booking.id,id);assert.deepEqual(await state(),stable);
   }finally{keys.forEach(k=>{process.env[k]=site;});await admin.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1',[site]);}
  });
  await t.test('original booking CAS rejects an inverted checkout lock immediately and rolls back its command, primary, backup and outbox',async()=>{
   const f=await seed(),ident=preparation.bookingAtomicCommandIdentity({...identity(input(f)),siteId:site}),response=await rpc(admin)('faolla_booking_atomic_snapshot_v1',ident);assert.equal(response.error,null);const snapshot=response.data;
   const mutation={generation:snapshot.generation,revision:snapshot.revision,rows:snapshot.rows,next:{version:1,records:[...snapshot.rows.find(r=>r.slug===primary).blocks.records,{id:'R-closed-gate-'+randomUUID(),...input(f),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'active',editToken:'b'.repeat(36)}]},result:{},mailJobs:[]},before=await state();
   await a.query('begin');try{await a.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))",[site]);await b.query('set statement_timeout=1500');
    await assert.rejects(one(b,'select public.faolla_booking_atomic_commit_v1($1,$2,$3,$4)',[site,ident.p_command_key,ident.p_request_hash,mutation]),error=>{assert.equal(error.message,'checkout_resource_locked');assert.equal(error.code,'P0001');return true;});assert.deepEqual(await state(),before);
   }finally{await a.query('rollback');await b.query('set statement_timeout=15000');}
  });
  await t.test('closed gate permits an existing ordinary booking update while a newer financial original is pending',async()=>{
   const f=await seed(),created=await create(input(f));await submit(f);const before=await state();
   const ident=preparation.bookingAtomicCommandIdentity({...identity(input(f)),siteId:site}),response=await rpc(admin)('faolla_booking_atomic_snapshot_v1',ident);assert.equal(response.error,null);const snapshot=response.data;
   const next=structuredClone(snapshot.rows.find(r=>r.slug===primary).blocks);const record=next.records.find(r=>r.id===created.booking.id);assert.ok(record);record.note='An existing ordinary booking update';record.updatedAt=new Date().toISOString();
   await one(a,'select public.faolla_booking_atomic_commit_v1($1,$2,$3,$4)',[site,ident.p_command_key,ident.p_request_hash,{generation:snapshot.generation,revision:snapshot.revision,rows:snapshot.rows,next,result:{},mailJobs:[]}]);
   const after=await state();for(const k of Object.keys(before).filter(k=>k.startsWith('faolla_checkout_design.')||k==='public.faolla_redemption_operations'))assert.deepEqual(after[k],before[k],k);
   assert.equal((await one(admin,'select blocks from pages where slug=$1',[primary])).blocks.records.find(r=>r.id===created.booking.id).note,record.note);assert.deepEqual(effects,[]);
  });
  await t.test('final booking wrapper waits on the shared checkout lock and then sees a newly committed claim',async()=>{
   const f=await seed(),ident=preparation.bookingAtomicCommandIdentity({...identity(input(f)),siteId:site}),response=await rpc(admin)('faolla_booking_atomic_snapshot_v1',ident);assert.equal(response.error,null);const snapshot=response.data;
   const mutation={generation:snapshot.generation,revision:snapshot.revision,rows:snapshot.rows,next:{version:1,records:[...snapshot.rows.find(r=>r.slug===primary).blocks.records,{id:'R-synthetic-'+randomUUID(),...input(f),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'active',editToken:'b'.repeat(36)}]},result:{},mailJobs:[]};
   await a.query('begin');let waiting;try{await submit(f,a);waiting=one(b,'select public.faolla_checkout_legacy_booking_commit_v1($1,$2,$3,$4,$5)',[site,ident.p_command_key,ident.p_request_hash,mutation,new Date(Date.now()+11000).toISOString()]);waiting.catch(()=>{});
    let blocked=false;const until=Date.now()+2000;while(Date.now()<until){blocked=(await one(admin,"select wait_event='advisory' blocked from pg_stat_activity where pid=$1",[b.processID]))?.blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10));}assert.equal(blocked,true);
   }finally{await a.query('commit');}const before=await state();await assert.rejects(waiting,/checkout_original_pending/);assert.deepEqual(await state(),before);
  });
  await t.test('late outbox and outbox failure roll back actual booking, original command, backup and all queued notifications',async()=>{
   for(const mode of ['deadline','failure']){const f=await seed(),before=await state();await admin.query(`create function public.synthetic_booking_job_failure() returns trigger language plpgsql as $$begin ${mode==='deadline'?'perform pg_sleep(0.65);':"raise exception 'synthetic_job_rejected';"}return new;end;$$;create trigger synthetic_booking_job_failure after insert on public.faolla_booking_mail_jobs for each row execute function public.synthetic_booking_job_failure();`);
    try{await assert.rejects(create(input(f),undefined,a,mode==='deadline'?{deadlineMs:450}:{}),mode==='deadline'?/checkout_create_unconfirmed/:/booking_atomic_storage_unconfirmed/);assert.deepEqual(await state(),before);}finally{await admin.query('drop trigger synthetic_booking_job_failure on public.faolla_booking_mail_jobs;drop function public.synthetic_booking_job_failure();');}}
  });
  await t.test('new booking function has no API grants and cannot run under a retained snapshot',async()=>{
   const signature='public.faolla_checkout_legacy_booking_commit_v1(text,text,text,jsonb,text)',before=await state();for(const role of ['anon','authenticated','service_role']){assert.equal((await one(admin,'select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).allowed,false);
    await a.query(`set role ${role}`);try{await assert.rejects(one(a,'select public.faolla_checkout_legacy_booking_commit_v1($1,$2,$3,$4,$5)',[site,'a'.repeat(64),'b'.repeat(64),{},new Date(Date.now()+11000).toISOString()]),/permission denied/);}finally{await a.query('reset role');}}
   await a.query('begin isolation level repeatable read');try{await assert.rejects(one(a,'select public.faolla_checkout_legacy_booking_commit_v1($1,$2,$3,$4,$5)',[site,'a'.repeat(64),'b'.repeat(64),{},new Date(Date.now()+11000).toISOString()]),/checkout_intent_unavailable/);}finally{await a.query('rollback');}assert.deepEqual(await state(),before);assert.deepEqual(effects,[]);
  });
  await t.test('inactive booking generation cannot be bypassed through the new private wrapper',async()=>{
   await admin.query('update faolla_booking_atomic_control set active=false where singleton');
   try{const before=await state();await assert.rejects(one(a,'select public.faolla_checkout_legacy_booking_commit_v1($1,$2,$3,$4,$5)',[site,'a'.repeat(64),'b'.repeat(64),{},new Date(Date.now()+11000).toISOString()]),/booking_atomic_inactive/);assert.deepEqual(await state(),before);}
   finally{await admin.query('update faolla_booking_atomic_control set active=true where singleton');}
  });
 }finally{keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];});}
}
