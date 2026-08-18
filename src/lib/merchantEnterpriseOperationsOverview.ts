import type { MerchantTask, MerchantTaskBoard } from "@/lib/merchantEnterprise";

const DEFAULT_DUE_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type MerchantEnterpriseOperationsBoardSummary = {
  boardId: string;
  boardName: string;
  openTaskCount: number;
  overdueTaskCount: number;
  dueSoonTaskCount: number;
};

export type MerchantEnterpriseOperationsOverview = {
  openTaskCount: number;
  overdueTaskCount: number;
  dueSoonTaskCount: number;
  unassignedTaskCount: number;
  involvedBoardCount: number;
  boardSummaries: MerchantEnterpriseOperationsBoardSummary[];
};

function parseTimestamp(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildMerchantEnterpriseOperationsOverview(
  input: {
    boards: readonly Pick<MerchantTaskBoard, "id" | "name" | "position" | "status">[];
    tasks: readonly Pick<
      MerchantTask,
      "id" | "boardId" | "assigneeIds" | "archivedAt" | "completedAt" | "dueAt"
    >[];
    assigneeId?: string;
    dueSoonWindowMs?: number;
  },
  nowMs = Date.now(),
): MerchantEnterpriseOperationsOverview {
  const dueSoonWindowMs =
    Number.isFinite(input.dueSoonWindowMs) && Number(input.dueSoonWindowMs) > 0
      ? Number(input.dueSoonWindowMs)
      : DEFAULT_DUE_SOON_WINDOW_MS;
  const dueSoonBoundaryMs = nowMs + dueSoonWindowMs;
  const activeBoards = input.boards
    .filter((board) => board.status === "active")
    .sort((left, right) => {
      if (left.position !== right.position) return left.position - right.position;
      const nameDifference = left.name.localeCompare(right.name);
      return nameDifference !== 0 ? nameDifference : left.id.localeCompare(right.id);
    });
  const activeBoardIds = new Set(activeBoards.map((board) => board.id));
  const matchingTasks = input.tasks.filter((task) => {
    if (task.archivedAt || task.completedAt || !activeBoardIds.has(task.boardId)) return false;
    return !input.assigneeId || task.assigneeIds.includes(input.assigneeId);
  });

  const boardSummaries = activeBoards.map((board) => {
    const boardTasks = matchingTasks.filter((task) => task.boardId === board.id);
    let overdueTaskCount = 0;
    let dueSoonTaskCount = 0;
    for (const task of boardTasks) {
      const dueAtMs = parseTimestamp(task.dueAt);
      if (dueAtMs === null) continue;
      if (dueAtMs < nowMs) {
        overdueTaskCount += 1;
      } else if (dueAtMs < dueSoonBoundaryMs) {
        dueSoonTaskCount += 1;
      }
    }
    return {
      boardId: board.id,
      boardName: board.name,
      openTaskCount: boardTasks.length,
      overdueTaskCount,
      dueSoonTaskCount,
    };
  });

  return {
    openTaskCount: matchingTasks.length,
    overdueTaskCount: boardSummaries.reduce(
      (total, board) => total + board.overdueTaskCount,
      0,
    ),
    dueSoonTaskCount: boardSummaries.reduce(
      (total, board) => total + board.dueSoonTaskCount,
      0,
    ),
    unassignedTaskCount: matchingTasks.filter((task) => task.assigneeIds.length === 0).length,
    involvedBoardCount: boardSummaries.filter((board) => board.openTaskCount > 0).length,
    boardSummaries: boardSummaries.sort((left, right) => {
      if (left.overdueTaskCount !== right.overdueTaskCount) {
        return right.overdueTaskCount - left.overdueTaskCount;
      }
      if (left.openTaskCount !== right.openTaskCount) {
        return right.openTaskCount - left.openTaskCount;
      }
      return left.boardName.localeCompare(right.boardName);
    }),
  };
}
