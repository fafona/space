# 第132批：考勤组与归组记录 v1 契约

状态：第132批本地验收完成；未发布、开关默认关闭。只新增负责人分组，不改变旧打卡、排班、规则分类、审批、工资、角色或worker/settings值。原实现缺少group实体，因此不复用任务团队或旧规则writer。验收结果和实际证据边界见实施记录第132批。

## 业务语义

- 分组对象为考勤worker档案。只允许当前商户负责人。组名称/说明/允许新增归组(active)可保存版本；停用不清已有归属。没有自动默认组或批量导入。
- 归组是企业日期标签：起止含末日，endsOn=null为无固定结束，2000..2100；保存企业timeZone和settingsVersion快照。验证有限端点真实存在，但不推导UTC打卡生效时刻、不检查任职覆盖或生成计薪时长。以后时区变化不重解释旧标签。
- 同worker所有未撤销记录的日期标签不许重叠，跨组也一样。同日交接冲突；10/31结束与11/01开始允许。只对当前记录判冲突，不是历史as-of查询。
- assign -> end（只给原无固定结束的记录指定末日，保留之前日期）或cancel（整段撤销）；end后可cancel。最多3个版本。cancel不是离组，UI须明确整段作废且保留历史。正常换组先结束旧长期归组，再新增后续归组，两次明确操作；不声称原子调组。
- assign需group.active和worker.active；核对当前group/worker/settings版本与时区。结束/撤销只核本记录revision，不因group/worker停用而阻止历史处理。当前owner每次核验。保存group不需要打卡enabled。
- worker姓名/工号/employeeId随归组保存快照；读旧归组不改成当前人名，不给员工新增自助权限。管理UI应区分历史标签与当前选中档案。
- 平台暂停拒绝所有新写，允许当前有权者GET及精确同actor旧命令重放。每一写操作用merchant SHARE -> settings UPDATE -> group/worker锁序；GET settings SHARE。不要改settings版本。

## 名称与权限

- 新124迁移：202610030124_merchant_attendance_groups.sql
- 4私有表：merchant_attendance_groups（当前投影）、merchant_attendance_group_operations（不可变）、merchant_attendance_group_assignments（当前投影）、merchant_attendance_group_assignment_operations（不可变）。当前投影更新不删除旧操作/快照；不触碰旧表值。
- RPC faolla_attendance_groups_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)。只service_role EXECUTE；表无API直读写权限，helper私有，RLS；仅新表索引。
- /api/merchant-enterprise/attendance/groups；新GROUPS前后端flags。认证、源站、权益、限流、12秒/128KiB/4KiB错误体沿Calendar模式。无自动轮询。

## 精确DTO（所有对象禁额外字段）

Query exact8:
siteId, view ('groups'|'members'|'context'), groupId:null|UUID, workerId:null|UUID, onDate:null|date, assignmentId:null|UUID, operationId:null|UUID, cursorId:null|UUID。
- groups: group/worker/date/assignment/op均null，cursor可null或UUID；列表全部组（含停用）ID降序25+1。
- members: group或worker至少一个非null，可同时；assignment/op均null；onDate可null（所有区间）或一个日期；cursor可UUID。列表包含撤销记录，按当前投影有效起止日期筛选，ID降序25+1。不叫在组总人数。
- context: onDate/cursor null；group/worker/assignment/op可null。assignmentId要求groupId及workerId非null。没有已知op时不自动读列表。
- POST view=context，operationId=null。save_group新建expectedRevision0时query.groupId=null；更新时query.groupId=command.groupId；worker/assignment=null。assign时query.groupId/workerId=command目标，assignment=null。end/cancel时query.assignmentId=command.assignmentId，group/worker必非null。

Commands:
- save_group exact8: operationId,action:'save_group',groupId,expectedRevision（0新建，>0更新）,name（trim1..80码点无C0/DEL/C1）,description（trim0..200码点无control）,active:boolean,reason（trim1..200码点无control）。新建groupId=operationId。
- assign exact11: operationId,action:'assign',groupId,workerId,expectedGroupRevision,expectedWorkerVersion,expectedSettingsVersion,timeZone,startsOn,endsOn,reason。assignmentId=operationId。
- end exact6: operationId,action:'end',assignmentId,expectedRevision:1,endsOn:date,reason。仅当前assigned且endsOn=null，endsOn>=startsOn且在历史timeZone存在。
- cancel exact5: operationId,action:'cancel',assignmentId,expectedRevision:1|2,reason。
- 数字安全范围正数<=9007199254740990；save_group命令expectedRevision<=9007199254740989，group当前revision最高990。UUID/8位site/UTC6微秒canonical沿Calendar。

GroupItem exact7:
groupId,revision,name,description,active,createdAt,updatedAt。

GroupWorker exact6:
workerId,workerName（1..120）,workerNo（1..40）,employeeId:null|UUID,version,active。

AssignmentItem exact14:
assignmentId,groupId,groupName（归组时快照1..80）,workerId,workerName,workerNo,employeeId:null|UUID,timeZone,startsOn,endsOn,createdAt,updatedAt,revision:1|2|3,status:'assigned'|'ended'|'cancelled'。
- assigned仅revision1；ended仅revision2且endsOn非null；cancelled为rev2或3。updatedAt>=createdAt。

