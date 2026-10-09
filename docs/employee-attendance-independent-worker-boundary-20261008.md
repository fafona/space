# C04-A 无邮箱独立考勤人员：最小实施边界

2026-10-08。用户已批准无邮箱独立 worker 与终端 PIN 的有限本地实施方向。本文件第1–7节是原调查／设计；后续SOURCE实施与验收状态见第8–11节。**196已运行只读数据库前置，但迁移／八组业务验收尚未通过，未运行浏览器、未创建真实人员／凭证，也不增加已完成项计数**。238 首次补正委托的迁移、原生夹具与测试保持冻结；本文件不修改它们。

目标是实际可走通：负责人建立没有 membership 的考勤档案 → 明确签发独立 PIN → 既有受信终端完成一班次 → 原号核验和本人获取该班资料 → 撤销凭证／停用 → 后续显式绑定真实会员身份。不能用虚假邮箱、共享账号、伪 employee/Auth UUID 或负责人身份冒充员工。

## 1. 已确认的旧链断点

| 层 | 现行为及依据 | 不能采用的捷径 |
| --- | --- | --- |
| 档案底表 | [061](../scripts/supabase-migrations/202609290061_merchant_attendance_foundation.sql) 46–79 已有稳定 workerId，employee_id 本来可空；工号企业内唯一、任职期归 worker | 不需要把旧账号／epoch 表改为 nullable，更不能先制造 membership 再隐藏邮箱 |
| 实际建档入口 | [064](../scripts/supabase-migrations/202609290064_merchant_attendance_owner_configuration.sql) 88–89 强制 employeeId，168–175 核当前会员及历史保护，209–214 人员目录排除无会员 worker；[Admin 协议](../src/lib/merchantAttendanceAdmin.ts) 6、44–47 要求字符串 UUID；[Admin 页面](../src/components/enterprise/MerchantAttendanceAdminPanel.tsx) 295–307 必须选择已有员工 | 只往底表插入空 employee 的 worker，现页面既不能正常建立，也可能不能发现；不能声称已经交付 |
| PIN 凭证与验证 | [106](../scripts/supabase-migrations/202610010106_merchant_attendance_pin_credentials.sql) 5–31 的凭证、成功 lease 绑定非空 employee；42–55 的 pin_member 要求 active membership、Auth、角色和 self.view/self.clock | 不删除当前会员门槛，不把“没有会员”当作自动通过，不借用旧 employeeId 字段装 workerId |
| 服务端 PIN 派生 | [Pin.server](../src/lib/merchantAttendancePin.server.ts) 13–16、41 的 KDF 绑定 site／worker／employee；[Pin.ts](../src/lib/merchantAttendancePin.ts) 24 禁止无 employee 设置 PIN | 不能原样使用 member 域的 verifier；新主体必须独立域分离，不能将 null 或空字符串当成旧 employee |
| 打卡与原号 | [112](../scripts/supabase-migrations/202610020112_merchant_attendance_pin_clock_identity.sql) 18–23、35–55、75–80 先消费当前会员 lease，再核最后事实 actor 与当前 employee，并写旧 member PIN receipt；[PinClock 协议](../src/lib/merchantAttendancePinClock.ts) 10、15–31 也要求非空 employee | 仅允许 INSERT actor=null 会使状态、重放和后续动作失效；不能放宽所有历史 null 的归属 |
| 原班规则／计划证明 | [133](../scripts/supabase-migrations/202610040133_merchant_attendance_shift_rule_bindings.sql) 98、179–207 的 verified 来源要求双身份和旧通路 receipt；[134](../scripts/supabase-migrations/202610040134_merchant_attendance_bound_clocks.sql) 77–94 包装旧 PIN writer；[135](../scripts/supabase-migrations/202610040135_merchant_attendance_shift_rule_binding_reader.sql) 严格验证保存图 | 新独立打卡不能伪造 verified member 规则图；不能把“原始打卡成功”宣传为已核准计划／正式异常 |
| 暂停与任职 | [164](../scripts/supabase-migrations/202610060164_merchant_attendance_account_suspensions.sql) 79–123 的暂停代次、恢复及状态操作绑定 employee；[166](../scripts/supabase-migrations/202610060166_merchant_attendance_employment_lifecycle.sql) 59–96、123–159 要求保存 worker／employee／Auth 与原暂停链 | 不改原 epoch 主键，不为独立人伪造 account suspension；既有 membership 停用仍必须撤销已绑定人的全部入口 |
| 后续绑定 | [111](../scripts/supabase-migrations/202610020111_merchant_attendance_self_clock_identity.sql) 83、95，[112](../scripts/supabase-migrations/202610020112_merchant_attendance_pin_clock_identity.sql) 45–55，[108](../scripts/supabase-migrations/202610010108_merchant_attendance_onsite_qr.sql) 136、146，[113](../scripts/supabase-migrations/202610020113_merchant_attendance_location_receipt_identity.sql) 71、98 都拒当前身份与旧事实不一致；064 172–175 禁止历史 worker 偷换会员 | 只 UPDATE worker.employee_id 后，旧独立末条 null 仍使新会员无法接续；必须有明确切换边界，而非把旧事实重标成新会员 |
| 本人读与固定周期 | [109](../scripts/supabase-migrations/202610020109_merchant_attendance_event_channels.sql) 122 本人按原 actor 筛选；[148](../scripts/supabase-migrations/202610050148_merchant_attendance_period_source.sql) 85–123 的 period_session 要求实际双身份；[PeriodClosure 协议](../src/lib/merchantAttendancePeriodClosure.ts) 13、88、147 固定非空双身份 | 不能把独立历史静默漏掉后假称周期完整，不能把后来绑定的 Auth 追填旧归档；旧 v1／v2 格式不因此放宽 |

这些是本地源码事实，不是生产调查。原 [计划第6节](employee-attendance-plan-20260929.md) 明确允许无邮箱考勤人员；[196同身份任职生命周期](employee-attendance-employment-lifecycle-20261006.md) 已完成，但不包含这个独立身份分支。

## 2. 最小身份模型：同 worker，显式新主体证明

使用已有 worker 和任职期底表，不另建一套工号／原始事件系统。新建档时 employee_id 保持真实的 null；只接受由新 owner-only RPC 创建并留有独立主体证明的 worker，不自动接管数据库里所有历史空 employee 档案。

新增独立账本／投影的逻辑职责（最终表名与 exact DTO 在实现前冻结）：

