// Exact retained 8607 pre-worker-intent refusal. Metadata and hashes only.
const identity=(ino,mode,nlink,size,mtimeMs,ctimeMs=mtimeMs)=>({dev:64769,ino,uid:0,mode,nlink,size,mtimeMs,ctimeMs});
const file=(ino,size,time,sha256)=>({identity:identity(ino,0o100600,1,size,time),sha256});
export const PRE_INTENT=Object.freeze({toolRevision:'8607f9d21980f8330cba46eb13c7e8f5d99a8485',inventorySha256:'43fe04f0fb2fb15e64294f26d53fb35de1a16e5ce55e9cdba0bd9d076598892c',windowId:'a9ef45af-ddaa-4154-95bd-dd4fe1915383',operationId:'a9ef45af-ddaa-4154-95bd-dd4fe1915383',controllerPid:3199436,controllerStartTicks:'1225381285',operationInode:2624956,preConnectClosedDirectory:'/var/lib/faolla-booking-preconnect-closures/1ee7ada1-864d-4fac-a1ee-21a1adc6330a/e05de613-aa8c-4579-95ac-3a9542c9cd4d',preConnectClosedSha256:'04d60ef9627122594d58dabacb7ae636218c467cc5269a547d77574b0a9886a3',preConnectQualificationSha256:'04342395f3bda4aab3d4fa0c8a568d5264a0075401962234883c9174fd59ab4f',root:'/var/lib/faolla-booking-pre-intent-closures/a9ef45af-ddaa-4154-95bd-dd4fe1915383'});
export const PRE_INTENT_FILES=Object.freeze(['controller-exit-unconfirmed.json','publication-attempt.json','publication-unconfirmed.json','rollback-readiness.json']);
export default Object.freeze({
 operation:{directory:'/var/lib/faolla-maintenance/merchant-space/operation.lock',identity:identity(2624956,0o40700,2,4096,1793307715624.9365),files:{}},
 publication:{directory:'/var/lib/faolla-booking-active-publications/f274ad615550c83717aa7af2ad32339608e6f8aa/'+PRE_INTENT.windowId,identity:identity(4868359,0o40700,2,4096,1793307998672.882),files:{
  'controller-exit-unconfirmed.json':file(4868363,762,1793307998672.882,'48b47a58464dd5a2ac9d117167754962f612e21c7c40ac928dae027b9d98b4b4'),
  'publication-attempt.json':file(4868360,2620,1793307980654.694,'be26872a6ce8594c2cd3f19be8520bb368c48322fc237c3c6a3ebab41842931b'),
  'publication-unconfirmed.json':file(4868362,221,1793307998669.882,'6a4b20e5ca95021984ec70ae3310e94e3bdc4452432e070a69feb614c129878d'),
  'rollback-readiness.json':file(4868361,1375,1793307980656.694,'0fb1a596ce9fee3563260f71d00f54cea8a8ca138abb779a4a670843bbb83531')
 }},
 backup:{directory:'/var/lib/faolla-booking-handoff/f274ad615550c83717aa7af2ad32339608e6f8aa/toolchain-admission/1793307769645-29ab4c83-874d-4576-a9e8-454f14de39b5',identity:identity(4862672,0o40700,3,4096,1793307824413.0676),files:{
  'active-publication-backup-attempt.json':file(4862673,282,1793307769649.4983,'d511ab0207cf537a049d0e774641a301517f4df9bd6ba6ec43fb9a4a749228d7'),
  'backup-application-binding.json':file(4868358,2528,1793307824414.0676,'bdd8f59de3da212c3b41ff420eb54966a7b9c77fd5e2b6f6a532f4e92ad2093b'),
  'backup-create.json':file(4868356,3291,1793307811605.9346,'840b1236d532d65bc35d09bf534e0fbea496aa10325f94137110a13097be5336'),
  'backup-producer-source.json':file(4862711,374,1793307772672.5298,'543a5d72279e24bd93e821d2bb7da58f4ac443623223eac75b2a8dd7ac2381e0'),
  'backup-verify.json':file(4868357,3511,1793307822696.0498,'f712e7ce83452cf833769c90023a6f3c1db425a485763cd345e6abf0f56b1928'),
  'backup.key':file(4868354,65,1793307772678.5298,'35a9399af3347b5ba25d494fbafb9d372d2906421269f09acb91726441fd8ac1'),
  'database.tar.enc':file(4862720,569518112,1793307810940.9277,'6da0ef41c16f4e1d8a0b9d24b1f96ede9b9251837edd5343400008d943781fb5')
 }}
});
