# 238 首次补正审批委托：冻结实施合同

用户对237结尾列出的四项本地实施范围回复“继续”，批准按推荐边界实施。默认关闭、仅合成验收，不开通真实角色／资料，不部署。此包完成C03剩余审批中的首次补正approve/reject；连续修订、正式异常及其他管理动作仍按有限清单继续，不冒称C03已全部完成。

## 文件与接口

- 139：新增189 `202610080189_merchant_attendance_correction_delegation.sql`，SQL静态及独立真实原生夹具；不启动库，不改旧迁移文件。可在189内兼容替换现account_capture，将新授权表纳入两处早退存在检查，其余分支和旧权限保持。
- 协议代理：新增 `merchantAttendanceCorrectionDelegation.ts`、`...Client.ts`、`...server.ts`及纯测试，拥有新API route-handler/route及路由测试。
- UI代理：新增CorrectionDelegationPanel/Launcher及测试，企业Admin/Manager父接线、独立恢复入口；不改旧审批客户端／SQL。
- 根：190权限迁移、merchantEnterprise目录、统一类型／本地原生／浏览器检查、资源及交付记录。

HTTP `/api/merchant-enterprise/attendance/correction-delegation`；前后开关 `FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED`／`NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED`，精确1。请求8KiB、响应128KiB、错误4KiB、fetch+body共12秒。沿既有同源／严格JSON／真实Auth／企业资格，不以owner身份代发。新权限 `attendance.correction.review`，只依赖enterprise.view，无默认角色授予；主管无需自己的worker或self.view。服务器新写关闭后允许当前身份原号GET、当前owner只读list/detail及安全撤权；关闭catalog/新grant，delegate仅原号恢复。前端入口仍默认关闭，不因此暴露未安装功能；已开启的候选UI遇server暂停时仍可只读撤权。

Owner RPC `faolla_attendance_correction_delegations_v1`；delegate RPC `faolla_attendance_delegated_corrections_v1`，均参数`(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)`。

OwnerQuery exact7、DelegateQuery exact9，沿MissingDelegation字段与关系：

```
owner: {siteId,access:'owner',mode:'list'|'catalog'|'detail'|'recover',catalog:null|'delegates'|'workers'|'locations',afterId:null|uuid,grantId:null|uuid,operationId:null|uuid}
delegate: {siteId,access:'delegate',mode:'grants'|'list'|'detail'|'decide'|'recover',grantId:null|uuid,requestId:null|uuid,operationId:null|uuid,beforeAt:null|UTC6,beforeId:null|uuid,afterId:null|uuid}
```

列表25+1，owner目录／grant按UUID升序；待审按submittedAt/requestId降序。先授权／范围过滤再limit。不自动翻页。GET不得decide。ownergrant配初始list，revoke配detail/grantId；delegate POST配decide/grantId/requestId，query各操作号／游标null。

## 命令与固定投影

GrantCommand exact12：`{action:'grant',operationId,delegateEmployeeId,delegateAuthUserId,workerId,employeeId,employeeAuthUserId,locationId,includePending:boolean,validFrom:UTC6,validUntil:UTC6,reason}`。grantId=operationId、revision1；每grant精确一主管、一worker、一保存地点，finite有效期from<until且授予时until大于锁后当前时刻，不擅加最大天数；includePending必须显式，UI默认false，false仅显示grant.recorded_at之后提交的申请。双方身份／地点／当前角色及双暂停代次在授予和使用时核验；不拼多个grant范围、不自审批。reason1–200字符，trim且无控制字符。

RevokeCommand exact5：`{action:'revoke',operationId,grantId,expectedRevision:1,reason}`；追加revision2。

DecideCommand exact3：`{grantId,expectedGrantRevision:1,decision}`。decision采用旧096六字段原命令：`{action:'approve'|'reject',operationId,requestId,expectedRevision:positive safe integer,expectedEvidence:32hex,reason:1–500}`。不把授权字段塞进旧command。原审批及新授权旁证同事务保存真实delegate，任何失败全回滚。

CatalogItem exact6同Missing：`{id,name,employeeId,employeeAuthUserId,workerNo,timeZone}`；分目录的null规则不变，只列实际具备新能力的主管。

Grant exact14：`{grantId,revision,status,delegate,worker,location,includePending,validFrom,validUntil,grantedBy,grantedAt,reason,revocation,usable}`。delegate/worker/location/revocation子字段与Missing完全同形；usable是SQL本次观察，不用readAt在浏览器重新算时间。

