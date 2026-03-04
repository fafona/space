# 超级后台蓝图（总站管理）

## 1) 目标边界
- 超级后台管理的是整个平台，不是单商户页面编辑。
- 商户后台负责商户自己的页面内容；超级后台负责总站首页、行业分类、站点归类规则。

## 2) 功能清单（MVP）
1. 行业分类管理
- 新增/编辑/停用行业分类
- 设置分类排序
- 商户站点必须归属到一个行业分类

2. 总站首页规划
- 配置总站 Hero（主标题、副标题）
- 维护首页分区（例如：推荐行业、热门行业、新入驻商户）
- 每个分区可绑定行业分类并支持排序与显隐

3. 商户站点归类
- 新建商户站点时必须选择行业分类
- 支持查看某行业下的站点数量
- 支持后续变更站点所属分类（审计留痕）

4. 平台治理
- 审计日志记录关键操作（分类、首页布局、站点归类）
- 角色权限约束（已有权限体系可复用）

## 3) 数据结构（建议）

### industry_categories
- id: string (PK)
- name: string
- slug: string (唯一)
- description: string
- parent_id: string | null
- sort_order: number
- status: "active" | "inactive"
- created_at: string
- updated_at: string

### sites（扩展）
- id: string
- tenant_id: string
- name: string
- domain: string
- category_id: string
- category: string（分类名称快照，便于列表直接展示）
- status: "online" | "maintenance" | "offline"
- ...其余字段保持不变

### home_layout_config
- hero_title: string
- hero_subtitle: string
- featured_category_ids: string[]
- sections: HomeSection[]

### home_sections（可嵌入 home_layout_config.sections）
- id: string
- title: string
- description: string
- category_id: string
- sort_order: number
- visible: boolean

## 4) API 草案
1. 分类管理
- GET `/api/super-admin/categories`
- POST `/api/super-admin/categories`
- PATCH `/api/super-admin/categories/:id`
- PATCH `/api/super-admin/categories/:id/status`

2. 首页布局
- GET `/api/super-admin/home-layout`
- PUT `/api/super-admin/home-layout`
- POST `/api/super-admin/home-layout/sections`
- PATCH `/api/super-admin/home-layout/sections/:id`

3. 站点归类
- POST `/api/super-admin/sites`
- PATCH `/api/super-admin/sites/:id/category`
- GET `/api/super-admin/categories/:id/sites`

4. 审计
- GET `/api/super-admin/audits?targetType=category|home_layout|site`

## 5) 前端页面草案（超级后台）
- 页面1：总站规划
- 模块A：Hero 配置
- 模块B：首页分区配置
- 模块C：行业分类统计卡片

- 页面2：行业分类管理
- 分类列表 + 新增表单 + 启用/停用

- 页面3：商户站点管理
- 站点列表（租户、域名、行业分类、状态）
- 站点归类调整

## 6) 实施顺序
1. 先在现有本地 store 中加入 `industryCategories` 与 `homeLayout`（可直接演示）。
2. 把创建站点改为必须选择分类。
3. 超级后台页面新增“总站规划与行业分类”模块。
4. 最后再把 store 切换到 Supabase 表和真实 API。
