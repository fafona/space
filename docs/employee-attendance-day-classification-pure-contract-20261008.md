# C15-A 纯分类候选附记

2026-10-08。只实现 `merchantAttendanceDayClassification.ts` 的有限解析/评估基础，沿已认可的[日历分类边界](employee-attendance-calendar-classification-boundary-20261008.md)。没有 SQL、可信采集、权限核验、case 保存、通知或页面闭环，不计 C15 完成。

## 输入与输出

`parseDayClassificationInput(raw)` / `parseDayClassificationInputJson(text)` 解析并深度冻结 exact 输入；`evaluateDayClassification(raw)` 同步产生四种决定候选。没有网络、环境变量、时间读取、写入或摘要计算。

输入协议 `attendance-day-classification-input-v1`，exact 顶层为 `protocol, siteId, asOf, actorId, target, source`。具体字段以新模块导出的 readonly 类型为唯一 pure DTO，不借用旧174保存协议。

- target 固定 `kind, workerId, employeeId, employeeAuthUserId, workDate, timeZone, fromAt, toAt, slotId`。day 的 slotId=null，显式区间最多48小时；plan 的 slotId 非空，必须等于 plans 内该计划的**完整保存区间、保存日期及 IANA**，不是与日边界裁剪后的片段。计划沿旧099上限24小时、整分钟端点。
- source 固定 `fingerprint, coverage, identity, current, plans, records, calendar, pending, conflicts, arrangements, caseHead`。fingerprint 只是调用者提供的64位小写十六进制；coverage=`complete|unknown|over_limit`，identity=`matching|unproven`。非complete不接受部分集合/部分case；实际超过硬界的数组直接拒绝，不截断再伪装完整。
- plans、records（session＋missing合计）、calendar、pending、conflicts、arrangements 各最多100。每个集合原号唯一。records 同时保存 original/selected 端点；missing 只接受调用者声明的已批准完整记录。当前无已获准行政闭合 DTO，不允许用修订字段把原 open session 装成已闭合。
- 日期真实 `2000-01-01..2100-12-31`；UUID 精确36字符；UTC精确27字符/6位小数，真实日期；IANA显式非默认。单个 closed session 最多31天，calendar保存日期跨度最多366天。全输入256KiB、20000节点、深度18；descriptor先检、getter不执行、拒绝重复JSON键及非法Unicode/NUL。
- 所有 `fromAt/toAt` 由未来可信适配器提供。本模块只检查格式、有限长度、半开相交和完整覆盖；**不从日期/IANA重新推算UTC、也不证明给出的UTC就是该民事日边界**。输出 `boundariesVerified:false`，实际来源层以后仍须使用权威边界。
- caseHead 是调用者声称的当前单个case摘要，不是任意历史第一页：固定target完全相等；latestDecision指向已保存决定；latestSelf若有，必须对应该决定、同case和本人，revision恰为当前head且在该决定之后。`explain`三个claim和`dispute`分支精确。没有摘要完整性声明或不吻合时不能据旧说明作实质候选。

输出协议 `attendance-day-classification-preview-v1`，`candidateOnly:true, authorityChecked:false, applied:false, sourceFingerprintVerified:false, boundariesVerified:false, evidenceOrigin:'caller_provided'`。`candidateState`仅表示给定参数符合纯条件，不是 canWrite、核准或已查数据库。actorId只用于拒绝自己处理自己，不证明其是owner。

## 有限判定

固定顺序七观察可以并列；未结束、来源未知/过限/失效、身份不明给 `evidence_insufficient`，绝不据不完整输入推导 `no_record`。存在完整记录可与 open/未关联并列，但不能据此产生 `recorded_work_reviewed`。原始记录不会因核定端点移到范围外而被视为不存在；独立安排只作背景，永不生成工时。

`follow_up`之外三种候选共同要求来源完整、身份声明相符、当前、已结束、没有pending/open/conflict/unassociated。无记录只说明未发现记录，不输出“旷工/零工时/全天正常”。

`calendar_exempt`只列每一条独立满足的 created revision1 closure：同site，企业或原计划地点，单条完整覆盖，计划未取消且有publication证据；holiday/异地点/取消/部分相交/多条拼接均不合格。有工作记录仍可豁免应到要求，但不会删除工作或旧异常。

`not_worked_reported`还要求范围内没有任何原始/核定/获批漏卡事实，case最新互动为当前决定之后本人 `explain/not_worked`。最新dispute、uncertain、worked_missing_records不能替代。候选保留精确说明原号，不把“已读/沉默”当说明。

测试终点是上述有限纯条件与失败关闭边界；不会声称已完成原边界第7节的真实SQL/UI八组。
