export const MAX_MERCHANT_ENTERPRISE_PUBLISHED_WORKFLOW_CHOICES = 200;
export const MAX_MERCHANT_ENTERPRISE_PUBLISHED_WORKFLOW_STEPS = 50;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MerchantEnterprisePublishedWorkflowChoice = {
  id: string;
  title: string;
  scenario: string;
  revisionId: string;
  revisionNo: number;
  stepCount: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function read(
  source: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string,
) {
  return source[camelCaseKey] ?? source[snakeCaseKey];
}

function boundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : "";
}

function positiveInteger(value: unknown) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

export function normalizeMerchantEnterprisePublishedWorkflowChoice(
  value: unknown,
): MerchantEnterprisePublishedWorkflowChoice | null {
  const source = record(value);
  if (!source) return null;

  const id = boundedText(source.id, 80).toLowerCase();
  const title = boundedText(source.title, 160);
  const scenario = boundedText(source.scenario, 500);
  const revisionId = boundedText(
    read(source, "revisionId", "revision_id"),
    80,
  ).toLowerCase();
  const revisionNo = positiveInteger(
    read(source, "revisionNo", "revision_no"),
  );
  const stepCount = positiveInteger(
    read(source, "stepCount", "step_count"),
  );

  if (
    !UUID_PATTERN.test(id) ||
    !title ||
    !scenario ||
    !UUID_PATTERN.test(revisionId) ||
    revisionNo === null ||
    stepCount === null ||
    stepCount > MAX_MERCHANT_ENTERPRISE_PUBLISHED_WORKFLOW_STEPS
  ) {
    return null;
  }

  return { id, title, scenario, revisionId, revisionNo, stepCount };
}
