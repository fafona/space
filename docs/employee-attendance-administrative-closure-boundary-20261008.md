# C04-B：暂停后开放班次的行政结案边界

2026-10-08。用户已批准有限缺口清单Q2推荐方向。下文保留初始只读调查的业务边界；195行政结案现已实现，并完成末节列明的有限本地原生及独立浏览器验收。它不是生产部署、真实账号／设备试点或整个考勤计划完成声明。无邮箱人员是独立C04-A，不夹带在本包。

## 业务口径

行政结案关闭的是旧班次的操作连续性，不是员工打卡、补正核定、工资结算或劳动合同手续。新增私有案件与不可变操作账本，保存商户、worker／employee、暂停时Auth、任职期、暂停ID及代次、真实起点／尾事件ID及sequence、尾动作、来源指纹、真实操作者和理由。

- 负责人可登记结束时刻未知及理由；未知仍待处理，不解锁任职结束或新上班。
- 明确核验结束时刻后才能行政关闭：真实尾时刻≤核验结束时刻≤锁后服务器当前时刻，使用完整UTC微秒。不得默认取停用时刻、排班终点或浏览器时间。
- 同一真实起点／尾事件仅一个有效边界；不追加虚构clock_out／break_end、不改raw事件、不清空或占用raw sequence。下一次真实上班仍为原尾sequence＋1。
- 行政关闭后仍暂停；再显式走166正式结束、后日同身份再入职、164明确恢复。当天不能再入职，PIN及委托不自动复活。已行政关闭但尚无合法新任职期时不得直接恢复旧开放任职。
- 首版不新增核定时长，不写correction_effect。原段raw endAt／totals仍null，不能显示为0；独立显示负责人核验结束时刻。094／096真实闭合后才能补正的护栏保持。

## 身份、异议和原号

写入沿merchant→settings UPDATE→worker UPDATE→employee SHARE→案件头锁序，锁后重核当前负责人、身份、暂停代次、尾事件、CAS和完整来源。请求未知先保留原号，原操作者GET恢复最小回执；同号完整同命令重放不再写，异命令冲突。

本人需要独立窄入口，在暂停／离职后仍能核对本人的行政结果并追加异议；必须以真实Auth及保存收件身份、当前绑定核验，不靠重新启用打卡或借负责人身份读取。异议不撤销操作边界，不把新任职接回旧班次；负责人只能追加回复，不能覆盖异议或代本人确认。暂停时Auth不冒称旧raw原始Auth，缺历史依据不得倒填135／137或伪造148证明。

## 必需的旧路径兼容

| 接点 | 必须处理的实际断点 |
| --- | --- |
| 166:199–202 | 保留真实尾与暂停快照完全一致、身份、暂停、日期及未结束事项护栏；只让严格有效行政边界替代open_session闭合条件。 |
| 164:369–374及166恢复适配 | 尾事件仍原样核验；行政关闭后没有合法新任职期不得恢复。 |
| 111:79–88、072:86–88、108:134–139、112:47–51 | 四通路都按原尾action推导状态，需要同一个“真实尾＋行政边界”操作头。143:485–489 PIN选班还有独立状态机，不能遗漏。113:105–129 safeFinish不得再次结束已行政关闭旧段。 |
| Self.ts:85–86、PinClock.ts:27 | 严格协议拒绝off＋working原尾；新增明确行政边界分支，保留真实lastEvent和sequence，不伪装下班。无边界者沿原分支。 |
| 070:29、143:283、148:101／175–194、153:124／255 | 新上班原前驱必须clock_out、旧段扫描到真实下班；需要边界证明截断旧段并允许下一段，不能只修writer。 |
| Session.ts:45–67、Timesheet.ts:91、TimesheetResponse.ts:74、ClosureSourceReport.ts:148 | 原开放段后不能接下一段；新增明确行政分段语义，未知时长仍未知。 |

编号指`scripts/supabase-migrations`对应迁移，TS指`src/lib/merchantAttendance*`。新增迁移，不编辑旧迁移文件。来源及报表同时覆盖153动态报告、155固定边界报告、175／179来源和184受托私有镜像。

## 周期与归档

相关新来源保存行政上下文／版本化分段证明，按真实尾截断旧raw段、以行政边界限定关联范围，避免永久污染后日周期。不增加原始／核定合计；涉及未知时长的周期明确保留“行政结案未核定工时”阻断，不能借行政结案封存为完整工时。新负责人关闭检查影响区间封存护栏；本人异议可追加，旧artifact正文、SHA、原号、导出不重采或改写。无行政记录及旧保存版本继续原严格分支。

## 有限验收终点

1. working／break真实暂停；未知时刻不解锁，核验关闭后可进入166。
2. 166结束→后日受控再入职→164恢复→新上班；四入口头一致，原sequence连续而不续接旧段。
3. 本人暂停后仍能看结果、异议；他人／换绑无越界访问。
4. 尾变化、重复命令、恢复竞争及最终写入失败整事务回滚；只测新增共享锁风险，不无限排列。
5. 原事件、旧档精确不变；旧段／新段分离，未知时长不当0、不算工资。
6. 实际负责人及本人窄入口、草稿离开保护、未知原号GET恢复通过后，收口本限定包。