Summary exact12：`{requestId,startEventId,revision,workerId,employeeId,employeeAuthUserId,workerName,locationId,locationName,timeZone,submittedAt,status:'submitted'}`。

Detail=Summary加exact8：`{original,proposal,reason,evidenceToken,blockers,blocked,canApprove,canReject}`。original/proposal均为既有CorrectionProposal `{startAt,endAt,breaks:[{startAt,endAt,paid}]}`，时戳UTC6。original据完整原始basis真实clock/break事件投影，不伪造缺失尾；不满足完整原始段则拒绝详情。blockers沿decision_checks_v2，但涉及范围外邻接资料只给泛化`scope_unavailable`，不返回额外人员／事件／理由。blocked表示存在阻批准条件；canReject沿旧只拒已撤回／已决定／身份变化／自审批等条件，再加当前grant/资格。canApprove=true仅blocked=false且当前开关/授权允许；blocked可true而canReject=true。

**地点按保存原始basis和本次actual currentBasis判断，不按worker当前门店。** 返回给主管的所有事件须同grant地点；外部previous/next只参与内部旧重叠核验，不返回其内容。不能从owner RPC套完整DTO；新私有采集器复用083basis/085固定规则/096checks，验证后仅返上述最小投影。跨地点原始段不是本grant可见对象，列表和详情均不泄露。审批不能绕过150封存INSERT触发器或旧有效来源CAS。

OwnerReceipt exact6：`{operationId,action:'grant'|'revoke',grantId,revision:1|2,recordedAt,commandFingerprint:64hex}`。
DecisionReceipt exact8：`{operationId,requestId,grantId,action:'approve'|'reject',status:'approved'|'rejected',actorId,recordedAt,commandFingerprint:64hex}`。

OwnerResult exact12同Missing，protocol=`correction-delegations-v1`。
DelegateResult exact13同Missing，protocol=`delegated-corrections-v1`。
HTTP `{ok:true,...result}`，错误`{ok:false,error}`。保存决定返回receipt-only；recover仅最小回执，不重采旧申请正文，不携带旧理由／姓名。

## 指纹、存储、恢复、并发

SHA为PG固定标量JSON数组`::text`的UTF8，TS逐标量JSON.stringify后以`, `拼接。前缀`['attendance-correction-delegation-v1',siteId,access]`。
- grant tail依次action,operationId,delegateEmployeeId,delegateAuthUserId,workerId,employeeId,employeeAuthUserId,locationId,includePending,validFrom,validUntil,reason。
- revoke tail依次action,operationId,grantId,expectedRevision,reason。
- decide tail依次decision.action,decision.operationId,grantId,expectedGrantRevision,decision.requestId,decision.expectedRevision,decision.expectedEvidence,decision.reason。

Pending同Missing exact7：`{version:1,anchorId,actorId,employeeId,query,command,commandFingerprint}`。key `faolla:attendance:correction-delegation:v1:${siteId}:${access}:${anchorId}`；owneranchor Auth，delegateanchor employee，actor永为Auth。保留未知原号，不自动POST，不显示本地原理由；只有原actor+相同savedemployee/Auth可最小恢复，停用／撤权／到期不扩大读写资格，换绑拒绝。此包不得改旧correction／revision pending槽。

商户SHARE→settings写UPDATE/读SHARE→目标worker→稳定UUID两employee/role锁序，等待后重核身份、epoch、期限、完整范围和旧证据。旧owner审批仍用原函数和结果，所需原表新增真实业务行，不回写历史。新旁证须禁止伪造/改写/截断，helper不向service_role直接授权；仅两个入口RPC可执行。新表缺少旧权限/记录不作自动修复。

新错误前缀`attendance_correction_delegation_invalid/too_large/not_found/disabled`；兼容实际096/150/原规则错误，服务端白名单拒绝内核细节。

## 页面与有限验收终点

实际负责人目录选择→授予／撤销；主管独立入口→授权→待审→原始与申请对照→明确approve/reject；自身不能操作，无自己worker主管可达。dirty/pending/outer leave guard、隐藏／scope失效、390px、独立恢复不依赖现权限。实际同号重放、旧owner路径、越界／自审批／过期／暂停恢复后旧epoch拒绝、成功后损坏响应仅原号GET恢复各有证据。只对本次新增共享锁风险作必要竞争，不重跑无关所有矩阵。默认关闭，真实账号／手机、其他C03动作和生产另列。