AssignmentDetail exact17 = AssignmentItem + history,canEnd:boolean,canCancel:boolean。
- history数组长度=revision且1..3；每项exact2 {command:非save_group命令,item:AssignmentItem}。第一项assign、后面只允许end/cancel；最后item与当前detail summary一致。时间递增（允许相同微秒）。固定身份/组/开始日/创建时刻均保持。只有end能将原null endsOn改成合法日期，cancel保留上一版日期。
- canEnd只能当前assigned且endsOn=null；canCancel只能未cancelled。平台gate仍单独控制所有write。

Result exact12:
protocol:'groups-v1',siteId,actorId,settingsVersion,timeZone,view,group:null|GroupItem,worker:null|GroupWorker,items:(GroupItem[]或AssignmentItem[]),nextCursor:null|UUID,detail:null|AssignmentDetail,receipt:null|{command:Command,item:GroupItem|AssignmentItem}。
- group/worker对应query所选当前上下文；没有选择也不返回，唯一例外query无group的初次save_group收据恢复/POST可返回其group。新建无成功receipt时group仍null。
- 所有context/POST items=[]，nextCursor=null。groups列表结果group/worker/detail/receipt=null。members只有选中的group/worker、items，detail/receipt=null。
- detail只为query.assignmentId或assignment类receipt/POST返回；必须同时匹配所选group/worker。group当前名可以与assignment.groupName历史快照不同。
- receipt pin operationId、精确命令；group receipt revision=expected+1，与currentgroup ID/createdAt一致，currentrevision>=receipt，same revision时summary全等；assign/end/cancel receipt item必须在detail.history同revision精确匹配。POST必须receipt。
- 未知/其他actor operation GET receipt=null；同actor op但显式query scope不匹配则attendance_group_not_found404。其他actor POST同号冲突409；转移owner后不能继承旧收据。
- operationId在两种操作账本间也不能重复使用：持settings锁后同时查两表，旧号换action必须冲突，不准分别写成两个动作。若同号已出现在两表则拒绝为invalid。
- HTTP exact额外ok:true,moduleEnabled:boolean。

Errors: attendance_group_not_found404, attendance_group_inactive409, attendance_group_worker_inactive409, attendance_group_overlap409, attendance_group_closed409, attendance_group_invalid503；另Calendar通用invalid_request400/access_denied403/settings_required409/platform_paused403/version_conflict409/operation_conflict409/unavailable503/rate_limited429/not_available404/body_too_large413/invalid_content_type415。

## TypeScript与客户端

merchantAttendanceGroups.ts exports GroupsQuery/GroupsCommand/GroupItem/GroupWorker/GroupAssignmentItem/GroupAssignmentDetail/GroupsResult/GroupsResponse, GROUPS_ERRORS, parseGroupsQuery/HttpQuery/Command/Body/Result/Response, parseGroupItem/parseGroupAssignmentItem/Detail, groupsQueryString/sameGroupsCommand, groupDate/groupRange(startsOn,endsOn,timeZone?)。

AttendanceGroupsClient({siteId,ownerId,apiFetch,storage,randomId?,timeoutMs?})，state phase idle/loading/ready/saving/unconfirmed/blocked,result,pending,message。
- initialize(): 无pending读groups首页；pending读原query+op。groups()仅在无pending时返回groups首页，pending恢复使用initialize/retry；next()沿当前列表。
- context(groupId:null|UUID,workerId:null|UUID=null) 读context；members({groupId:null|UUID,workerId:null|UUID,onDate:null|date})明确查列表；detail(assignmentId)沿selectedgroup/worker，若按group列表未选worker则从当前item提取worker。
- saveGroup({name,description,active,reason})：currentgroup则更新，否则newID=op；assign({startsOn,endsOn,reason})需要currentgroup+worker。end(endsOn,reason)、cancel(reason)针对detail。retry/pause同Calendar。
- pending完整保存{siteId,ownerId,query,command}；storageKey faolla:attendance:groups:v1:site:owner。存储验证后写，GET查旧号，原号明确重试，generation/hidden拒迟到。

## UI与验收

- 独立owner-only GroupsLauncher/Panel，AdminPanel新default-off入口及相同active-unmount guard；旧主form/状态不修改。
- 列表显示group.name/active，选组后可修改定义、查看归组记录；独立admin workers25分页选择当前档案，随后groups context拿version/身份。沿旧admin筛选，只能选已关联员工、默认地点且有任职记录的档案；不更改旧读取范围。已归组后解绑或停用的历史仍可从组记录详情查看及结束／撤销。明确查询不要每次输入自动请求。
- 分配、结束、整段撤销均预览/明确确认，长时归组结束≠撤销，日期查询不冒充historical as-of；组停用不移除原成员。历史快照与当前选人标签区分。390px、dirty/pending关闭告知、hidden清屏。
- 复用现PG15 owned sandbox，root唯一服务运行者，不创建大build/cluster/screenshot。native需实际RPC产生组/归组，25+分页、跨组重叠/相接、end保留历史+新组后续、cancel、停用/改名/转owner、paused replay、时间边界、ACL/账本不可变、真实并发交叉组同worker冲突。
- prepareGroupsNativeFixture(native,scope)仅合成merchant/settings/worker/employee等基础，零group/assignment；提供site,owner,foreign,other,workerId,otherWorkerId,inactiveWorkerId,exec,sql,queryInput,read,call,save,assign,end,cancel,fingerprint,protectedFingerprint。
- Browser真实新launcher/SDK/defaulthandler/serviceSQL，合成Auth/entitlement/本机传输，明确不是真实生产/手机。本轮代码lint/tsc+目标单测+全attendance回归；基线恢复/服务停止。
