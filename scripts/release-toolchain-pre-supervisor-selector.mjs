// Leaf only. Observers must never import an executing publication CLI.
import fs from'node:fs';import{PRE_SUPERVISOR as U}from'./release-toolchain-pre-supervisor-contract.mjs';
export const hasPreSupervisorDisposition=()=>fs.existsSync(U.publication)||fs.existsSync(U.root);
