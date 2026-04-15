import test from "node:test";
import assert from "node:assert/strict";
import {
  canRegisterAnotherSuperAdminDevice,
  normalizeSuperAdminMaxDevices,
  normalizeSuperAdminTrustedDeviceDetails,
  normalizeSuperAdminTrustedDevices,
  pickLeastRecentlyVerifiedSuperAdminTrustedDevice,
  removeSuperAdminTrustedDevice,
  upsertSuperAdminTrustedDevice,
} from "@/lib/superAdminTrustedDevices";

test("normalizeSuperAdminTrustedDevices keeps latest record per device", () => {
  const devices = normalizeSuperAdminTrustedDevices({
    devices: [
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-20T10:00:00.000Z",
        firstLoginIp: "1.1.1.1",
        lastLoginIp: "1.1.1.1",
        lastLoginStatus: "success",
      },
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-21T10:00:00.000Z",
        firstLoginIp: "1.1.1.1",
        lastLoginIp: "2.2.2.2",
        lastLoginStatus: "success",
      },
      {
        deviceId: "device-2",
        deviceLabel: "Mac / Safari",
        addedAt: "2026-03-22T10:00:00.000Z",
        lastVerifiedAt: "2026-03-22T10:00:00.000Z",
        firstLoginIp: "3.3.3.3",
        lastLoginIp: "3.3.3.3",
        lastLoginStatus: "success",
      },
    ],
  });

  assert.equal(devices.length, 2);
  assert.equal(devices[0]?.deviceId, "device-2");
  assert.equal(devices[1]?.lastLoginIp, "2.2.2.2");
});

test("upsertSuperAdminTrustedDevice preserves original addedAt and first login ip", () => {
  const devices = upsertSuperAdminTrustedDevice(
    [
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-20T10:00:00.000Z",
        firstLoginIp: "1.1.1.1",
        lastLoginIp: "1.1.1.1",
        lastLoginStatus: "success",
      },
    ],
    {
      deviceId: "device-1",
      deviceLabel: "Windows / Edge",
      verifiedAt: "2026-03-23T10:00:00.000Z",
      loginIp: "9.9.9.9",
    },
  );

  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.deviceLabel, "Windows / Edge");
  assert.equal(devices[0]?.addedAt, "2026-03-20T10:00:00.000Z");
  assert.equal(devices[0]?.firstLoginIp, "1.1.1.1");
  assert.equal(devices[0]?.lastLoginIp, "9.9.9.9");
});

test("normalizeSuperAdminTrustedDeviceDetails keeps useful browser information only", () => {
  const details = normalizeSuperAdminTrustedDeviceDetails({
    platform: "iPhone",
    os: "iOS 18.1",
    browser: "Safari",
    browserVersion: "18.1",
    model: "iPhone",
    deviceType: "mobile",
    language: "es-ES",
    languages: ["es-ES", "en-US"],
    timezone: "Europe/Madrid",
    screen: "1179×2556 @3x",
    viewport: "393×852",
    userAgent: "Mozilla/5.0",
    brands: ["Safari 18.1"],
    deviceMemory: "8 GB",
    hardwareConcurrency: "6",
  });

  assert.equal(details?.platform, "iPhone");
  assert.equal(details?.deviceType, "mobile");
  assert.deepEqual(details?.languages, ["es-ES", "en-US"]);
});

test("upsertSuperAdminTrustedDevice stores device details", () => {
  const devices = upsertSuperAdminTrustedDevice([], {
    deviceId: "device-1",
    deviceLabel: "iPhone / Safari",
    verifiedAt: "2026-04-15T10:00:00.000Z",
    loginIp: "4.4.4.4",
    details: {
      platform: "iPhone",
      os: "iOS 18.1",
      browser: "Safari",
      browserVersion: "18.1",
      model: "iPhone",
      deviceType: "mobile",
      language: "es-ES",
      languages: ["es-ES"],
      timezone: "Europe/Madrid",
      screen: "1179×2556 @3x",
      viewport: "393×852",
      userAgent: "Mozilla/5.0",
      brands: ["Safari 18.1"],
      deviceMemory: "",
      hardwareConcurrency: "6",
    },
  });

  assert.equal(devices[0]?.details?.browser, "Safari");
  assert.equal(devices[0]?.details?.timezone, "Europe/Madrid");
});

