import { handleOwnerNotifications } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleOwnerNotifications(request);
export const POST = (request: Request) => handleOwnerNotifications(request);
