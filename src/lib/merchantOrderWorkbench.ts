import type { MerchantOrderRecord, MerchantOrderStatus } from "@/lib/merchantOrders";

export const MERCHANT_ORDER_WORKBENCH_DEFAULT_CONFIRMATION_OVERDUE_MINUTES = 15;
export const MERCHANT_ORDER_WORKBENCH_DEFAULT_PROCESSING_OVERDUE_MINUTES = 120;
export const MERCHANT_ORDER_WORKBENCH_DAILY_TREND_DAYS = 14;
export const MERCHANT_ORDER_WORKBENCH_RECENT_ACTIVITY_DAYS = 30;
export const MERCHANT_ORDER_WORKBENCH_TOP_PRODUCT_LIMIT = 8;

const MIN_TIMEZONE_OFFSET_MINUTES = -14 * 60;
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;
const MAX_SLA_MINUTES = 30 * 24 * 60;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

export type MerchantOrderWorkbenchThresholds = {
  confirmationOverdueMinutes: number;
  processingOverdueMinutes: number;
};

export type MerchantOrderWorkbenchSummary = {
  total: number;
  pending: number;
  confirmationOverdue: number;
  processing: number;
  processingOverdue: number;
  completedToday: number;
  cancelledToday: number;
  customerNote: number;
};

/**
 * Monetary totals are intentionally separated by pricePrefix. `totalAmount` and
 * `orderCount` include non-cancelled orders only. The completed-today fields are
 * a subset whose completedAt falls on today in the requested fixed UTC offset.
 */
export type MerchantOrderWorkbenchAmount = {
  pricePrefix: string;
  totalAmount: number;
  orderCount: number;
  completedTodayAmount: number;
  completedTodayCount: number;
};

export type MerchantOrderWorkbenchDailyTrend = {
  /** Calendar date in the dashboard's fixed UTC offset. */
  date: string;
  createdCount: number;
  completedCount: number;
  cancelledCount: number;
};

export type MerchantOrderWorkbenchStatusDistribution = Record<MerchantOrderStatus, number>;

export type MerchantOrderWorkbenchRecentActivity = {
  createdCount: number;
  completedCount: number;
  cancelledCount: number;
};

export type MerchantOrderWorkbenchTopProduct = {
  productId: string;
  name: string;
  /** Number of non-cancelled orders containing the product. */
  orderCount: number;
  /** Total quantity across those non-cancelled orders. */
  quantity: number;
};

export type MerchantOrderWorkbenchAverageOrderAmount = {
  pricePrefix: string;
  /** Non-cancelled orders in this price-prefix group. */
  orderCount: number;
  averageOrderAmount: number;
};

export type MerchantOrderWorkbenchAnalytics = {
  /** Today and the preceding 13 calendar days, oldest first. */
  dailyTrend: MerchantOrderWorkbenchDailyTrend[];
  statusDistribution: MerchantOrderWorkbenchStatusDistribution;
  /** Today and the preceding 29 calendar days. */
  recent30Days: MerchantOrderWorkbenchRecentActivity;
  topProducts: MerchantOrderWorkbenchTopProduct[];
  /** Non-cancelled order amounts, kept separate by pricePrefix. */
  averageOrderAmounts: MerchantOrderWorkbenchAverageOrderAmount[];
};

export type MerchantOrderWorkbenchTodoKind =
  | "pending_confirmation"
  | "processing"
  | "confirmation_overdue"
  | "processing_overdue"
  | "customer_note";

export type MerchantOrderWorkbenchTodo = {
  id: string;
  orderId: string;
  kind: MerchantOrderWorkbenchTodoKind;
  status: MerchantOrderStatus;
  createdAt: string;
  /** Minutes spent in the state relevant to this todo, rounded down. */
  ageMinutes: number;
  customerName: string;
  totalAmount: number;
  pricePrefix: string;
  note?: string;
};

export type MerchantOrderWorkbenchDashboard = {
  generatedAt: string;
  /** Fixed offset from UTC. For example, UTC+02:00 is represented as 120. */
  timezoneOffsetMinutes: number;
  thresholds: MerchantOrderWorkbenchThresholds;
  summary: MerchantOrderWorkbenchSummary;
  amounts: MerchantOrderWorkbenchAmount[];
  analytics: MerchantOrderWorkbenchAnalytics;
  todos: MerchantOrderWorkbenchTodo[];
};

