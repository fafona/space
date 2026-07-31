import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform merchant snapshot success response returns only the saved revision in payload", async () => {
  const routeSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const successResponse = routeSource.match(
    /const savedPayload = saveResult\.payload \?\? payload;[\s\S]*?return NextResponse\.json\(\{([\s\S]*?)\n  \}\);\n\}/,
  )?.[1];

  assert.ok(successResponse, "success response contract was not found");
  assert.match(successResponse, /count: savedPayload\.snapshot\.length/);
  assert.match(successResponse, /defaultSortRule: savedPayload\.defaultSortRule/);
  assert.match(successResponse, /revision,/);
  assert.match(successResponse, /payload: \{ revision \}/);
  assert.doesNotMatch(successResponse, /payload:\s*savedPayload/);
});
