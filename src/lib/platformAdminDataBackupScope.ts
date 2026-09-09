/** Describes the existing application snapshot; this is not a database restore manifest. */
export const PLATFORM_ADMIN_DATA_BACKUP_SCOPE = {
  kind: "platform_admin_application_snapshot",
  version: 1,
  title: "超级后台应用快照",
  fullDatabaseBackup: false,
  independentBackupCopy: false,
  databasePointInTimeRestore: false,
  included: [
    "当前浏览器的后台管理状态（站点、用户、角色、模板等）",
    "当前浏览器已加载的商户账号展示摘要（不含登录凭据）",
    "服务器中的商户目录与服务配置快照、配置历史及归档",
    "商户与平台客服之间的信息处理会话",
  ],
  excluded: [
    "会员资料、积分与余额账本、库存、优惠券、订单和预约等商户业务数据",
    "兑换操作凭据、待处理结算与确认状态（含 faolla_redemption_operations / faolla_redemption_checkouts）",
    "真实登录身份、密码、会话，以及企业员工账号与权限表",
    "商户已发布网页的完整内容、上传文件和图片等对象存储文件",
    "数据库结构、策略、函数、扩展及全库时间点一致性",
  ],
  storageNotice: "快照保存在当前应用数据库中；同库主备记录不等于独立异地备份。不能用它替代数据库备份与恢复演练。",
  readUnavailableNotice: "相关数据未能可靠读取，操作已停止，尚未开始写入。请检查数据服务与快照记录后重试；不要将此情况视为空数据。",
  schedule: {
    trigger: "authenticated_admin_session_catch_up",
    timezone: "Europe/Madrid",
    minimumIntervalDays: 3,
    maximumRecords: 8,
    notice: "进入已登录后台时检查并补建，按马德里日期至少间隔 3 天，最多保留最近 8 次。不是凌晨定时任务；未进入后台不会按时自动执行。",
  },
  restoreScopes: {
    user_manage: {
      label: "后台管理配置",
      warning: "将覆盖商户目录与服务配置快照、配置归档，以及本浏览器后台管理状态。商户账号摘要仅恢复显示，不会恢复真实登录身份、密码或员工权限；此操作分步执行，不是全库事务。",
    },
    support_messages: {
      label: "平台客服会话",
      warning: "将替换商户与平台客服的信息处理会话，不会恢复商户与客户的业务会话或其他商户业务数据。",
    },
  },
} as const;

export function withPlatformAdminDataBackupScope<T extends Record<string, unknown>>(payload: T) {
  return { ...payload, backupScope: PLATFORM_ADMIN_DATA_BACKUP_SCOPE };
}
