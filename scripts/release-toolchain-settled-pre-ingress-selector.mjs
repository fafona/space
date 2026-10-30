// Deliberately a leaf: observers must never import a currently executing CLI.
import fs from'node:fs';import{SETTLED_PRE_INGRESS as S}from'./release-toolchain-settled-pre-ingress-contract.mjs';
export const hasSettledPreIngressDisposition=()=>fs.existsSync(S.publication)||fs.existsSync(S.root);
