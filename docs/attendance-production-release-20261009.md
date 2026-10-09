# 考勤首次正式发布：无维护、单商户首批开放

本文件是操作计划与源码边界，不是部署成功、真实手机验收或数据库已升级的证明。
用户已批准：备份和兼容验收通过后升级正式数据库并无维护发布；首批考勤范围为商户 `10000000`。
不得自动给任何商户开通平台权益、给旧角色追加权限，或把本地/mock 验收称为真实账号/定位验收。

## 固定范围

- 当前发布基线：`b1304d5d58841c2247b93229b90bb7adcfd64965`。新目标必须是审查后当前 `origin/main` 的完整 40 位 SHA，并保留既有必需 CI、干净源码、祖先关系和依赖一致性校验。
- 精确源码清单在 `attendance-production-release-scope-20261009.json`：运行代码、验收素材、配置、操作工具、资料及迁移分别列出。不接受文件名前缀通配。`package.json` 的本地预览别名、独立试点/本地预览工具不是本次正式交付授权。
- 正式登记表基线为 60 行、最大版本 `202609240052`；本次只执行清单中的 061–210 共 **149** 个原始 SQL，165 未使用，完成后共 **209** 行、最大版本 `202610090210`。不得混入未发布的 053–060，也不得以最终 210 独装替代实际升级链。
- 正式候选保留全部既有公共资源、二维码字体、下载功能、旧不可变资产及旧后台 worker。试点 source-only 包不可以充当完整生产产物。

## 最短安全操作路径

由已有固定 SSH/发布工具入口执行，不在聊天中提供或回显密码、环境值、数据库连接串。
所有命令使用同一个已合并并通过必需 CI 的 `TARGET`；`BASELINE` 为上面的固定基线。
这里的 shell 名称只是说明占位，不是允许把未知目标或任意文件注入控制器。

1. 审查并合并本次精确代码闭包，必需 CI 通过；用既有 `prepare-online-release-tool.mjs TARGET` 准备干净、固定 SHA 的发布控制器。不得用未提交工作树、试点打包器或修改状态文件代替。
2. 构建准入要求实际可用内存至少 6 GiB、可用磁盘至少 20 GiB 且无 swap。若内存不足，只通过已有 ownership guard 停止获准的五个独立试点容器，保留它们的数据库和文件，不停止正式服务或 worker；重新核实准入后执行 `node scripts/online-traffic-release.mjs stage TARGET BASELINE`。只准备新候选，完整 `npm run build` 保持所有前置 guard、类型检查、经用户批准的固定构建预算和正常烟测，不联网取包。不能自动或未经批准扩大资源限制，不能跳过原 guard。旧服务继续在线。
3. 候选构建完成后，按已有 ownership guard 启动独立试点服务（如构建前曾为释放内存停止它）；执行 `attendance-production-052-compatibility.mjs` 的真实 **052→210** 新库兼容验收。它只对精确正式库做只读元数据核对和 `pg_dump --schema-only`，保留全部非系统 schema（含 public/auth/storage/extensions）的 owners、ACL、RLS、trigger、constraint 及 default ACL；不复制任何业务、Auth 或 storage 记录，不导出/初始化 cluster globals。新库仅插入 manifest 固定的 60 条 version/name 登记元数据，不复制 applied_at，也**不重放历史 0001–052、不运行 init 或 042 补偿**。源052与新库的完整 normalized metadata 合同匹配后，才执行原哈希绑定的 149 个迁移；全过程正式库元数据必须保持不变。随后用 `attendance-production-database-migrations.mjs dry-run --target TARGET --baseline BASELINE` 核对正式库身份、registry 和原始 SQL；正常加密备份创建并验证、上述兼容验收均成功后才允许 `apply`。`apply` 仍要求明确确认、私有备份及 create/verify 报告，并拒绝手工写出的兼容“通过”文件；完整参数以该已审查管理器的解析器及真实报告为准。
4. `node scripts/online-traffic-release.mjs database TARGET`。这个考勤分支 **不执行 SQL**；只调用管理器再次只读核验正式库及固定位置的真实 DB-ready 报告，随后仅将本候选的安全功能 flag 切换到可用状态，重启本候选并复验。失败保留原状态和证据。
5. `node scripts/online-traffic-release.mjs activate TARGET`。再次核验候选、原进程、代理哈希、同一 DB-ready 报告与实时库状态；按原流程发布不可变资源、检查 nginx、无维护切换并执行原公共烟测。公共验证失败仍只回滚本操作拥有的代理配置。
6. `node scripts/online-traffic-release.mjs status TARGET` 查看实际结果。只有 activation 和公共验证完成才称“已上线”。随后通过正常超级后台为授权商户配置平台权益/角色，使用测试者自设密码的真实账号验证手机定位与授权路径；不得自动造业务打卡。

