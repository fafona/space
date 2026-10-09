# 第191批：请假／工作安排委托冻结接入协议

用户对190明确范围回复“继续”，仅批准本地实现与验收，未批准生产开通。各代理先完整阅读PROJECT_RULES及190边界。不要改旧SQL／旧RPC，未知情况先协商本文件再实现。根代理独占数据库／浏览器／全量TS；代理仅纯测试／lint。

## 文件所有权

- SQL代理：新162 `merchant_attendance_application_delegation.sql`与其静态测试；不改权限目录／旧迁移。根代理负责163权限目录及native运行。
- 协议代理：新 `merchantAttendanceApplicationDelegation.ts`、`...Client.ts`、`...server.ts`、纯测试、`api/merchant-enterprise/attendance/application-delegation/route-handler.ts`与route.ts；可新增纯fixture model。不要改旧Missing核心。
- UI代理：新ApplicationDelegationPanel／Launcher、Admin／Self父页最小接线、三处旧请假／通知／工作安排文案、UI纯测试及浏览器fixture。根代理负责独立恢复页，不改你的父页。
- 根代理：权限及163、独立恢复入口、原生／浏览器运行与交付。

## 名称、开关与命令

API `/api/merchant-enterprise/attendance/application-delegation`，type前缀 `ApplicationDelegation`，函数前缀`applicationDelegation`／`parseApplicationDelegation`，class `AttendanceApplicationDelegationClient`，常量 `APPLICATION_DELEGATION_*`。

owner RPC `faolla_attendance_application_delegations_v1`；delegate RPC `faolla_attendance_delegated_applications_v1`。参数均 `{p_query,p_auth_user_id,p_command:null|command,p_allow_write:boolean,p_capture_notifications:boolean}`；读操作capture也显式传bool。旧通知采集开关沿Leave.server现有规则，委托server不得默认擅自打开。

开关 `FAOLLA_ATTENDANCE_APPLICATION_DELEGATION_ENABLED`、`NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_DELEGATION_ENABLED`仅精确`1`，默认关闭。关后只允许精确原号GET及当前owner安全revoke，不允许列表／新批准。保持真实密码认证、同源、无缓存和限定request body8KiB／response128KiB／error4KiB。

权限 `attendance.leave.review` 与 `attendance.work_arrangement.review`，均依赖`enterprise.view`、`attendance.self.view`。旧角色不自动授予。

OwnerQuery exact7与189同名形状：`{siteId,access:'owner',mode:'list'|'catalog'|'detail'|'recover',catalog:null|'delegates'|'workers',afterId:null|uuid,grantId:null|uuid,operationId:null|uuid}`。关系约束同189；catalog无locations。

DelegateQuery exact9与189：`{siteId,access:'delegate',mode:'grants'|'list'|'detail'|'decide'|'recover',grantId,requestId,operationId,beforeAt,beforeId,afterId}`。空值和游标约束同189。

GrantCommand exact13：`{action:'grant',operationId,delegateEmployeeId,delegateAuthUserId,workerId,employeeId,employeeAuthUserId,category:'leave'|'work_arrangement',kinds:[],includePending:boolean,validFrom,validUntil,reason}`。leave kinds必须空；work kinds为trip/field/remote非空无重复规范顺序（trip,field,remote）。两类别不可在一个grant混合。时戳6位UTC，reason1–200，禁止自授权。includePending缺失拒绝，默认UI false；false仅request.submitted_at>=grant.recorded_at，true允许此前仍待审，不泄露已终结历史。

RevokeCommand exact5同189：`{action:'revoke',operationId,grantId,expectedRevision:1,reason}`。

DecideCommand exact4：`{grantId,expectedGrantRevision:1,expectedEvidenceFingerprint:64hex,decision}`。
decision是旧命令：leave approve及所有reject exact5 `{action,operationId,requestId,expectedRevision:1,reason}`；work approve exact7再加`expectedConflictsFingerprint:64hex,confirmConflicts:boolean`。类型与选定grant/请求必须服务端核对；不能把外层授权字段写进旧command。

## 结果

CatalogItem exact6同189 `{id,name,employeeId,employeeAuthUserId,workerNo,timeZone}`。仅delegates/workers，timeZone恒null，delegates workerNo null；按真正具备对应审批permission候选发现，grant时复查。

Grant exact15：`{grantId,revision:1|2,status:'granted'|'revoked',delegate:{employeeId,authUserId,name},worker:{workerId,employeeId,authUserId,name,workerNo},category,kinds,includePending,validFrom,validUntil,grantedBy,grantedAt,reason,revocation:null|{operationId,actorId,reason,recordedAt},usable}`。usability是服务端观察，不用较晚readAt重算到期。无location。