export type MerchantOrderWorkbenchOptions = {
  now?: Date | string | number;
  /** Fixed offset from UTC. For example, UTC+02:00 is represented as 120. */
  timezoneOffsetMinutes?: number;
  confirmationOverdueMinutes?: number;
  processingOverdueMinutes?: number;
};

type TodoSortMetadata = {
  todo: MerchantOrderWorkbenchTodo;
  overdueMinutes: number | null;
  createdAtMs: number | null;
};

type ActivityCountKey = "createdCount" | "completedCount" | "cancelledCount";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function roundMoney(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Number(parsed.toFixed(2)));
}

function parseDateMs(value: unknown) {
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNow(value: MerchantOrderWorkbenchOptions["now"]) {
  const parsed = parseDateMs(value ?? Date.now());
  return new Date(parsed ?? Date.now());
}

export function normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(MAX_TIMEZONE_OFFSET_MINUTES, Math.max(MIN_TIMEZONE_OFFSET_MINUTES, Math.round(parsed)));
}

function normalizeSlaMinutes(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_SLA_MINUTES, Math.max(1, Math.round(parsed)));
}

function getAgeMinutes(startedAtMs: number | null, nowMs: number) {
  if (startedAtMs === null) return 0;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000));
}

function getFixedOffsetDayKey(valueMs: number | null, timezoneOffsetMinutes: number) {
  const dayIndex = getFixedOffsetDayIndex(valueMs, timezoneOffsetMinutes);
  return dayIndex === null ? "" : getFixedOffsetDayKeyFromIndex(dayIndex);
}

function getFixedOffsetDayIndex(valueMs: number | null, timezoneOffsetMinutes: number) {
  if (valueMs === null) return null;
  return Math.floor((valueMs + timezoneOffsetMinutes * 60_000) / DAY_MILLISECONDS);
}

function getFixedOffsetDayKeyFromIndex(dayIndex: number) {
  return new Date(dayIndex * DAY_MILLISECONDS).toISOString().slice(0, 10);
}

function isRecentCalendarDay(dayIndex: number, todayIndex: number, dayCount: number) {
  return dayIndex <= todayIndex && dayIndex >= todayIndex - dayCount + 1;
}

