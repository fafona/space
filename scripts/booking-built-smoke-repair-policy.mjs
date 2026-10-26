// One approved already-built smoke-tool incident; no alternate targets or pins.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const BOOKING_BUILT_SMOKE_PINS=Object.freeze({
  "originalTool": "2fec6ef6f482cbdd066103986b9aad23c201a919",
  "retentionHeadSha256": "77ea9068d2c634f146f0f53be465ba9cb13ad335417cbc8f2228fd6bc5cef6cb",
  "processesSha256": "e84e8832160afe08981567c806f1952d7cdf84efd0493e1d9cc7cb64bef78af4",
  "protectedFiles": {
    "/var/lib/faolla-online-release/active.json": "20f06d98ce7cdbe9b3003b23d63967458842a144afd77ca04e249c38827c297b",
    "/var/lib/faolla-maintenance/merchant-space/state.json": "1443543536254a8b9edf318ef5382789cf1df62f4e8dfe72c60a1d003a60b673",
    "/www/server/panel/vhost/nginx/proxy/www.faolla.com/faolla_web_release.conf": "487d4192e05edbabac37d7e560e1cb29d07e4fc3455d034402d6f7939a8a6468",
    "/www/server/panel/vhost/nginx/proxy/www.faolla.com/e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf": "ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c",
    "/www/server/panel/vhost/nginx/proxy/www.faolla.com/no_store_entries_www.faolla.com.conf": "2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52",
    "/www/server/panel/vhost/nginx/proxy/www.faolla.com/faolla_contact_card_release.conf": "dfe65825dd3ed7f398541525277135f0a4ef3019424e7fcabb3d9c5c9dba3777"
  },
  "pair": [
    {
      "target": "6c5d5df31d06b43929e5ba5e6f3978dd51f1c6b0",
      "status": "booking-rollback-built",
      "port": 3110,
      "stateSha256": "36b56054d7f532f7e088e4c4fb584fbc18ece90cd5811e31c6eca13c86e89c3a",
      "files": {
        "attendance-build-proof.json": "3ff113faa788dd2c3421fa0b614fb03ddfcdf3fbdaf70c8de5344733a206ad2b",
        "attendance-build.env": "380dedb27329243fd404ec66978dc6d74fea43091545a097e3a61c26967fd078",
        "rollback-build-original-state.json": "7078efe6feefe159e9c108c8cbea92a3b5bc265e76765831841c21118067ec0d",
        "rollback-build-prepared.json": "5a8edd6279edd2121ed3d82f56f4c70bd9b016bea32f3961862d0c6c107748ed",
        "rollback-built.json": "be9fa4eb4b64a741628b9eabbfb5c4d0899ce0bbc7fb91b17ace1bdd6b4638a8",
        "runtime.json": "d61394ff511e29b5cbb86c329f8541183ddc4fbe99b5ce35ec203765e8fd0c69",
        "state.json": "36b56054d7f532f7e088e4c4fb584fbc18ece90cd5811e31c6eca13c86e89c3a"
      },
      "envSha256": "cbec5fc4981657a4c82c7cf7985f9b293a9ab83eacfbc8ad012abbac590c6c98",
      "dependencies": {
        "sha256": "cb0428251f3bfe2c700eedd3242d3506e0bdd556511852f9810e7dd62e9b63fe",
        "files": 31354,
        "bytes": 843728222
      },
      "built": {
        "sha256": "572e503ac11738d9c87ae48e76f76bd9afdf650fa252a6ac7dfb58a7ec5989f0",
        "files": 2017,
        "bytes": 38794546
      }
    },
    {
      "target": "f274ad615550c83717aa7af2ad32339608e6f8aa",
      "status": "preparing",
      "port": 3104,
      "stateSha256": "d0e8d279f285c2dcc70b4b48413bb24104ae41606817b98ce0bdc505eca96964",
      "files": {
        "after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf": "c039dadbac1cfb9439203548f36fc7c235d0cc45d02881a6915b9885cca21188",
        "after-faolla_contact_card_release.conf": "dc635c2c2b9328d8bbb938e2139d558e07e3bab9f53fdec116e2691f6846f34c",
        "after-no_store_entries_www.faolla.com.conf": "e8bc4dd372d0091b259b2142abbc19580f4b02950379d1970dfc8d6c8f2ad134",
        "attendance-build-proof.json": "64c3f92de89f33a085ceaced0d703ec670d05bd14ec8c1a60f2ee79353ac590f",
        "attendance-build.env": "26da92ddf1fbfc267fef8f62a6fd52bdb3891edf9e9182ba9b026d871957340e",
        "before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf": "ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c",
        "before-faolla_contact_card_release.conf": "dfe65825dd3ed7f398541525277135f0a4ef3019424e7fcabb3d9c5c9dba3777",
        "before-no_store_entries_www.faolla.com.conf": "2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52",
        "runtime.json": "4c040b280146884ef3351b95df66a33ef511df4319e44be02aafba1709dba9b3",
        "state.json": "d0e8d279f285c2dcc70b4b48413bb24104ae41606817b98ce0bdc505eca96964"
      },
      "envSha256": "7a3beb2c4a8b8d493972beb84401b6bcf4cd8385c0b786d8d997e10566466100",
      "dependencies": {
        "sha256": "cb0428251f3bfe2c700eedd3242d3506e0bdd556511852f9810e7dd62e9b63fe",
        "files": 31354,
        "bytes": 843728222
      },
      "built": {
        "sha256": "3b6b0ab719c85fbc0fbd4b68209511dd00621abfb4aafaf284bc2183bb4092a2",
        "files": 2017,
        "bytes": 38794568
      }
    }
  ]
});
export const BOOKING_BUILT_SMOKE_REPAIR_FILES=Object.freeze([
 'scripts/booking-release-probe.mjs','scripts/booking-release-probe.test.mjs',
 'scripts/booking-built-smoke-repair-policy.mjs','scripts/booking-built-smoke-repair-policy.test.mjs',
 'scripts/booking-built-smoke-repair.mjs','scripts/booking-built-smoke-repair.test.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs',
 'scripts/booking-handoff-policy.mjs','scripts/booking-handoff-runtime.mjs','scripts/booking-handoff-runtime.test.mjs',
 'scripts/booking-handoff-pending.mjs','scripts/booking-handoff-tool-preparation.test.mjs',
]);
export const BOOKING_BUILT_SMOKE_RECEIPT='built-smoke-tool-repair.json';
export const BOOKING_BUILT_SMOKE_ORIGINAL='built-smoke-original-state.json';
const need=(v,c)=>{if(!v)throw Error('booking_built_smoke_'+c);};
const hash=v=>createHash('sha256').update(v).digest('hex');
export const bookingBuiltSmokePinsSha256=hash(JSON.stringify(BOOKING_BUILT_SMOKE_PINS));
export function assertBookingBuiltSmokeToolDelta({files,originalInputs,currentInputs}){
 need(Array.isArray(files)&&new Set(files).size===files.length&&isDeepStrictEqual([...files].sort(),[...BOOKING_BUILT_SMOKE_REPAIR_FILES].sort()),'tool_scope');
 need(typeof originalInputs==='string'&&currentInputs===originalInputs,'application_inputs_changed');return hash(currentInputs);
}
export function assertBookingBuiltSmokeState(original,current,phase){
 need(['preparing','staged','database-ready'].includes(phase)&&hash(original)===BOOKING_BUILT_SMOKE_PINS.pair[1].stateSha256,'original_state');
 return assertBookingBuiltSmokePhaseTransition(original,current,phase);
}
export function assertBookingBuiltSmokePhaseTransition(original,current,phase){
 need(['preparing','staged','database-ready'].includes(phase),'phase');
 const expected=JSON.parse(original);need(expected.status==='preparing','original_phase');expected.status=phase;
 if(phase==='database-ready'){need(/^[a-f0-9]{64}$/.test(current.bookingDatabaseProofSha256??''),'database_proof');expected.bookingDatabaseProofSha256=current.bookingDatabaseProofSha256;}
 need(isDeepStrictEqual(current,expected),'state_transition');return true;
}
export function assertBookingBuiltSmokeReceipt(receipt,{toolRevision}={}){
 need(receipt&&isDeepStrictEqual(Object.keys(receipt).sort(),['schemaVersion','kind','originalTool','toolRevision','pinsSha256','sourceInputsSha256','toolClosureSha256','changedToolFiles','preparedAt'].sort()),'receipt_shape');
 need(receipt.schemaVersion===1&&receipt.kind==='booking-built-smoke-tool-repair'&&receipt.originalTool===BOOKING_BUILT_SMOKE_PINS.originalTool&&
  /^[a-f0-9]{40}$/.test(receipt.toolRevision??'')&&receipt.toolRevision!==receipt.originalTool&&(!toolRevision||receipt.toolRevision===toolRevision)&&
  receipt.pinsSha256===bookingBuiltSmokePinsSha256&&/^[a-f0-9]{64}$/.test(receipt.sourceInputsSha256??'')&&
  /^[a-f0-9]{64}$/.test(receipt.toolClosureSha256??'')&&Number.isFinite(Date.parse(receipt.preparedAt)),'receipt');
 need(isDeepStrictEqual(receipt.changedToolFiles,[...BOOKING_BUILT_SMOKE_REPAIR_FILES].sort()),'receipt_scope');return true;
}
