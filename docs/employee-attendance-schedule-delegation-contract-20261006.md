# 第198批主管排班委托冻结协议

用户已对197明确范围回复“继续”，批准本地实现／验收，未授权生产开通。所有代理先完整读PROJECT_RULES和197边界。根代理独占本地DB／浏览器／全量TS；代理只运行纯测试／lint。原源码脏工作区保留，只使用apply_patch。

## 所有权

- SQL代理137：新167迁移及静态测试；仅前向兼容136guard、137slot、120overview、128sources、164capture五处旧函数，不编辑旧迁移、不改旧delegation_epochs。
- 协议代理139：新ScheduleDelegation core/server/client/route-handler/route、协议与客户端测试及model fixture。不改旧协议。
- UI代理140：新Panel/Launcher、Admin/Self最小接线、UI测试及browser fixture；先按本文接口，可直接与139协调client方法。
- 根：168权限目录/merchantEnterprise、独立恢复、新native fixture/driver、运行验证和交付文档。

## API与开关

`/api/merchant-enterprise/attendance/schedule-delegation`，统一RPC `faolla_attendance_schedule_delegation_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean)`。
前缀ScheduleDelegation/parseScheduleDelegation；常量SCHEDULE_DELEGATION_*；class AttendanceScheduleDelegationClient。

服务端精确`FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED=1`且命中`FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_SITES`（64个8位编号，4096字符上限，无通配）才允许新grant/publish/cancel；UI `NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED`只控制新入口。当前owner可关开关后读已有授权及明确revoke，原号recover始终按真实原Auth最小读取。新delegate普通列表／schedule还要求开启。全新权限`attendance.schedule.publish`和`attendance.schedule.cancel`，均依赖enterprise.view及attendance.self.view，旧角色不自动授予。

route GET/POST真实强Auth、同源/canonical、no-store、限流、request 8KiB/response128KiB、严格UTF8/duplicate JSON/unknown keys。recover跳过当前entitlement；owner revoke也可不依赖当前模块开通。其他请求取模块资格生成allowWrite，SQL实际owner/delegate授权不可由body提供。

## 查询与命令

Query exact9：`{siteId,access:'owner'|'delegate',mode:'list'|'catalog'|'detail'|'grants'|'schedule'|'recover',catalog:null|'delegates'|'workers'|'locations',grantId:null|uuid,afterId:null|uuid,fromDate:null|date,throughDate:null|date,operationId:null|uuid}`。
owner仅list/catalog/detail/recover；delegate仅grants/schedule/recover。list/grants允许afterId；catalog需catalog且允许afterId；detail需grantId；schedule需grantId及日期范围≤31个日期；recover只需operationId、其余定位字段为null。无关字段必须null。HTTP可省null参数，未知/重复参数拒绝。

Owner grant exact13：`{action:'grant',operationId,delegateEmployeeId,delegateAuthUserId,workerId,employeeId,employeeAuthUserId,locationId,actions:['publish'|'cancel'],includeExistingFuture:boolean,validFrom,validUntil,reason}`。actions非空无重复且固定publish/cancel顺序；时间6位UTC；reason1–200；禁止自管理。新grant自身保存双方epoch generation，零只在无epoch时真实采集，不容缺采证。
Owner revoke exact5：`{action:'revoke',operationId,grantId,expectedRevision:1,reason}`。
Delegate command exact2：`{expectedGrantRevision:1,decision:旧ScheduleCommand}`。decision保持旧8键publish或6键cancel形状。使用query.mode=schedule及query.grantId，POST query.operationId=null。grant POST query.mode=list无cursor；revoke POST query.mode=detail并与command.grantId一致。

新内部原排班query仍exact6 `{siteId,access:'delegate',workerId,fromDate,throughDate,operationId:null}`；原command保持旧shape，不塞grantId。新不可变authority operation旁证绑定新外层query/command、旧query/command、真实Auth及grant。不能假传owner调用099/136。全事务写原schedule账本、slots/cancellations、旁证及强制136发布证据。

## 响应

