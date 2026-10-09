# 189漏卡审批委托：冻结开发合同

本批已获用户对188范围的“继续”批准。仅本地开发；默认关闭、无线上授权。根代理负责161权限迁移、原生／浏览器与全量检查，139负责160SQL，137负责新协议／客户端／路由，140负责新UI及最小父接线。修改合同须同步三方。

## 查询与接口

HTTP `/api/merchant-enterprise/attendance/missing-delegation`；POST exact `{query,command}`。GET是query字段平铺，null用统一queryString编码；拒重复／额外键。请求8KiB、响应128KiB、错误4KiB；明确超时／取消、no-store、同源、真实认证。

两个RPC均四参`(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)`。SQL直接接收带access的完整query，不剥字段。

- Owner RPC `faolla_attendance_missing_delegations_v1`，query exact7：`{siteId,access:'owner',mode:'list'|'catalog'|'detail'|'recover',catalog:null|'delegates'|'workers'|'locations',afterId:null|uuid,grantId:null|uuid,operationId:null|uuid}`。
- Delegate RPC `faolla_attendance_delegated_missing_v1`，query exact9：`{siteId,access:'delegate',mode:'grants'|'list'|'detail'|'decide'|'recover',grantId:null|uuid,requestId:null|uuid,operationId:null|uuid,beforeAt:null|UTC6,beforeId:null|uuid,afterId:null|uuid}`。
- Owner catalog/list与delegate grants按UUID升序25+1，用afterId。delegate list仅所选grant内待审、submittedAt/requestId倒序25+1，用成对beforeAt/beforeId。所有分页先范围过滤，不全企业拉取。detail必须精确ID，recover仅operationId，其他指针null。GET不得mode=decide。
- Owner POST grant配list且所有游标null；revoke配detail/grantId。Delegate POST只配decide/grantId/requestId，游标与operationId null。操作号在command，不重复放query。

## 命令

- grant exact11：`{action:'grant',operationId,delegateEmployeeId,delegateAuthUserId,workerId,employeeId,employeeAuthUserId,locationId,validFrom,validUntil,reason}`。grantId=operationId，revision1；每grant精确一主管、一worker、一保存地点。双方身份及地点当前核验，finite UTC6 from<until，不设无依据的最长天数；理由1–200字符、去前后空白、无控制字符。
- revoke exact5：`{action:'revoke',operationId,grantId,expectedRevision:1,reason}`；追加revision2，不改grant旧行。当前owner可在模块暂停时安全撤销。
- decide outer exact3：`{grantId,expectedGrantRevision:1,decision:{action:'approve'|'reject',operationId,requestId,expectedRevision:1,evidenceToken:32hex,reason}}`。旧账本仅存decision exact6，真实delegate为actor；授权sidecar同事务保存。禁止受托者处理自己的申请，不伪owner调103。

## 投影（exact keys）

Grant exact13：`{grantId,revision:1|2,status:'granted'|'revoked',delegate:{employeeId,authUserId,name},worker:{workerId,employeeId,authUserId,name,workerNo},location:{locationId,name,timeZone},validFrom,validUntil,grantedBy,grantedAt,reason,revocation:null|{operationId,actorId,reason,recordedAt},usable:boolean}`。

OwnerResult exact12：`{protocol:'missing-delegations-v1',siteId,actorId,mode,timeZone,canWrite,items:Grant[],catalogItems:CatalogItem[],nextId:null|uuid,detail:null|Grant,receipt:null|OwnerReceipt,readAt}`。

CatalogItem exact6：`{id,name,employeeId:null|uuid,employeeAuthUserId:null|uuid,workerNo:null|string,timeZone:null|string}`。delegates的id=employeeId且Auth非空；workers的id=workerId且employee/Auth/workerNo非空；locations的id=locationId且timeZone非空，其他三项null。Owner catalog必须实际分页，UI可标明“筛选当前页”，不得手填UUID替代选择。

OwnerReceipt exact6：`{operationId,action:'grant'|'revoke',grantId,revision:1|2,recordedAt,commandFingerprint:64hex}`。recover只给回执、items/catalogItems空、detail=null。

DelegateResult exact13：`{protocol:'delegated-missing-v1',siteId,actorId,employeeId,mode,canWrite,grants:Grant[],items:Summary[],nextCursor:null|{at:UTC6,id:uuid},nextId:null|uuid,detail:null|Detail,receipt:null|DecisionReceipt,readAt}`。

Summary exact10：`{requestId,workerId,employeeId,employeeAuthUserId,workerName,locationId,locationName,timeZone,submittedAt,status:'submitted'}`。

