import { handleCartCheckoutEntry } from "./route-handler";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handleCartCheckoutEntry(request); }
