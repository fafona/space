import { handleEventNotifications } from "./route-handler";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleEventNotifications(request);
export const POST = (request: Request) => handleEventNotifications(request);
