# merchant-space

本项目包含「商家站点 + 总站导航 + 超级后台」三套入口。

## 本地启动

```bash
npm install
npm run dev
```

启动后默认访问 `http://localhost:3000`。

## 路由约定（当前统一定义）

- `/`：商家前台
- `/admin`：商家后台（编辑商家页面内容）
- `/super-admin`：超级后台（管理总站数据与平台治理）
- `/portal`：总站（行业与商户导航网站）
- `/industry/[slug]`：总站下的行业聚合页
- `/site/[siteId]`：商家站点前台页

## 职责边界

- 超级后台编辑的是总站（行业分类、总站分区、站点归类、平台治理）。
- 商家后台编辑的是商家页面内容。
- 总站用于聚合行业和商户入口，用户可在总站点击进入商家前台页面。

## 校验命令

```bash
npm run lint
npm test
npm run build
```
