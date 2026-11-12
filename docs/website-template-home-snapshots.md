# 模板预览：固定操作栏与完整首页快照

## 展示及数据边界

- 预览操作栏在滚动区域外：左侧返回模板库，中间复制目标方案和使用模板，右侧切换设备及关闭。窄屏使用固定两行，不横向溢出。
- 打开预览或切换设备时回到内容顶部；返回模板库恢复原列表位置。
- 完整快照按原始长宽比例展示，不使用封面的固定裁剪比例。电脑和手机分别使用其真实首页截图。
- 快照不放进模板设计 JSON，不写入商户方案，不改变复制前确认、恢复备份、发布或模板审核机制。
- 只有原有鉴权和模板可见性检查通过的详情 GET，且显式带 `homeSnapshot=1` 时，才读取快照。列表及独立全站预览不加载额外图片。
- 快照与模板 UUID / 精确 revision 绑定。缺失、过期或校验失败时只回退为明确标注的封面，不把封面称为完整首页，也不阻断模板库。

## 生成与安装

在当前应用的正常服务环境下运行只读导出（不输出环境变量或密钥、不修改数据库）：

```text
node --env-file=.env.local --import ./node_modules/tsx/dist/loader.mjs \
  /path/to/website-template-home-snapshots-export.mjs \
  <active-application-40SHA> \
  /var/lib/faolla-template-catalog/home-snapshots-<batch>/export.json
```

将导出下载到隔离工作目录，在仓库根目录运行随资产批次保留的生成器（生成器及其导出/报告不进入网站运行源码）：

```text
node <batch>/website-template-home-snapshots-render.mjs <export.json> <new-output-directory>
```

渲染器使用实际 `BlockRenderer`，电脑 1440、手机 390 宽度，截图覆盖完整文档和最后一个区块。使用全新隔离浏览器；无商户站点身份，禁用预约/下单，拒绝任何外部请求。所有图片须解码成功，页面不得横向溢出。WebP 对象不超过 2 MB，保留尺寸、字节数及 SHA-256。

只安装经过核对、revision 仍为当前值的资产到下列独立目录：

```text
/var/lib/faolla-template-home-snapshots/<template-uuid>/<revision-uuid>/
  manifest.json
  desktop.webp
  mobile.webp
```

该目录由部署管理员持有，应用只读。每个 revision 使用新目录，不覆盖现有快照；安装前重新检查导出的 design SHA 和当前公开模板一致。保留生成报告及安装结果。不得更改模板行、来源草稿、商户副本或应用发布状态。

管理员重新收录设计或更新资料生成新 revision 后，应在该次模板上架流程重新生成对应快照；旧 revision 快照不会误配给新内容。应用源码发布仍使用现有常规无维护通道，无新增数据库迁移。

## 验证

- `src/lib/websiteTemplateHomeSnapshots*.test.ts`：尺寸和格式上限、revision 绑定、文件哈希、无路径穿越/链接、只读及异常回退。
- `src/lib/websiteTemplateRoutes.server.test.ts`：原鉴权和可见性先于快照读取，opt-in，不增加写操作。
- `scripts/application-release-template-browser-acceptance.mjs`：真实 React 控件在 320/390/1280/1920 宽度的固定工具栏、电脑端中间对齐、完整长图、设备切换、列表位置恢复，以及原有方案独立复制/管理员审核边界。
