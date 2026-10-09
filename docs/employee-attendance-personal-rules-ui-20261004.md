# 考勤个人例外：核准页面与原号恢复

日期：2026-10-04，第146批。承接[第145批独立后端](employee-attendance-personal-rules-20261004.md)，新增默认关闭的人员级操作页面。这里仍是**未应用的候选规则**，不是实际打卡规则、工资计算或员工申请／双人审批。

## 操作范围

- 入口位于负责人“考勤人员”列表的每位人员旁，名称为“个人例外候选（未应用）”。进入独立模态窗口，不混入人员修改表单。
- 核准前明确展示目标人员、工号、员工及登录身份、企业时区、人员／设置／候选版本。不能由输入框替换授权身份。
- 四项规则分别选择继承、明确停用或指定分钟，空白不当作0，不自动填推荐值；至少明确指定一项。范围为未来1–31个当地日期，日期提示来自服务器读取时间，不依赖电脑时钟。
- 提交前再确认人员、身份、日期、完整规则和理由。未开始的核准可填写理由并明确撤回；只追加撤回记录，不删除原核准，不撤回已开始的区间。
- 每页最多25条历史，查看完整原始快照及原操作收据；不以本页条数假装历史总数。服务器提交时仍重新检查身份、版本、时间和重叠。

## 防重复与页面生命周期

- 提交前在当前标签页的 `sessionStorage` 保存原编号、完整请求及企业／负责人／人员范围，并回读核验后才发送。损坏、替换或无法访问的存储不被覆盖。
- 超时、断网、无法可靠解析的回应或身份拒绝不假装成功；保留原编号，阻止新的核准和撤回。重新打开仅查询原收据，不自动重发。
- 只有明确点击原号重试，先查询仍未发现收据、当前身份与原内容继续通过核验时，才重发同一个请求。不能生成新编号掩盖上次不确定结果。
- 已确认收据与本地原命令完全匹配后才清除待确认内容。已知拒绝也须状态码和严格错误格式匹配；模糊错误不能丢弃原编号。
- 隐藏／pagehide、关闭、人员／负责人／授权代次变化会清除可见资料和未提交输入，隔离迟到回复。原生确认窗口返回后再次核对当前页面代次与身份。
- 未提交输入仅保存在内存；重新读取、隐藏、关闭或切换时清除。关闭窗口或离开前对未提交／待确认状态提示。待确认仅限当前标签页，关闭标签页、清理站点数据或跨设备不能保证恢复；没有持久草稿或离线自动队列。

## 接线与保护

- 新增[客户端](../src/lib/merchantAttendancePersonalRulesClient.ts)、[入口](../src/components/enterprise/MerchantAttendancePersonalRulesLauncher.tsx)和[页面](../src/components/enterprise/MerchantAttendancePersonalRulesPanel.tsx)。父级仅在人员列表挂载入口，沿用当前授权代次和编辑／忙碌状态隔离。
- 前端仅 `NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERSONAL_RULES_ENABLED=1` 时出现；服务端仍需独立 `FAOLLA_ATTENDANCE_PERSONAL_RULES_ENABLED`、当前负责人认证和企业资格。本批不配置开关。
- 沿用145的独立接口及129候选账本，不增加迁移，不修改原打卡、工时、审批、Sources128或两层解析。不把本页面的独立查询拼成已经授权的三层来源快照。
- 客户端严格限制响应大小和读取时间，错误体最多4096字节、成功体最多131072字节；操作快照冻结，外部观察者不能修改原请求。生命周期变化及同步存储／订阅回调之后均重新核验代次。

## 本地验收

- 100项定向测试通过：20项新客户端、9项新UI／日期／SSR，以及71项协议、接口、原规则客户端和父管理客户端相关回归。没有失败、取消或跳过。
- 全量TypeScript无增量输出检查、8个相关代码文件ESLint通过；本批未新增迁移。
- [实际页面验收](../scripts/merchant-attendance-personal-rules-browser-check.mjs)8组全部通过：默认关闭／未打开不请求；390px核准和未来撤回；原生模态阻止误操作父页、取消Escape和撤回保留输入；成功回应丢失后实际刷新、暂停状态仅GET恢复；真实重叠409拒绝；未送达操作经明确GET→同号POST恢复；pagehide及人员／负责人／授权代次变化隔离迟到GET／POST；确认期间同范围客户端替换后拒绝旧导航和关闭。
- 最后一项先通过合成同步确认回调复现：旧navigate在新客户端GET之后仍额外发出旧客户端GET。根因是刷新／翻页、关闭确认后没有核对生命周期代次；仅在新增Panel补齐代次／可见状态检查，再完整通过8组验收。该验证不声称实机原生弹窗自然发生此重入，也不是生产事故或旧writer故障；首次读取期间仍可关闭窗口。
- 实际Launcher／Panel／Client经原处理器、服务层、严格解析与129 SQL形成1个个人流、5条成功追加记录。最终通过轮共28次API请求，其中7次POST尝试包含5次成功、1次真实409、1次未送达；原号重试没有多生成记录，撤回不改变原收据。
- 每组前后核对旧业务表指纹不变；7个受保护的145后端／迁移、旧来源／两层解析和旧规则客户端文件哈希未变。
- 复用既有、明确指定且有所有权的本地PG15与临时schema，最终基线恢复、schema清理、集群停止。浏览器与loopback服务关闭，无外部请求，没有新数据库、依赖或完整构建副本。

浏览器中实际运行的是新增入口和页面，**不是完整Admin端到端验收**；父级接线以源检查和相关回归覆盖。认证／企业资格为合成注入，PostgREST以隔离SQL适配；人员／身份／隐藏等外部事件由测试控件模拟。没有运行真实Auth、Next服务、手机、生产容量或实机时间跨界撤回，本批不扩大145已有边界。

主要命令：

```powershell
node --import tsx --test src/lib/merchantAttendancePersonalRulesClient.test.ts src/lib/merchantAttendancePersonalRulesUi.test.tsx src/lib/merchantAttendancePersonalRules.test.ts src/lib/merchantAttendancePersonalRulesRoute.test.ts src/lib/merchantAttendanceRulesClient.test.ts src/lib/merchantAttendanceAdminClient.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
```

浏览器检查由 `runAttendanceLabelsReuse` 在明确指定的停止合成集群内调用 `withAttendanceConcurrencySandbox`，再执行 `checkAttendancePersonalRulesBrowser`。导入脚本不启动服务；必须由单一运行者负责环境，不能自动搜索其他服务器或创建数据库。

## 剩余工作与试点

1. 后续第147批新增[独立三层来源与候选解析后端](employee-attendance-rule-sources-20261004.md)，148批已补[独立只读预览](employee-attendance-rule-preview-20261004.md)。个人来源未读取、超限或身份变化不得当作不存在而继承；本个人核准页面仍不拼接两次请求冒充一致来源。
2. 补历史来源固定与正式异常核查；本账本和本页面均不代表已用于考勤判定，C07／C15仍部分完成。
3. 在获准非生产环境验证真实认证、PostgREST、Next／代理和手机操作；本地合成身份、桌面浏览器窄宽不能代替实机试点。
4. 先核对129及064／124／127等依赖、当前负责人身份和专用测试人员，再按需启用两端独立开关。不得顺带启用所有打卡通路或修改现有角色。

固定24项能力仍为16项限定本地已有、6项部分、2项未实现；详见[进度台账](employee-attendance-progress-20261004.md)。未部署，未修改真实数据，后续发布继续遵守无维护方式。
