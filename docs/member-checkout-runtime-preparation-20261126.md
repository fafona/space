# 会员预约／产品结算：正式运行准备清单

2026-11-27 更新：优先采用受限数据库连接作为待接入方向，第一阶段 PG15.8 探针隔离验证已通过；不先配置独立签发资源。实际应用／生产授权与网络尚未接入，准确结果和剩余项见[调用路径复核](member-checkout-transport-decision-20261127.md)。下文 JWT／签发材料为保留历史，不自动作为新候选的生产操作步骤。

状态：本地准备方案，不是安装／授权／部署命令。Stripe 最后接入，当前保持关闭。

最新补充：用户已批准现有 root 网站身份不动、签发走独立安全域的本地方案/隔离验证；本阶段已完成，见[独立签发方案](member-checkout-isolated-signing-plan-20261126.md)。20 项协议/身份检查、8 项真实隔离场景及本地 2 项旧控制器衔接测试通过。它没有解决正式资源选择、实际 JWT 信任配置、宿主 root/更宽凭据绕过或持久灾难恢复，不是正式签发或安装就绪。本轮未访问正式环境/密钥，不重采已有基线。

后续监督衔接已本地完成：新增独立监督层，在交付端停止后终止旧续发循环，保留原控制器/协议/业务不变；最新独立 CI 的 49 项检查和 6 项真实 TLS/原文件生命周期场景通过。明确保留不合作签名调用的 pending 状态，不冒称物理停机或持久恢复。尚需用户确认独立资源位置，再列正式提案；不创建资源、不读取正式环境或密钥、不安装/部署，不启用 Stripe。

## 1. 不再重复的工作

- 应用候选仍固定 `b089e659…`／2974 文件 `e41ee7fe…`，续发固定 `5a7381a2…`；不改原应用、38 步 SQL 或旧写入路径。
- 应用／原生安装共同验收仍引用 `98920198…` 的 18 作业／524 场景；独立来源准备仍引用 `599c1497…` 的 53 项 CI。新元数据测试单独记录，不与它们相加，也不刷新原证据。
- 214 条登记、26 个函数和三个守卫已经有保存基线，不再重新采集来代替下面的运行缺口。安装窗口的漂移检查是另一个明确授权阶段，不能提前执行。
- 07:58 UTC 的单次运行事实读取已结束。它没有证明网关绑定、运行默认值、应用 UID／GID 或备份覆盖；这份方案不产生重连许可。

## 2. 当前运行事实与剩余交付

| 缺口 | 已知事实 | 下一项交付，不以推测代替 |
| --- | --- | --- |
| 网关实际鉴权链 | 09:39 UTC 已确认固定明文监听可用、5 个相关 service／5 个 route／9 项已启用插件绑定，前后元数据一致 | 绑定元数据缺口已补；有效 JWT 签发／验证配置及端到端调用能力仍需单独交付，不能由插件名称推断 |
| 签发信任 | Auth／REST 的 secret 环境项存在，值未读；显式 audience 等部分已知 | 有效算法／issuer／audience／kid 和可用受信签发入口的配置来源证明；不能因环境项同名就认定钥匙相同，不能导出钥匙来比较 |
| 应用身份 | 10:10 UTC 已完成准确活动记录→PID/start-time→CWD／exe 元数据→前后监听 FD/socket 的共同绑定；具体进程／身份字段仅私有保存 | 元数据缺口已补，不等于公网流量、PM2 监督、可执行字节或签发隔离已获证明；不自动改变现有应用身份 |
| 持久目录与服务 | 拟用根目录及子目录、指定 issuer unit 不存在 | 批准后的准确 OS 身份、目录 owner／mode、签发服务生命周期、短期交付和暂停／撤销机制；不能把 stat 目录当作已经完成这些交付 |
| 独立备份恢复 | 指定演练凭证不存在；结算路径覆盖未知 | 明确覆盖清单、独立加密备份位置／保留规则／恢复者及可验证恢复边界；“有备份文件”不等于恢复验证通过 |

## 3. 元数据读取先做到可靠