Grant exact15：`{grantId,revision:1|2,status:'granted'|'revoked',delegate:{employeeId,authUserId,name},worker:{workerId,employeeId,authUserId,name,workerNo},location:{id,name,timeZone},actions,includeExistingFuture,validFrom,validUntil,grantedBy,grantedAt,reason,revocation:null|{operationId,actorId,reason,recordedAt},usableActions:[]}`。usableActions为当前可用动作子集，不在浏览器以较晚readAt重算。
CatalogItem exact6沿191：`{id,name,employeeId:null|uuid,employeeAuthUserId:null|uuid,workerNo:null|string,timeZone:null|string}`；delegates/workers带双身份，locations只id/name/timeZone。owner分页每页25+1；delegate与worker均绑定真实Auth，不制造worker。
Entry exact14：`{slotId,revision,workerId,locationId,timeZone,workDate,startAt,endAt,publishedAt,publishedBy,cancelled,cancelledAt:null|UTC6,cancelledBy:null|uuid,canCancel}`。start/end为UTC3分钟，publishedAt等UTC6，不返回申请正文或范围外班次细节。
Schedule exact9：`{grant,revision,settingsVersion,timeZone,workerVersion,locationVersion,readAt,entries:Entry[],rangeLimited}`；timeZone为当前授权location时区。31日期内最多100+1；超限entries=[]且rangeLimited=true，不用部分结果宣称完整；禁止此状态发新写。
Receipt exact8：`{operationId,action:'grant'|'revoke'|'publish'|'cancel',grantId,grantRevision:1|2,scheduleRevision:null|positiveInt,actorId,recordedAt,commandFingerprint:64hex}`。grant/revoke scheduleRevision=null；publish/cancel grantRevision=1且scheduleRevision对应原排班命令。无正文/理由。
Result exact14：`{protocol:'schedule-delegation-v1',siteId,access,actorId,employeeId:null|uuid,mode,canWrite,grants:[],catalogItems:[],nextAfterId:null|uuid,detail:null|Grant,schedule:null|Schedule,receipt:null|Receipt,readAt:UTC6}`。owner employeeId=null；delegate正常及recover为当前匹配成员ID。recover/POST仅receipt，不夹带列表或详情；无记录recover receipt=null，不代表未执行。owner detail只detail，schedule只schedule，list/grants只grants，catalog只catalogItems。

## 指纹/本地意图

SHA256 UTF8标量数组，PG jsonb_build_array::text；TS每个标量JSON.stringify再以`, `连接。
通用前缀`['attendance-schedule-delegation-v1',siteId,access]`。
grant tail：action,op,delegateEmployee,delegateAuth,worker,employee,employeeAuth,location,actions.join(','),includeExistingFuture,validFrom,validUntil,reason。
revoke tail：action,op,grantId,expectedRevision,reason。
delegate tail：decision.action,op,query.grantId,expectedGrantRevision,query.fromDate,query.throughDate,expectedRevision,expectedSettingsVersion,reason,locationId或null,timeZone或null,JSON.stringify(slots)或null,slotId或null。SQL slots字段用紧凑JSON数组字符串（须与TS逐对JSON.stringify、逗号无空格相同，不能剥理由内空格）。

pending exact7沿191：`{version:1,anchorId,actorId,employeeId:null|uuid,query,command,commandFingerprint}`，owner anchor=Auth/employeeId=null；delegate anchor=employeeId/actorId来自首次响应真实Auth。key `faolla:attendance:schedule-delegation:v1:${siteId}:${access}:${anchorId}`。必须先精确持久化再只发一次POST。未知仅原号GET，不重POST；核对actor/hash后清pending。切Auth/epoch/存储CAS变化不误删。严格确认的无写拒绝可按196方案清除本次精确意图并要求重新读取，不以普通Error.message作证。

## 权限与历史兼容

新写 merchant SHARE→settings UPDATE→worker→稳定顺序成员／角色及地点锁；锁后重查当前owner、双方身份/role/代际、grant期限、动作及范围。新grant保存双方generation；164capture识别新grant涉及双方（含无worker主管及flag回退），不改旧epoch表。旧两类grant继续原语义。
授权时要求目标当前默认地点；发布必须仍是默认地点并保留旧任职/重叠/分钟/未来180天护栏。取消只在保存地点、目标双身份、授权期限内且尚未开始；授权前已存在未来slot需includeExistingFuture，强制136保存双身份。当前目标/主管停用或任一epoch.paused不允许新操作；原owner取消不变。
四个旧历史helper新分支验证保存的不可变authority旁证，不能使用当前grant usable，不能因撤权/过期/暂停破坏旧排班及下游。原owner分支/shape保持；140权限不放宽、旧归档原字节保留。旧099/136owner writer不替换。

新errors前缀attendance_schedule_delegation_invalid/disabled/not_found/too_large/changed；另有旧schedule/version/operation/account等真实码按明确白名单，未知内部SQL信息统一unavailable。独立恢复仅固定新endpoint GET；仍严格原actor及当前相同成员/Auth，不受撤权/停用/flag回退影响，不返回人员目录。