test("removeSuperAdminTrustedDevice removes the requested device only", () => {
  const devices = removeSuperAdminTrustedDevice(
    [
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-20T10:00:00.000Z",
        firstLoginIp: "1.1.1.1",
        lastLoginIp: "1.1.1.1",
        lastLoginStatus: "success",
      },
      {
        deviceId: "device-2",
        deviceLabel: "Mac / Safari",
        addedAt: "2026-03-22T10:00:00.000Z",
        lastVerifiedAt: "2026-03-22T10:00:00.000Z",
        firstLoginIp: "3.3.3.3",
        lastLoginIp: "3.3.3.3",
        lastLoginStatus: "success",
      },
    ],
    "device-1",
  );

  assert.deepEqual(
    devices.map((item) => item.deviceId),
    ["device-2"],
  );
});

test("canRegisterAnotherSuperAdminDevice blocks new devices when limit is reached", () => {
  const devices = [
    {
      deviceId: "device-1",
      deviceLabel: "Windows / Chrome",
      addedAt: "2026-03-20T10:00:00.000Z",
      lastVerifiedAt: "2026-03-20T10:00:00.000Z",
      firstLoginIp: "1.1.1.1",
      lastLoginIp: "1.1.1.1",
      lastLoginStatus: "success" as const,
    },
    {
      deviceId: "device-2",
      deviceLabel: "Mac / Safari",
      addedAt: "2026-03-22T10:00:00.000Z",
      lastVerifiedAt: "2026-03-22T10:00:00.000Z",
      firstLoginIp: "3.3.3.3",
      lastLoginIp: "3.3.3.3",
      lastLoginStatus: "success" as const,
    },
  ];

  assert.equal(canRegisterAnotherSuperAdminDevice(devices, 2, "device-3"), false);
  assert.equal(canRegisterAnotherSuperAdminDevice(devices, 2, "device-2"), true);
});

test("normalizeSuperAdminMaxDevices clamps values to a safe range", () => {
  assert.equal(normalizeSuperAdminMaxDevices(0), 1);
  assert.equal(normalizeSuperAdminMaxDevices(99), 20);
  assert.equal(normalizeSuperAdminMaxDevices("4"), 4);
});

test("pickLeastRecentlyVerifiedSuperAdminTrustedDevice returns the stalest verified device", () => {
  const device = pickLeastRecentlyVerifiedSuperAdminTrustedDevice([
    {
      deviceId: "device-1",
      deviceLabel: "Windows / Chrome",
      addedAt: "2026-04-01T10:00:00.000Z",
      lastVerifiedAt: "2026-04-10T10:00:00.000Z",
      firstLoginIp: "1.1.1.1",
      lastLoginIp: "1.1.1.1",
      lastLoginStatus: "success",
    },
    {
      deviceId: "device-2",
      deviceLabel: "iPhone / Safari",
      addedAt: "2026-04-02T10:00:00.000Z",
      lastVerifiedAt: "2026-04-05T10:00:00.000Z",
      firstLoginIp: "2.2.2.2",
      lastLoginIp: "2.2.2.2",
      lastLoginStatus: "success",
    },
    {
      deviceId: "device-3",
      deviceLabel: "Windows / Edge",
      addedAt: "2026-04-03T10:00:00.000Z",
      lastVerifiedAt: "2026-04-12T10:00:00.000Z",
      firstLoginIp: "3.3.3.3",
      lastLoginIp: "3.3.3.3",
      lastLoginStatus: "success",
    },
  ]);

  assert.equal(device?.deviceId, "device-2");
});
