// Test-resource teardown only: a failure must not skip later owned resources.
// A deadline stops waiting, not the underlying operation. Later browser/process
// shutdown steps must still run, and every failure remains visible to the caller.
export async function runAttendanceCleanupSteps(steps){
  const failures=[];
  for(const {name,run,timeoutMs=15000} of steps){
    let timer;
    try{
      await Promise.race([
        Promise.resolve().then(run),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`attendance_cleanup_timeout:${name}`)),timeoutMs);}),
      ]);
    }catch(error){failures.push(new Error(`attendance_cleanup_failed:${name}`,{cause:error}));}
    finally{clearTimeout(timer);}
  }
  if(failures.length)throw new AggregateError(failures,'attendance_cleanup_failed');
}

// Preserve download event history separately from disposal state. In-flight
// disposal is shared if a deadline expires; only a confirmed success is skipped.
export function deleteAttendanceDownloadOnce(record){
  if(record.deleted)return Promise.resolve();
  if(record.deleting)return record.deleting;
  const pending=Promise.resolve().then(()=>record.download.delete()).then(()=>{record.deleted=true;})
    .finally(()=>{record.deleting=null;});
  record.deleting=pending;
  return pending;
}
