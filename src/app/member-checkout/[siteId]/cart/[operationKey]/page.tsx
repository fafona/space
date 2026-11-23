import { notFound } from "next/navigation";
import CartResultClient from "./CartResultClient";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
/** Old originals remain addressable after disabling new purchases. The key
 * is NOT authorization; the API independently verifies the actual customer. */
export default async function CartResultPage({ params }: { params: Promise<{ siteId: string; operationKey: string }> }) {
  const { siteId, operationKey } = await params;
  if (!/^\d{8}$/.test(siteId) || !/^[a-f0-9]{64}$/.test(operationKey)) notFound();
  return <CartResultClient siteId={siteId} operationKey={operationKey}/>;
}
