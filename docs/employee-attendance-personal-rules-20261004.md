# 考勤个人例外：独立核准候选账本

日期：2026-10-04，第145批。承接[两层候选解析](employee-attendance-rule-resolution-20261004.md)，本批新增个人例外的数据协议、独立账本和默认关闭的接口。**145交付时尚无操作页面；146已补[页面及原号恢复](employee-attendance-personal-rules-ui-20261004.md)。仍未接入三层来源解析，也没有应用到打卡、工时或异常判定。未部署。**

## 实现范围

- 采用“负责人核准登记”，不是员工申请／负责人审批，也不声称双人审核。负责人明确提交完整规则、人员、日期和理由后，原子追加一份核准快照；没有持久草稿、自动核准或通知。
- 单次为未来1–31个含首尾的当地日期；最早当地次日开始，必须填写结束日。31天是首版技术范围，不是法律规定或长期政策建议。
- 保存企业时区及UTC半开边界。夏令时不用固定24小时推算；不存在的起止当地日期拒绝，结束边界支持紧接跳日以及2100年末的下一年边界。
- 人员绑定同时核对商户、考勤人员ID、员工记录ID和员工Auth身份；核准人独立记录。建立后的个人记录流不随换绑自动转移。当前身份不同会拒绝读写／原号恢复，旧记录仍保留，不被清空或改绑。
- 新核准要求当前负责人、启用的考勤人员和已绑定启用员工；人员版本、设置版本、时区及记录流版本必须匹配。部门／姓名不能代替身份授权。
- 四项规则沿用明确的继承、停用和值（包括允许为0的字段）；全为继承不构成例外，拒绝登记。不会沿用旧版的非空值。
- 同一人员未撤回的核准区间不得UTC重叠；相邻端点允许。锁定当前身份／设置后检查重叠与版本，防止两个并发提交都通过。
- 撤回只能在原区间开始前追加一条记录，完整保留原核准快照。开始后不能整段撤回，也没有提前结束或追溯补批接口。
- 原操作编号和内容保持不变；当前同一负责人、同一目标身份可在暂停、停用或设置变更后核对已成功收据。不同内容、人员或核准人不能复用原编号；暂停不允许新写入。
- 历史每页25条，返回明确下一页游标；收据保留原快照，撤回标记是列表派生状态，不修改原收据。

## 接线与保护

- [协议和严格解析](../src/lib/merchantAttendancePersonalRules.ts)、[服务层](../src/lib/merchantAttendancePersonalRules.server.ts)、[接口处理器](../src/app/api/merchant-enterprise/attendance/personal-rules/route-handler.ts)。
- 新接口 `/api/merchant-enterprise/attendance/personal-rules` 仅在 `FAOLLA_ATTENDANCE_PERSONAL_RULES_ENABLED=1` 时可用，默认关闭。本批未配置开关。认证方式、同源入口、请求大小、频率和企业资格检查独立执行，数据库再次核验当前负责人。
- [129候选迁移](../scripts/supabase-migrations/202610040129_merchant_attendance_personal_rules.sql)新增两个私有表及专用函数，依赖064／124／127及其依赖。服务角色仅执行重新授权的RPC，不获表直读写权限；核准／撤回操作禁止更新、删除和截断。
- 原127企业／组账本、128来源协议及144两层解析不修改。没有把两次不同时间的请求结果拼成三层依据，也没有把尚未读取的个人例外当作“不存在”。
- 原始打卡、已有审批、排班、请假、报表和工时计算不变；不新增工资、假期余额、打卡阻断或默认员工授权。

## 本地验收

- 114项定向测试通过：新增24项协议测试、6项接口／服务边界、13项迁移静态契约，以及71项相关规则／来源回归。无失败、取消或跳过。全量TypeScript（不写增量缓存）、8个相关代码文件ESLint及130个迁移文件校验通过。
- [原生验收](../scripts/merchant-attendance-personal-rules-native.mjs)10项全部通过：真实执行129及TS解析，核对安装／重入、核准／撤回、重叠和相邻时段、暂停恢复、双身份及负责人边界、严格值和日期、25＋1分页、真实并发锁、处理器→服务→SQL和私有权限／不可改写。
- 隔离库内通过真实RPC形成2个个人流、28条追加操作（26＋2），正常操作没有直接预造个人账本数据。包括48次成功结果解析、5次处理器经服务调用SQL，以及1次按确切阻塞PID见证的并发冲突：只有一个同版本核准成功。
- 原审批快照和原号重放保持一致。停用／暂停／设置变化、Auth重新绑定、人员解绑、换负责人等检查均在可回滚的合成环境内进行；受保护旧表和旧函数指纹不变。
- 包含实际数据库时钟决定的未来日期、31天上限、Madrid夏令时区间，以及SQL与TS对照的Apia跳过次日／2100年末结束边界。**开始后撤回**已由实现中的锁后墙钟检查、静态契约及微秒边界纯测试覆盖，本轮没有真实等待跨过开始时刻，不能声称该时间跨界场景已原生见证。
- 复用既有指定停止PG15和有所有权的临时schema；最终确认基线恢复、schema清理、集群停止。没有创建新数据库／依赖／完整构建副本，没有启动浏览器或访问生产。
- 原127／128迁移、规则／来源解析器、两层解析器和Sources页面6个文件的SHA-256均未变化。新功能没有修改这些既有路径。

认证和企业资格为合成注入；真实Auth、PostgREST、Next／代理、浏览器操作、手机、容量和故障恢复仍待相应试点。以上次数是验收证据，不是生产性能指标或整体完成比例。完整历史多页读取也不是冻结快照。

主要命令（仅本地合成环境）：

```powershell
node --import tsx --test src/lib/merchantAttendancePersonalRules.test.ts src/lib/merchantAttendancePersonalRulesRoute.test.ts scripts/merchant-attendance-personal-rules-migration.test.mjs src/lib/merchantAttendanceRules.test.ts src/lib/merchantAttendanceRuleDraft.test.ts src/lib/merchantAttendanceRuleResolution.test.ts src/lib/merchantAttendanceSources.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node scripts/check-supabase-migrations.mjs
```

原生脚本必须明确传入 `--run-local --directory` 及既有、停止、有所有权的合成集群绝对路径；不自动寻找服务器或创建数据库。导入脚本不启动服务。

## 尚未完成

1. 145时待补的默认关闭操作页面、明确确认与待确认编号恢复，已在[146批](employee-attendance-personal-rules-ui-20261004.md)完成限定本地验收；不是跨设备或关闭标签页后的保证恢复。
2. 同一次授权读取内加入个人来源的独立协议，再解析个人→组→企业三层候选；个人来源缺失、截断或身份变化时不能假装继承。
3. 历史来源封存与正式异常核查；本账本自身不代表规则已应用。
4. 实际Auth／PostgREST／Next代理、真实手机、权限撤销和容量试点，仍按[试点清单](employee-attendance-pilot-readiness-20261002.md)准备。

固定24项仍为16项限定能力本地已有、6项部分、2项未实现。C07／C15仍部分完成；没有用新增接口或测试数量增加整体完成度。
