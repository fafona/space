# merchant-space

本项目包含「商家站点 + 总站导航 + 超级后台」三套入口。

## 本地启动

```bash
npm install
npm run dev
```

启动后默认访问 `http://localhost:3000`。

## 路由约定（当前统一定义）

- `/`：总站（主域名下的行业与商户导航网站）
- `/admin`：商家后台（编辑商家页面内容）
- `/super-admin`：超级后台（管理总站数据与平台治理）
- `/portal`：旧总站入口，自动跳转到 `/`
- `/[merchantEntry]`：商户快捷入口（后台或按前缀命中的前台）
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

## 自动部署

当前仓库已经有 CI 工作流 `/.github/workflows/ci.yml`，可以继续用 GitHub Actions 做生产自动部署：

1. 服务器准备
   在服务器安装 `node 20`、`npm`、`pm2`、`git`，并把仓库先 clone 到固定目录，例如 `/var/www/merchant-space`
2. 服务器环境变量
   在服务器项目目录准备 `.env.local`，至少包含 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`
3. GitHub Secrets
   在仓库配置 `SSH_HOST`、`SSH_PORT`、`SSH_USER`、`SSH_PRIVATE_KEY`、`APP_DIR`
   可选：`APP_NAME`、`APP_PORT`
4. 自动触发
   推送到 `main` 或 `master` 后，CI 成功会触发 `/.github/workflows/deploy.yml`
   也可以在 GitHub Actions 页面手动触发 `Deploy Production`
5. 服务器执行内容
   工作流会通过 `/scripts/deploy.production.sh` 在服务器执行 `git pull`、`npm ci`、`npm run build`、`pm2 restart`

如果 `faolla.com` 继续指向你当前服务器 IP，这套方式是最省改动的。若后续改用 Vercel，则要把域名 DNS 一起切过去。