已有 `database-ready` 的考勤候选重复执行 `database` 只核验，不重跑迁移。
若候选启用时被中断，恢复只接受同一报告绑定的 before/after 文件哈希，不能接收额外环境改动、清空 journal 或复跑已安装迁移。
数据库升级部分完成时，由独立管理器的明确 resume 及既有进度摘要恢复，不用发布控制器重跑 205–209。

## 明确的环境阶段

环境 key 全清单由 JSON 的 `publicFlags` / `serverFlags` / `siteKeys` / `disabledFlags` / `credentialKeys` 精确维护。
`attendanceCandidateEnvironment()` 是唯一阶段映射；未知考勤 key、重复/含糊 dotenv 赋值或 PM2 与真实进程环境不一致均拒绝。

| 类别 | 构建/初始候选 | 真 DB-ready 后候选 |
| --- | --- | --- |
| 已审查 `NEXT_PUBLIC_FAOLLA_ATTENDANCE_*_ENABLED` | `1`，下列危险功能除外 | 不需重建，保持同值 |
| 已审查功能 server flag | `0` | `1`，下列危险功能除外 |
| `FAOLLA_ATTENDANCE_ROLLOUT_ENABLED` | `1` | `1` |
| `FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS` | `10000000` | `10000000` |
| 其他清单内高级 `SITE_IDS` / `SITES` | 空 | 仅 `10000000` |
| reminders runner / retention disposal（含 public disposal） | `0` | `0` |
| enterprise / backup restore E2E harness | 空 | 空 |
| 本候选 background paused / automation worker / invitation worker | `1` / `0` / `0` | 保持相同 |

二维码签名秘密及 PIN pepper 使用既有有效值；缺失时仅为新候选生成独立 32 字节值，私有保存，不输出、不替换已存在值。
原分析签名、retention 开关、订单注意事项商户 `10000000`、正式 console origin、注册/邀请 Auth origin 均继承并核验，不能借本次发布更改。
平台 `allowEmployeeAttendance` 和原角色权限保持已保存配置；首批范围不是替代平台/角色授权的权限。
界面入口由正常 server overview admission 与当前 actor 授权联合控制；原已有班次合法收尾、历史核验规则仍保留，不能为了隐藏按钮删除其安全恢复路径。

## 本次候选有界构建

`attendance-online-build.mjs` 只供本通道调用，不改变其他发布通道。
构建前要求实际 `MemAvailable >= 6 GiB`、候选所在盘可用 `>= 20 GiB`、swap 为 0。
独立 systemd unit 使用实际 cgroup v1 验证的 **4 GiB / 100% CPU / 128 tasks / 20 分钟** 硬限制、整组终止和 `PrivateNetwork=yes`。
网络核验比较 net namespace 并读取 `/proc/net/dev` 的仅 lo 接口，不使用可能仍关联 host namespace 的 `/sys/class/net`。
完整 guard 链在限制内以 Node heap 3072 MiB、明确的 `FAOLLA_BUILD_SINGLE_WORKER=1` 执行；系统不支持实际限制或内存不足时停止，不自动无限制重试。
此固定预算经用户于 2026-10-09 明确批准，仅用于独立考勤候选构建，不改变正式网站、数据库或其他发布通道的配置。本机完整冷类型检查在 1792/2304 MiB 下耗尽堆内存，在 3072 MiB 下通过；本机 Node 24 与服务器 Node 20 不同，且 TypeScript 的内存统计不是整个 cgroup 的峰值，因此这不是服务器构建必定成功的证明。至少 6 GiB 的准入要求不变；4 GiB 硬上限仍可能与线上服务争用资源，失败不得自动继续增大上限。
环境通过私有 `EnvironmentFile` 提供，服务中解析后的关键值逐项和保存 runtime JSON 对比，秘密不放到命令行。
不额外安装/复制依赖，不连外网获取构建包，不跳完整性/类型检查。失败候选、构建证据和备份保留，不自动清理或扩容。