Detail=Summary+`{proposal:{startAt:UTC6,endAt:UTC6,breaks:[{startAt:UTC6,endAt:UTC6,paid:boolean}]},reason,evidenceToken:32hex,blocked:boolean,canApprove:boolean,canReject:boolean}`。仅待审详情，不返回范围外lineage／分类冲突，范围外或混合冲突使用泛化blocked。批准／驳回成功后返回receipt-only，不再返回已终结Detail。

DecisionReceipt exact8：`{operationId,requestId,grantId,action:'approve'|'reject',status:'approved'|'rejected',actorId,recordedAt,commandFingerprint:64hex}`。recover/grants/list/detail/decide形状须严格配查询，recover grants/items为空，detail=null，两游标null，不含旧正文／理由／姓名。

HTTP成功为`{ok:true,...Result}`；失败`{ok:false,error:code}`。协议对应access及当前认证身份。canWrite仅控制新grant/approve/reject，revoke独立允许当前owner安全撤权。

## 指纹与原号恢复

SQL SHA256输入为固定标量JSON数组`jsonb_build_array(...)::text`的UTF8；TS以每个标量`JSON.stringify`后用`, `连接并加方括号生成完全相同文本，再WebCrypto SHA-256。不得使用对象键顺序或Node crypto进入浏览器；整数明确转为整数再入数组。

共同前缀3标量：`['attendance-missing-delegation-v1',siteId,access]`。

- grant后续依次：action,operationId,delegateEmployeeId,delegateAuthUserId,workerId,employeeId,employeeAuthUserId,locationId,validFrom,validUntil,reason。
- revoke后续：action,operationId,grantId,expectedRevision(integer),reason。
- decide后续：decision.action,decision.operationId,grantId,expectedGrantRevision(integer),decision.requestId,decision.expectedRevision(integer),decision.evidenceToken,decision.reason。

客户端POST前生成hash并重新检查代次／身份，pending保存原命令＋hash＋原Auth／employee，存储按site/access/actor隔离。未知结果仅GET recover，GET空或错误不清pending，不换号补发。最小receipt匹配原op/action/目标grant/request/hash才可清pending，恢复时不把本地原正文渲染出来。

Delegate recover逐次真实认证，仅原actor且同saved delegateEmployee仍绑定该Auth；员工inactive、角色撤权或grant撤销／过期可取最小回执，身份换绑不可取。普通读／新审批仍要求active角色、权限、有效grant及双方当前身份。Owner recover仍要求当前owner；不向前owner泄露新企业资料。新feature关闭仅允许精确原号GET和当前owner的安全revoke，不暴露新列表／目录。

## 存储、权限与兼容

160新增三张append-only表：grants、revocations、decision authority sidecar；旧entry仅新增实际审批，不回写。旧函数/owner/self协议不替换。新增所需最窄旧request列表索引，沿136预检→CIC→终事务样式；不自动删除或修复异常索引。根代理原生安装按CIC分段，不在外层事务包整文件。

161新增`attendance.missing.review`，依赖`enterprise.view`、`attendance.self.view`，均无默认角色授予。本人查看依赖保证既有员工考勤入口可达，不代表同意授予别人的查看／导出权。授权时主管角色必须显式具备新权限。

遵循merchant SHARE→settings写UPDATE/读SHARE→target worker→稳定UUID顺序employee/role/location的锁序，在锁等待后重新核身份、授权期限、来源、封存；私有103review用real actor且p_owner=true仅启用审核规则，不伪造owner身份。审批和sidecar失败必须整笔回滚；不会给其他审批类别权限。

新开关`FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED`、`NEXT_PUBLIC_FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED`默认关闭；业务资格沿现企业／考勤资格。新UI须有原生modal、dirty/pending离开保护、隐藏清内存、epoch失效、390px可用，不阻断正常打卡／安全下班。

真实审核者保存sidecar并在新受托回执显示本人actor。旧员工结果保留状态／时间／理由，只将两处误导文案改为“负责人或获授权审批人”；本包不宣称原员工页新增了审核者姓名审计界面，也不为此扩第三RPC。

## 第189批最终观察与生命周期边界

不同请求的墙钟时间不保证单调，不要求撤销recordedAt必须大于授予recordedAt。grant的usable是服务端该次观察结论，不用较晚的response readAt在客户端重新计算授权；真实POST仍在取得锁后重验有效期及其他资格。usable列表仍须严格过滤，考勤暂停不返回可用授权。

开关关闭后原号恢复成功会清pending，但已打开弹窗保留最小回执至明确关闭；focus不触发重新提交或丢失回执。明确关闭后没有待确认记录则入口消失。身份、scope或active失效仍立即卸载，保留弹窗不能跨身份继续展示。