- **独立主体与代次**：siteId＋workerId＋不可变 subjectId，kind 固定 independent；保存建档操作、负责人真实 Auth、姓名／工号快照及任职起点。当前 enabled、generation、revision 是受控投影；每次启停／凭证撤销有不可变操作依据。它不是旧 employee epoch 的替代物。
- **独立 PIN 凭证与操作**：credentialId、subjectId、generation、credentialRevision，盐及 verifier 只在服务端；签发／撤销明确 CAS＋operationId。不得提供可回读 PIN。
- **独立打卡来源旁证**：每个新原始 event 绑定同 site／worker／subject／代次、terminalId、credentialId/revision、完整非秘密命令 SHA、operationId。event 仍 source=kiosk，actor_employee_id 真实为 null；旁证才证明这是合法独立主体，不据 null 自行推断。
- **会员绑定操作**：记录原 subject、worker 版本、最后事件 ID／sequence、目标真实 employee＋Auth、负责人、时间及命令指纹。不修改之前的 event／receipt／规则／归档。

原始事件与旁证必须一个事务提交；任一失败全部回滚。历史事实的保存身份永远是当时的独立主体，不是后来关联会员。所有新表 RLS 默认拒绝，私有 helper 不给 anon/authenticated/service_role 直接执行；仅显式服务 RPC 获 EXECUTE。

首版仅允许“从新独立主体绑定至一个尚未绑定任何 worker 的真实同商户会员”。不提供解绑回独立、甲会员换乙会员、合并两个 worker 或复用已撤销身份。这些不能由本功能隐式产生。

## 3. 可复用与必须独立的协议

可复用：

1. 104 终端配对、设备密钥校验、到期和撤销；不再发一套独立设备登录，不改变旧30天设备有效期／5分钟配对窗。
2. 现 PIN 的服务端 KDF 并发门、专用 pepper 获取、常量时间比较、假 verifier 工作量、错误脱敏；新派生输入必须显式 domain=independent-pin-v1，并绑定 site／worker／subject／credential revision 或代次，旧 verifier 域完全不变。
3. 原始事件的全 worker 序列、动作状态机、服务器 UTC 时刻、地点时区和休息 paid 快照、任职期检查及 append-only 触发器。
4. 严格 JSON／字节限额／超时、同源检查、sessionStorage 原号意图、同步 Auth／scope fence、未知结果不自动 POST、精确 CAS 清槽的既有模式；不要直接复用旧 member pending 的 key 或结构。
5. 既有纯工时计算可在输入身份边界已验证后复用。旧一般报表的 nullable employeeId 并不证明已验证独立身份；新本人资料投影必须带新主体证明。

必须独立：

- 新 owner 档案／启停／凭证／绑定协议，严格区分 independent 和 bound 状态；旧 Admin command 的 employeeId 不改成可空。新目录能找到独立档案，旧目录可以继续只列会员人员，不将遗漏冒称“没有人员”。
- 新 PIN begin／finish／clock／read 协议与 lease：不往106非空 employee 成功 lease 写 null；旧接口和 verifier 保持不变。独立失败尝试须纳入同设备总防猜计数及服务 KDF 预算，不能因多一个 endpoint 获得双倍可猜额度。
- 新事件／回执投影严格返回 subject，不使用 fake employee；不能把它转换成旧 PinClockResult 让旧 parser 误认会员。
- 本人获取入口必须重新验证独立 PIN 与当前受信终端，只可读自己明确日期／事件范围，不返回员工目录、其他工号是否存在或精确定位。PIN 不进入 URL、日志、storage、导出或客户端长期状态。

PIN 是验证材料，不能为了“GET 原号”把 PIN 塞进查询串。终端可沿已有模式通过 POST 完成凭证认证，内部只读取一个原 operation 的最小回执；报告必须区分 HTTP 认证请求和业务写入。每次提交最多一个新打卡动作。

## 4. 有限可用闭环

### 4.1 建档、签发、打卡

负责人从新独立入口填写姓名、企业内工号、开始日期、地点，明确确认“无员工账号”。不必填邮箱、证件、住址、工资，不创建 Auth 用户。新档案默认不启用；签发 PIN 与启用是显式动作，未知结果先查原号，不自动重做。

仅在当前企业开启、独立主体启用、有效任职、受信终端地点匹配且地点无需 GPS 时开放 PIN 动作。沿现PIN边界，不能把终端所在门店当成通过地理围栏；地理围栏地点应明确拒绝并提示不适用，不新增 GPS 或二维码现场能力。

状态机仍为上班 → 可选开始休息／结束休息 → 下班，休息中不能直接下班。平台停止新开始时可保留资格仍有效的显式结束；**主体／凭证／设备已撤销则不可因 safeFinish 绕过撤销**。开放班次停用只留待人工处理，不自动制造下班。这不实现另一个 C04-B 永久离职收尾方案。

所有动作重新核实 worker version、subject generation、credential revision、设备和源序列。已成功原号只返回原回执，不按当前时间重写；同号不同 body／worker／subject／terminal 拒绝。若新旁证保存失败，event 也不得留存。

### 4.2 原号与本人资料

- 有效独立凭证下，员工可在受信终端明确核对一个原号，或读取本人有限日期范围内的完整原始班次、休息和保存身份，并显式下载／打印；不自动邮件，不宣称是工资表或固定周期确认。
- 丢响应的未知意图不换号重发。独立客户端 pending 只存非秘密命令及精确域；退出／换人不清未核号，重新输入 PIN 才可读。临时 PIN、正文及短时 lease 在隐藏／卸载／换人时清除。
- PIN／主体撤销后，不得继续使用旧 PIN 读个人档案。负责人仍可在 owner-only 历史／原号入口核对并交付该人的资料；本人无账号且无有效凭证时必须明确走该受控交接，不承诺无身份凭证的远程自助恢复。
- 如果产品要求“撤销后本人仍独立核验原号、且无需负责人”，须冻结一项额外的 **仅单回执** 恢复凭据协议：随机高熵 proof、服务端仅存 hash、绑定 subject＋operation、有限期限、不能读档案或打卡。不能默认拿旧 PIN 或工号实现。本首版推荐先不引入这种新增 bearer 凭据，以免把撤销语义变复杂。

### 4.3 后续真实会员绑定

绑定必须在锁内满足：当前 owner；新独立主体真实存在；目标同商户 active 会员、真实 Auth 和必要权限；该会员尚无另一个 worker；该 worker 尚未绑定；最后状态 off（无记录或完整 clock_out），所有最后事实有同一独立主体旁证；没有未核完的绑定／凭证操作。

绑定同事务追加不可变映射与完整命令回执、推进 worker／subject 代次，撤销独立 PIN、失效未消费 lease，再设置当前 worker.employee_id。不会自动发会员 PIN、授予角色、启用 membership 或修改任职历史。之后的会员凭证必须重新明确签发。

