// Actual merchant client and lazy panels. The runner supplies synthetic HTTP
// bootstrap only; there is no production session, build, or Next server here.
import { createRoot } from "react-dom/client";
import AdminClient from "../../src/app/admin/AdminClient";
import { I18nProvider } from "../../src/components/I18nProvider";
import LoginPage from "../../src/app/login/page";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

// Server page gating/configuration is explicitly synthetic here. Exact special
// routes must precede the generic employee portal; no paired cookie is injected.
const terminalPath = window.location.pathname;
if (process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TERMINALS_ENABLED === "1" && terminalPath === "/enterprise/attendance-terminal") {
  void import("../../src/components/enterprise/MerchantAttendanceTerminalDevice").then(({default: Device}) =>
    createRoot(document.getElementById("qa-root")!).render(<Device onsiteEnabled={process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED !== "1"} recoveryUrl={window.location.origin + "/enterprise"}/>));
} else if (process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED === "1" && terminalPath === "/enterprise/attendance-terminal/clock") {
  void import("../../src/components/enterprise/MerchantAttendancePinClock").then(({default: PinClock}) =>
    createRoot(document.getElementById("qa-root")!).render(<PinClock recoveryUrl={window.location.origin + "/enterprise"}/>));
} else if (process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TERMINALS_ENABLED === "1" && terminalPath === "/enterprise/attendance-terminal/onsite") {
  void import("../../src/components/enterprise/MerchantAttendanceOnsiteDisplay").then(({default: Display}) =>
    createRoot(document.getElementById("qa-root")!).render(<Display scanOrigin={window.location.origin} recoveryUrl={window.location.origin + "/enterprise"}/>));
} else if (process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TERMINALS_ENABLED === "1" && terminalPath === "/enterprise/attendance-scan") {
  void import("../../src/components/enterprise/MerchantAttendanceOnsitePhone").then(({default: Phone}) =>
    createRoot(document.getElementById("qa-root")!).render(<Phone scanOrigin={window.location.origin}/>));
} else if (window.location.pathname.startsWith("/enterprise")) {
  void import("./attendance-portal-browser");
} else createRoot(document.getElementById("qa-root")!).render(
  <I18nProvider initialLocale="zh-CN">
    {window.location.pathname === "/login"
      ? <SearchParamsContext.Provider value={new URLSearchParams(window.location.search)}><LoginPage /></SearchParamsContext.Provider>
      : <AdminClient forcedScope="site-99990001" startInLoadingState />}
  </I18nProvider>,
);
