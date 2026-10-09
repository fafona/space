// Only for the ownership-checked temporary schema in the reused local PG cluster.
// Auth service and non-attendance bootstrap remain synthetic. Attendance business
// replies come from real service executors / migration RPCs, never a UI model.
import assert from "node:assert/strict";
export const databaseId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const databaseActors=[{id:databaseId(99),email:"owner-entry@example.test"},{id:databaseId(1),email:"employee-a@example.test"},{id:databaseId(2),email:"employee-b@example.test"}];
const literal=(value:unknown)=>value===null||value===undefined?"null":"'"+String(value).replaceAll("'","''")+"'";
const json=(value:unknown)=>value===null||value===undefined?"null":literal(JSON.stringify(value))+"::jsonb";
export function createAttendanceDatabaseTransport(exec:(sql:string)=>string){
  const state={moduleEnabled:true};
  const calls:{name:string;actor:string;operationId:string|null;command:unknown}[]=[];
  const errors:string[]=[];
  const rpc=async(name:string,args:Record<string,unknown>)=>{
    assert.equal(args.p_site_id,"99990001");assert(databaseActors.some(a=>a.id===args.p_auth_user_id));
    const params=[literal(args.p_site_id),literal(args.p_auth_user_id)];
    if(name==="faolla_attendance_self_v1")params.push(json(args.p_command),literal(args.p_operation_id));
    else if(name==="faolla_attendance_admin_v1")params.push(json(args.p_query),json(args.p_command),literal(args.p_operation_id));
    else if(name==="faolla_attendance_self_history_v1")params.push(json(args.p_query));
    else throw Error("database_browser_unexpected_rpc");
    const command=args.p_command as {operationId?:string}|null;
    calls.push({name,actor:String(args.p_auth_user_id),operationId:command?.operationId??(args.p_operation_id as string|null)??null,command:args.p_command??null});
    try{
      const reply=JSON.parse(exec(`set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${params.join(',')}));`));
      assert.equal(reply.role,"service_role");return {data:reply.data,error:null};
    }catch(e){
      const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];
      if(!code){errors.push(String(e).slice(0,1600));throw e;}
      return {data:null,error:{message:code}};
    }
  };
  const serveShell=async(request:Request,authUserId:string)=>{
    const url=new URL(request.url),siteId="99990001";
    assert(databaseActors.some(a=>a.id===authUserId));
    const owner=exec(`select count(*) from public.merchants where id='${siteId}' and user_id=${literal(authUserId)};`)==="1";
    const employee=JSON.parse(exec(`select coalesce((select jsonb_build_object('id',e.id,'displayName',e.display_name,'email',e.email,'roleId',r.id,'roleName',r.name,'version',r.version,'permissions',r.permissions)
      from public.merchant_enterprise_employees e join public.merchant_enterprise_roles r on r.id=e.role_id and r.merchant_id=e.merchant_id
      where e.merchant_id='${siteId}' and e.auth_user_id=${literal(authUserId)} and e.status='active' and r.status='active'),'null'::jsonb);`));
    if(!owner&&(!employee||!employee.permissions.includes('enterprise.view')))return Response.json({ok:false,error:"merchant_employee_access_denied"},{status:403});
    if(url.pathname==="/api/merchant-enterprise/employees/accept"){
      assert.equal(request.method,"POST");assert.deepEqual(await request.json(),{siteId});assert(employee);return Response.json({ok:true});
    }
    assert.equal(request.method,"GET");
    if(url.pathname==="/api/merchant-enterprise/memberships"){
      assert(employee);return Response.json({ok:true,memberships:[{siteId,siteName:"合成企业",employeeId:employee.id,displayName:employee.displayName,roleId:employee.roleId,roleName:employee.roleName,status:"active",enterable:true}]});
    }
    assert.equal(url.searchParams.get('siteId'),siteId);
    const actor=owner?{type:"owner",id:authUserId,siteId,displayName:"合成负责人",email:databaseActors[0].email,permissions:[],accessScope:"all",allowedBoardIds:[]}:
      {type:"employee",id:employee.id,siteId,displayName:employee.displayName,email:employee.email,permissions:employee.permissions,accessScope:"all",allowedBoardIds:[]};
    if(url.pathname==="/api/merchant-business/capabilities"){
      assert(employee);return Response.json({ok:true,schemaVersion:1,actor:{type:"employee",displayName:employee.displayName,principalKey:`employee:${employee.id}`,authorizationVersion:`${employee.version}:1`},
        cacheNamespace:`database-${employee.id}-${employee.version}`,collaborationPermissions:employee.permissions,permissions:[],workspace:{siteId,siteName:"合成企业",siteCountryCode:"ES"}});
    }
    assert.equal(url.pathname,"/api/merchant-enterprise/overview","database_browser_unexpected_shell_endpoint");
    return Response.json({ok:true,actor,needsBootstrap:owner,snapshot:{roles:[],employees:[],boards:[],columns:[],tasks:[]}});
  };
  return {state,calls,errors,rpc,serveShell};
}