这一步不能只更改档案字段。必须新增受证明的“跨主体开新班”接点：

1. 仅当最后事件恰好等于绑定账本保存的 clock_out＋sequence，允许新真实会员从 off 发起第一个 clock_in。
2. 原号读取仍按旧保存独立主体核验，不能因绑定就让新会员拿旧 member API 冒领旧 independent receipt。
3. 未证明的 null actor、其他主体、开放班次、过期映射或错误 last sequence 继续拒绝。
4. 新第一班以后回到原严格同会员连续性检查；不把例外推广成“凡已下班都可换人”。
5. 涉及111／112／108／113当前最后事件门槛及其134等包装链：应抽取带不可伪造来源证明的窄兼容分支，保留旧字段／命令／成功结果，不用 GUC 假授权，不覆盖历史迁移文件。若不能证明完整链相容，绑定按钮必须保持阻断，不能宣称绑定后可正常使用四入口。

## 5. 不悄悄扩展旧规则、审批和归档

独立身份首版的交付范围是档案、凭证、终端原始一班次、本人资料、撤销及受控绑定。下列边界必须在UI／报告写清：

- 现有个人规则／组归属／排班／审批来源很多保存 employee＋Auth，不能自动给独立主体补双身份。新班若尚未有完整规则证明，明确显示未核准，不能复用133旧 verified 协议冒充已经纳入所有规则计算。
- 148/149以及后续周期来源仍以会员双身份作正式完整性条件。跨独立与会员边界的日期范围必须明确返回身份分段／协议不支持，不得删除旧独立班次后生成“完整”周期。后续仅含真实新会员记录的完整期间，才可沿旧正式路径核验。
- 绑定后获取独立历史，使用新受控历史／交接入口，并呈现原 independent 身份；不能追填当前 Auth。旧固定 artifact 的正文、SHA、版本和回执不变。
- 不能用这一包宣布原 C04 全生命周期、C07 全部规则、C19 混合主体正式周期均已完成；也不把这些未接能力隐藏为零值工时。
- 实体卡、NFC/RFID、二维码工牌、离线补传属于原P2；本包不加。真实终端设备／个人登录／生产上线仍另验，不通过造假账号弥补。

## 6. 事务、资源和兼容护栏

新管理写沿当前 merchant SHARE → settings UPDATE → worker → 独立主体／凭证 → 必要目标会员和角色锁；终端认证、动作、撤销、绑定必须有同一序列化点，并在等待后重新核资格和时间。先核104/106已有 settings／设备／会员锁序，再冻结新顺序；不得让绑定先锁 worker 再等待一个持有 worker 之前已拿到的旧会员锁而形成新循环。

新表只添加，旧PIN、epoch、employee、receipt不改 nullable；旧 terminal 过期时间／KDF参数／总体尝试预算不提高。关键关系用FK、不可变触发器、来源 proof 和同事务验证，而不是依赖浏览器判断。旧成功路径只加入上节明确批准的证明型边界，不进行历史回填或批量修复。

所有列表和资料读取有明确日期窗、分页、最大条数和字节预算；超量明确拒绝或翻页，不能截断完整班次后计算。迁移支持首装／重入／私有ACL验证，关闭新开关不影响原会员PIN、旧回执和当前owner的安全撤销／交接。

## 7. 最小验收与交付顺序

以下均为待实施／待执行，不是测试通过记录。

1. 新 owner 建档 → independent PIN → 同一真实终端四动作 → 本人原始明细／明确导出 → 撤销。真实 SQL、严格 Node 投影和实际新组件至少有一条贯通证据；Auth与终端密钥可使用明确合成前提，不冒称实机或真实登录。
2. 未制造任何 membership/Auth/email；worker.employee_id 与 event.actor_employee_id 真实为 null，所有新事件都有 exact 独立旁证；无法把任意旧 null actor 当成本主体。
3. 错PIN／不存在工号、错误门店／设备、到期／撤销、非任职日、平台暂停、错误动作／序列、同号改body都拒绝；防猜计数不因新旧endpoint分流而绕过。
4. event插入后旁证失败整笔回滚；已提交丢响应原号核验只一个原动作；换人／隐藏／晚响应／存储CAS不误清或展示他人数据。
5. 两个必要竞争：打卡对撤销、首次绑定对打卡。真实PID等待同一必要锁，胜方事实完整、败方无新event；不人为先锁制造并发结论。
6. off 状态绑定真实会员，旧PIN不可复活，原独立历史／回执不改；新会员第一个合法新班可完成，错误边界和开放班次绑定拒绝。已绑定membership停用继续走164，不回落独立通道。
7. 原会员PIN／设备、四入口、旧本人读取与固定归档回归。全旧行／定义／archive bytes保护；仅owned合成schema内验证、最终恢复停止，不新集群、不扩大磁盘／时限／预算、不访问生产。
8. 先实现独立主体／管理／凭证／原始一班次及owner交接；紧接实现证明型绑定兼容和对应本人入口后，才能将本文件目标称为完整的 C04-A 本地包。若绑定或完整本人资料暂未完成，应准确列为未交付，不以增加静态测试代替。

本设计选“撤销后通过当前owner受控交接”，不额外引入撤销后个人 bearer 恢复权；若用户希望该能力，再明确选择上一节的单回执协议。除此之外，这里是已批准方向的有限技术收敛，不再要求为同一无邮箱目标重复授权。

## 8. 已实现的派生基础，尚非独立人员闭环

新增 `merchantAttendanceIndependentPinKdf.server.ts`：独立域 HMAC 绑定 site／worker／subject／generation／credentialRevision，再使用现有相同 scrypt 参数；与会员 PIN 共用原 `withAttendancePinKdf` 零排队并发门和 pepper，不新增一份防猜或内存预算。绑定在异步派生前严格校验、复制冻结，临时材料清零，验证使用常量时间比较。

3 个本地串行测试已通过，包含独立 Node HMAC/scrypt 对照、旧会员域不可复用、代次／凭证修订变化及两个方向的共享并发门、恶意 getter／额外字段拒绝。它不创建档案、签发凭证或授权终端，管理／SQL／四动作／本人资料／绑定仍待实现，不能将 C04-A 标为完成。

## 9. 196 实施前冻结的 exact 边界（SOURCE，尚非验收）

2026-10-08 根代理短审后冻结。新增迁移为 `202610080196_merchant_attendance_independent_workers.sql`；不改历史迁移。下列为实现输入，不代表真实 SQL／浏览器／Auth／硬件已通过，也不增加已完成项。

### 9.1 标识、版本和可公开 DTO

