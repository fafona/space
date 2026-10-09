// A 31-calendar-day period can exceed 744 hours across the autumn DST change.
// Unlike the single-shift formatter, a period must not impose a 31x24h ceiling.
export function formatAttendanceTimesheetDuration(value:number,signed=false){
  if(!Number.isSafeInteger(value)||(!signed&&value<0))throw Error("attendance_report_invalid_duration");
  const amount=Math.abs(value),seconds=Math.floor(amount/1000000),fraction=String(amount%1000000).padStart(6,"0").replace(/0+$/,"");
  return `${signed?(value<0?"−":value>0?"+":""):""}${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds/60)%60} 分 ${seconds%60}${fraction?`.${fraction}`:""} 秒`;
}
