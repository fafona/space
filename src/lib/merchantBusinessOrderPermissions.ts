import type { MerchantBusinessActor } from "@/lib/merchantBusinessActor.server";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import type { MerchantOrderWorkbenchDashboard } from "@/lib/merchantOrderWorkbench";

function uniquePermissions(
  permissions: MerchantStaffBusinessPermission[],
) {
  return Array.from(new Set(permissions));
}

export function getMerchantOrderMutationRequiredPermissions(input: {
  action?: unknown;
  status?: unknown;
  items?: unknown;
}): MerchantStaffBusinessPermission[] | null {
  const hasAction =
    input.action !== undefined && input.action !== null && input.action !== "";
  const hasStatus =
    input.status !== undefined && input.status !== null && input.status !== "";
  const hasItems = Array.isArray(input.items);
  if ((hasAction && hasStatus) || (hasAction && hasItems)) return null;

  const permissions: MerchantStaffBusinessPermission[] = [];
  if (hasItems) permissions.push("orders.items.update");
  if (hasStatus) {
    if (
      input.status !== "pending" &&
      input.status !== "confirmed" &&
      input.status !== "completed" &&
      input.status !== "cancelled"
    ) {
      return null;
    }
    permissions.push(
      input.status === "completed" ? "orders.complete" : "orders.status.manage",
    );
  }
  if (input.action === "complete" || input.action === "uncomplete") {
    permissions.push("orders.complete");
  } else if (
    input.action === "confirm" ||
    input.action === "cancel" ||
    input.action === "restore"
  ) {
    permissions.push("orders.status.manage");
  } else if (input.action === "print") {
    permissions.push("orders.print");
  } else if (input.action === "touch") {
    // Touch is an internal acknowledgement and never receives its own broad
    // write permission. The employee must still be allowed to view orders.
    permissions.push("orders.view");
  } else if (hasAction) {
    return null;
  }
  return permissions.length > 0 ? uniquePermissions(permissions) : null;
}

export function redactMerchantOrderForBusinessActor(
  order: MerchantOrderRecord,
  actor: Pick<MerchantBusinessActor, "type" | "businessPermissions">,
): MerchantOrderRecord {
  if (
    actor.type === "owner" ||
    actor.businessPermissions.includes("orders.customer_data.view")
  ) {
    return order;
  }
  return {
    ...order,
    customerAccountId: "",
    customerUserId: "",
    customerLoginEmail: "",
    customerGuestHash: "",
    customer: {
      name: order.customer.name ? "客户" : "",
      phone: "",
      email: "",
      note: "",
    },
  };
}

export function redactMerchantOrdersForBusinessActor(
  orders: MerchantOrderRecord[],
  actor: Pick<MerchantBusinessActor, "type" | "businessPermissions">,
) {
  return orders.map((order) => redactMerchantOrderForBusinessActor(order, actor));
}

export function redactMerchantOrderWorkbenchForBusinessActor(
  dashboard: MerchantOrderWorkbenchDashboard,
  actor: Pick<MerchantBusinessActor, "type" | "businessPermissions">,
): MerchantOrderWorkbenchDashboard {
  if (
    actor.type === "owner" ||
    actor.businessPermissions.includes("orders.customer_data.view")
  ) {
    return dashboard;
  }
  return {
    ...dashboard,
    todos: dashboard.todos.map((todo) => ({
      ...todo,
      customerName: todo.customerName ? "客户" : "",
      note: undefined,
    })),
  };
}