所有对象 exact keys；禁止 getter／额外字段／重复 JSON key。site 为8位数字，UUID为小写有效UUID，整数为非负 safe integer且不含负零，最高9007199254740990；revision／workerVersion最低1，credentialRevision最低0（0仅尚未签发）。日期2000–2100且真实有效；UTC为6位微秒；姓名1–120字符、工号1–40、reason1–500、search0–80。请求8KiB；资料页1MiB UTF8；列表25项加第26项sentinel。日期窗最多31个地点日，完整班次25项一页，单班最多2002 events、单页最多4000 events；超界整页拒绝，绝不截班计算。

Owner query 联合（每个列出的字段均存在，null显式保留）：

```ts
type IndependentQuery =
 | {siteId; mode:'list'; cursor:UUID|null; search:string; state:'all'|'independent'|'bound'}
 | {siteId; mode:'detail'; subjectId:UUID}
 | {siteId; mode:'recover'; subjectId:UUID; operationId:UUID}
 | {siteId; mode:'history'; subjectId:UUID; fromDate; throughDate; cursor:UUID|null};
type ChangeBase = {operationId; subjectId; expectedSubjectRevision; expectedGeneration;
 expectedWorkerVersion; expectedSettingsVersion; reason};
type IndependentCommand =
 | {action:'create'; operationId; subjectId; workerId; expectedSettingsVersion;
    workerNo; displayName; locationId; startsOn; reason}
 | (ChangeBase & {action:'enable'|'disable'})
 | (ChangeBase & {action:'issue_pin'|'revoke_pin'; expectedCredentialRevision})
 | (ChangeBase & {action:'bind_member'; expectedCredentialRevision; targetEmployeeId;
    targetAuthUserId; expectedLastEventId:UUID|null; expectedSequence});
```

`create`对应detail query中的同subjectId；其余写也只允许detail query且同subjectId。所有管理写推进subject revision与worker version；create生成初始worker version=1、subject revision=1、generation=0且disabled。`disable`／`revoke_pin`／`bind_member`推进generation并撤销当前PIN／lease；`enable`仅推进revision／worker version，不推进generation，不复活旧PIN；`issue_pin`绑定当前generation、推进credential revision。这样先签发再启用可用，停用后旧PIN不可复活。主体state仅independent→bound一次，不提供解绑／换绑／合并。

Owner结果外壳 exact：`{protocol:'attendance-independent-admin-v1',siteId,actorId,readAt,settingsVersion,data,receipt}`。

- subject：`{subjectId,workerId,workerNo,displayName,startsOn,locationId,enabled,generation,revision,workerVersion,state,createdAt}`。
- credential status：`{credentialId:UUID|null,revision,enabled,generation:number|null,changedAt:UTC|null}`，无盐／verifier。
- head：`{sequence,status:'off'|'working'|'break',lastEventId:UUID|null,lastAction:Action|null,lastAt:UTC|null}`。
- receipt：`{operationId,subjectId,workerId,action,actorId,subjectRevision,generation,workerVersion,credentialRevision:number|null,recordedAt,commandFingerprint}`。
- data 联合：`{kind:'list',items:Subject[],nextCursor:UUID|null}`、`{kind:'detail',subject,credential,head,binding:Binding|null}`、`{kind:'receipt'}`、`{kind:'history',report:RawReport}`。
- binding：`{protocol:'attendance-independent-binding-boundary-v1',siteId,workerId,subjectId,bindingOperationId,employeeId,employeeAuthUserId,workerVersion,generation,lastIndependentEventId:UUID|null,lastSequence,boundAt}`。

凭据撤销精确语义：issue将credential revision推进1；disable／revoke／bind存在凭据时推进1，未签发时仍0。撤销保留credentialId与原签发generation，更新changedAt，清盐／verifier并disabled；enable不改credential revision、不复活。管理receipt的credentialRevision：create／enable为null；issue为expected+1；disable为实际非负版本；revoke／bind为expected=0时0、否则expected+1。正常当前owner的历史GET可展示旧actor的最小receipt，但不得据此清除本actor的pending；有expected原号恢复仍要求原actor、完整命令与SHA一致。失权原actor只能读取自己的最小原号receipt，不能读当前正文／历史列表。

### 9.2 终端协议和公开指纹顺序

浏览器每次仅一个POST：`{siteId,terminalId,workerNo,pin,request}`；设备secret沿既有受信terminal通路取，不接受浏览器`verified`。PIN仅短时输入，不进入request command、URL、日志、pending、公开指纹、导出或客户端持久状态；隐藏／换人／卸载立即清PIN、正文、lease，不清未知原号。

```ts
type IndependentClockCommand = {operationId; subjectId; workerId; generation; credentialId;
 credentialRevision; expectedWorkerVersion; expectedSettingsVersion; locationId;
 expectedLocationVersion; expectedSequence; action:Action; breakPaid:boolean|null};
type IndependentTerminalRequest =
 | {kind:'state'}
 | {kind:'clock'; command:IndependentClockCommand}
 | {kind:'recover'; subjectId; workerId; operationId; commandFingerprint}
 | {kind:'personal'; subjectId; workerId; fromDate; throughDate; cursor:UUID|null};
```

`breakPaid`仅break_start为boolean，其余必须null；值须匹配锁内保存的当前paid快照。时间全部服务端产生。仅clock会插入至多一个原始event；state／recover／personal的HTTP POST只做重新认证和读取，报告不能算成新增打卡。recover必须同保存subject／worker／原号／指纹，不自动POST重打。撤销／绑定后旧PIN不再能recover或读个人资料，走current-owner受控交接，不新增bearer恢复权。

终端结果：`{protocol:'attendance-independent-terminal-v1',siteId,terminalId,readAt,data}`。认证后subject最小投影为 `{subjectId,workerId,workerNo,displayName,generation,workerVersion,credentialId,credentialRevision,settingsVersion,locationId,locationVersion,timeZone}`；data为 `{kind:'state',subject,head}`、`{kind:'clock',subject,head,receipt}`、`{kind:'receipt',receipt:ClockReceipt|null}`、`{kind:'personal',report}`。

原event exact：`{id,operationId,sequence,action,locationId,occurredAt,receivedAt,timeZone,breakPaid,source:'kiosk',actorEmployeeId:null}`。ClockReceipt exact为 `{operationId,command,commandFingerprint,event,source}`，source为 `{subjectId,generation,credentialId,credentialRevision,credentialIssueOperationId,terminalId,workerVersion,settingsVersion,locationVersion,commandFingerprint}`；交叉核event／command／source全部身份、版本、动作、原号、terminal与时间。同事务写event＋旁证，旁证失败原event回滚，不能把任意旧null actor视为独立人。