function compareText(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareTodos(left: TodoSortMetadata, right: TodoSortMetadata) {
  const leftIsOverdue = left.overdueMinutes !== null;
  const rightIsOverdue = right.overdueMinutes !== null;
  if (leftIsOverdue !== rightIsOverdue) return leftIsOverdue ? -1 : 1;

  if (leftIsOverdue && rightIsOverdue) {
    const overdueDifference = (right.overdueMinutes ?? 0) - (left.overdueMinutes ?? 0);
    if (overdueDifference !== 0) return overdueDifference;
    if (left.todo.kind !== right.todo.kind) {
      return left.todo.kind === "confirmation_overdue" ? -1 : 1;
    }
  }

  const leftPriority = left.todo.kind === "customer_note" ? 1 : 2;
  const rightPriority = right.todo.kind === "customer_note" ? 1 : 2;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftCreatedAt = left.createdAtMs ?? Number.POSITIVE_INFINITY;
  const rightCreatedAt = right.createdAtMs ?? Number.POSITIVE_INFINITY;
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
  return compareText(left.todo.id, right.todo.id);
}

function chooseStableProductName(current: string, candidate: unknown) {
  const next = trimText(candidate);
  if (!current) return next;
  if (!next) return current;
  return compareText(current, next) <= 0 ? current : next;
}

function compareTopProducts(left: MerchantOrderWorkbenchTopProduct, right: MerchantOrderWorkbenchTopProduct) {
  if (left.quantity !== right.quantity) return right.quantity - left.quantity;
  if (left.orderCount !== right.orderCount) return right.orderCount - left.orderCount;
  const productIdDifference = compareText(left.productId, right.productId);
  return productIdDifference || compareText(left.name, right.name);
}

function buildTodo(
  order: MerchantOrderRecord,
  kind: MerchantOrderWorkbenchTodoKind,
  ageMinutes: number,
  note?: string,
): MerchantOrderWorkbenchTodo {
  return {
    id: `${kind}:${order.id}`,
    orderId: order.id,
    kind,
    status: order.status,
    createdAt: order.createdAt,
    ageMinutes,
    customerName: trimText(order.customer?.name),
    totalAmount: roundMoney(order.totalAmount),
    pricePrefix: trimText(order.pricePrefix),
    ...(note ? { note } : {}),
  };
}

/**
 * Builds an operational snapshot from the complete order list. The function
 * only uses fields represented by MerchantOrderRecord; it deliberately makes
 * no inference about payment, refund, delivery, or print success.
 */
export function buildMerchantOrderWorkbenchDashboard(
  orders: readonly MerchantOrderRecord[],
  options: MerchantOrderWorkbenchOptions = {},
): MerchantOrderWorkbenchDashboard {
  const now = normalizeNow(options.now);
  const nowMs = now.getTime();
  const timezoneOffsetMinutes = normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes(
    options.timezoneOffsetMinutes ?? 0,
  );
  const thresholds: MerchantOrderWorkbenchThresholds = {
    confirmationOverdueMinutes: normalizeSlaMinutes(
      options.confirmationOverdueMinutes,
      MERCHANT_ORDER_WORKBENCH_DEFAULT_CONFIRMATION_OVERDUE_MINUTES,
    ),
    processingOverdueMinutes: normalizeSlaMinutes(
      options.processingOverdueMinutes,
      MERCHANT_ORDER_WORKBENCH_DEFAULT_PROCESSING_OVERDUE_MINUTES,
    ),
  };
  const todayKey = getFixedOffsetDayKey(nowMs, timezoneOffsetMinutes);
  const todayDayIndex = getFixedOffsetDayIndex(nowMs, timezoneOffsetMinutes) ?? 0;
  const summary: MerchantOrderWorkbenchSummary = {
    total: orders.length,
    pending: 0,
    confirmationOverdue: 0,
    processing: 0,
    processingOverdue: 0,
    completedToday: 0,
    cancelledToday: 0,
    customerNote: 0,
  };
  const dailyTrend = Array.from(
    { length: MERCHANT_ORDER_WORKBENCH_DAILY_TREND_DAYS },
    (_, index): MerchantOrderWorkbenchDailyTrend => ({
      date: getFixedOffsetDayKeyFromIndex(
        todayDayIndex - MERCHANT_ORDER_WORKBENCH_DAILY_TREND_DAYS + index + 1,
      ),
      createdCount: 0,
      completedCount: 0,
      cancelledCount: 0,
    }),
  );
  const dailyTrendByDate = new Map(dailyTrend.map((entry) => [entry.date, entry] as const));
  const statusDistribution: MerchantOrderWorkbenchStatusDistribution = {
    pending: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
  };
  const recent30Days: MerchantOrderWorkbenchRecentActivity = {
    createdCount: 0,
    completedCount: 0,
    cancelledCount: 0,
  };
  const amountByPricePrefix = new Map<string, MerchantOrderWorkbenchAmount>();
  const productById = new Map<string, MerchantOrderWorkbenchTopProduct>();
  const todos: TodoSortMetadata[] = [];

  const recordActivity = (value: unknown, key: ActivityCountKey) => {
    const valueMs = parseDateMs(value);
    if (valueMs === null || valueMs > nowMs) return;
    const dayIndex = getFixedOffsetDayIndex(valueMs, timezoneOffsetMinutes);
    if (dayIndex === null) return;
    if (isRecentCalendarDay(dayIndex, todayDayIndex, MERCHANT_ORDER_WORKBENCH_RECENT_ACTIVITY_DAYS)) {
      recent30Days[key] += 1;
    }
    if (isRecentCalendarDay(dayIndex, todayDayIndex, MERCHANT_ORDER_WORKBENCH_DAILY_TREND_DAYS)) {
      const entry = dailyTrendByDate.get(getFixedOffsetDayKeyFromIndex(dayIndex));
      if (entry) entry[key] += 1;
    }
  };

  orders.forEach((order) => {
    const createdAtMs = parseDateMs(order.createdAt);
    const createdAgeMinutes = getAgeMinutes(createdAtMs, nowMs);
    const customerNote = trimText(order.customer?.note);
    const isActive = order.status === "pending" || order.status === "confirmed";
    const isCompletedToday =
      order.status === "completed" &&
      getFixedOffsetDayKey(parseDateMs(order.completedAt), timezoneOffsetMinutes) === todayKey;
    const isCancelledToday =
      order.status === "cancelled" &&
      getFixedOffsetDayKey(parseDateMs(order.cancelledAt), timezoneOffsetMinutes) === todayKey;

    statusDistribution[order.status] += 1;
    recordActivity(order.createdAt, "createdCount");
    if (order.status === "completed") recordActivity(order.completedAt, "completedCount");
    if (order.status === "cancelled") recordActivity(order.cancelledAt, "cancelledCount");

    if (order.status === "pending") {
      summary.pending += 1;
      todos.push({
        todo: buildTodo(order, "pending_confirmation", createdAgeMinutes),
        overdueMinutes: null,
        createdAtMs,
      });
      if (
        createdAtMs !== null &&
        nowMs >= createdAtMs &&
        createdAgeMinutes >= thresholds.confirmationOverdueMinutes
      ) {
        summary.confirmationOverdue += 1;
        todos.push({
          todo: buildTodo(order, "confirmation_overdue", createdAgeMinutes),
          overdueMinutes: createdAgeMinutes - thresholds.confirmationOverdueMinutes,
          createdAtMs,
        });
      }
    } else if (order.status === "confirmed") {
      summary.processing += 1;
      const confirmedAtMs = parseDateMs(order.confirmedAt);
      const processingAgeMinutes = getAgeMinutes(confirmedAtMs, nowMs);
      todos.push({
        todo: buildTodo(order, "processing", processingAgeMinutes),
        overdueMinutes: null,
        createdAtMs,
      });
      if (
        confirmedAtMs !== null &&
        nowMs >= confirmedAtMs &&
        processingAgeMinutes >= thresholds.processingOverdueMinutes
      ) {
        summary.processingOverdue += 1;
        todos.push({
          todo: buildTodo(order, "processing_overdue", processingAgeMinutes),
          overdueMinutes: processingAgeMinutes - thresholds.processingOverdueMinutes,
          createdAtMs,
        });
      }
    }

    if (isCompletedToday) summary.completedToday += 1;
    if (isCancelledToday) summary.cancelledToday += 1;

    if (isActive && customerNote) {
      summary.customerNote += 1;
      todos.push({
        todo: buildTodo(order, "customer_note", createdAgeMinutes, customerNote),
        overdueMinutes: null,
        createdAtMs,
      });
    }

    if (order.status !== "cancelled") {
      const pricePrefix = trimText(order.pricePrefix);
      const current = amountByPricePrefix.get(pricePrefix) ?? {
        pricePrefix,
        totalAmount: 0,
        orderCount: 0,
        completedTodayAmount: 0,
        completedTodayCount: 0,
      };
      current.totalAmount = roundMoney(current.totalAmount + roundMoney(order.totalAmount));
      current.orderCount += 1;
      if (isCompletedToday) {
        current.completedTodayAmount = roundMoney(current.completedTodayAmount + roundMoney(order.totalAmount));
        current.completedTodayCount += 1;
      }
      amountByPricePrefix.set(pricePrefix, current);

      const productsInOrder = new Map<string, { name: string; quantity: number }>();
      order.items.forEach((item) => {
        const productId = trimText(item.productId);
        const rawQuantity = typeof item.quantity === "number" ? item.quantity : Number(item.quantity);
        if (!productId || !Number.isFinite(rawQuantity) || rawQuantity <= 0) return;
        const quantity = Math.max(1, Math.round(rawQuantity));
        const currentProduct = productsInOrder.get(productId) ?? { name: "", quantity: 0 };
        currentProduct.name = chooseStableProductName(currentProduct.name, item.name);
        currentProduct.quantity += quantity;
        productsInOrder.set(productId, currentProduct);
      });
      productsInOrder.forEach((product, productId) => {
        const currentProduct = productById.get(productId) ?? {
          productId,
          name: "",
          orderCount: 0,
          quantity: 0,
        };
        currentProduct.name = chooseStableProductName(currentProduct.name, product.name);
        currentProduct.orderCount += 1;
        currentProduct.quantity += product.quantity;
        productById.set(productId, currentProduct);
      });
    }
  });

  const sortedAmounts = [...amountByPricePrefix.values()].sort((left, right) =>
    compareText(left.pricePrefix, right.pricePrefix),
  );

  return {
    generatedAt: now.toISOString(),
    timezoneOffsetMinutes,
    thresholds,
    summary,
    amounts: sortedAmounts,
    analytics: {
      dailyTrend,
      statusDistribution,
      recent30Days,
      topProducts: [...productById.values()]
        .sort(compareTopProducts)
        .slice(0, MERCHANT_ORDER_WORKBENCH_TOP_PRODUCT_LIMIT),
      averageOrderAmounts: sortedAmounts.map((amount) => ({
        pricePrefix: amount.pricePrefix,
        orderCount: amount.orderCount,
        averageOrderAmount: roundMoney(amount.totalAmount / amount.orderCount),
      })),
    },
    todos: todos.sort(compareTodos).map((item) => item.todo),
  };
}
