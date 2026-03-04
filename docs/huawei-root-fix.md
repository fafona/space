# 华为云根治方案（商户前后台）

这个项目当前商户链路依赖 Supabase（登录、商户身份识别、页面远端读写、素材上传）。
你之前遇到的“522 / 后端不可用 / 刷新慢 / 登录异常”，根因是浏览器到现有 Supabase 网关链路不稳定。

要“根治”，要做两件事：

1. 把 Supabase 后端迁到你自己的华为云（或至少换成你能稳定访问的后端）
2. 把项目环境变量指向新后端，并初始化必须的数据表与策略

下面是可直接执行的落地步骤。

## 1. 在华为云准备 Supabase（推荐自建）

在 ECS 上执行：

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker

sudo mkdir -p /opt && cd /opt
sudo git clone --depth 1 https://github.com/supabase/supabase.git
cd supabase/docker
cp .env.example .env
```

编辑 `/opt/supabase/docker/.env`，至少设置：

- `SITE_URL`：你的站点地址（例如 `https://your-domain.com`）
- `API_EXTERNAL_URL`：Supabase 网关地址（例如 `https://api.your-domain.com`）
- `JWT_SECRET`
- `ANON_KEY`
- `SERVICE_ROLE_KEY`
- `POSTGRES_PASSWORD`

然后启动：

```bash
docker compose up -d
docker compose ps
```

确保网关可访问（默认 8000 端口；生产建议 Nginx 反代到 443）：

```bash
curl -i http://127.0.0.1:8000/auth/v1/settings
```

## 2. 初始化项目所需数据库结构

在 Supabase Studio 的 SQL Editor 执行：

- `scripts/supabase-init.sql`

这个脚本会创建并配置：

- `public.pages`
- `public.merchants`
- `public.page_events`
- `storage bucket: page-assets`
- 必要索引、RLS 策略、更新时间触发器

## 3. 配置本项目环境变量

把项目的 `.env.local` 改成你的华为云后端：

```env
NEXT_PUBLIC_SUPABASE_URL=https://api.your-domain.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的ANON_KEY

# 可选：让失败更快返回，减少“卡住”体感
NEXT_PUBLIC_SUPABASE_FETCH_TIMEOUT_MS=3500
NEXT_PUBLIC_SUPABASE_FETCH_COOLDOWN_MS=5000
```

连通性检查：

```bash
npm run check:supabase
```

## 4. 商户账号与站点绑定（关键）

商户后台是否能正常进入并读写页面，取决于 `merchants` 表是否能匹配当前登录用户。

最小做法：在 `merchants` 表插入一行绑定关系（示例）：

```sql
insert into public.merchants (id, user_id, email, owner_email, user_email, name)
values ('site-main', '你的auth.users.id', 'you@example.com', 'you@example.com', 'you@example.com', '默认商户')
on conflict (id) do update
set user_id = excluded.user_id,
    email = excluded.email,
    owner_email = excluded.owner_email,
    user_email = excluded.user_email,
    updated_at = now();
```

`id` 建议用你平台站点的 `siteId`（例如 `site-main`），这样商户前台路径 `/site/site-main` 能直接对应。

## 5. 验收清单

1. `/login` 登录不再出现“后端连接不可用”
2. `/admin` 不再长时间停在“正在检查登录状态…”
3. 发布后刷新 `/site/<siteId>` 内容稳定一致
4. 控制台不再频繁出现 `AuthRetryableFetchError` / `signal is aborted without reason`

---

如果你愿意我直接代你完成服务器落地，请提供：

1. 服务器 SSH 地址与端口
2. 登录方式（密钥或账号）
3. 你要绑定的域名（用于 HTTPS 反代）
4. 是否允许我按上面默认参数初始化 Supabase