公开SHA统一使用现有`operationalRuleLedgerEncode`规范JSON tuple encoder（数组逗号后一个空格，UTF8，与PG jsonb数组文本一致），不是length-framed；不用JS对象顺序或重放tzdata：

- clock tuple：`['attendance-independent-clock-command-v1',siteId,terminalId,[operationId,subjectId,workerId,generation,credentialId,credentialRevision,expectedWorkerVersion,expectedSettingsVersion,locationId,expectedLocationVersion,expectedSequence,action,breakPaid]]`。
- owner tuple：`['attendance-independent-admin-command-v1',siteId,actorId,action,operationId,subjectId,values]`；create values为 `[workerId,expectedSettingsVersion,workerNo,displayName,locationId,startsOn,reason]`；其余共同前缀 `[expectedSubjectRevision,expectedGeneration,expectedWorkerVersion,expectedSettingsVersion,reason]`，issue／revoke再加 `[expectedCredentialRevision]`；bind再加 `[expectedCredentialRevision,targetEmployeeId,targetAuthUserId,expectedLastEventId,expectedSequence]`。

RawReport exact：`{protocol:'attendance-independent-raw-v1',siteId,subjectId,workerId,workerNo,displayName,timeZone,fromDate,throughDate,fromAt,toAt,readAt,items,nextCursor,pageComplete:true,rangeComplete,rulesAssessment:'unassessed',fixedPeriodEligible:false}`；items为 `{startEventId,endEventId:UUID|null,complete:boolean,events:ClockReceipt[]}`。cursor为上一页最后startEventId，锁内验证同site／subject／worker与range后按sequence翻页；只含完整来源图，开放班尾以readAt截止且complete=false。rangeComplete仅cursor=null且nextCursor=null时为true。下载／打印必须明确当前页或完整逐页结果，不称工资表／正式周期。

### 9.3 表、服务 RPC、锁序与旧链精准范围

新增6表（均`merchant_attendance_`前缀）：`independent_subjects`、`independent_entries`、`independent_credentials`、`independent_leases`、`independent_event_sources`、`independent_member_bindings`。subject稳定site／worker唯一；entries保存完整非秘密command与SHA和旧新版本、真实actor；source绑定exact event＋签发entry；binding不可变。entry／source／binding禁止UPDATE／DELETE／TRUNCATE；所有表RLS默认拒绝直接DML、私有helper不给service_role EXECUTE，只有明确公共服务RPC授权。

RPC exact签名（Boolean不是浏览器授权，服务端真实认证后注入）：

1. `faolla_attendance_independent_admin_v1(text,uuid,jsonb,jsonb,jsonb,boolean)`＝site/auth/query/command/credentialMaterial/allowNew。仅issue的credentialMaterial为`{salt,verifier,commitment}`，其他必须null，永不投影回浏览器。
2. `faolla_attendance_independent_begin_v1(text,uuid,text,text,uuid,boolean)`＝site/terminal/secretHash/no/lease/allowNew；返回盐／verifier只到server，denied同成本dummy KDF。
3. `faolla_attendance_independent_finish_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)`＝同设备／lease／server verified/request/allowNew；内部重新核验并消费lease后至多一个clock。

issue盐为私有独立HMAC盐域（`faolla-attendance-independent-pin-salt-v1`），绑定site/worker/subject/generation/目标credentialRevision/operationId，取前16 bytes；同原号同PIN确定性派生，不因每次随机盐造成伪冲突。先真实owner预读/CAS，后现有共享零队列KDF，SQL锁内再核；不嵌套同一KDF gate。entry保存私有material commitment（独立域规范JSON tuple `['attendance-independent-pin-material-v1',site,worker,subject,generation,revision,operationId,salt,verifier]`）并与同原号重放匹配；PIN沿旧8–12数字约束，不在公开SHA，换PIN同原号拒绝。

管理写：merchant SHARE→settings UPDATE→目标employee/role SHARE（仅bind，必须在worker前）→worker UPDATE→subject UPDATE→credential UPDATE→独立lease。终端：104 device/settings SHARE→旧106共同attempts UPDATE→worker UPDATE→subject UPDATE→credential UPDATE→独立lease。settings是新管理／终端共同串行点；每次等锁后重核clock_timestamp和资格。新旧端点共用106同一attempts行60/min；新独立lease另表且保存共同window/attempt ordinal，旧begin再次加计数自然使独立lease失效，新begin清旧成功lease全部字段，绝不往旧employee非空lease塞null主体。credential保持10/15min；设备30天／配对5分钟／KDF成本不变。

绑定只新增精确受证明bootstrap：当前195的6个private operational cores（self、pin、onsite、location v1/v2、pin_schedule）与`operating_head`做hash-pinned、exact次数、同OID/ACL/metadata的forward替换，不改111/112/108/113历史文件、public wrapper或原receipt actor gate。只有state且operationId=null，或无旧receipt的新clock_in可用；lastEvent/sequence原样，附9.1的bindingBoundary而非伪造空head。四入口实际验收前binding按钮blocked。首次新member事件后回原严格同member连续性。

旧148 collector已按未过滤actor的候选逐个核period_session，混合/null历史明确抛identity_changed而非漏掉，196不放宽或修改旧period函数。独立raw明确unassessed，不伪造133 verified member规则或旧双身份归档。新开关默认off；安全撤销／owner受控交接／已保存原号不随开关关闭消失。主体、PIN或设备撤销不得safeFinish；地理围栏地点一直拒绝。当前仍无真实Auth／实机／生产验收声明。

## 10. 196 SOURCE短审记录（非实际SQL验收）

主迁移为`scripts/supabase-migrations/202610080196_merchant_attendance_independent_workers.sql`，当前SHA256为`901C8F4132379E863A0F74247914A6C295AD968CFE1754B87C0802F201AC91D0`。实际收敛为6张新表、20个新函数、2个普通新索引、7个既有函数的exact forward；没有为了凑函数数量添加接口。只有admin／begin／finish三个明确服务RPC获service_role EXECUTE，所有新表RLS、私有helper和ledger DML默认拒绝。

PG15 安装护栏窄修：实际首装 postflight 的 `ind196_subjects_pk7` 被通用 `connoinherit=false` 期待错误拒绝。经批准复用原 owned 集群，仅在 rollback TEMP 事务用5条SQL、3175ms取元数据；PK／UQ／普通FK／可延后FK均为true，普通CHECK为false，validated／local为true、inhcount为0。现护栏先只允许c／p／u／f，再按kind精确期待CHECK=false、PK／UQ／FK=true；没有修改任何实际约束、ACL、外键／列／索引或业务函数。finally停止，PID和16444监听均为空。这只是有限PG元数据证据，不是196完整安装／业务原生通过。

