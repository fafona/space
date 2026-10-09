import React from "react";
import {createRoot} from "react-dom/client";
import PinClock from "../../src/components/enterprise/MerchantAttendancePinClock";
import Device from "../../src/components/enterprise/MerchantAttendanceTerminalDevice";
createRoot(document.getElementById("qa-root")!).render(<><header className="qa-toolbar">隔离合成 PIN 打卡验收 · 仅本地实际组件／处理器／SQL · 无生产访问</header>{location.pathname.endsWith('/clock')?<PinClock/>:<Device/>}</>);
