import assert from "node:assert/strict";
import {parseAttendanceAdminCommand,parseAttendanceAdminQuery,type AttendanceAdminSettings,type AttendanceAdminResult} from "../../src/lib/merchantAttendanceAdmin";
export const entryOwner={id:"00000000-0000-4000-8000-000000000099",email:"owner-entry@example.test"};
export function createOwnerEntryModel(){
  const receipts=new Map<string,AttendanceAdminResult["receipt"]>();let settings:AttendanceAdminSettings|null=null,version=0;
  const model={denied:false,moduleEnabled:true,lost:false,gets:0,posts:0,overviewGets:0,overviewStatus:200,invalidOverviewBody:false,needsBootstrap:true,receiptQueries:[] as string[],
    async respond(request:Request,userId:string):Promise<Response|null>{
      assert.equal(userId,entryOwner.id);const url=new URL(request.url);
      if(model.denied)return Response.json({ok:false,error:"attendance_access_denied"},{status:403});
      if(url.pathname==='/api/merchant-enterprise/overview'){
        assert.equal(request.method,'GET');assert.equal(url.searchParams.get('siteId'),'99990001');
        model.overviewGets++;
        if(model.overviewStatus===0)return null;
        if(model.overviewStatus!==200)return model.invalidOverviewBody?new Response('not json',{status:model.overviewStatus}):Response.json({ok:false,error:'synthetic_overview_unavailable'},{status:model.overviewStatus});
        return Response.json({ok:true,actor:{type:'owner',id:entryOwner.id,siteId:'99990001',displayName:'合成负责人',email:entryOwner.email,permissions:[],accessScope:'all',allowedBoardIds:[]},
          needsBootstrap:model.needsBootstrap,snapshot:{roles:[],employees:[],boards:[],columns:[],tasks:[]}});
      }
      if(url.pathname==='/api/merchant-enterprise/current-operations'){
        assert.equal(request.method,'GET');return Response.json({ok:true,asOf:new Date().toISOString(),scope:'enterprise',employeeId:null,scopeRestricted:false,boardSummaryTotalCount:0,boardsTruncated:false,
          summary:{openTaskCount:0,overdueTaskCount:0,dueSoonTaskCount:0,unassignedTaskCount:0,involvedBoardCount:0,sharedAssignmentTaskCount:null},boards:[],priorityTasks:[]});
      }
      if(url.pathname==='/api/merchant-enterprise/workflow-permission-gaps'){
        assert.equal(request.method,'GET');return Response.json({ok:true,gaps:[]});
      }
      if(url.pathname==='/api/merchant-enterprise/todos'){
        assert.equal(request.method,'GET');return Response.json({ok:true,merchantId:'99990001',items:[],nextCursor:null,
          counts:{openCount:2,taskCount:2,overdueCount:0,dueSoonCount:0,acknowledgementCount:0,executionCount:0,feedbackCount:0}});
      }
      assert.equal(url.pathname,'/api/merchant-enterprise/attendance/admin');
      const result=(view:string,receipt:AttendanceAdminResult['receipt']=null)=>Response.json({ok:true,moduleEnabled:model.moduleEnabled,siteId:'99990001',version,settings,view,items:[],nextCursor:null,receipt});
      if(request.method==='GET'){model.gets++;const q=parseAttendanceAdminQuery(url.href);assert.equal(q.siteId,'99990001');if(q.operationId)model.receiptQueries.push(q.operationId);return result(q.view,receipts.get(q.operationId??'')??null);}
      assert.equal(request.method,'POST');model.posts++;const parsed=parseAttendanceAdminCommand(await request.json()),c=parsed.command;assert.equal(parsed.siteId,'99990001');assert.equal(c.kind,'settings');
      const prior=receipts.get(c.operationId);if(prior)return result('settings',prior);
      if(!model.moduleEnabled)return Response.json({ok:false,error:'attendance_platform_paused'},{status:403});
      if(c.expectedVersion!==version)return Response.json({ok:false,error:'attendance_version_conflict'},{status:409});
      settings=c.values as AttendanceAdminSettings;version++;const receipt={operationId:c.operationId,kind:c.kind,targetId:null,version};receipts.set(c.operationId,receipt);
      if(model.lost)return null;return result('settings',receipt);
    },writes:()=>receipts.size,operationIds:()=>[...receipts.keys()],
  };return model;
}