首装前／末尾及重入均使用冻结完整metadata/body/hash manifest，检查columns／默认值／全部具名CHECK及FK／PK／UQ／索引key、排序、opclass、collation／trigger／RLS／ACL，不把漂移状态自动revoke或ALTER修好。196 CHECK规范化保留字符串及正则字面量原bytes，只折叠外部语法与已知PG15标量cast；修改字符类、大小写、阈值、操作符仍不相等。实际PG196安装尚未运行，不把SOURCE canonicalization测试当作数据库验证。

bind仍直接验证同商户真实active员工、精确Auth与active角色，并要求enterprise.view/self.view/self.clock。通用权限helper只允许两份正式已知定义：registry190存在且name精确时仅190完整SHA；190缺失且185registry/name精确时仅185完整SHA；其他registry/body/metadata/ACL拒绝，不额外安装190。owned195父夹具预期为185分支；两分支当前仅静态源码检查，未宣称196中实际跑过。

证明型bootstrap附加在原operating_head，不重写lastEvent/sequence或receipt。会员PIN的唯一exact state parser增加仅在实际字段存在时的independentBindingBoundary解析，交叉site/worker/employee、off状态、原尾事件ID/sequence及绑定时间（保留微秒）；旧缺字段shape与原receipt gate不变。这是first real member clock_in之前的绑定state接点，不给历史独立回执新的会员读取权。

`merchant-attendance-independent-{installation,forward,migration.test}.mjs`的16个串行SOURCE测试通过，3脚本lint0。新旧PIN wire定向测试15项通过、2文件lint0，涵盖原shape逐值相同、合法零尾／closed尾、未知boundary／错身份／非off／错sequence／getter／微秒倒退拒绝。另独立DTO／Node服务／两API route由独立代理报告39个mock小测试通过；这些不是实际SQL、真实Auth、浏览器或硬件证据。

KDF原3项实际本地派生基础此前通过；新增原号确定性salt／material commitment只运行其纯辅助测试，新的实际scrypt原号重放组待唯一资源租约。管理／终端客户端和UI尚待接线。下一步准备复用195 owned ctx的独立196有限native adapter SOURCE，不建集群／数据库、不复制旧数据、不跑旧完整矩阵；实际资源租约仍由根代理串行安排。完成真实原始一班、2个必要PID竞争、4旧入口首次绑定前后与完整本人资料后，才可把C04-A本地包标为完成。

## 11. 196 有限native adapter SOURCE预算与验收终点

入口为`scripts/merchant-attendance-independent-native.mjs`的`installAndVerifyIndependentWorkersNative(ctx)`。它只能由已获批195 parent在原owned namespace内调用，不提供CLI、不启动数据库／集群／浏览器／真实Auth，不接生产。fixture为`scripts/fixtures/attendance-independent-native.mjs`。195风险夹具已微提交使用`99990196`，197使用`99990197`，故根代理冻结196使用未占用的`99990198`；运行时在写入前仍须断言site和全部32个固定UUID不存在，不能以源码未引用代替数据库断言。

八组有限终点：A创建默认禁用、签发／启用及原号材料重放；B真实四动作、一整班原始资料、原号恢复、关新写仍可结束和恢复；C有限PIN、地理围栏、任职、共享设备／凭据预算与旧begin使新lease失效；D精确23514旁证失败无孤儿event、旧NULL actor不收编、private ACL与不可变性；E停用／启用不复活旧PIN、撤销代次及owner交接受控最小回执；F四个不同worker分别走原self／PIN／onsite／location入口的绑定前拒绝、显式关闭边界绑定、第一条真实member clock_in；G实际revoke持锁与finish等待；H实际clock_in持锁与bind等待。原审批／正式周期／旧完整矩阵不重跑，不把raw-only资料称为工资或正式周期。

冻结计数区分协调层、真实RPC和SQL调度，不以一次server调用掩盖内部读写：

| 项目 | SOURCE预测／运行上界 |
| --- | --- |
| 八组实际RPC | 23 / 19 / 9 / 5 / 16 / 80 / 16 / 12，合计180；hard cap180 |
| owner admin RPC | detail30、candidates2、history2、recover12、write34，共80 |
| independent terminal RPC | begin41、finish30，共71 |
| 原入口与显式合成setup RPC | 29 |
| 两次竞争参与RPC | owner write2＋terminal finish2，已包含在180，不另加 |
| 主业务SQL调度 | 预测234，hard cap250；每RPC、savepoint、seed、故障约束与竞争pid／commit均单独计 |
| 顶层逻辑步骤 | 约177，hard cap180；每次协调内部RPC仍完整另计 |
| PID只读观察 | 每场最多34次、75ms间隔、2.5秒；必须同waiter与holder的真实`pg_blocking_pids`证据 |
| 资源 | 总120秒；最多3连接（主连接先关闭，再开两个竞争参与者＋只读观察）；0新cluster／DB／KDF／真实Auth／浏览器／生产 |

独立保护driver`attendance-independent-native-protection.mjs`将首装／重入、catalog、全事实、旧函数与七forward的OID／metadata保护逐次通过原owned guard调度并记录。完整成功路径预计41个显式`native.query`，hard cap64；另调用原195冻结的155／207归档回调共8次，保留原bytes／SHA验证。回调内部transport数量对adapter不透明，因此只报告`archiveCallbacks`，不冒称已数出其内部SQL。此保护组不混入业务RPC或PID观察计数。

核心在单事务内完整ROLLBACK并比较全库事实／catalog；两次真实跨连接竞争仅微提交全新`99990198`行，明确由既有parent成功／失败finally精确owned namespace清理，不删除append-only记录来伪装回滚。所有之前的facts、其它函数defs、七forward元数据、归档始终受保护。PIN使用明确synthetic verifier依赖注入，仅验SQL／server协调，0 KDF；不因此声称真实密码、cookie、手机定位、硬件或生产认证已通过。

截至本SOURCE记录，9个新adapter静态／mock unit、19个迁移SOURCE测试、19个协议测试及4个首次定位预读回归通过；这些不是实际196 PostgreSQL验收，不能据此增加C04-A完成数或声称可部署。

### 11.1 首次定位预读的已证明SOURCE接点修正

真实`executeAttendanceLocationClock`会先调用`rpc(null, command.operationId, null)`，然后才提交clock_in。原196 helper在NULL command且非NULL operation时无条件拒绝，导致刚完成closed binding的首条定位打卡在预读被拒。已批准的窄修仅允许该worker根本不存在此operation的预读继续核验完整closed binding；现存operation仍拒绝进入bootstrap，原113的actor receipt gate原文件SHA及全部旧writer代码不改。

