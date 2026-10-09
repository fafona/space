import type {Metadata} from "next";
import {notFound} from "next/navigation";
import MerchantAttendancePinClock from "@/components/enterprise/MerchantAttendancePinClock";
import {resolveCanonicalPortalOrigin} from "@/lib/canonicalPortalRequest";
import {terminalRecoveryUrlFromOrigin} from "@/lib/merchantAttendanceTerminalRecovery";
export const dynamic="force-dynamic";
export const revalidate=0;
export const metadata:Metadata={title:"门店 PIN 打卡 · Faolla",referrer:"no-referrer",robots:{index:false,follow:false}};
export default function Page(){
  if(process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED!=="1"||process.env.FAOLLA_ATTENDANCE_PIN_ENABLED!=="1"||process.env.FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED!=="1")notFound();
  return <MerchantAttendancePinClock recoveryUrl={terminalRecoveryUrlFromOrigin(resolveCanonicalPortalOrigin())}/>;
}
