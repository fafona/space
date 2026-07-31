export type MerchantTaskOrderItem = Readonly<{
  id: string;
  columnId: string;
  position: number;
  createdAt: string;
}>;

export type MerchantTaskReorderIntent = Readonly<{
  taskId: string;
  targetColumnId: string;
  targetTaskId?: string;
  placement: "before" | "after" | "end";
}>;

export type MerchantTaskReorderPlan =
  | { kind: "noop" }
  | { kind: "invalid" }
  | {
      kind: "move";
      columnId: string;
      targetIndex: number;
      orderedTaskIds: string[];
    };

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function comparableTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function compareMerchantTaskOrder(
  left: MerchantTaskOrderItem,
  right: MerchantTaskOrderItem,
) {
  if (left.position !== right.position) return left.position - right.position;
  const timestampDifference =
    comparableTimestamp(left.createdAt) - comparableTimestamp(right.createdAt);
  if (Number.isFinite(timestampDifference) && timestampDifference !== 0) {
    return timestampDifference;
  }
  const createdAtDifference = compareText(left.createdAt, right.createdAt);
  if (createdAtDifference !== 0) return createdAtDifference;
  return compareText(left.id, right.id);
}

export function sortMerchantTaskOrderItems<T extends MerchantTaskOrderItem>(
  tasks: readonly T[],
) {
  return [...tasks].sort(compareMerchantTaskOrder);
}

function sameOrder(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((taskId, index) => taskId === right[index])
  );
}

export function planMerchantTaskReorder(
  tasks: readonly MerchantTaskOrderItem[],
  intent: MerchantTaskReorderIntent,
): MerchantTaskReorderPlan {
  if (!intent.taskId || !intent.targetColumnId) return { kind: "invalid" };
  if (!(["before", "after", "end"] as const).includes(intent.placement)) {
    return { kind: "invalid" };
  }

  const orderedTasks = sortMerchantTaskOrderItems(tasks);
  const activeTask = orderedTasks.find((task) => task.id === intent.taskId);
  if (!activeTask) return { kind: "invalid" };

  if (intent.targetTaskId === intent.taskId) {
    return activeTask.columnId === intent.targetColumnId
      ? { kind: "noop" }
      : { kind: "invalid" };
  }

  const targetTask = intent.targetTaskId
    ? orderedTasks.find((task) => task.id === intent.targetTaskId)
    : undefined;
  if (intent.targetTaskId && targetTask?.columnId !== intent.targetColumnId) {
    return { kind: "invalid" };
  }
  if (intent.placement !== "end" && !targetTask) return { kind: "invalid" };

  const originalColumnOrder = orderedTasks
    .filter((task) => task.columnId === activeTask.columnId)
    .map((task) => task.id);
  const targetTasks = orderedTasks.filter(
    (task) => task.columnId === intent.targetColumnId && task.id !== activeTask.id,
  );

  let targetIndex = targetTasks.length;
  if (intent.placement !== "end" && targetTask) {
    const targetTaskIndex = targetTasks.findIndex(
      (task) => task.id === targetTask.id,
    );
    if (targetTaskIndex < 0) return { kind: "invalid" };
    targetIndex =
      intent.placement === "after" ? targetTaskIndex + 1 : targetTaskIndex;
  }

  const orderedTaskIds = targetTasks.map((task) => task.id);
  orderedTaskIds.splice(targetIndex, 0, activeTask.id);

  if (
    activeTask.columnId === intent.targetColumnId &&
    sameOrder(originalColumnOrder, orderedTaskIds)
  ) {
    return { kind: "noop" };
  }

  return {
    kind: "move",
    columnId: intent.targetColumnId,
    targetIndex,
    orderedTaskIds,
  };
}
