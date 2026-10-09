# 三层候选规则只读预览（第148批）

日期：2026-10-04。承接[第147批专用来源后端](employee-attendance-rule-sources-20261004.md)，新增独立页面与只读客户端。不修改现有打卡、工时、个人核准、旧来源或两层解析。本批不配置开关、不部署、不操作真实资料。

## 页面与数据边界

- 人员列表新增「三层规则预览（未应用）」，前端仅在 `NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED=1` 时显示。服务器仍须独立 `FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED=1`、当前负责人身份与企业资格；隐藏入口不是权限控制。
- 原生模态弹窗独立懒加载，打开时日期为空、零请求；用户选择连续1–7个企业当地日期并明确读取后才执行GET130。不自动读取、轮询、恢复请求、保存、发布、核准、撤回、导出或下载。
- 同一次授权读取中的个人核准 → 考勤组 → 企业候选按字段显示。0、明确停用、继承、无个人核准、无归组、无候选发布、缺失或冲突不混为一谈。个人区间结束后回到下层，撤回记录保留但不参与有效候选。
- 每段保留UTC半开区间、原操作／操作人／登记时间、版本、时区和身份依据；归组原快照与当前组资料分开，个人核准和撤回分别展示。时间段与各类来源均每页最多10项，分页只使用本次已读内容，不追加请求。
- 明确标注「未应用、未历史固定、非异常或工资结论」。查询过去日期只是当前候选来源的投影，不证明当时采用了哪一版本；不读取或判断打卡、排班、请假、日历。
- 模块暂停但当前读取授权有效时仍可核对候选；人员或来源停用、超限、身份变化与歧义由既有严格协议和纯解析器保留拒绝／阻断语义。

## 生命周期与受保护范围

- 编辑日期立即移除旧结果；页面隐藏、pagehide、关闭、人员／企业／负责人／认证fetch变化、父授权代次变化或卸载后，清除结果和未提交日期，旧请求不得回显。返回后不自动读。
- 新客户端只接受完整身份和日期绑定的 `rule-sources-v1`；成功响应体上限1,049,600字节（包含HTTP包，内部数据仍受原1MiB约束），错误体4,096字节，头和流式正文共享12秒期限。拒绝重定向、非200成功、错误状态与错误包不一致、非JSON及非法UTF-8。该期限不是生产性能承诺。
- 客户端选项复制并校验，状态和结果递归冻结；同步订阅回调／abort回调启动新读或暂停后，旧调用再次核对代次。不使用浏览器存储或新增依赖。
- 父管理组件只增加import和一个人员行入口，沿用原忙碌／编辑／授权状态隔离；不变更原人员编辑、配置保存、其他入口和客户端。
- 新增[入口](../src/components/enterprise/MerchantAttendanceRuleSourcesLauncher.tsx)、[页面](../src/components/enterprise/MerchantAttendanceRuleSourcesPanel.tsx)、[三层展示](../src/components/enterprise/MerchantAttendanceThreeLayerRules.tsx)及[客户端](../src/lib/merchantAttendanceRuleSourcesClient.ts)。无新迁移，130及其后端、旧128／129路径和既有writer保持不变。

## 本地验收记录

- 113项定向测试通过：新客户端20项、新UI／SSR及接线契约19项、原来源协议／接口／三层解析／父管理客户端相关回归74项。无失败、取消或跳过。全项目TypeScript无增量输出检查、10个相关代码文件ESLint通过；本批没有新迁移，不重复147的重型上限／并发夹具。
- [实际页面验收](../scripts/merchant-attendance-rule-sources-browser-check.mjs)7组通过：默认关闭及未查询零请求；桌面0值／停用／逐层继承及个人结束后恢复组规则；390px无横向溢出；改日期清空；原生模态阻止误点父页、Escape及关闭重开；暂停仍只读；401／403清除旧资料；隐藏／pagehide、人员／负责人／企业／授权代次／active／卸载以及认证fetch变化隔离迟到头和正文。
- 本轮20次API请求全部为GET，19次进入实际处理器→服务→130 SQL（401在执行前拒绝），页面0次POST。最小准备仅1组、1归组、2条企业／组候选发布、3条个人核准／撤回操作；它们由真实RPC写入本轮自有合成schema，不是真实用户资料。每次读取及各组检查后全表指纹不变；文字转义、零外网请求、不写浏览器存储与不触碰无关存储通过。
- 复用原有停止的本机PG15，没有新集群、数据库副本、依赖安装或磁盘完整构建；浏览器资源在内存构建。结束后临时schema清理、既有基线恢复、浏览器／回环服务关闭、集群停止。
- 17个受保护后端／旧客户端／旧页面／迁移和运行包装器哈希不变。父管理文件与原文比较，仅增加一个import和一个人员行入口；未改变既有成功逻辑。

浏览器实际运行新Launcher／Panel／Client，父管理接线以源码契约和旧客户端回归覆盖，**不是完整Admin E2E**。身份、资格和生命周期故障为合成注入，数据库传输用隔离SQL适配，不是实际Auth／PostgREST／Next或手机实测。真实SQL夹具仅2段，跨页按钮及10项渲染上限由SSR／源码契约覆盖，未声称浏览器多页翻动实测；布局断言也不等于实体手机或生产容量验收。

### 检查中修正的两个显示问题

1. 原采用标记只比较操作UUID；个人与发布账本可存在相同UUID，导致下层也被标为采用。仅新展示组件补层级与组标识比较，并以严格parser可接受的跨层同UUID输入验证。
2. 通用来源快照把企业层的继承也写成「继承下一层」。仅新组件按层显示企业未设值、无更低层、不补默认值，新增SSR反例通过。均不修改底层规则选择或历史事实。

主要本地命令：

```powershell
node --import tsx --test src/lib/merchantAttendanceRuleSourcesClient.test.ts src/lib/merchantAttendanceRuleSourcesUi.test.tsx src/lib/merchantAttendanceRuleSources.test.ts src/lib/merchantAttendanceRuleSourcesRoute.test.ts src/lib/merchantAttendanceThreeLayerRules.test.ts src/lib/merchantAttendanceAdminClient.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
```

浏览器检查由唯一运行者通过 `runAttendanceLabelsReuse` 和 `withAttendanceConcurrencySandbox` 包装，显式指定原有停止合成目录后调用 `checkAttendanceRuleSourcesBrowser`。导入脚本不启动服务；不得指向应用数据库或自动新建集群。

## 后续与真实试点

1. C07／C15仍是部分完成。下一步明确历史计算依据如何固定、何时生效、如何纠正与封存，之后才推进正式异常核查；不得拿当前候选追溯改写已核定工时。
2. 真实环境仍需获准的独立测试网址／数据库、专用负责人和至少两名员工；实际Auth、PostgREST、Next／代理、手机登录及撤权要独立验收。用户尚无专用账号，本轮仅本地合成资料。
3. 试点按依赖核对130与064／124／127／129的前置迁移及两个独立开关，不顺带启用其他写入口。无维护发布规则不变；本轮没有发布操作。

[固定进度台账](employee-attendance-progress-20261004.md)仍为16项限定本地已有、6项部分完成、2项未实现；新增只读预览不代表整体P1或正式规则已经完成。
