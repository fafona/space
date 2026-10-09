import { makeOperationalPunchHandler } from "../operational-punch-self/route-handler";
const location = makeOperationalPunchHandler("location");
export const operationalPunchLocationDependencies = location.dependencies;
export const handleOperationalPunchLocation = location.handle;
