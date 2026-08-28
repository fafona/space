export const MERCHANT_STAFF_BUSINESS_PERMISSIONS = [
  "redemptions.view",
  "redemptions.customer_data.view",
  "redemptions.checkout",
  "redemptions.recharge",
  "redemptions.recharge.cancel",
  "redemptions.catalog.manage",
  "redemptions.print",
  "bookings.view",
  "bookings.customer_data.view",
  "bookings.update",
  "bookings.status.manage",
  "bookings.email.send",
  "bookings.analytics.view",
  "bookings.export",
  "bookings.settings.manage",
  "bookings.automation.manage",
  "bookings.calendar.manage",
  "orders.view",
  "orders.customer_data.view",
  "orders.status.manage",
  "orders.complete",
  "orders.items.update",
  "orders.print",
  "orders.analytics.view",
  "orders.export",
  "orders.export.customer_data",
  "orders.catalog.view",
  "orders.catalog.manage",
  "conversations.view",
  "conversations.search",
  "conversations.start",
  "conversations.send",
  "members.view",
  "members.customer_data.view",
  "members.account.view",
  "members.account.adjust",
  "members.allergens.manage",
  "members.insights.view",
  "members.settings.manage",
] as const;

export type MerchantStaffBusinessPermission =
  (typeof MERCHANT_STAFF_BUSINESS_PERMISSIONS)[number];

export type MerchantStaffBusinessPermissionGroup =
  | "积分兑换"
  | "预约管理"
  | "订单管理"
  | "会话"
  | "会员管理";

export const MERCHANT_STAFF_BUSINESS_PERMISSION_CATALOG: ReadonlyArray<{
  key: MerchantStaffBusinessPermission;
  label: string;
  group: MerchantStaffBusinessPermissionGroup;
  description: string;
  risk: "standard" | "sensitive" | "high";
}> = [
  { key: "redemptions.view", label: "查看积分兑换", group: "积分兑换", description: "进入积分兑换并查看脱敏的兑换、充值记录。", risk: "standard" },
  { key: "redemptions.customer_data.view", label: "查看兑换客户资料", group: "积分兑换", description: "查看积分兑换中的客户联系方式和完整会员资料。", risk: "sensitive" },
  { key: "redemptions.checkout", label: "积分兑换结算", group: "积分兑换", description: "为会员执行积分兑换结算。", risk: "high" },
  { key: "redemptions.recharge", label: "会员充值", group: "积分兑换", description: "为会员创建储值充值。", risk: "high" },
  { key: "redemptions.recharge.cancel", label: "撤销充值", group: "积分兑换", description: "撤销已完成的会员充值。", risk: "high" },
  { key: "redemptions.catalog.manage", label: "管理兑换项目", group: "积分兑换", description: "维护积分兑换项目及分类。", risk: "high" },
  { key: "redemptions.print", label: "打印兑换凭证", group: "积分兑换", description: "打印积分兑换或充值凭证。", risk: "standard" },

  { key: "bookings.view", label: "查看预约", group: "预约管理", description: "进入预约管理并查看脱敏预约；打开记录会同步已读状态。", risk: "standard" },
  { key: "bookings.customer_data.view", label: "查看预约客户资料", group: "预约管理", description: "查看预约客户的联系方式及备注。", risk: "sensitive" },
  { key: "bookings.update", label: "编辑预约", group: "预约管理", description: "修改预约内容、时间及客户填写信息。", risk: "high" },
  { key: "bookings.status.manage", label: "处理预约状态", group: "预约管理", description: "确认、取消、恢复或批量更新预约状态。", risk: "high" },
  { key: "bookings.email.send", label: "发送预约邮件", group: "预约管理", description: "向预约客户发送人工通知邮件。", risk: "high" },
  { key: "bookings.analytics.view", label: "查看预约分析", group: "预约管理", description: "查看预约工作台统计与分析。", risk: "standard" },
  { key: "bookings.export", label: "导出预约", group: "预约管理", description: "导出有权查看的预约数据。", risk: "sensitive" },
  { key: "bookings.settings.manage", label: "管理预约设置", group: "预约管理", description: "维护预约工作台、门店、项目和时间规则。", risk: "high" },
  { key: "bookings.automation.manage", label: "管理预约自动化", group: "预约管理", description: "创建、修改或停用预约自动处理规则。", risk: "high" },
  { key: "bookings.calendar.manage", label: "管理预约日历", group: "预约管理", description: "维护预约日历及可预约日期。", risk: "high" },

  { key: "orders.view", label: "查看订单", group: "订单管理", description: "进入订单管理并查看脱敏订单；打开记录会同步已读状态。", risk: "standard" },
  { key: "orders.customer_data.view", label: "查看订单客户资料", group: "订单管理", description: "查看订单客户的联系方式和配送资料。", risk: "sensitive" },
  { key: "orders.status.manage", label: "处理订单状态", group: "订单管理", description: "确认、取消、恢复或批量更新订单状态。", risk: "high" },
  { key: "orders.complete", label: "完成或撤销完成订单", group: "订单管理", description: "完成订单或撤销完成状态，并触发相应账务逻辑。", risk: "high" },
  { key: "orders.items.update", label: "修改订单商品", group: "订单管理", description: "修改允许编辑的订单商品及数量。", risk: "high" },
  { key: "orders.print", label: "打印订单", group: "订单管理", description: "打印订单或小票。", risk: "standard" },
  { key: "orders.analytics.view", label: "查看订单分析", group: "订单管理", description: "查看订单工作台统计与分析。", risk: "standard" },
  { key: "orders.export", label: "导出脱敏订单", group: "订单管理", description: "导出不含客户敏感资料的订单。", risk: "sensitive" },
  { key: "orders.export.customer_data", label: "导出完整订单资料", group: "订单管理", description: "在导出中包含客户联系方式和配送资料。", risk: "high" },
  { key: "orders.catalog.view", label: "查看商品经营目录", group: "订单管理", description: "查看订单商品经营目录。", risk: "standard" },
  { key: "orders.catalog.manage", label: "管理商品经营目录", group: "订单管理", description: "新增、修改或停用订单商品。", risk: "high" },

  { key: "conversations.view", label: "查看会话", group: "会话", description: "查看普通客户和商户会话；Faolla 官方支持会话仍仅负责人可见。", risk: "sensitive" },
  { key: "conversations.search", label: "搜索联系人", group: "会话", description: "按精确账号或邮箱搜索可联系对象。", risk: "sensitive" },
  { key: "conversations.start", label: "发起会话", group: "会话", description: "与搜索到的客户或商户发起普通会话。", risk: "high" },
  { key: "conversations.send", label: "发送文字消息", group: "会话", description: "以员工身份发送文字消息。", risk: "high" },

  { key: "members.view", label: "查看会员", group: "会员管理", description: "进入会员管理并查看脱敏会员列表。", risk: "standard" },
  { key: "members.customer_data.view", label: "查看会员资料", group: "会员管理", description: "查看会员联系方式和完整基础资料。", risk: "sensitive" },
  { key: "members.account.view", label: "查看会员账户", group: "会员管理", description: "查看积分、储值余额和账户流水。", risk: "sensitive" },
  { key: "members.account.adjust", label: "调整会员账户", group: "会员管理", description: "人工调整积分或储值账户并写入可信审计。", risk: "high" },
  { key: "members.allergens.manage", label: "管理过敏信息", group: "会员管理", description: "查看和维护会员过敏信息。", risk: "sensitive" },
  { key: "members.insights.view", label: "查看会员洞察", group: "会员管理", description: "查看消费频率、偏好及会员分析。", risk: "sensitive" },
  { key: "members.settings.manage", label: "管理会员设置", group: "会员管理", description: "维护会员等级、权益、充值方案和积分规则。", risk: "high" },
];

