export type MerchantOperationContext = {
  operationModule?: string;
  operationAction?: string;
  operationSummary?: string;
};

const operationContextStack: MerchantOperationContext[] = [];

function normalizeContextText(value: unknown, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeContext(context: MerchantOperationContext | null | undefined): MerchantOperationContext | null {
  if (!context) return null;
  const operationModule = normalizeContextText(context.operationModule, 120);
  const operationAction = normalizeContextText(context.operationAction, 120);
  const operationSummary = normalizeContextText(context.operationSummary, 240);
  if (!operationModule && !operationAction && !operationSummary) return null;
  return {
    ...(operationModule ? { operationModule } : {}),
    ...(operationAction ? { operationAction } : {}),
    ...(operationSummary ? { operationSummary } : {}),
  };
}

function removeContext(context: MerchantOperationContext) {
  const top = operationContextStack.length - 1;
  if (operationContextStack[top] === context) {
    operationContextStack.pop();
    return;
  }
  const index = operationContextStack.lastIndexOf(context);
  if (index >= 0) operationContextStack.splice(index, 1);
}

export function readCurrentMerchantOperationContext() {
  return operationContextStack[operationContextStack.length - 1] ?? null;
}

export function runWithMerchantOperationContext<T>(
  context: MerchantOperationContext | null | undefined,
  task: () => T,
): T {
  const normalized = normalizeContext(context);
  if (!normalized) return task();
  operationContextStack.push(normalized);
  try {
    return task();
  } finally {
    removeContext(normalized);
  }
}