新组件 `member-checkout-runtime-metadata.mjs` 是纯输入投影，无文件、网络、命令或安装入口。它只解决已在本地复现的两种兼容性：

1. Linux comm 可含括号；`next-server (v1` 不能被旧字符白名单拒绝。Name 仅散列用于同一快照一致性，不作为可执行文件或权限身份。
2. Kong 监听可同时有明文／TLS 地址、reuseport、backlog 等生成参数。先解析准确字段；off／TLS-only／IPv6-only／proxy-protocol／未知地址不能被当成可安全调用的 IPv4 明文端口。

进程必须比较前后 PID/start-time、Name 和 CWD；CPU 计数变化不算身份变化，PID 重用或目录变化必须拒绝。即使解析通过，`publicTargetBindingVerified`、`executableIdentityVerified`、`signerIsolationApproved` 仍为 false，不能据此获得正式能力。

独立 owned Linux／Kong 测试只操作自己创建的 child 和带随机 owner label 的临时容器；无生产网络、宿主挂载或端口发布。它不核实上次线上拒绝的具体原因，也不能把旧报告的 unknown 改成 observed。

格式验收已完成：代码 `bb6e73edb780bbc189ea7a3feeb640222b1d833e`、独立 CI `45787507433`，24 项纯投影／拒绝检查及 6 项真实 Linux／Kong owned 检查成功；child／容器清理通过。初版 `79057d16…` 与诊断版 `f92ca1c5…` 的失败原样保留。临时 tmpfs 盖住 Kong 安装库的问题已定位，改用 `/tmp/faolla-kong-prefix` 并实测库文件仍可见，保持只读根文件系统／无网络／无宿主挂载／无公开端口。这只修测试夹具，不改变正式 Kong 的 prefix 或任何配置。CI review SHA `77477e16b062a33a86904de5d0dfaf284f28dbbb263cadb049f414f240a6a76a`。

