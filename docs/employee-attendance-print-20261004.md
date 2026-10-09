# 考勤打印明细：C21本地交付

2026-10-04，第140批。用户在第139批已说明的打印接入范围后回复“继续”，本批据此实施；不授权部署、启用真实商户或修改打卡／审批数据。

## 交付范围

- 普通工时报表、含整段漏卡申报的合并报表均新增独立“核验并打印”区域，覆盖负责人、本人和获授权主管。原CSV区域及下载逻辑不变。
- 勾选资料保管提示后，明确点击才重新读取当前导出范围；查看权限不能代替导出权限。沿用原导出POST及来源读取审计，不新增接口、数据库迁移或业务writer。
- 打印布局为A4纵向：先显示人员、范围与汇总，再列来源记录、按日和逐来源明细。人类可读的时分秒与原始整数微秒并存，不重新计算工时或舍入。
- 原始、核定、整段申报和不同汇总视图分开；未结束时长不伪造为零。打印件明确“核对明细，非已封账工资表”，不把来源哈希当签名／文件校验值。
- 使用临时、不可执行脚本的iframe，仅调用该明细的浏览器打印对话框；不打印整个后台、不静默发实体打印任务、不打开新窗口、不在服务器保存文件。浏览器支持时可由用户选择另存PDF。

## 变更与边界

新增代码：

- [纯打印文档](../src/lib/merchantAttendancePrintDocument.ts)：有界CSV解析、完整性检查、文本转义、版式与元数据。
- [打印控制器](../src/lib/merchantAttendancePrintClient.ts)：复用原查询／收据协议及请求函数，独立处理打印准备与异步时限。
- [浏览器交付](../src/lib/merchantAttendancePrintBrowser.ts)：受限iframe、单次派发及清理。
- [打印组件](../src/components/enterprise/MerchantAttendancePrint.tsx)：独立确认、按钮、状态与同步卸载清理。

只在 [普通导出组件](../src/components/enterprise/MerchantAttendanceTimesheetExport.tsx) 和 [合并导出组件](../src/components/enterprise/MerchantAttendanceUnifiedExport.tsx) 增加兄弟入口及测试用可选开关；没有改旧CSV客户端、CSV生成器、路由、SQL、权限定义、打卡、审批或计算规则。

默认入口受 `NEXT_PUBLIC_FAOLLA_ATTENDANCE_PRINT_ENABLED === "1"` 控制，并位于原导出开关下。实际访问仍须原服务端导出开关及权限。本轮没有配置环境开关或部署；此公开变量需在未来获准的候选构建中核对，不能只在构建后改环境就声称已开放。

## 安全和失败处理

1. 每次新打印重新核验身份／企业／人员／地点／日期和范围版本；旧收据重放不返回文档，不自动重试。
2. 回包、收据、文件名和CSV元数据逐项绑定，包括人员、操作、时区、读取时间、来源摘要／字节数及来源数量。合法A收据搭配B内容也拒绝。
3. 请求起始单调时间计入全过程：所有角色最长五分钟；主管有限租期取更短值并扣除请求时间。在文档生成后、iframe载入后及调用打印前再次检查，不能靠计时器替代。
4. 身份／查询／数据版本变更、卸载、隐藏或pagehide取消任务；新组件使用同步commit清理，防止body外的旧iframe抢在被动清理前打印。HTTP迟到和iframe迟到载入都不能重新派发。
5. iframe只授 `allow-same-origin allow-modals`；无脚本、外链字体、图片、网络请求、导航、下载或弹窗权限。保留现有站点CSP，不为打印放宽全站安全头。
6. 载入最多30秒，派发后等待afterprint或最多60秒回收，均受更短租期限制；隐藏／卸载也可立即回收。重复load只派发一次。
7. 不支持打印、异常、回复丢失及过期均明确提示，可能已有来源读取审计；不声称“没有数据库写入”。调用返回或afterprint不等于已经出纸／保存，已交给浏览器的资料不能保证远程收回。
8. CSV上限4MiB、12,000逻辑行、每单元格16,384字符，生成HTML上限12MiB；超过任一上限拒绝整份，不静默截断。原服务端日期和来源上限继续生效。

逐请求授权和有限租期不能变成即时远程撤权承诺；服务器返回后、本页尚未获知的权限变化无法用静态打印件远程撤回。

## 验收记录

定向测试 **70项通过，0失败／取消／跳过**：新增打印文档24、控制器12、浏览器交付9；既有普通／合并CSV协议、客户端、生成器和契约25。没有运行全量考勤回归或完整构建。

命令：

```powershell
node --import tsx --test src/lib/merchantAttendancePrintClient.test.ts src/lib/merchantAttendancePrintBrowser.test.ts src/lib/merchantAttendancePrintDocument.test.ts src/lib/merchantAttendanceTimesheetExportClient.test.ts src/lib/merchantAttendanceTimesheetExport.test.ts src/lib/merchantAttendanceUnifiedExport.test.ts scripts/merchant-attendance-timesheet-export-contract.test.mjs
node --import tsx scripts/merchant-attendance-print-browser-check.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

全量TypeScript检查通过；相关11个代码／测试文件ESLint通过。独立复核发现的CSV／收据错配及被动卸载清理窗口均已在新打印链修正，没有改旧CSV逻辑。

浏览器专项 **22项通过**：两种报表×三种身份的明确打印与原CSV下载6项，重复点击2项，丢回复2项，HTTP在途隐藏／换身份4项，拒权2项，已准备iframe在父卸载／换身份后释放迟到load 4项，实际打印媒体布局2项。最后一轮共10次拦截的打印派发、6次实际Chromium CSV下载且全部删除。

浏览器使用实际导出／打印组件、控制器和打印文档，HTTP／身份／来源为合成；复刻现有敏感页CSP及X-Frame-Options。准备好的iframe在父DOM首次变更微任务释放迟到load前已经移除，两次迟到load均不打印。实际print媒体检查794px文档无横向溢出、汇总位于元数据之前、10pt正文／表格、重复表头、跨页规则及A4边距；实际使用的字体均为本地平台字体，零自定义字体下载。390px是桌面浏览器模拟宽度，不是手机实机。

打印API由验收桥拦截并模拟afterprint，不打开实体打印对话框；布局／CSS检查不是打印机或实际PDF分页验收。没有页面错误、CSP违规、外部请求或持久存储写入。测试完成后无界面浏览器、回环服务均已关闭，无保留下载／构建文件。

## 资源与剩余关卡

本批不启动PostgreSQL，不创建数据库／依赖副本，不生成完整构建、截图、录像或永久打印文件；使用内存bundle、回环临时服务和无界面浏览器。仅删除本轮浏览器自己生成的CSV下载，不触及用户文件。

真实Auth／PostgREST／Next代理、真实手机的打印支持、实际打印机与保存PDF仍随获准试点验证。本项本地完成不等于P1完成或已上线，亦不补齐周期冻结、组规则或分类保留。下一剩余工作按[固定进度台账](employee-attendance-progress-20261004.md)推进，不重复本批已通过链路。