新增小测试调用真实Node服务，确定性证明预读参数、拒绝时零writer、合法快照后的原两段读写，以及原operation／wrong worker／unbound／open／flagoff的拒绝传播。后四类身份／状态拒绝是mock注入并配合SQL源码约束检查，不冒称已经实际执行PostgreSQL；正式fixture F仍负责绑定后真实location第一次clock_in验证。完整closed head、member/Auth、subject、entry指纹、原sidecar及外层flags校验均保留；下述两只读选择加入后总业务RPC预测180，不扩大八组矩阵或资源上界。

### 11.2 首轮实际native的安装前停止（未安装196）

获批唯一资源租约后，session56959复用原`LKtY4L` owned parent，既有195全链／A-B-C／finite risk实际通过。196完整只读dependency diagnostic的唯一失败为`faolla_valid_merchant_enterprise_permissions_v1(text[])`的ACL；其他签名／body hash／metadata均无失败项。由于这是Node前置断言，不是PostgreSQL产品SQL错误，因此没有可报告的产品SQLSTATE／CONTEXT；196未安装、八组业务／两PID竞争尚未执行，KDF仍0。

父链finally已报告`stopped:true`，之后只读确认owned`data/postmaster.pid`不存在、16444监听数0，PostgreSQL日志20:11:30.168 CEST明确shutdown。没有补迁移、改ACL、重跑或创建新数据库。失败时通用guard要求该helper owner-only；该sandbox从062首次CREATE纯helper，185／190仅CREATE OR REPLACE所以继承默认PUBLIC EXECUTE，而完整正式enterprise026已REVOKE PUBLIC等权限。首轮未采集实际ACL逐项明细，因此PUBLIC来源是固定父链源码推断，不冒充实际明细。

根代理批准仅此已exact body／registry／owner／config／language／volatility的纯helper兼容两种正式原ACL：owner-only，或owner与PUBLIC各一条EXECUTE；每条grantor必须为owner且无grant option，必须包含owner有效EXECUTE，不接受显式anon／authenticated／service_role／其他角色、重复或额外权限。已同步产品首装／重入／末尾guard和只读native diagnostic；其他函数ACL期待不变，未新增GRANT／REVOKE。17项SOURCE测试包含两形接受及额外角色、grantor、grant option、缺owner等拒绝。下一轮同一只读diagnostic会报告实际完整ACL明细；此兼容性窄修未重跑数据库，也未把失败前置称作196验收通过。

### 11.3 Owner真实只读选择（SOURCE，未原生验收）

原企业overview有意清空Auth字段，不能据此构造绑定命令，也不能让用户手输UUID。196追加两个独立literal query：`{siteId,mode:'members'|'locations',cursor:UUID|null,search:string[0..80]}`；每页一条既有admin RPC，只有当前真实owner可读，settings SHARE，command／material必须null，新写flags关闭仍可读取。members exact items为`{employeeId,authUserId,displayName}`，筛选同商户active且Auth非空、active合法权限角色、明确enterprise.view/self.view/self.clock、未被任何worker占用的员工；照原bind准则，不追加accepted_at限制。locations exact items为`{locationId,name,timeZone}`，仅同商户当前active地点。均按ID升序、literal搜索、25＋1 sentinel、strict DTO和nextCursor，列表本身不授予权限，bind写仍锁内重核原全部条件。

未修改旧026／064／overview，也不驱动父旧AdminClient共享pending。原生A加入两只读RPC，同时使用刚完成create返回的真实home省去首次issue的冗余detail；F四旧通道完全不动。新预测总180真实RPC／234业务SQL，hard cap180／250及八组、120秒、三连接不变。

### 11.3 管理端传输与操作入口（SOURCE／单元证据）

新增独立`AttendanceIndependentAdminClient`、惰性管理Launcher／Panel及真实Admin父入口。新建默认停用、启用／停用、PIN签发／撤销、同人账号绑定、31天原始资料分页分开明确操作；不复用旧配置pending key，不改旧员工配置成功路径。地点与成员候选必须由196当前owner只读接口提供，成员Auth不手输、不从姓名推断；最终绑定仍由SQL锁内重核。候选新协议正在独立补齐，不能用页面源码代替实际可用证明。

7项客户端单元及4项真实组件SSR／确认guard测试串行通过，定向lint零警告。客户端先保存完整非秘密命令SHA，再仅发送一次POST；PIN仅留于本次瞬时请求，已成功POST仍保留原号，仅原actor的匹配最小GET receipt＋存储字节CAS可清理。超时、null／损坏／异回执、存储换号及晚响应均保留原号。隐藏／pagehide同步清正文、草稿和PIN，Auth／requester变更撤下旧body；离开有草稿／原号确认。以上不是实际浏览器、真实Auth、实际KDF或196原生业务通过；完整本地原生验收仍待完成，终端SOURCE首包见下节。

2026-10-08追加负责人端实际浏览器证据：`attendance-independent-owner-browser.mjs`四组有限验收通过，实际GET29＋POST6＝35次API、HTTP38次，用时6.183秒；一个owned Chromium／context、390px无横向溢出，内存bundle，外部请求0。真实Admin父入口草稿拦截、Launcher子入口初始0联网、地点／同人账号候选选择、新建丢回复与null原号保留、flagoff原GET清号、启用／签发／closed-head绑定、原始班次25＋1分页、flagoff停用／撤销、pagehide清正文与PIN、隐藏晚响应保号、requester变更及stable Auth回调失效撤正文均通过。停用与撤销使用两个不同的明确合成主体；26班次／52回执全部是合成HTTP资料，不是SQL生成事实，不将原始资料称为工资或正式周期。实际组件已运行，但当前身份／API均为合成，真实Auth、SQL、KDF仍为0／未验；不据此宣布C04-A原生包完成或可部署。finally已核owned浏览器断开、listener停止，context／esbuild回收。

首次无观测的浏览器运行在拒绝关闭后读取理由字段超时，前三组通过、第四组未完成；原因尚未证实。第二次仅夹具增加原生confirm返回值／生命周期与DOM布尔观测，无产品修改；实际确认恰好一次leave确认返回false且正文／PIN仍保留，随后四组全部通过。保留首次失败记录，不将第二次通过表述为已修复业务缺陷。此夹具7项SOURCE／合成模型测试及3文件lint另行通过，不能替代真实SQL或登录验收。

## 13. 独立终端首包（SOURCE／实际浏览器，尚未原生验收）

