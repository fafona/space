import { makeOperationalPunchHandler } from "../operational-punch-self/route-handler";
const pin = makeOperationalPunchHandler("pin");
export const operationalPunchPinDependencies = pin.dependencies;
export const handleOperationalPunchPin = pin.handle;
