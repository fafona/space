// Tiny non-mutating reproduction of the previous inline-entry dependency loop.
export async function verifySelfImportAfterEvaluation(){await import(import.meta.url);return'fully-evaluated';}
if(process.argv[2]==='--old-inline-entry')await import(import.meta.url);