Summary exact12：`{requestId,workerId,employeeId,employeeAuthUserId,workerName,category,kind:null|'trip'|'field'|'remote',startAt,endAt,timeZone,submittedAt,status:'submitted'}`。start/end固定3位UTC（与原申请summary），submittedAt6位。

Detail = Summary加 `{reason,evidenceFingerprint:64hex,conflictsFingerprint:64hex,conflicts:[],blocked:boolean,sealed:boolean,canApprove:boolean,canReject:boolean}`。conflict exact5 `{source:'schedule'|'application',kind:null|'leave'|'trip'|'field'|'remote',startAt,endAt,timeZone}`，schedule kind=null，不含来源ID、地点或理由。内核完整来源仍用于指纹。未授权类别／历史来源只能blocked，不返回其摘要，不允许批准。授权内应用按当前有效grant、双身份、includePending时间及kind复核后才允许最小摘要；排班只给目标员工必要时段。leave overlap任何有效已批请假阻批准，避免放宽旧规则。

OwnerReceipt exact6同189 `{operationId,action:'grant'|'revoke',grantId,revision:1|2,recordedAt,commandFingerprint:64hex}`。
DecisionReceipt exact9 `{operationId,requestId,grantId,category,action:'approve'|'reject',status:'approved'|'rejected',actorId,recordedAt,commandFingerprint:64hex}`，不含旧正文／理由／姓名。

OwnerResult exact12同189除protocol：`{protocol:'application-delegations-v1',siteId,actorId,mode,timeZone,canWrite,items,catalogItems,nextId,detail,receipt,readAt}`。
DelegateResult exact13同189除protocol：`{protocol:'delegated-applications-v1',siteId,actorId,employeeId,mode,canWrite,grants,items,nextCursor,nextId,detail,receipt,readAt}`。
HTTP成功`{ok:true,...result}`失败`{ok:false,error}`。recover无列表／正文且所有游标null；receipt匹配原操作／种类／grant／request／hash后才清pending。

## 指纹、持久化和安全

SHA256 UTF8固定标量JSON数组（PG jsonb_build_array::text；TS每标量JSON.stringify以`, `拼接），避免对象键顺序差异。
prefix3 `['attendance-application-delegation-v1',siteId,access]`。
grant tail依次action,operationId,delegateEmployeeId,delegateAuthUserId,workerId,employeeId,employeeAuthUserId,category,kinds.join(','),includePending,validFrom,validUntil,reason。
revoke tail同189；decide tail依次decision.action,decision.operationId,grantId,expectedGrantRevision,expectedEvidenceFingerprint,decision.requestId,decision.expectedRevision,decision.reason,expectedConflictsFingerprint或null,confirmConflicts或null。

pending exact7同189 `{version:1,anchorId,actorId,employeeId,query,command,commandFingerprint}`，key `faolla:attendance:application-delegation:v1:${siteId}:${access}:${anchorId}`。owner anchor为auth，delegate为employee。独立恢复页由根代理读取已知本机pending、严格解析和hash，核真实当前auth，调用现有client仅initialize/recover，不load不POST，不显示本地理由。可同时处理189missing同协议形状。不迁移旧leave/work pending。

新增3张append-only表名称`merchant_attendance_application_delegations`、`..._revocations`、`..._decisions`。真实actor旧entries、新sidecar及按原开关的请假notification同事务；任何失败全回滚。旧owner/self函数及历史command不可改变。不伪owner、不绕过旧身份／在职／冲突校验，不改工时／工资／余额。

新委托approve一律检查period_assert_open；旧owner leave不顺改。reject不因封存一概拒绝，仍禁止自处理及失效scope。merchant SHARE→settings写UPDATE/读SHARE→targetworker→稳定UUID employee／roles锁序，等待后复核；委托获取与旧owner决定共用settings写锁确保唯一决定。分页先授权再limit25+1，复用已有self列表窄索引，不加无必要索引或复制数据库。旧owner恢复维持当前owner；delegate最小恢复允许同身份撤权/停用但换绑拒绝。

## client/UI约定

client方法沿189 `initialize,load,catalog,next,choose,openGrant,list,openRequest,grant,revoke,decide,recover,pause,invalidate,hasLeaveRisk`（按189实际API名称，无关不存在者不强加）。choices只delegate/worker。grant输入category/kinds/includePending/validFrom/validUntil/reason；decide(action,reason,confirmConflicts)显式确认已显示摘要。UI可按现有client实际签名与协议代理协调，不能私改ABI。

异常码新前缀`attendance_application_delegation_invalid/too_large/not_found/disabled/evidence_changed`，通用及leave/work/period旧错误纳入白名单。SQL不得泄漏内部异常详情。真实浏览器/native由根代理集中运行；代理可以实现fixtures但不启动运行环境。全部变更使用apply_patch。
