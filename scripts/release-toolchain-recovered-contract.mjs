// Exact operator-approved recovered failure, NOT a generic reset/retry policy.
export const RECOVERED_BOOKING_ATTEMPT=Object.freeze({
 operationId:'11b4f503-ab11-4c4c-9ec2-8d4aee0c20de',
 priorTool:'0223b33b28fedbe603bc12dc44ade55ea4da8989',
 protectedSnapshotSha256:'1a0280fd8c141e46cd8bfcb55535af4f445a2e2f71094b8096e8c7fe43d2093f',
 databaseSha256:'a70c7b01d0967a32c81195051952d9e1c659dd290196dac66a8013c071cbc1ee',
 retentionHead:'77ea9068d2c634f146f0f53be465ba9cb13ad335417cbc8f2228fd6bc5cef6cb',
 files:Object.freeze([
 ['active-file-before-recovery.json',184,'20f06d98ce7cdbe9b3003b23d63967458842a144afd77ca04e249c38827c297b'],
 ['controller-failure.json',214,'ca4dbd4b42bb1d8342bfaa0bcfefc27125e0236290eec96e31e54a539d5bfcf5'],
 ['ingress-plan.json',5183,'3f73d0a60b12e5f965ef9d7ebc71e397d06c8987f114995b8eded78f01d232a7'],
 ['pm2-dump-before-recovery.json',366747,'6d1e5b272fc23b8811e73d105a90a98e3810364218d2a4903f13b13066c20589'],
 ['pm2-save-recovery-attempt.json',17290,'40ed96e367f03612bf0988401dec74b280b36d3161b36f166ccc66b568e0dd5e'],
 ['preflight.json',2434,'e4ce3b3b90a1f5e60e224560565cd85a6da5a2eb904fec555f5f72509fbee98d'],
 ['primary-state-before-recovery.json',25001,'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3'],
 ['recovery-plan.json',716,'cf6269d7323f9783eeadb40a17a141e2513c51d57cf106bdd0a54fc1c187aba6'],
 ['rollback-readiness.json',901,'cbc46dcc66e29651ee04e4884c47c42161017f0e9db310911c2886b78c65a139'],
 ['routing-plan.json',26309,'2ce56d28159fde96b681222b6174913b891ce944f3fbe292a529ddbfb8d1a837'],
 ['rule-repair-plan.json',12427,'bd2ded72a6020188a978710da65dfa186d0aed98d1ab6f878b2f0572c3410ba8'],
 ['watchdog-armed.json',382,'838f6e443c91c151379edbba1ca297312ede8a6923995b1092a6c1492560904a'],
 ['watchdog-finished.json',1185,'944e39b13f4d9277a229c49d8beda97a4ea2fbe0cfb7dbd75a52cdf575234076'],
 ['watchdog-lease.json',1017,'6837b934dcf8c29e3b8bf15078907f861a3065cc7da72e53f62f61391f5036d6'],
 ['watchdog-recovery-attempt.json',18513,'ba35debf9dc55b4caaffe844e5c8ca594f7582b378e284bdaf347922aab6a808'],
 ['watchdog-recovery.json',1030,'a742b6a47b7bc45214b44af0b2b434a488da82c7c3577bb3ca97bfceac346b10'],
 ['watchdog.log',0,'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
 ].map(v=>Object.freeze(v)))
});
export const RECOVERED_BOOKING_STATIC_NAMES=Object.freeze(['primary-original-stage.json','primary-runtime-restart-attempt.json','ready-worker-attempt.json','ready-worker-completed.json',
 'rollback-original-state.json','rollback-runtime-start-attempt.json','runtime-attempt.json','runtime-ready.json','static-assets.json','toolchain-admission','toolchain-qualification','toolchain-runtime','worker-runtime.json','worker-start-attempt.json']);
