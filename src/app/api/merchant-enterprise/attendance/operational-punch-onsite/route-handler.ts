import { makeOperationalPunchHandler } from "../operational-punch-self/route-handler";
const onsite = makeOperationalPunchHandler("onsite");
export const operationalPunchOnsiteDependencies = onsite.dependencies;
export const handleOperationalPunchOnsite = onsite.handle;
