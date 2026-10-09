import { attendanceSelfContextDependencies, handleAttendanceSelfContext } from "../../self-context/route-handler";
export const correctionContextEnabled = () => process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED === "1";
// Identical read-only auth/identity checks; correction use must not require enabling GPS.
export const handleCorrectionContext = (request: Request, overrides: Partial<typeof attendanceSelfContextDependencies> = {}) =>
  handleAttendanceSelfContext(request, { enabled: correctionContextEnabled, ...overrides });
