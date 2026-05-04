import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL || "https://www.faolla.com";

const config: CapacitorConfig = {
  appId: "com.faolla.app",
  appName: "Faolla",
  webDir: "app-shell",
  server: {
    url: serverUrl,
    appStartPath: "/launch?appShell=faolla&nativeStart=1&nativeBuild=17",
    cleartext: false,
    allowNavigation: ["faolla.com", "*.faolla.com"],
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#ffffff",
    },
  },
};

export default config;
