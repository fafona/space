// Deliberately a leaf: observers must never import a currently executing CLI.
import fs from'node:fs';import{METADATA_RECOVERY as S}from'./release-toolchain-metadata-recovery-contract.mjs';
export const hasMetadataRecoveryDisposition=()=>fs.existsSync(S.publication)||fs.existsSync(S.root);