## 回滚与交付口径

`rollback TARGET` 保持原拥有关系与全代理哈希核验，不要求故障候选或新 DB-ready 核验还能成功。
它恢复旧 web 流量，不降级/删除数据库、不恢复旧数据、不删除新记录，不停止原 worker。
旧版与新 additive schema 的兼容性须在切换前证明。未知 SQL、身份、角色/旧记录漂移或新失败一律停止并保留证据。

本地纯测试、源码静态测试、隔离新库验收、正式库升级、候选构建、公共切换和真实手机验收是不同证据；报告应分别列明，不相互替代。

## 获准结束的未发布候选

2026-10-09 的 `5b974eb06c858757c8785d5f9106b006903a5ba0` 在 focused tests 阶段失败：测试固定旧 `www` 来源，而正式入口使用 `launch.faolla.com`。只修正测试环境隔离并补旧来源拒绝断言，不放宽运行时来源校验。

用户批准保留证据后结束该候选，再对修正版本完整重试。`online-unpublished-candidate.mjs` 只接受这一完整 SHA、原基线及原状态 SHA。它取得既有双锁，核对整个 `.next` 和构建私有目录不存在、systemd unit/journal 无构建痕迹、PM2/保存 dump/进程/端口无候选、正式库仍为精确 052 状态且无考勤对象、无升级/兼容操作文件，以及旧代理、维护状态、保留进程、活动版本不变。

`attendance-stage-focused-diagnostic.tap` 是失败测试重放的诊断日志，不冒充原 stage 完整日志。校验结合固定原状态、实际执行痕迹及原构建入口先创建私有目录的代码约束；未知痕迹一律拒绝结束。

操作只写一次 `unpublished-termination.json`，原 `state.json`、候选、依赖、私有环境、日志和原备份全部保留，不伪标发布成功或回滚。共享 pending 校验只认可该固定候选的完整回执和仍保留的原证据；其他待发布操作继续阻止发布。已结束候选仍由旧清理器保护，不扩大清理范围。

新工具必须经正常 PR、必需 CI、合并及 exact-main 验证。首次安装变更 helper 使用已有的 root-owned、干净、只包含固定静态依赖闭包的 sparse bootstrap worktree；逐 blob 验证后先执行 `dry-run`，再执行明确获准的 `end approved-end-unpublished-candidate-5b974eb06c85`。随后正常准备完整发布工具、新候选、新目标备份和完整验收链；不覆盖旧工具或绕过 pending 保护。

重试版本的完整 CI 另暴露了通知客户端的超时边界：响应头已到达、reader 尚未建立时，lease 的 deadline/Auth 校验拒绝后没有取消未读取的 body。以可控时钟确定性复现并补齐该拒绝路径的取消操作；生产超时、成功路径、字节上限、身份和原编号恢复规则均不放宽。原 8ms 墙钟测试改为先确认正文读取已开始、再明确触发 deadline，仍验证正文被取消。

账号状态测试不再以固定 10ms/5ms 等待猜测异步指纹计算与请求启动已完成。两次请求分别提供明确的进入屏障，再撤销 Auth 或暂停；屏障同时与操作完成竞争，未发请求就结束会直接失败，不永久等待。生产指纹计算、默认 12 秒超时、原记录和恢复行为未改。

有限检查 88 个考勤客户端测试文件，另外确认独立员工管理、独立终端及更正委托的三个测试也在请求前等待真实异步指纹，却以短轮询猜测请求已经开始。这三个 fixture 同样改为每次请求独立的进入屏障，保留原 Auth/设备撤销、暂停、存储 CAS、原始字节及正文取消断言；只修测试，不扩大等待时限或改成功逻辑。上述四个修正后的客户端测试加入候选 focused tests，原完整 CI 和 exact-main 检查继续保留。