新增自有四文件：`merchantAttendanceIndependentTerminalClient.ts`、其`.test.ts`、`MerchantAttendanceIndependentTerminalPanel.tsx`、`enterprise/attendance-terminal/independent/page.tsx`。页面初始为空壳，不自动请求或打卡；用户显式“检查已配对设备”才沿原`TERMINAL_DEVICE_API` GET与HttpOnly cookie核验真实active终端。未配对／格式错误／未就绪时清空设备与资料并提示原`/enterprise/attendance-terminal`配对入口；不制造terminalId，不接URL／JS设备秘密，不修改旧配对或PIN成功通道。

每次state／clock／recover／personal都需新输入本人8–12位PIN；PIN仅在单次短POST局部变量中，UI调用前立即清除输入，不在sessionStorage、pending、URL或client状态保存。clock先持久化完整非秘密command及原SHA，然后最多一个POST；即使有效clock回执也保留原编号，禁止继续新打卡。只能用户显式点击“只读核对原编号（不重新打卡）”，以携PIN的`request.kind='recover'` POST重新核验。该POST只读，不是重试writer；只有与保存的完整原command／SHA／site／device／subject／worker匹配的原回执，且存储字节仍相同，才CAS删除pending。null、失败、损坏、foreign、deadline、pause、晚响应及存储替换均不能清编号。不自动请求恢复、不自动重发、不离线补传；终端pending最多64项，损坏项不自动清理。

12秒总预算涵盖响应头、bounded UTF8流和异步SHA解析，响应最多1MiB，device GET8KiB；busy／epoch／document.hidden／当前scope检查横跨每个异步边界。正文15秒隐藏；PIN／工号变化后采用明确固定15秒清理，不声称为所有操作的闲置计时。隐藏标签页／pagehide由useLayoutEffect注册的flushSync同步清device、正文、PIN／工号／日期／带薪休息选择，原待确认存储保留；换工号、检查设备及“下一位”同样清日期与带薪选择，不能沿用上一个人的草稿。新写flag默认关闭只禁clock_in／break_start，不能以404阻断配对核验／原号读取／本人明细／允许的break_end与clock_out；服务端仍独立决定身份、撤销及安全收尾资格。

本人原始明细仅显式查询最多31个地点日、每页25个完整班次；每一页需新PIN，nextCursor只接受当前报告的精确下一页且日期范围不可换。开放班次明确未结束，页面始终标注raw／未规则评估／非工资与正式周期。没有硬件、真实Auth、GPS、KDF或生产声称。

首包12个client协议mock小组和4个真实React SSR／UI源码小组共16项串行PASS，四文件lint0。浏览器拟四有限组，独立API预算20／HTTP35／POST12／180秒：实际Panel配对／打卡／original recovery、pending重挂载与null保留、flagoff安全收尾、本人raw页／hide／390px。此处仅SOURCE，等待唯一heavy租约，不增加C04-A已完成数。

浏览器SOURCE入口为`attendance-independent-terminal-browser.mjs`的`verifyIndependentTerminalBrowser()`，默认导入／无参CLI均不启动服务。actual Page与actual Panel由独立entry在内存构建；HttpOnly配对cookie、API响应、worker数据和PIN均明确合成，不是实际Next route、真实设备／Auth／SQL／KDF验收。四组预计16次API（4个原device GET、12个短POST），其中clock写3次、原号只读recover4次、state4次、personal1次；POST hard12、API hard20、HTTP hard35、总180秒不增。限制loopback来源、无磁盘bundle／截图／新DB，finally关闭本轮context／browser／监听器。4项inert／model小测试PASS，3个浏览器SOURCE文件lint0；尚未启动浏览器。候选DTO类型窄修后协议19项与终端16项合计35小测试PASS，不将SOURCE／SSR证明计作真实端到端完成。

2026-10-08追加独立终端实际浏览器证据：上述四组有限验收全部通过，实际GET4＋POST12＝16次API、HTTP19次，用时2.951秒；页面初始0次API，390px无横向溢出，外部请求0、内存bundle。实际Page／Panel组件运行，配对检查、打卡后保留原编号、原号只读恢复、null与丢回复保留pending、flagoff安全收尾、本人raw资料及隐藏同步清正文／PIN均通过。12次POST包含state／recover／personal的重新认证读取，不是12次打卡写入；三个clock请求中的安全收尾使用明确预置的合成工作状态。HttpOnly cookie、身份和HTTP响应均为合成；Next route仅有SOURCE证据，真实Auth／SQL／KDF均未运行，不据此宣布C04-A原生包完成、实机可用或可部署。finally已核owned context／browser关闭、listener停止、esbuild回收；`browserClosed:true`与`listenerStopped:true`。本次未修改终端夹具或产品代码。

## 14. 八组原生函数首次全部返回通过

2026-10-08，session98067在既有唯一owned PG15中完成195后，196实际安装／重入及八组函数返回通过；随后197前置指纹错误使整条外层链失败，不能把外层失败写成整链通过。196已执行四个原成功通路的首次会员打卡、无membership独立员工正常班次／本人原号与原始资料、两次真实PID锁竞争，原事实／归档和七forward元数据保护均通过。这里仅报告已有函数返回及其硬上界内的检查；下一次联验会逐phase输出实际计数，避免后续包失败掩盖已完成证据。

前两轮196业务停止均为夹具问题：synthetic verifier把对象插入顺序混入PIN派生，改为与真实KDF相同的显式身份scalar tuple（不改真实KDF）；随后最终核对步骤超出180逻辑步，移除一条独立的当日日期读取，直接使用同一实际setup SQL返回的UTC日期。最终事实核对、180 RPC／250 SQL／120秒／三连接硬上界和两PID见证均保留，没有放宽预算。真实Auth、硬件、GPS及生产仍未验；全体新源码冻结后的完整TypeScript收尾尚待完成，因此暂不更新全局完成数或宣称上线就绪。

session90615已逐包打印196实际成功结果：八组、180逻辑步、233业务SQL、180 RPC，安装／重入、四旧通路和两次真实PID竞争通过，旧facts／archives均未变。随后197也全部通过；外层在198合成角色setup处被旧权限CHECK拒绝，故不把整条联验称为通过。196不再缺实际计数或原生业务证明，完整TypeScript及固定台账收尾仍待；真实试点边界不变。

收口更新：后续session15195与36110再次通过196八组及旧事实／归档保护；全量TypeScript在session82532退出码0。既有负责人四组和独立终端四组实际浏览器证据与本节实际SQL证据共同达到Q2批准的有限本地终点，固定台账C04更新为本地已有。完整联验的后续199／200失败另列，不反称本包或后续包整链通过；真实账号、设备、KDF、任意跨Auth历史合并和生产仍未验、不在此收口声称内。

