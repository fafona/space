# 第202批：核对后未触发迟到／早退规则的结案

2026-10-06。用户在[201范围说明](employee-attendance-plan-clearance-boundary-20261006.md)后回复“继续”，本批按该范围实现并完成限定本地验收。默认关闭、未部署，没有访问生产或修改真实用户资料。

## 解决的实际问题

旧案经过补正后，两项规则都不再触发，原“确认异常／说明后豁免”不能提交，而“继续核查”又阻挡周期封存。现在负责人可以有理由地追加“核对后未触发本次迟到／早退规则”（`cleared`），保留原决定、员工说明和原始打卡。

这不是无条件标记正常：必须已有案件、版本至少1、当前来源完整且`eligible=true`，迟到和早退两项都严格为`not_triggered`。保存版本必须大于1。仍触发、没有配置或停用规则、已批请假、待处理申请、未完整取得的资料等不能借此结案。宽限内也可能实际晚到／提前离开，页面和消息明确说明，不声称整班正常、全勤、工资确认或法律签名。

本人仍能查看、说明、明确已读；业务已读与消息标读分开。后来出现员工说明或来源变化，周期仍须重新核查、重新送审及本人确认，不能继承旧结案直接封存。旧周期固定正文与哈希不改。

## 实现与开关

- [170追加迁移](../scripts/supabase-migrations/202610060170_merchant_attendance_plan_clearance.sql)：替换147命令／entry校验和159入口这三处获准函数；增加一个私有执行函数和一个service-only入口，不新增表、索引或权限，不修改旧迁移。旧三种结果保留。
- 169消息结果约束只增加后续版本的`cleared`；新通知与决定同事务。原操作重放不因消息缺失补发。旧入口不能新建`cleared`，但仍可以按现权限读取、恢复和重放已保存结果。私有执行函数不给service_role、anon或authenticated执行权。
- [严格协议](../src/lib/merchantAttendancePlanExceptions.ts)、[服务分流](../src/lib/merchantAttendancePlanExceptions.server.ts)、[客户端](../src/lib/merchantAttendancePlanExceptionClient.ts)、[共用资格判断](../src/lib/merchantAttendancePlanClearance.ts)和[消息协议](../src/lib/merchantAttendanceEventNotifications.ts)同步识别新结果。
- [异常工作区](../src/components/enterprise/MerchantAttendancePlanExceptionWorkspace.tsx)增加独立选项，[消息面板](../src/components/enterprise/MerchantAttendanceEventNotificationsPanel.tsx)展示保存时结论。没有改父页面、原补正／请假writer、周期算法或阈值。
- 新写服务器开关为`FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED=1`加`FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS`精确商户名单；[开关校验](../src/lib/merchantAttendancePlanClearance.server.ts)默认拒绝。页面另由`NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED=1`控制。旧异常模块开关和权限仍需满足。消息捕获／读取继续使用原独立开关。本批未配置真实环境的任何开关。
- 以后发布须先具备新枚举读取能力，再为获准商户启用新写；关闭新写仍需保留新历史与原号恢复。不能把应用回退到不识别`cleared`的旧客户端。本批没有实施生产发布或旧缓存会话切换。

## 本轮验收证据

253项定向测试通过：209项TS协议／客户端／UI／周期回归，加44项新旧迁移和夹具静态／mock测试。全量`tsc --noEmit --incremental false`通过，定向lint和170份迁移目录检查通过；没有完整应用构建。

[定向本地runner](../scripts/merchant-attendance-plan-clearance-native.mjs)复用唯一明确指定、原本停止的PG15合成集群，只安装所需前置，不再重复191–200无关业务场景。151／160并发索引迁移按原文件在事务外执行；测试结束恢复基线、清理本轮所有权校验过的schema并停止集群，没有新建数据库或副本。

[实际SQL主链](../scripts/fixtures/attendance-plan-clearance-native.mjs)与[边界验收](../scripts/fixtures/attendance-plan-clearance-boundaries-native.mjs)共7组通过：

1. 170安装、重入、权限及旧169通知／159回执兼容；已有事实保持，旧155固定归档15249字节的原文及SHA-256保持。
2. 真实旧补正提交与审批、后续修订审批产生双项未触发的有效依据，原事件／排班关联／固定规则核准不改。旧入口和关闭新开关均拒绝新结案。
3. 通知最后插入故障使结案整笔回滚；两条连接对同版本竞争，观察到精确后端PID锁等待，只接受一个决定。原三入口在暂停状态原号重放不重复写入。
4. 本人明确业务已读、独立消息标读、后来追加说明再阻止封存；负责人再次核查后，周期重新送审、本人确认、负责人封存成功。保存上下文包含新结果。
5. 后续真实修订即使仍在宽限内，也使旧结案过期；过期指纹和其他身份被拒，旧事实不变。
6. 独立回滚组9个步骤、10次明确拒绝：无原案、实际请假提交与批准、Auth换绑、撤销本人查看权、员工／worker停用及模块暂停；只修改当前合成配置或运行真实旧writer，最终全部回滚。
7. 补正审批与旧依据结案同时竞争，精确PID锁等待后旧依据被拒；capture关闭时保存新结案，再从三个入口开启capture原号重放，仍不补消息。另一次合法宽限内修订留下过期状态供页面验收。

主链统计24次带全事实哈希检查的读取、7次零写入拒绝；边界组另有8次读取检查与10次拒绝，不把辅助函数内部检查重复算作业务次数。共1个原补正、4次实际修订审批、2组精确PID竞争。回滚中的请假2次实际命令不计作持久业务记录。

[浏览器验收](../scripts/fixtures/attendance-plan-clearance-browser.mjs)从实际Admin／Self父组件进入，经过真实处理器、服务和SQL：6组、18次API（13次工作流请求）、3次明确POST。覆盖默认关闭保留旧三选项、未保存离开保护、结案成功但回复丢失后关闭新写并仅GET恢复、本人历史／已读、独立消息标读、隐藏后的迟到回复丢弃、390px窄屏。所有GET前后全事实哈希相同；零外部请求、无磁盘bundle，浏览器及本地HTTP在finally关闭。

## 证据边界与剩余工作

- 历史班次前提仍使用原夹具明确声明的10条追加式合成历史行；它们不是实际过去的排班发布或打卡。其后的补正、修订、结案、通知、周期操作运行真实SQL。095私有修订函数只由所属本地postgres夹具角色运行，没有新增服务端授权。
- 页面认证是合成端口，新写开关按真实环境名单验证；逐请求测试开关只能收紧，不扩大服务器权限。这不是实际Auth／Next／PostgREST／手机验收。
- 未配置／停用固定历史规则的拒绝已做严格协议、资格判断及迁移谓词检查，本批没有另造一批固定历史核准来做其原生数据库实例；未来／取消排班等沿用原来源阻断，并未在这轮重复全部历史场景。不能把“7组通过”称为所有生产场景验证完毕。
- 2218个受保护基线文件中仅获准的7处旧源码变化，旧迁移不变；新增14个源码／迁移／测试文件。没有改真实角色、账号、数据或上线状态。
- [固定进度](employee-attendance-progress-20261004.md)仍为17项限定本地已有、6项部分完成、1项未实现，整体P1未完成。C07／C15更广跨来源采用、C23分类保留与争议保全、C24故障备用登记及真实试点仍待各自收口；本次不删除资料、不补造打卡，不扩大余额／工资／外部通知范围。
