// Synthetic business transport only. Actual browser pages, SDK and server auth
// resolver are exercised separately by the caller; this is NOT production SQL.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initialAttendanceState,applyAttendanceEvent,type AttendanceEvent} from "../../src/lib/merchantAttendance";
import {parseAttendanceSelfCommand,parseAttendanceSelfQuery} from "../../src/lib/merchantAttendanceSelf";
import {createEmployeeLocationFixture} from "./attendance-employee-location-workspace-model";
import {createCorrectionFixture} from "./attendance-correction-model";
export const portalId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const portalActors=[{id:portalId(1),email:"employee-a@example.test"},{id:portalId(2),email:"employee-b@example.test"}];
export function createAttendancePortalModel(features=false){
  const siteId="99990001",locationId=portalId(20);
  const workers=new Map(portalActors.map((actor,i)=>{
    const workerId=portalId(10+i);return [actor.id,{workerId,name:`合成员工${i===0?"甲":"乙"}`,state:initialAttendanceState(siteId,workerId),last:null as AttendanceEvent|null,events:new Map<string,AttendanceEvent>()}];
  }));
  const location=new Map([...workers].map(([employeeId,w])=>[employeeId,createEmployeeLocationFixture({employeeId,workerId:w.workerId,locationId})]));
  const corrections=new Map([...workers].map(([employeeId,w])=>[employeeId,createCorrectionFixture({employeeId,workerId:w.workerId})]));
  const model={canClock:true,canRequest:true,denied:false,moduleEnabled:true,loseNextPost:false,version:1,posts:0,gets:0,receipts:0,accepts:0,location,corrections,
    async respond(request:Request,userId:string):Promise<Response|null>{
      const url=new URL(request.url),worker=workers.get(userId);assert(worker,"synthetic_actor_only");
      const permissions=["enterprise.view","attendance.self.view",...(model.canClock?["attendance.self.clock"]:[]),...(features&&model.canRequest?["attendance.self.request"]:[])];
      const actor={type:"employee",id:userId,siteId,displayName:worker.name,email:portalActors.find(a=>a.id===userId)!.email,permissions,accessScope:"all",allowedBoardIds:[]};
      const json=(data:unknown,status=200)=>Response.json(data,{status});
      if(model.denied)return json({ok:false,error:"merchant_employee_access_denied"},403);
      if(url.pathname==="/api/merchant-enterprise/employees/accept"){
        assert.equal(request.method,"POST");assert.deepEqual(await request.json(),{siteId});model.accepts++;return json({ok:true});
      }
      if(url.pathname==="/api/merchant-enterprise/memberships"){
        assert.equal(request.method,"GET");return json({ok:true,memberships:[{siteId,siteName:"合成企业",employeeId:userId,displayName:worker.name,roleId:portalId(30),roleName:"合成考勤角色",status:"active",enterable:true}]});
      }
      if(url.pathname==="/api/merchant-business/capabilities"){
        assert.equal(url.searchParams.get("siteId"),siteId);assert.equal(request.method,"GET");
        return json({ok:true,schemaVersion:1,actor:{type:"employee",displayName:worker.name,principalKey:`employee:${userId}`,authorizationVersion:`${model.version}:1`},
          cacheNamespace:`synthetic-${userId}-${model.version}`,collaborationPermissions:permissions,permissions:[],workspace:{siteId,siteName:"合成企业",siteCountryCode:"ES"}});
      }
      if(url.pathname==="/api/merchant-enterprise/overview"){
        assert.equal(url.searchParams.get("siteId"),siteId);assert.equal(request.method,"GET");
        return json({ok:true,actor,needsBootstrap:false,snapshot:{roles:[],employees:[],boards:[],columns:[],tasks:[]}});
      }
      if(features&&url.pathname.startsWith('/api/merchant-enterprise/attendance/')&&!url.pathname.endsWith('/self')){
        const isLocation=['self-context','location-clock','location-notice'].includes(url.pathname.split('/').at(-1)!);
        const fixture=isLocation?location.get(userId)!:corrections.get(userId)!;
        if(!isLocation)corrections.get(userId)!.canRequest(model.canRequest);
        if(isLocation&&request.method==='POST'&&!model.canClock&&url.pathname.endsWith('/location-clock'))return json({ok:false,error:'attendance_access_denied'},403);
        try{return await fixture.apiFetch(url.pathname+url.search,{method:request.method,...(request.method==='POST'?{body:await request.text()}: {})});}
        catch(error){if(error instanceof Error&&/committed_response_lost/.test(error.message))return null;throw error;}
      }
      assert.equal(url.pathname,"/api/merchant-enterprise/attendance/self","unexpected_business_endpoint");
      const locationState=location.get(userId)!.snapshot().state;
      const result=(receipt:AttendanceEvent|null=null,replayed=false)=>json({ok:true,moduleEnabled:model.moduleEnabled,workerId:worker.workerId,locationId,
        state:locationState.sequence>worker.state.sequence?locationState:{sequence:worker.state.sequence,status:worker.state.status,lastEvent:worker.last},receipt,replayed});
      if(request.method==="GET"){
        model.gets++;const q=parseAttendanceSelfQuery(request.url);assert.equal(q.siteId,siteId);
        const receipt=worker.events.get(q.operationId??"")??null;if(receipt)model.receipts++;return result(receipt);
      }
      assert.equal(request.method,"POST");model.posts++;
      if(!model.canClock)return json({ok:false,error:"attendance_access_denied"},403);
      const parsed=parseAttendanceSelfCommand(await request.json()),command=parsed.command;assert.equal(parsed.siteId,siteId);
      if(command.expectedWorkerId!==worker.workerId)return json({ok:false,error:"attendance_worker_changed"},409);
      const saved=worker.events.get(command.operationId);if(saved)return result(saved,true);
      if(command.expectedSequence!==worker.state.sequence)return json({ok:false,error:"attendance_sequence_conflict"},409);
      const event:AttendanceEvent={id:randomUUID(),siteId,workerId:worker.workerId,locationId,operationId:command.operationId,sequence:worker.state.sequence+1,action:command.action,occurredAt:new Date().toISOString(),timeZone:"Europe/Madrid",breakPaid:command.action==="break_start"?false:null};
      worker.state=applyAttendanceEvent(worker.state,event).state;worker.last=event;worker.events.set(command.operationId,event);
      if(model.loseNextPost){model.loseNextPost=false;return null;}return result(event);
    },
    count:(userId=portalActors[0].id)=>workers.get(userId)!.events.size,
  };
  return model;
}
