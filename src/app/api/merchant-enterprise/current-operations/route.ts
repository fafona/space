import { handleMerchantEnterpriseCurrentOperationsGet } from "@/app/api/merchant-enterprise/current-operations/route-handler";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  return handleMerchantEnterpriseCurrentOperationsGet(request);
}