## 195有限本地验收记录

2026-10-08，第八轮同一owned合成集群的实际输出先后为：

```text
PASS 195 install/reentry: 28 exact forward signatures, two private tables, all old facts/OID/metadata and fixed archives preserved
PASS 195 A/B/C: actual present closure, four old-finish refusals and new starts, disclosed historical templates and real old/new period decisions; full rollback
PASS 195 finite risks: direct break closure/time bounds, exact late23514 rollback, actor/body isolation and original receipts, one actual settings close/restore lock witness; micro-commits cleaned by parent
```

六组有限终点的证据分开记账，不用脚本存在代替执行：

| 组 | 已实际通过的有限证据 |
| --- | --- |
| 1 | 现时真实working案经过unknown→真实恢复→break_end尾推进→再次暂停→新候选close；旧候选拒绝，旧来源保留。另一个真实break案直接close，不造break_end／clock_out。核验时刻早于真实尾或晚于服务器当前时刻均拒绝。 |
| 2 | 当日166 rejoin实际拒绝。具名历史模板的后日166 rejoin、164 restore及PIN／现场码／定位／普通网页四通道真实服务开班、结束通过；四通道旧finish各实际拒绝。PIN真实begin／KDF／lease及现场签发未用成功DTO代替。 |
| 3 | 原员工暂停／166任职结束后仍可独立读案、提交异议，负责人实际追加回复；新合成身份的Auth换绑、worker换绑、负责人失权及跨商户正文拒绝，原操作者GET仅得最小原号回执。 |
| 4 | 同号同命令零新增、异命令冲突、旧尾／暂停候选拒绝；以临时owned CHECK准确触发最终entries插入的23514及constraint_name，全部业务写回滚、catalog恢复。仅一对close→restore真实双连接竞争，精确后台PID锁阻塞证据成立，restore锁后重核拒绝。 |
| 5 | 旧行政段工时仍null、totalsComplete=false；真实周期服务send／本人confirm／本人dispute通过、seal拒绝。后继完整段的新周期真实send／本人confirm／seal通过。所有原商户事件、旧155／207归档原文、UTF-8字节与SHA保全。 |
| 6 | 独立浏览器夹具另行实际通过6组：现有Admin宿主、Launcher／Panel／独立self组件，取消0新增POST、未知保号GET、隐藏／Auth晚响应、脏草稿离开、历史25＋1分页、390px无溢出。该层使用隔离localhost与合成响应，不冒称真实Auth或SQL；实际22 API／28 HTTP／3 POST、外部请求0，浏览器／context／listener均已关闭。 |

### 时间、写入与清理边界

- A是新合成商户`99990195`的现时真实RPC。B/C是两份明确披露的新worker／employee／Auth／原号历史模板，分别整体移日；保留正常CHECK／FK／append-only触发器并运行固定来源、任职链与真实137／145旁证checker。模板不是历史真实RPC或真实员工同意，未合成135、未改系统时钟、未改旧事件或旧行。
- ABC至多120步、单90秒连接，最终完整ROLLBACK并核对全事实／函数／catalog／旧归档；报告字段为`coreRollbackRestored`。定位围栏仅新合成地点的savepoint设置，不称真实GPS。
- 风险组只使用另一新合成商户`99990196`，至多64步／64新增行、90秒主连接、单SQL10秒／锁3秒；唯一锁竞争使用两个25秒连接。为让双连接观察真实提交，微量新行会提交；不能称它们也由ABC事务回滚。身份probe与故障CHECK各自完整回滚，其他提交行由既有parent owned schema清理（成功／失败均执行），不删除append-only记录来伪装通过。
- 风险组基线和持久连接统一UTC／ISO／浮点序列化后逐表保护全部原商户行；不把timestamptz的CEST／UTC字符串差异误报为资料变化。最后实际`stopped:true`，复核`postmaster.pid`不存在、16444无监听。未新建集群、未拷库、未使用生产连接。

### 运行时根因与冻结检查

195新私有saved-source helper原先把183真实writer保存前的合法`recorded_at=null`候选当坏资料；窄修为入口一次`coalesce(p_recorded,clock_timestamp())`预检上界。已经保存的非null recorded_at仍原值，finite、来源／hash／固定证明检查保持；实际验收覆盖nullable预检成功及保存时间早于证明的拒绝。未改183 writer或28项旧function recipes。另修195 preflight一个CASE比较括号；历史模板补齐B真实RPC产生的137／145旁证，未放宽现身份拒绝。

最终195自有33项纯／static测试通过，定向lint及语法检查通过。195 SQL SHA256：`4B316703618483053F53127C6B1589E757A17826E77F54F708EA26DCBDF7B187`。

第八轮随后进入198独立adapter，因该adapter未安装registry189前置而失败，已定位为`merchant_attendance_review_routing_prerequisite_required`，不是195失败；整条195→198串联退出码仍为1，不能报告整父链通过。后续应由198 adapter补其真实189前置并保持198 guard，不修改已通过的195矩阵。真实账号／设备试点、生产启用及独立核定工时语义仍未验收或部署。
