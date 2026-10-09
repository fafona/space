# 193 实现契约：账号停用与考勤暂停

2026-10-06。用户已在192边界说明后确认继续，授权该范围本地实现；不部署、不连接生产、不改真实用户数据。实现中的固定接口约定，验收结果另记。

## 业务边界

- 保留当前企业紧急停用、任务交接和权限校验。只影响当前 merchant membership，不动全局 Auth。
- 停用与暂停同事务。无自动 clock_out、任职日期变更、申请决定、历史修改。
- 当前企业已存在考勤配置且员工关联 worker 或持有考勤委托时，服务器显式 opt-in 才首次联动；已有暂停历史的员工以后仍受保护，不因关开关绕过。
- 暂停保存 employee/Auth、可空 worker、原 worker.active、原始最后事件、真实 actor 与代际。无自己 worker 的受托员工也必须永久失去旧委托，但不得创建虚假 worker。
- 账号 active 不自动恢复考勤。owner 明确核验同一 employee/Auth/worker 才解除暂停，worker 恢复到暂停前的 active 值（原本 false 仍为 false）。无 worker 的纯受托人只能解除其授权暂停，不创建档案。
- PIN 当前凭证永久撤销并递增 revision；旧未消费租约不能使用。两种委托以双方 employee 的精确 generation 证明失效，不按时间猜测、不循环撤销全部旧 grant。既有历史回执不按现有授权重新解释。
- 服务器不能枚举其他浏览器的未知操作编号。页面明确该限制，不显示“未知操作为0”。

## 现有员工更新的窄扩展

保留 `faolla_update_merchant_enterprise_employee_v1(p_input jsonb)` 返回的原 employee shape。新增可选键：

- `attendance_operation_id`：UUID；只允许纯 status active/disabled + 可选 offboarding_mode/replacement_employee_id，不能混入角色/姓名修改。
- `attendance_suspension_enabled`：服务器布尔；请求体不得直接决定。无开关、无新增编号的旧 Store 调用不增加键。

外层锁序 merchant SHARE → attendance settings UPDATE（存在时）→ 原企业 task/employee/role 锁 → worker UPDATE → PIN。未获得原子授权/成功前不写暂停。暂停失败须连员工状态、任务交接、审计一起回滚。旧没有 operationId 的更新从来只有版本检查，继续保持，不虚构旧回执。新成功编号保存输入与真实 Auth，重复精确输入可返回原结果；旧版本成功动作不得推断/补写暂停。未 opt-in 且无该员工 epoch 的旧调用保持旧行为；不能声称 DB 已为全站自动启用。已有未解除暂停时重复停用不递增 generation、不覆盖原 wasActive；只保存本次新的员工状态回执。

新增最小员工状态回执 `statusReceipt`：

```ts
{ operationId:string, actorId:string, employeeId:string,
  expectedVersion:number, version:number, status:'active'|'disabled',
  suspensionId:string|null, recordedAt:string, commandFingerprint:string }
```

POST 使用旧 employees PATCH 的鉴权/任务交接校验，传可选 operationId；确认员工返回之后仍按原号 GET 取得上述回执，不以快照猜测暂停是否发生。超时仅 GET、不自动重发。GET 将 `statusReceipt` 与其他恢复回执分开。

## 新负责人接口

路径 `/api/merchant-enterprise/attendance/account-suspensions`。精确 query：

```ts
{siteId:string, mode:'list'|'detail'|'recover'|'recover-status',
 afterId:string|null, suspensionId:string|null, operationId:string|null}
```

- list：afterId 可空，其余 null；当前暂停按 suspensionId keyset，25+1。
- detail：suspensionId 必填，其余 null。
- recover / recover-status：operationId 必填，其余 null；只读原操作者最小回执，无重新发送。
- POST `{query,command}` 仅 detail；`command` 精确如下（10项）：

```ts
{action:'restore',operationId:string,suspensionId:string,expectedGeneration:number,
 workerId:string|null,expectedWorkerVersion:number|null,expectedEmployeeVersion:number,
 employeeId:string,employeeAuthUserId:string,reason:string}
```

SQL：`faolla_attendance_account_suspensions_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_restore boolean)`。

