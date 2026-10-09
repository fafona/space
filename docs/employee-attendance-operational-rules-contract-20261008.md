# C07／239：八项业务规则的纯合同基础

本包承接用户已批准的 Q4。首先实现严格值域与纯解析，不接生产、不修改旧四阈值协议，不声称已发布或已经执行。完整消费点见[八字段边界](employee-attendance-remaining-rules-boundary-20261008.md)；只有纯合同通过不能把 C07 标成完成。

## 固定协议

文档恰有八键：`allowedChannels / locationScope / shiftSource / breakTypes / correctionWindow / reviewRouting / timesheetCycle / reminders`。每键仅三种严格形状：`{mode:'inherit'}`、`{mode:'disabled'}`、`{mode:'value',value:…}`，拒绝未知键、隐式缺省、重复 JSON 键、访问器、稀疏数组、非规范 UUID、非整数及无效日期。输入上限 32 KiB、4096 节点、深度有界；不要静默截断。

- 通路：规范排序、非空的 `self/location/pin/onsite` 子集；地点：规范排序、非空且至多25个 UUID。此处只能验证形状，不能确认商户归属或通路资格。
- 班次来源：`published_selection` 或 `unplanned`；不自动匹配班次。
- 休息：`{allowed:[paid|unpaid…],selection:fixed|explicit}`；fixed 仅一个值。解析不产生休息事件。
- 申请窗口：`{days:0..365}`；独立企业政策仍是额外上限，缺政策不是无限期。
- 审批路由：恰四键 correction/missing/leave/work_arrangement，各为 `owner` 或恰有 delegateEmployeeId/delegateAuthUserId 的对象。不是授权凭据，不能由此审批或隐式交接。
- 周期：`{kind:'weekly',weekStartsOn:1..7}`、`{kind:'fortnightly',anchorDate:真实民事日期}`、`{kind:'monthly'}`、`{kind:'manual'}`。本基础不计算时区边界、不生成或封存周期。
- 提醒：恰三键 open_session/pending_review/period_due，各为 `{mode:'disabled'}` 或 `{mode:'enabled',afterMinutes,repeatMinutes,maxOccurrences}`。技术边界分别为1..44640、60..44640、1..10，无默认管理期限；本基础不创建通知或任务。

## 纯三层预览

`parseOperationalRules(unknown)` 与 `parseOperationalRulesJson(text)` 返回不可变严格文档。解析器输入恰有 enterprise/group/personal/baselineCorrectionWindowDays，enterprise 必需，group/personal 可为 null，表示调用方未提供该层，不证明真实业务没有该层；baseline 为0..365或null。

一般字段逐字段个人→组→企业选择；disabled 明确保留来源而非当作 inherit。地点是例外：所提供的所有 value 集合取交集，某层 disabled 不解除其他层；空交集是明确空集合，不是未配置。真实运行时还须与原通路授权相交。

窗口保留所选值，并另列 baselineDays/constrainedDays/baselineMissing；有基线时只取更紧上限，无基线时 constrainedDays 为 null，不伪造可申请资格。各字段列所提供层的 trace 与选择／贡献来源，不制造规则版本、身份、发布时间或完整来源证明。

整个输出明确属于 preview，published/effective/authorized/applied 均不能为 true。禁止把本结果替代下一包的数据库核准、身份与地点校验、锁内重验或实际使用旁证。

## 本包的有限终点

严格形状、八类值域、继承与停用区分、地点交集、零天和缺基线区分、不可变输出及非法 JSON／对象测试通过。本包不重复旧四阈值测试，不接旧入口；后续仍须完成核准存储、实际打卡／申请消费、周期采用及有界提醒。

## 本地验证记录

239纯基础已实现，仅新增 `merchantAttendanceOperationalRules.ts` 及其测试；主线程独立执行29项测试、这两个文件的ESLint、全项目TypeScript无输出检查，全部通过。包含UUID尾部换行拒绝、真实0001–9999日期及超长属性名在读取值前拒绝。没有数据库／浏览器／生产动作，不能把纯预览计作已核准或已执行规则；接下来实施独立版本账本。
