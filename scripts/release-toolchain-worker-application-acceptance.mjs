// Owned child-process acceptance only: actual application, entirely fake HTTP.
import assert from 'node:assert/strict';import fs from 'node:fs';
import {loadBookingAtomicWorkerApplication} from './booking-atomic-worker.mjs';
export function createSyntheticWorkerApplication(source){
 assert.equal(process.env.NODE_ENV,'test');
 for(const file of ['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'])assert.equal(fs.existsSync(file),false);
 const key='owned-synthetic-service-credential-'.repeat(3);
 for(const name of ['SUPABASE_SERVICE_ROLE_KEY','NEXT_SUPABASE_SERVICE_ROLE_KEY'])assert.ok(!process.env[name]||process.env[name]===key);
 assert.ok(!process.env.RESEND_API_KEY&&!process.env.BOOKING_CONFIRMATION_EMAIL_FROM);
 Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_INTERNAL_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:key,MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'1',FAOLLA_BACKGROUND_JOBS_PAUSED:'0'});
 let revision=0,ticks=0,commits=0,claims=0;const calls=[];
 const rows=[{id:'records',slug:'__merchant_booking_records__:v1',blocks:{version:1,records:[]},updated_at:null},{id:'rules',slug:'__merchant_booking_rules__:v1',blocks:{version:1,snapshots:{}},updated_at:null},{id:'workbench',slug:'__merchant_booking_workbench__:v1',blocks:{version:1,settingsBySiteId:{}},updated_at:null}];
 const snapshot=()=>({protocol:2,generation:'00000000-0000-4000-8000-000000000001',revision:String(revision),rows:structuredClone(rows)});
 globalThis.fetch=async(input,options)=>{
  const request=typeof input==='object'&&input instanceof Request?input:null,url=new URL(request?.url??String(input));assert.equal(url.origin,'http://127.0.0.1:1');assert.equal(options?.method??request?.method,'POST');
  const name=url.pathname.slice('/rest/v1/rpc/'.length);assert.equal(url.pathname,'/rest/v1/rpc/'+name);const args=JSON.parse(options?.body??await request?.text()??'{}');calls.push(name);
  if(name==='faolla_booking_atomic_read_v2')return Response.json(snapshot());
  if(name==='faolla_booking_atomic_snapshot_v1')return Response.json({replayed:false,...snapshot()});
  if(name==='faolla_booking_atomic_commit_v1'){
   const mutation=args.p_mutation;assert.equal(mutation.revision,String(revision));assert.deepEqual(mutation.rows,rows);assert.deepEqual(mutation.mailJobs,[]);
   for(const old of rows[0].blocks.records){const next=mutation.next.records.find(row=>row.id===old.id);assert.ok(next);if(old.siteId!==args.p_site_id)assert.deepEqual(next,old);}
   rows[0].blocks=structuredClone(mutation.next);revision++;commits++;return Response.json({replayed:false,result:mutation.result});
  }
  if(name==='faolla_booking_mail_claim_v1'){claims++;return Response.json(null);}
  throw Error('synthetic_application_unexpected_rpc');
 };
 const application=loadBookingAtomicWorkerApplication(source);
 const report=()=>({kind:'actual-booking-application-synthetic-acceptance',actualApplicationInvoked:true,zeroSiteDynamicImport:ticks>=1,multiSiteCompleted:ticks>=2&&commits===2&&claims>=2,sharedAtomicContext:commits===2,syntheticCommits:commits,claimCalls:claims,completedTicks:ticks,realNetwork:false,formalDatabaseLoaded:false,mailEnabled:false});
 return {report,tick:async()=>{
  const result=await application.tick();ticks++;
  if(ticks===1){assert.equal(result.processedSiteCount,0);for(const siteId of ['syntheticA','syntheticB']){rows[0].blocks.records.push({id:'booking-'+siteId,siteId,createdAt:'2000-01-01T00:00:00Z',updatedAt:'2000-01-01T00:00:00Z',status:'active',appointmentAt:'2000-01-02T00:00',appointmentTimeZone:'UTC',editToken:'synthetic-private-token-'.repeat(3),timeline:[]});rows[2].blocks.settingsBySiteId[siteId]={appointmentAutoStatus:'completed',customerAutoEmailEnabled:false,merchantReminderOffsetsMinutes:[]};}}
  else{assert.equal(result.processedSiteCount,2);assert.equal(commits,2);assert.ok(rows[0].blocks.records.every(row=>row.status==='completed'));assert.ok(claims>=2);}
  return report();
 }};
}