结果精确 `{siteId,mode,items,nextAfterId,detail,receipt,statusReceipt}`。items 最多25；非list为空数组。detail 非detail为 null；receipt/statusReceipt 只在对应写入或recover模式非空。

item：`{suspensionId,generation,employeeId,employeeAuthUserId,employeeName,workerId,workerName,wasActive,recordedAt}`；Auth/worker/workerName/wasActive 可 null，仅 owner 可见列表。

detail：`{suspension:item,employeeStatus,employeeVersion,workerVersion,workerActive,originalAction,currentAction,canRestore,blockers,pinInvalidated,delegationsInvalidated,pendingReview}`。

- employeeStatus: active/invited/disabled/null；版本可null；workerActive可null；action: clock_in/break_start/break_end/clock_out/null。
- blockers 字符串数组，固定代码：already_restored / binding_changed / employee_inactive / role_invalid / location_invalid / employment_invalid / settings_disabled / worker_missing / state_binding_changed。
- canRestore 是数据库当前资格，route 还需当前平台资格。当前角色需按已有有效权限规则核验；原active worker 需本人查看/打卡权限与有效地点、任职日期。同身份原开放班次可恢复，但不能改变原事件。
- pendingReview 精确 `{leave:'not_checked',workArrangement:'not_checked',missing:'not_checked',unknownOperations:'not_observable'}`。本页不暗中全历史查询，提供原负责人申请入口说明；不可显示0或全部处理完。后续可单独加有界汇总，不影响本包原子暂停。
- pinInvalidated/delegationsInvalidated 是暂停事实布尔，不能暗示新凭证/授权已设置。

恢复 receipt：`{operationId,actorId,suspensionId,generation,employeeId,workerId,workerActive,recordedAt,commandFingerprint}`，workerId/workerActive可null。

指纹统一 SHA256 对 UTF8 JSON.stringify 数组；restore：`['attendance-account-restore-v1',siteId,action,operationId,suspensionId,expectedGeneration,workerId,expectedWorkerVersion,expectedEmployeeVersion,employeeId,employeeAuthUserId,reason]`；status：`['attendance-account-status-v1',siteId,operationId,employeeId,expectedVersion,status,offboardingMode??null,replacementEmployeeId??null]`。SQL数组 `::text` 带空格，不可直接当 JS 紧凑JSON；采用既有 helper/逐项组合明确对齐。

## 开关、鉴权与恢复

- 新 opt-in：`FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED === '1'`；前端新员工状态流 `NEXT_PUBLIC_FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED === '1'`。若已有站点 allowlist 工具复用，否则无需新客户配置写入。
- 列表/detail/GET原号及已暂停安全恢复在新开关关闭时仍可调用（记录存在才有数据）；恢复仍要求当前owner、平台资格、exact saved IDs及版本。不存在记录不能借restore开通考勤。
- 当前owner沿064七个历史owner字段；原号按原操作者Auth最小读取，不依赖仍持旧employee权限。canonical/same-origin/强认证/限流/no-store，POST bounded strict JSON。
- pending 单独 sessionStorage，auth+merchant+原号绑定，提交前持久化精确意图；未知只GET，查无不清。换用户/站点/API/卸载立即隐藏旧结果，CAS防误清。已有暂停不受UI开关回退绕过。
- 旧064普通编辑不得激活仍暂停的人。新grant捕获双方generation，检查双方不暂停；新PIN同样不能在暂停期间发放。旧grant历史guard和归档不变。

## 分工与验证

- SQL164/安装契约：139；协议/Client/server/routes/Store：137；真实Manager/Admin UI与内存浏览器fixture：140；root整合、安全审阅与唯一数据库/浏览器/全量TS运行。
- 只追加迁移，不改旧迁移。复用拥有标记的本地PG；不开新cluster/库副本、不完整构建。并发必须见证不同backend锁等待。
- 覆盖真实员工更新链、任务交接/审计、旧无op成功、关闭开关、原本inactive、在班/休息、双身份变更、PIN租约、两类委托双方、恢复/再次停用、失败回滚、GET未知回执、原归档字节与390px UI。
