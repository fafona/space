import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL || "https://www.faolla.com";

const config: CapacitorConfig = {
  appId: "com.faolla.app",
  appName: "Faolla",
  webDir: "app-shell",
  server: {
    url: serverUrl,
    cleartext: false,
    allowNavigation: ["faolla.com", "*.faolla.com"],
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#081121",
    },
  },
};

export default config;