Kong 2.8.1 的生成代码会用逗号序列化 table 值；该参考仅用于版本格式核对，不用于推定正式有效值。[Kong 2.8.1 源码](https://github.com/Kong/kong/blob/2.8.1/kong/cmd/utils/prefix_handler.lua#L439)

新的线上读取仍须另行明确批准。其输出应有固定阶段错误码和字段名，不吞掉失败原因后只给“未知”；原错误、容器身份、操作及字节摘要必须保留。禁止端口扫描、补装工具、读取完整配置后带回本机再脱敏，或在采样过程中修改配置。

### 源端投影和活动进程绑定方法已验证，尚未读取正式环境

`member-checkout-kong-source-projection.mjs` 生成源端 Lua 程序：只允许 127.0.0.1:8001 的固定 services／routes／plugins GET，HTTP/1.0 close、3 秒期限、响应有界，不用 DNS／代理，不跟随重定向，不安装 curl。使用镜像内置 LuaJIT 和准确 OpenResty 模块路径；错误仅输出固定码，不输出原响应。相关 service／route UUID 形成白名单，插件只返回 id／name／enabled／serviceId／routeId／scope；不请求 consumer 或凭据端点，不导出 config、consumer 或凭据值。分页或异常绑定拒绝，不继续抓取任意 next URL。

**权限边界必须如实说明：**插件响应在 Kong 源端进程内存中仍会被临时解析，响应中可能包含配置字段；这不是“完全不读取插件响应”的方法。完整响应和配置不离开该源端进程、不保存到磁盘，生成程序本身也不是读取许可。它不属于 07:58 那次“不读完整插件配置”的许可，必须另行明确批准这种源端临时处理，不能把“未导出”冒称“从未处理”。普通插件实体包含 config 字段，故不能直接把该接口正文带回本机。[Kong 2.8.1 插件实体](https://github.com/Kong/kong/blob/2.8.1/kong/db/schema/entities/plugins.lua)

`member-checkout-active-runtime.mjs` 为纯绑定器：准确四字段活动发布记录、其 inode／时间／owner／mode、对应 PID 文件和进程前后快照、可执行文件元数据，以及该进程前后实际持有的目标 LISTEN socket 必须一致。64 位 inode 用十进制字符串保存；不遍历旧 PID 后猜最新进程。绑定结果依然明确不证明 executable 字节、PM2 监督、公网入口或 signer 隔离，更不授予安装／部署权限。

准确代码 `8924b724bd92941e50fdaca2f49b9e1eca6d1b2a` 的独立 owned CI `45791564416`：53 项检查（新 29＋保留 24）及 7 项真实隔离场景通过。受控 Kong 实际导出两个服务／两个路由、全局／服务／路由三类插件绑定，合成隐私占位值不进入导出或报告；重复采样的元数据稳定。另一个受控 Node 容器实际绑定活动文件、PID、CWD、exe 元数据和监听 socket，错误 socket 拒绝，受控 root 不被当作 signer 隔离。两个容器均核验随机 owner label、image／ID 后清理；未连接正式环境。

前两次 owned 失败保留：初版依赖镜像内不存在的 curl；随后独立 LuaJIT 未设置 OpenResty 模块路径。新实现只使用已有运行时，并限制到 bundled 模块路径，不修改镜像或正式配置。三份原报告、TAP、运行身份和完整日志已下载复核，review SHA `0f54acbf7855f11849b17df809a66a1f0fb69651c72c526f46130218e8176b3f`，证据在 `output/checkout-source-projection-20261126/`。原应用、38 步 SQL、旧工作流、v2 清单与正式 unknown 原稿不变；不是新增应用／支付验收。

下一次拟议窗口只核对两项：①已知 Kong 来源／准确有效监听字段、相关服务／路由及上述白名单插件绑定；②活动发布记录所指应用的 PID／UID／GID、CWD／exe 元数据和目标端口 socket。先把采集器本地测试通过，再取得新的单次许可；不读取客户记录、完整环境、JWT／密码／签名钥匙，不查数据库、不改配置／权限／数据、不创建目录、不安装或部署。其它签发提供者、独立备份和公网入口证明仍待后续明确交付，不能由这次方法验收自动补全。

### 09:39 UTC 新单次读取结果：网关已确认，应用仍未确认

用户问题 `call_82a428f29ee34fb8ac324639c7d13bdf` 明确允许源端临时处理和准确活动进程核对。私有采集器先通过 68 项本地测试（原 53＋私有新增 15），再执行唯一一次受信 SSH；无重试。网关导出白名单进一步收窄：service 仅 id／name，route 仅 id／name／serviceId，plugin 仅 id／name／enabled／serviceId／routeId；host／port／path 也在源端序列化前去掉，没有完整响应／config 导出或落盘。

已知 Kong 容器身份／镜像／挂载稳定；固定有效监听字段确认允许 `127.0.0.1:8001`，六次固定 GET 的投影一致。5 个相关服务与 5 条路由绑定完整；9 项插件均启用。`rest-v1` 与 `auth-v1` 各绑定 acl／key-auth／cors；三个公开 Auth 服务分别绑定 cors。只确认名称和关系，不读取这些插件的配置、consumer 或凭据，不据此认定 JWT 算法、同一钥匙、网关角色授权或端到端结算已可运行。

应用分支在 `active_process_before` 返回 `metadata_file_changed`，没有得到完整身份绑定；报告没有保留具体路径标签和变化字段名，故无法从现有证据认定是 `/proc` 时间字段、PID 变化还是其他原因。**这是采集器的一致性检查拒绝，不是应用故障证据。**不放宽检查、不猜 UID／GID／root、不据此安装。网关结果可独立保留，不因应用失败而重复采集。

报告 SHA `5c8cb6750f7f55936950085effdb82cfb0d9311ba936042517ff9f5e584feab5`，离线 review SHA `6440c4c3bfc58bd15a373f3a71f4c71ea55c67bd70ff7cc026f9306a41dfa312`，实际发送源 SHA `b65e6b6c62d5c1429247cad7a7db3e60b391e8b0d1fd6b5add554404447ded9c`。证据在 `output/checkout-missing-runtime-approved-20261126-c8274f/` 私有保留，原报告和原采集器不覆盖。数据库查询、客户记录读取、远程写入／目录创建、权限修改、安装／部署均为 0；Stripe／邮件不启用。本次许可已消耗，下一次应用诊断必须另获明确许可，不能重跑这份 runner；原 524 应用场景／来源准备 53 项 CI 不重新累计。

### 09:49 UTC 应用专用诊断：准确定位到内核网络表的路径时间戳

新批准 `call_34f45735dda9482babda2b14b4a4040b` 仅用于应用。保留上一采集器原字节；新采集器无远端子进程／网络／网关／数据库入口。先通过 60 项本地检查（原纯组件 36＋私有诊断 24），逐字段故障注入验证原九字段比较、文件大小、owner／mode／inode、重复 PID、错误 socket 等拒绝不变。只增加固定资源标签、检查阶段和变化字段名，不返回任意错误正文、字段值或额外路径。

唯一 SSH 在 09:49 UTC 退出 0／stderr 0，未重试。准确诊断为 `tcp4_before / after_path_identity / metadata_file_changed / [mtimeNs,ctimeNs]`：文件打开前后、读取后 FD 的全部九字段检查均已通过；路径重新 lstat 时 dev／ino／nlink／uid／gid／mode／bytes 一致，仅上述两时间字段不同。确认的是**采集器拒绝的具体原因**，没有取得完整应用身份，也没有发现或证明网站业务故障；不报告 UID／GID／root、PM2 监督或公网绑定已就绪。

机制参考：Linux 的 `/proc` 是内核数据接口，`proc_get_inode` 的伪 inode 可在构建时赋当前时间；不能把这份上游源码冒充正式主机的实际内核版本或本次 dentry 生命周期证明。[内核 proc 文档](https://docs.kernel.org/filesystems/proc.html)、[Linux v4.18 proc_get_inode](https://github.com/torvalds/linux/blob/v4.18/fs/proc/inode.c#L420)。本次记录没有采集或扩大读取内核版本。

下一项仅为提案，尚未修改已使用规则：将准确 `/proc/net/tcp`、`/proc/net/tcp6` 与普通持久文件区分，先确认 procfs 类型及打开句柄身份，仍核对设备／inode／owner／mode／大小、前后 PID/start-time、目标 LISTEN 行及进程 FD/socket；普通 active／PID／exe 文件仍完整核对时间戳。须先补拒绝回归与真实隔离 Linux 验收；不得将任意文件或所有 `/proc` 都列入时间字段例外，不放行非 procfs、inode／权限／进程／socket 变化，也不拿本次诊断直接重试。新规则及新应用读取窗口需另行明确批准，不再读取已确认网关。

原报告 SHA `176820d7f9bdf5422c1bb2e6ca730b92663ad010297e4145360a1d684a469f3e`，发送源 SHA `f4ce8605e0b46597375357d0a379872dfcc2c2ddccd81db9e334cd1087da1c48`，独立离线 review SHA `54125868a23e04b2dc68936d8d0c0b2e7969592b1572f9502f6a988368dd3306`，证据私有保留于 `output/checkout-active-app-approved-20261126-d31a6c/`；上一报告、发送源、review 和采集器哈希复核未变。正式网关／数据库查询／客户数据／完整环境／密钥／cmdline 读取为 0，远程写入、目录／权限／服务变更、安装／部署均无操作，Stripe 不启用。本次单次许可已消耗。

### 固定 proc 网络表读取修正已验收，10:10 UTC 正式应用元数据核对成功

按新批准 `call_a9cd1311ccd344bab0f21b1a19941c59`，仅新增准确 `/proc/net/tcp`／`/proc/net/tcp6` 的专用 reader。以自身仍打开的数字 FD 链接进行 `statfsSync`，确认 procfs；检查 root-owned／readonly／零尺寸／单链接的内核表元数据，设备／inode／owner／mode／大小必须相同，同一打开句柄的全部九字段（含时间）仍严格一致。仅这两个已确认 procfs 的路径重查允许 `mtimeNs`／`ctimeNs` 差异；active／PID／exe 及其它 `/proc` 仍走原完整比较，不扩大为任意文件例外。原采集器函数体仅注入 reader／diagnostic 参数，原 PID/start-time、CWD、状态、LISTEN 与进程 FD/socket 约束不变。

独立提交 `67f274679e753fce458b948a2a4bfef525b5ad74`／CI `45798324231` 的 64 项检查（28 新 reader＋36 原身份）及 8 项真实隔离 Linux 场景全部通过。真实 procfs 自然出现同样路径时间戳差异，新 reader 完成实际 IPv4／IPv6 表和进程 socket 绑定；真实 tmpfs FD、同一 FD 时间变化、路径 inode 变化、PID 重用、普通文件时间变化与错误 socket 仍被拒绝。唯一 owned 容器无网络／宿主挂载／公开端口、只读根，按 ID／image／随机 owner 核验后清理。初版 `fd5cd4a9…`／`45797754311` 的 63 项单测通过、owned 失败且清理成功；其原报告未保留具体容器异常，不倒填原因。本地另确认新代码误用 Node 不提供的 `fstatfsSync`，改为受支持的自身 FD 链接 `statfsSync`，并修正清理阶段覆盖诊断的问题。失败证据全部保留。

私有组合采集器又通过 71 项本地检查（64＋7 精确接线），才执行唯一一次批准 SSH。10:10 UTC 退出 0／stderr 0，无重试；活动记录所指进程的完整元数据绑定成功，四次准确网络表读取均验证 procfs、打开句柄与路径身份稳定，实际路径时间戳差异均被记录。具体 target／PID／UID／GID／目录／端口只存私有报告；不把 `publicIngressVerified`、`pm2SupervisorVerified`、`executableBytesVerified`、`signerIsolationApproved` 提升为 true。

CI review SHA `312767b478662a032aca391d0d7aa7850f873dadbde8173573609d910d9943ec`；正式报告 SHA `0ef10d2b82327aad8d427392d803e31e1ed2e31b0a95e2707492c6805a972967`；实际发送源 SHA `0ac79dfe61bf92f8b6f816d72e6aeb1e94b2f95b5accf3d6fd56fb2d656297ae`；独立离线 review SHA `bc4fc4c8c884b3d6fc9c1eb37efcccd1858544b4950854f83e9cee2ed03145de`。全部证据私有保留于 `output/checkout-proc-table-approved-20261126-a9cd13/`；原采集器、失败原稿、旧报告与 review 哈希复核不变，原应用／SQL／依赖／旧工作流未改。新测试不加到原 524 应用场景；本轮不是部署验收。

这完成此次采集规则修复和应用元数据核对，不授予运行准备权限。当前部署条件仍要求单独设计签发隔离；不能仅凭本机文件 owner／mode 宣称私钥隔离，也不自动迁移既有应用身份。下一步建议先评估独立签发信任域的本地方案与隔离验收，保留现网运行方式；若选择非 root 应用迁移，需另行批准完整回归及发布范围。有效签发来源／算法／claims、目录生命周期与独立备份恢复仍须交付。本次未重读网关／数据库／客户记录／完整环境／cmdline／密钥，未改正式配置／权限／数据／目录／服务，不安装／签发／部署或启用 Stripe／邮件；单次许可已结束。

## 4. 身份与目录的提案，不自动落地

| 对象 | 建议持有者／权限 | 不可扩大到 |
| --- | --- | --- |
| 安装 prepared／confirmation | 独立受信安装身份；installations 根目录及操作目录 0700，文件 0600 | 应用进程／普通网关角色不能写安装凭证 |
| 独立 locator | 与 installations 分开的准确根目录；0700／0600；受信恢复身份管理 | 不以数据库可变路径选择 locator，不覆盖或重造丢失证据 |
| 短期凭据交付 | 专用 issuer 身份持有，应用仅属指定读取组；目录 0750，文件 0640 | 应用不能写文件、在目录新建文件、读 signer key；不共享可写发布目录 |
| 签发服务 | 提议 `faolla-checkout-issuer` 专用身份、受限固定 claims；service 名称仅提案 | 不给应用通用签名、任意 role／claims／算法接口，不把 service-role token 当降级方案 |
| 签名材料 | 留在经批准的受信签名提供者；来源与恢复管理单独明确 | 不复制到源代码、PM2 完整环境、public、日志、应用组或普通备份包 |

这些名称、路径、数字 UID／GID、签发算法和 key ID 尚未批准；不得“先创建再补许可”。应用身份若为 root／可读取签名材料，0700／0600 也不能证明对应用隔离，必须保持未就绪，并单独决定非 root 应用或独立安全域的签发服务；不能自动改变既有应用运行身份。

数据库角色仍使用原已测来源：`faolla_checkout_runtime` 为 NOLOGIN／NOINHERIT、仅固定 dispatcher；`faolla_checkout_executor` 为 NOLOGIN／NOINHERIT、原设计所需 BYPASSRLS，不成为 runtime 父角色。只有已证明的真实网关登录角色才能进入将来的精确授权提案；不能向 anon／authenticated／service_role 或所有继承者批量 GRANT。角色创建、成员关系、版本登记和 38 步执行均另需明确许可。

## 5. 服务生命周期

- 启动前：核对获批来源、时钟、绝对路径、owner／mode、受信签名提供者和精确 claims；未齐备则不发布凭据。
- 正常运行：按已测 TTL／提前量续发，文件原子替换并重读；应用只读、同一进程继续工作，不依赖 PM2 restart／update-env。
- 签发失败／超时：保留原字节但不延长期限，余量不足拒绝新财务派发；不降级为长期服务令牌，不自动重试财务 POST。
- 暂停／撤销：关闭新单仍可核对已存在的原单；精确撤销权限，保留业务记录与安装凭证。停止命令只影响本服务，不触碰现有预约／自动化 worker。

以上是已有组件的上线要求，不代表 unit／provider／监控已经交付。

## 6. 备份与恢复必须说明上限

备份应同时覆盖安装 prepared／confirmation、独立 locator、来源与非密钥服务配置；短期 token 可重发，不必把过期凭据当作恢复资产。签名材料的恢复由受信提供者单独管理。

现有 owned 恢复仅证明原 root／operation inode 保留时的文件恢复及进程中断后原结果核对；不能直接承诺全目录丢失、新主机、不同 inode 或掉电恢复。若拟用备份会改变这些身份，需要单独验证可审计的恢复绑定／拒绝路径，不能去掉旧 inode 校验来“让恢复通过”。同一磁盘上的第二个目录也不等于独立灾难备份。

正式安装前必须得到明确覆盖与可接受恢复标准。不读取客户行来证明备份覆盖，不把旧的数据库备份自动宣称为新持久目录备份。

## 7. 收敛后的执行顺序

1. **当前：**本地格式兼容、源端去敏投影与 owned 验收，保存旧未知与新结果；零生产读取／写入。
2. **限定事实窗口：**仅针对五个缺口列准确字段、投影方法和固定错误码；本地／owned 通过后另行请求一次新许可。没有可靠的 metadata-only 方法就先解决方法，不直接试读或反复采样。
3. **正式准备提案：**用确认事实绑定明确角色／目录／身份／签名提供者／备份和迁移版本，逐项列拟写入对象；不得自动预留版本或签发。若需要改变已成功路径，单独说明风险并获准。
4. **安装与运行验收：**正式操作必须明确批准；仍按独立候选、兼容回滚、严格漂移检查、事务／持久证据／原结果恢复执行，不重放旧 214 个迁移。新单门禁保持关闭。
5. **试点再上线：**批准具体商户、价格／积分／券／取消退还策略后，小范围验证预约与产品结算、原单不重复扣减、后台付款状态；不能自行扩大商户范围。
6. **Stripe 最后：**再接支付与 webhook 验证；定价／抽成／自动续费选择未确定前，正式收费不开启。

本清单不是新的权限开关，不包含可直接执行的线上 shell／SQL。下一步应减少真正的未知，而不是再增加一份“看起来通过”的证明。
