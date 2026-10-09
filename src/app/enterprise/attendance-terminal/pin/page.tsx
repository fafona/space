import type {Metadata} from "next";
import {notFound} from "next/navigation";
import MerchantAttendancePinVerify from "@/components/enterprise/MerchantAttendancePinVerify";
export const dynamic="force-dynamic";
export const revalidate=0;
export const metadata:Metadata={title:"终端 PIN 验证 · Faolla",referrer:"no-referrer",robots:{index:false,follow:false}};
export default function Page(){
  if(process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED!=="1"||process.env.FAOLLA_ATTENDANCE_PIN_ENABLED!=="1")notFound();
  return <MerchantAttendancePinVerify/>;
}
