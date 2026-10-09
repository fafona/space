# 第212批：故障声明的来源关联与变化核对（数据库实测待恢复）

后续状态：用户批准单一替代本地测试库后，[第213批](employee-attendance-outage-links-acceptance-20261007.md)已重跑基础检查并完成本批实际数据库验收；下述阻断及待验是212结束时的历史状态，保留而不改写。整体C24／P1仍未完成，未部署。

2026-10-07。继续执行用户已批准的[210故障恢复范围](employee-attendance-outage-recovery-boundary-20261007.md)，在[211登记基础](employee-attendance-outage-foundation-20261007.md)上增加明确来源关联、撤销及当前依据核对。**代码和定向检查已完成；本批数据库实测未完成，不是可发布验收，不是C24／P1完成。**

## 本批实现

- 新增177独立追加账本和私有函数，不替换旧打卡、补正、漏卡、周期或176函数。负责人明确选择1至10项已有班次／有效批准漏卡，保存真实操作者、理由、当时完整依据摘要和版本；不增加工时、不替员工确认、不自动结案。
- 班次保存原始首尾及当时核定首尾，包含精确事件尾、序号、核定编号／版本；漏卡保存根申请、当前批准申请及批准操作号。完整来源和精确待审事实进入摘要，不能只用一个“待审”布尔值代替。
- 保存依据与当前依据分别返回。之后补正、漏卡修订、待审流或身份代次变化应提示重新核对，不能覆盖旧快照。读取不到可靠依据时标记不可核验，不编造“已变化”或“已失败”。
- 开放班次及已有批准但还有待审修订，可以作为待核对准备材料；警告保留，不代表能够结案。无历史双身份依据不回退猜测当前身份；原声明中的未知操作号仍只是线索。
- 负责人可明确撤销关联，保留旧快照及历史回执。最多100个版本，最后一位保留给撤销；历史每页25个摘要，不重复返回全部证据正文。
- 精确重试／原号恢复优先读取当时收据，不按今天的来源重算。关闭新写后仍允许当前有权且为原操作者的负责人恢复；同号换正文拒绝。self读取需要当前有效员工身份及权限，换绑后的新员工不能读取旧员工声明。
- TS协议、服务适配、SHA-256及原始规范文本校验、体积上限、不可变返回结果已完成。新开关默认关闭，**没有生产API或页面接线，不应提前启用**。

主要实现：[177迁移](../scripts/supabase-migrations/202610070177_merchant_attendance_outage_links.sql)、[严格协议](../src/lib/merchantAttendanceOutageLinks.ts)、[服务适配](../src/lib/merchantAttendanceOutageLinks.server.ts)。

## 审查中修正的问题

来源摘要对待审／漏卡完整行使用`to_jsonb`，其中时间字段会随连接时区序列化为不同偏移。同一事实可能误报变化。现仅在新私有来源函数中固定UTC序列化，严格配置检查相应只允许此函数有该局部配置；不修改原时间或调用者的时区配置。

回滚夹具已加入真实待审补正、待审漏卡在UTC／Madrid下预览相等的断言。**该断言目前只通过静态检查，尚未实际执行，不能宣称数据库验证已通过。**

## 已完成检查

- 79项定向单元／纯函数／静态测试通过，其中17项为新TS协议，13项为177静态契约；其余含新驱动／夹具及旧176相关回归，不是79次真实数据库测试。
- 完整TypeScript检查通过（`node node_modules/typescript/bin/tsc --noEmit --incremental false`）。
- 11个本批TS／MJS文件ESLint通过；177份迁移目录校验通过。无完整构建、依赖安装或复制。
- 3542个源码／脚本基线中，只有旧211本地测试驱动及其测试增加可选回调，默认调用行为不变；新增10个代码／SQL／测试文件，旧业务与旧迁移未变。

可复现测试入口：

```powershell
node --import tsx --test src/lib/merchantAttendanceOutage.test.ts src/lib/merchantAttendanceOutageTime.test.ts src/lib/merchantAttendanceOutageLinks.test.ts scripts/merchant-attendance-outage-native.test.mjs scripts/fixtures/attendance-outage-native.test.mjs scripts/merchant-attendance-outage-links-migration.test.mjs scripts/merchant-attendance-outage-links-native.test.mjs scripts/fixtures/attendance-outage-links-native.test.mjs
```

## 当前实测阻断：原本地合成库文件缺失

尝试唯一既有环境：

```powershell
node --import tsx scripts/merchant-attendance-outage-links-native.mjs --run-local --directory "C:/Users/User/AppData/Local/Temp/faolla-attendance-foundation-7rg4GW"
```

在运行任何启动命令或SQL前，检查`data/PG_VERSION`即报ENOENT退出1。只读复查确认该目录仍有部分数据库文件及`global/pg_control`，但`PG_VERSION`、`postgresql.conf`和`pg_hba.conf`均缺失。不能据此判断是谁、何时或为何移除，也不能仅补一个版本文件后强行启动。56644未发现监听，本轮没有启动数据库或新增数据。

没有改写残存目录、重建集群、删除文件、放宽所有权守卫或改连其他数据库。原211的历史通过记录保持原义，不能算作本轮177已经执行。**本轮实际177安装、来源更新、摘要跨时区一致、原号恢复、权限与回滚归档保护均仍待实际验证。**

已准备的[原生驱动](../scripts/merchant-attendance-outage-links-native.mjs)和[回滚夹具](../scripts/fixtures/attendance-outage-links-native.mjs)复用204／207／211前置，拟用原096补正和103漏卡真实调用产生来源变化，并检查新旧归档不变。不得把这些待执行代码当成已通过证据。

## 下一步与边界

先确认如何恢复唯一、本机隔离的合成测试基线；不使用生产或真实员工数据，不自行覆盖残存文件。恢复后执行本批真实SQL验收，失败须修正根因，不能跳过守卫。之后继续已批准的本人确认／异议、负责人结案、相关新周期阻断、页面及备用纸表。

独立只读复核未找到仓库内原地恢复器或原基线备份。旧复用驱动的基线hash只存在运行进程中；初始化脚本会创建新目录，部分合成数据使用当前时间，故重播得到的是等价新基线，不能冒称恢复原字节／原归档hash。可恢复可信完整物理备份，或经用户明确同意创建**一个替代的本机合成测试库**、重新跑既有验收；后一方案保留残存目录，不复制依赖，不增建多个环境，不沿用旧库的通过结论。物理占用和重播耗时尚无可靠实测，不预报虚假数字。

固定清单仍为17项限定本地已有／6项部分完成／1项未实现；C23／C24及整体P1未完成。177为待实测候选，未部署。既有无维护发布要求不变。