const MERCHANT_STAFF_BUSINESS_PERMISSION_SET = new Set<string>(
  MERCHANT_STAFF_BUSINESS_PERMISSIONS,
);

export function isMerchantStaffBusinessPermission(
  value: unknown,
): value is MerchantStaffBusinessPermission {
  return (
    typeof value === "string" &&
    MERCHANT_STAFF_BUSINESS_PERMISSION_SET.has(value)
  );
}

export const MERCHANT_STAFF_BUSINESS_PERMISSION_DEPENDENCIES: Readonly<
  Record<MerchantStaffBusinessPermission, readonly MerchantStaffBusinessPermission[]>
> = {
  "redemptions.view": [],
  "redemptions.customer_data.view": ["redemptions.view"],
  "redemptions.checkout": ["redemptions.view", "redemptions.customer_data.view"],
  "redemptions.recharge": ["redemptions.view", "redemptions.customer_data.view"],
  "redemptions.recharge.cancel": ["redemptions.view", "redemptions.customer_data.view", "redemptions.recharge"],
  "redemptions.catalog.manage": ["redemptions.view"],
  "redemptions.print": ["redemptions.view"],
  "bookings.view": [],
  "bookings.customer_data.view": ["bookings.view"],
  "bookings.update": ["bookings.view", "bookings.customer_data.view"],
  "bookings.status.manage": ["bookings.view"],
  "bookings.email.send": ["bookings.view", "bookings.customer_data.view"],
  "bookings.analytics.view": ["bookings.view"],
  "bookings.export": ["bookings.view"],
  "bookings.settings.manage": ["bookings.view"],
  "bookings.automation.manage": ["bookings.view"],
  "bookings.calendar.manage": ["bookings.view"],
  "orders.view": [],
  "orders.customer_data.view": ["orders.view"],
  "orders.status.manage": ["orders.view"],
  "orders.complete": ["orders.view"],
  "orders.items.update": ["orders.view"],
  "orders.print": ["orders.view"],
  "orders.analytics.view": ["orders.view"],
  "orders.export": ["orders.view"],
  "orders.export.customer_data": ["orders.view", "orders.customer_data.view", "orders.export"],
  "orders.catalog.view": ["orders.view"],
  "orders.catalog.manage": ["orders.view", "orders.catalog.view"],
  "conversations.view": [],
  "conversations.search": ["conversations.view"],
  "conversations.start": ["conversations.view", "conversations.search"],
  "conversations.send": ["conversations.view"],
  "members.view": [],
  "members.customer_data.view": ["members.view"],
  "members.account.view": ["members.view"],
  "members.account.adjust": ["members.view", "members.account.view"],
  "members.allergens.manage": ["members.view", "members.customer_data.view"],
  "members.insights.view": ["members.view"],
  "members.settings.manage": ["members.view"],
};

export function getMerchantStaffBusinessPermissionDependencies(
  permission: MerchantStaffBusinessPermission,
) {
  return MERCHANT_STAFF_BUSINESS_PERMISSION_DEPENDENCIES[permission];
}

export function hasMerchantStaffBusinessPermissions(
  permissions: readonly string[],
) {
  return permissions.some(isMerchantStaffBusinessPermission);
}
