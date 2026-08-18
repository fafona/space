import assert from "node:assert/strict";
import test from "node:test";

import { MerchantEnterpriseAuthGeneration } from "@/lib/merchantEnterpriseAuthGeneration";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("a faster token B wins over a deferred token A completion", async () => {
  const auth = new MerchantEnterpriseAuthGeneration();
  const commits: string[] = [];
  const slowA = deferred();
  const fastB = deferred();

  const generationA = auth.begin();
  assert.equal(auth.bindSessionToken(generationA, "token-a"), true);
  const pendingA = slowA.promise.then(() => {
    if (auth.isCurrent(generationA, "token-a")) commits.push("token-a");
  });

  const generationB = auth.begin();
  assert.equal(auth.bindSessionToken(generationB, "token-b"), true);
  const pendingB = fastB.promise.then(() => {
    if (auth.isCurrent(generationB, "token-b")) commits.push("token-b");
  });

  fastB.resolve();
  await pendingB;
  slowA.resolve();
  await pendingA;

  assert.deepEqual(commits, ["token-b"]);
});

test("a sign-out generation prevents a deferred token from rebounding", async () => {
  const auth = new MerchantEnterpriseAuthGeneration();
  const commits: string[] = [];
  const slowA = deferred();

  const generationA = auth.begin();
  assert.equal(auth.bindSessionToken(generationA, "token-a"), true);
  const pendingA = slowA.promise.then(() => {
    if (auth.isCurrent(generationA, "token-a")) commits.push("token-a");
  });

  const signedOutGeneration = auth.begin();
  assert.equal(auth.bindSessionToken(signedOutGeneration, ""), true);
  if (auth.isCurrent(signedOutGeneration, "")) commits.push("signed-out");

  slowA.resolve();
  await pendingA;

  assert.deepEqual(commits, ["signed-out"]);
  assert.equal(auth.isCurrent(generationA, "token-a"), false);
  assert.equal(auth.isCurrent(signedOutGeneration, "", true), false);
});
